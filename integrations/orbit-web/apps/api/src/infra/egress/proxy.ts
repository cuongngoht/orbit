// THE AGENT'S ONLY WAY OUT (governed deployment): an egress proxy in the control plane. The agent's container is on an
// internal network with no route anywhere else, so every connection it makes to the internet comes through here -- and
// each one is a DECISION of its account's policy in effect (`network.egress` on `host:port`), asked as the run it belongs
// to (its token, carried as the proxy's credential) and recorded. Two ways through, nothing else:
//
//   CONNECT host:port               a tunnel (HTTPS, or anything else the decision allows), as before;
//   GET http://host/path HTTP/1.1   plain HTTP, to port 80 only: the request is forwarded as it is, its answer handed back
//                                   as it is -- a redirect included, never followed here: following it is the client's
//                                   new request, decided again.
//
// Whatever a policy says, a connection never reaches an address that is not on the public internet (addresses.ts): the
// name is resolved ONCE, that address is checked, and the connection is made to exactly it. An employee's assignment run
// is held closer: ports 80 and 443 only, no internal range the installation named, every connection kept in its network
// log (a ConnectionSink), and the limits its account's policy sets (ledger.ts) -- beside the installation's own cap on
// the connections one run holds open, which every run is held to.
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from "node:http";
import { connect, isIP, type BlockList, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import type { Readable, Writable } from "node:stream";
import type { NetworkLimits } from "@orbit-web/governance-core";
import { addressRefusal, forbiddenAddress, forbiddenForEmployee, unmapped } from "./addresses.js";
import { DEFAULT_MAX_CONNECTIONS_PER_RUN, EgressLedger, type Meter } from "./ledger.js";

export { allowedPrivate, forbiddenAddress, forbiddenForEmployee, isMetadataAddress } from "./addresses.js";

export interface EgressAsk {
  host: string;
  port: number;
  // The run's token, from the proxy credential (`run:<token>`); null when none was given.
  token: string | null;
  // Where the connection came from.
  from: string;
}

// The run a connection was decided as.
export interface EgressRun {
  // The run (its binding's id) and its account.
  id: string;
  accountId: string;
  // An employee's assignment run: ports 80 and 443 only, no internal range the installation named, its connections kept
  // in its network log, its account policy's limits applied.
  employee: boolean;
  // The limits the account's policy in effect sets for this connection (an employee's run; null: none).
  limits: NetworkLimits | null;
}

export interface EgressVerdict {
  allow: boolean;
  // Said to the agent's program when refused.
  reason: string;
  // The run the connection was decided as (absent or null: no run's token).
  run?: EgressRun | null;
}

export type EgressDecider = (ask: EgressAsk) => EgressVerdict | Promise<EgressVerdict>;

export const CONNECTION_VERDICTS = ["allowed", "refused", "limited"] as const;
export type ConnectionVerdict = (typeof CONNECTION_VERDICTS)[number];

// Why a connection of a run was not made: its account's policy, a port an employee's run does not reach, a limit, a
// name that does not resolve, an address that is not on the public internet, a log that could not be written.
export type ConnectionCause = "policy" | "port" | "limit" | "unresolved" | "address" | "unrecorded";

export interface ConnectionReason {
  cause: ConnectionCause;
  // What the agent's program was told.
  message: string;
  // The address the name resolved to, when that is what was refused.
  address?: string;
}

// WHERE THE PROXY SAYS WHAT A RUN'S CONNECTIONS DID: each one the moment it is decided -- refused or limited at once, or
// allowed and about to be made -- and, once an allowed one ends, the bytes it carried each way (in: from the host to the
// run; out: from the run to the host) and, when a limit cut it, why. What is kept, and where, is the sink's to say.
export interface ConnectionSink {
  // The entry's id, for `closed` (null: not kept). A failure refuses an allowed connection: one that cannot be recorded
  // is not made.
  opened(run: EgressRun, host: string, port: number, verdict: ConnectionVerdict, reason: ConnectionReason | null): Promise<string | null>;
  closed(id: string, bytesIn: number, bytesOut: number, cut: string | null): Promise<void>;
  // What the account's runs downloaded since a moment: a daily limit outlives a restart of this process.
  downloadedSince?(accountId: string, since: string): Promise<number>;
}

export interface ProxyOptions {
  decide: EgressDecider;
  // Whether a connection to the proxy itself is from the agent's network (others are dropped unanswered).
  admit: (remoteAddress: string | undefined) => boolean;
  resolve?: (host: string) => Promise<string>;
  own?: ReadonlySet<string>;
  // Which resolved addresses are never reached (default: forbiddenAddress, or forbiddenForEmployee for an employee's run,
  // over this host's own addresses).
  forbidden?: (address: string, employee: boolean) => boolean;
  // The internal ranges the installation named (ORBIT_WEB_EGRESS_PRIVATE_ALLOW): never an employee's.
  privateAllowed?: BlockList | null;
  sink?: ConnectionSink;
  // The installation's cap on the connections one run holds open at once (default 256).
  maxConnectionsPerRun?: number;
  // How a connection to an address that passed is made (default: TCP to exactly that address -- never a name again).
  dial?: (address: string, port: number) => Socket;
  // What could not be recorded after the agent was answered, for the operator's log.
  warn?: (message: string) => void;
  now?: () => number;
}

const HOST = /^[A-Za-z0-9.-]{1,253}$/;

const EMPLOYEE_PORTS: readonly number[] = [80, 443];

// `Proxy-Authorization: Basic base64(run:<token>)`.
export function tokenOf(header: string | undefined): string | null {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1) || null;
}

const ownAddresses = (): Set<string> => new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => unmapped(i.address))));

const STATUS_TEXT: Record<number, string> = { 400: "Bad Request", 403: "Forbidden", 405: "Method Not Allowed", 407: "Proxy Authentication Required", 429: "Too Many Requests", 502: "Bad Gateway" };

function refuse(socket: Socket, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? "Bad Gateway"}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOrbit Web governance: ${reason}\n`);
}

function reply(res: ServerResponse, status: number, reason: string): void {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, { "content-type": "text/plain", connection: "close" });
  res.end(`Orbit Web governance: ${reason}\n`);
}

interface Proxy {
  o: ProxyOptions;
  ledger: EgressLedger;
  resolve: (host: string) => Promise<string>;
  forbidden: (address: string, employee: boolean) => boolean;
  dial: (address: string, port: number) => Socket;
  warn: (message: string) => void;
}

function proxyOf(o: ProxyOptions): Proxy {
  const own = (): ReadonlySet<string> => o.own ?? ownAddresses();
  return {
    o,
    ledger: new EgressLedger({ maxConnectionsPerRun: o.maxConnectionsPerRun ?? DEFAULT_MAX_CONNECTIONS_PER_RUN, ...(o.now !== undefined ? { now: o.now } : {}) }),
    resolve: o.resolve ?? (async (h: string) => (await lookup(h)).address),
    forbidden: o.forbidden ?? ((a, employee) => (employee ? forbiddenForEmployee(a, own()) : forbiddenAddress(a, own(), o.privateAllowed ?? null))),
    dial: o.dial ?? ((address, port) => connect({ host: address, port })),
    warn: o.warn ?? (() => undefined),
  };
}

type Passed = { ok: true; address: string; run: EgressRun | null; meter: Meter | null; logId: string | null };
type Refused = { ok: false; status: number; reason: string };

// A refusal of a run's connection is said to the sink; one it could not keep still stands.
async function refused(p: Proxy, run: EgressRun | null, host: string, port: number, status: number, verdict: "refused" | "limited", reason: ConnectionReason): Promise<Refused> {
  if (run !== null && p.o.sink !== undefined) {
    try {
      await p.o.sink.opened(run, host, port, verdict, reason);
    } catch (err) {
      p.warn(`a refused connection of run ${run.id} to ${host}:${port} could not be recorded: ${(err as Error).message}`);
    }
  }
  return { ok: false, status, reason: reason.message };
}

// The name resolved ONCE and that address checked: the connection is then made to exactly it.
async function addressOf(p: Proxy, host: string, employee: boolean): Promise<{ ok: true; address: string } | { ok: false; status: number; reason: ConnectionReason }> {
  let address: string;
  try {
    address = isIP(host) !== 0 ? host : await p.resolve(host);
  } catch {
    return { ok: false, status: 502, reason: { cause: "unresolved", message: `${host} does not resolve` } };
  }
  if (p.forbidden(address, employee)) return { ok: false, status: 403, reason: { cause: "address", message: addressRefusal(host, address, employee), address } };
  return { ok: true, address };
}

// Everything that stands before a connection is made: its decision, the ports of an employee's run, the run's limits,
// the address. What passes holds a place among the run's open connections, and is in its log, until it ends.
async function gate(p: Proxy, host: string, port: number, token: string | null, from: string): Promise<Passed | Refused> {
  const verdict = await p.o.decide({ host, port, token, from });
  const run = verdict.run ?? null;
  const employee = run?.employee === true;
  if (!verdict.allow) return refused(p, run, host, port, 403, "refused", { cause: "policy", message: verdict.reason });
  if (employee && !EMPLOYEE_PORTS.includes(port)) return refused(p, run, host, port, 403, "refused", { cause: "port", message: `an employee's run reaches ports 80 and 443 only, not ${port}` });
  let meter: Meter | null = null;
  if (run !== null) {
    const sink = p.o.sink;
    if (run.limits?.downloadBytesPerDay !== undefined && sink?.downloadedSince !== undefined) await p.ledger.seed(run.accountId, (since) => (sink.downloadedSince as NonNullable<ConnectionSink["downloadedSince"]>)(run.accountId, since));
    const admission = p.ledger.admit(run);
    if (!admission.ok) return refused(p, run, host, port, 429, "limited", { cause: "limit", message: admission.reason });
    meter = admission.meter;
  }
  const at = await addressOf(p, host, employee);
  if (!at.ok) {
    meter?.release();
    return refused(p, run, host, port, at.status, "refused", at.reason);
  }
  let logId: string | null = null;
  try {
    if (run !== null && p.o.sink !== undefined) logId = await p.o.sink.opened(run, host, port, "allowed", null);
  } catch (err) {
    meter?.release();
    p.warn(`a connection of run ${run?.id ?? "none"} to ${host}:${port} could not be recorded, so it was not made: ${(err as Error).message}`);
    return { ok: false, status: 502, reason: "this connection could not be recorded, so it is not made" };
  }
  return { ok: true, address: at.address, run, meter, logId };
}

// One allowed connection, said to have ended once, however it ended: its place among the run's open ones is given back
// and the sink is told what it carried.
class Connection {
  private ended = false;
  private cut: string | null = null;

  constructor(
    private readonly p: Proxy,
    private readonly passed: Passed,
  ) {}

  limit(why: string): void {
    this.cut ??= why;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const { meter, logId, run } = this.passed;
    meter?.release();
    if (logId === null || this.p.o.sink === undefined) return;
    this.p.o.sink.closed(logId, meter?.bytesIn ?? 0, meter?.bytesOut ?? 0, this.cut).catch((err: unknown) => this.p.warn(`the end of a connection of run ${run?.id ?? "none"} could not be recorded: ${(err as Error).message}`));
  }
}

interface Step {
  piece: Buffer;
  // Milliseconds to wait before it moves (the run's bandwidth).
  wait: number;
  // Set when a limit ends the connection after this piece.
  cut: string | null;
}

// How each direction's bytes pass a run's meter: what comes from the host may be cut short by a download limit, and both
// directions share the run's bandwidth. A connection of no run passes as it is.
function stepsOf(meter: Meter | null): { down: (chunk: Buffer) => Step; up: (chunk: Buffer) => Step } {
  if (meter === null) return { down: (piece) => ({ piece, wait: 0, cut: null }), up: (piece) => ({ piece, wait: 0, cut: null }) };
  return {
    down: (chunk) => {
      const { pass, cut } = meter.down(chunk.length);
      const piece = pass < chunk.length ? chunk.subarray(0, pass) : chunk;
      return { piece, wait: meter.delay(piece.length), cut };
    },
    up: (chunk) => {
      meter.up(chunk.length);
      return { piece: chunk, wait: meter.delay(chunk.length), cut: null };
    },
  };
}

// Moves what `from` reads to `to` a chunk at a time, each through `step`; `from` is paused meanwhile, so the proxy holds
// at most one chunk a direction and a slow side slows the other. Its end is passed on -- after the chunk still waiting
// for its turn, if any: a source that has nothing more ends even while it is paused.
function relay(from: Readable, to: Writable, step: (chunk: Buffer) => Step, onCut: (why: string) => void): void {
  let waiting = false;
  let ended = false;
  const finish = (): void => {
    if (!to.destroyed && !to.writableEnded) to.end();
  };
  from.on("data", (chunk: Buffer) => {
    const s = step(chunk);
    waiting = true;
    from.pause();
    const go = (): void => {
      waiting = false;
      if (s.piece.length > 0 && !to.destroyed && !to.writableEnded) to.write(s.piece);
      if (s.cut !== null) return onCut(s.cut);
      if (ended) return finish();
      if (to.writableNeedDrain) to.once("drain", () => from.resume());
      else from.resume();
    };
    if (s.wait > 0) setTimeout(go, s.wait);
    else go();
  });
  from.on("end", () => {
    ended = true;
    if (!waiting) finish();
  });
}

async function tunnel(p: Proxy, req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
  const target = String(req.url ?? "");
  const colon = target.lastIndexOf(":");
  const host = target.slice(0, colon).replace(/^\[|\]$/g, "");
  const port = Number(target.slice(colon + 1));
  if (colon <= 0 || !HOST.test(host) || !Number.isInteger(port) || port <= 0 || port > 65535) return refuse(client, 403, "that is not a host:port the proxy reads");
  const passed = await gate(p, host.toLowerCase(), port, tokenOf(req.headers["proxy-authorization"]), client.remoteAddress ?? "");
  if (!passed.ok) return refuse(client, passed.status, passed.reason);
  const conn = new Connection(p, passed);
  const { down, up } = stepsOf(passed.meter);
  const upstream = p.dial(passed.address, port);
  let established = false;
  const cut = (why: string): void => {
    conn.limit(why);
    client.end();
    upstream.destroy();
  };
  upstream.once("connect", () => {
    established = true;
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(up(head).piece);
    relay(upstream, client, down, cut);
    relay(client, upstream, up, cut);
  });
  upstream.on("error", () => (established ? client.destroy() : refuse(client, 502, `${host}:${port} could not be reached`)));
  upstream.on("close", () => conn.end());
  client.on("error", () => upstream.destroy());
  client.on("close", () => {
    upstream.destroy();
    conn.end();
  });
}

// What a forwarded request or answer carries on: everything but what belongs to one hop (the run's token above all).
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);

function forwarded(headers: IncomingHttpHeaders, set: Record<string, string>): OutgoingHttpHeaders {
  const named = String(headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((h) => h.trim());
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined && !HOP_BY_HOP.has(name) && !named.includes(name)) out[name] = value;
  return { ...out, ...set };
}

const ONLY = "only HTTPS through CONNECT, or plain HTTP to port 80 asked as an absolute http:// request, leaves the agent's container -- and only where the account's policy allows";

async function forward(p: Proxy, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = String(req.url ?? "");
  if (!/^http:\/\//i.test(raw)) return reply(res, 405, ONLY);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reply(res, 400, "that is not a URL the proxy reads");
  }
  const host = url.hostname;
  const port = url.port === "" ? 80 : Number(url.port);
  if (!HOST.test(host)) return reply(res, 403, "that is not a host the proxy reads");
  if (port !== 80) return reply(res, 403, `plain HTTP is forwarded to port 80 only, not ${port}: use HTTPS (CONNECT) for another port`);
  const passed = await gate(p, host, port, tokenOf(req.headers["proxy-authorization"]), req.socket.remoteAddress ?? "");
  if (!passed.ok) return reply(res, passed.status, passed.reason);
  const conn = new Connection(p, passed);
  const { down, up } = stepsOf(passed.meter);
  const upstream = httpRequest({ method: req.method, path: `${url.pathname}${url.search}`, headers: forwarded(req.headers, { host, connection: "close" }), createConnection: () => p.dial(passed.address, port) });
  // A limit ends the answer short of its end: the client sees a connection that closed, never an answer that looks whole.
  const cut = (why: string): void => {
    conn.limit(why);
    upstream.destroy();
    res.socket?.end();
  };
  upstream.on("response", (answer: IncomingMessage) => {
    res.writeHead(answer.statusCode ?? 502, answer.statusMessage, forwarded(answer.headers, { connection: "close" }));
    relay(answer, res, down, cut);
  });
  upstream.on("error", () => (res.headersSent ? res.destroy() : reply(res, 502, `${host}:${port} could not be reached`)));
  upstream.on("close", () => conn.end());
  res.on("close", () => {
    upstream.destroy();
    conn.end();
  });
  relay(req, upstream, up, cut);
}

export function startEgressProxy(port: number, o: ProxyOptions, host = "0.0.0.0"): Promise<Server> {
  const p = proxyOf(o);
  const server = createServer((req, res) => {
    void forward(p, req, res).catch(() => reply(res, 502, "the proxy failed"));
  });
  server.on("connection", (socket: Socket) => {
    if (!o.admit(socket.remoteAddress)) socket.destroy();
  });
  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on("error", () => undefined);
    void tunnel(p, req, client, head).catch(() => refuse(client, 502, "the proxy failed"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
