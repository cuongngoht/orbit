// THE AGENT'S ONLY WAY OUT (governed deployment): an HTTPS CONNECT proxy in the control plane. The agent's container is
// on an internal network with no route anywhere else, so every connection it makes to the internet comes through
// here -- and each one is a DECISION of the Constitution in effect (`network.egress` on `host:port`), asked as the run
// it belongs to (its token, carried as the proxy's credential) and recorded. Nothing else is tunnelled: no plain HTTP,
// no connection that does not name a run, and never the control plane itself -- loopback, link-local and this host's
// own addresses are refused whatever a policy says, so a permissive rule cannot become a way around the agent
// network's gate.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";

export interface EgressAsk {
  host: string;
  port: number;
  // The run's token, from the proxy credential (`run:<token>`); null when none was given.
  token: string | null;
  // Where the connection came from.
  from: string;
}

export interface EgressVerdict {
  allow: boolean;
  // Said to the agent's program when refused.
  reason: string;
}

export type EgressDecider = (ask: EgressAsk) => EgressVerdict | Promise<EgressVerdict>;

const HOST = /^[A-Za-z0-9.-]{1,253}$/;

// `Proxy-Authorization: Basic base64(run:<token>)`.
export function tokenOf(header: string | undefined): string | null {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1) || null;
}

const unmapped = (a: string): string => (a.startsWith("::ffff:") ? a.slice(7) : a);

// Addresses no agent connection may reach whatever the policy says: this host, loopback, link-local, unspecified.
export function forbiddenAddress(address: string, own: ReadonlySet<string>): boolean {
  const a = unmapped(address);
  if (own.has(a)) return true;
  if (isIP(a) === 4) return a.startsWith("127.") || a.startsWith("169.254.") || a === "0.0.0.0" || a.startsWith("0.");
  return a === "::1" || a === "::" || a.toLowerCase().startsWith("fe80:");
}

const ownAddresses = (): Set<string> => new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => unmapped(i.address))));

function refuse(socket: Socket, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : status === 407 ? "Proxy Authentication Required" : "Bad Gateway"}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOrbit Web governance: ${reason}\n`);
}

export interface ProxyOptions {
  decide: EgressDecider;
  // Whether a connection to the proxy itself is from the agent's network (others are dropped unanswered).
  admit: (remoteAddress: string | undefined) => boolean;
  resolve?: (host: string) => Promise<string>;
  own?: ReadonlySet<string>;
  // Which resolved addresses are never reached (default: forbiddenAddress over this host's own addresses).
  forbidden?: (address: string) => boolean;
}

async function tunnel(o: ProxyOptions, req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
  const target = String(req.url ?? "");
  const colon = target.lastIndexOf(":");
  const host = target.slice(0, colon).replace(/^\[|\]$/g, "");
  const port = Number(target.slice(colon + 1));
  if (colon <= 0 || !HOST.test(host) || !Number.isInteger(port) || port <= 0 || port > 65535) return refuse(client, 403, "that is not a host:port the proxy reads");
  const verdict = await o.decide({ host: host.toLowerCase(), port, token: tokenOf(req.headers["proxy-authorization"]), from: client.remoteAddress ?? "" });
  if (!verdict.allow) return refuse(client, 403, verdict.reason);
  let address: string;
  try {
    address = isIP(host) ? host : await (o.resolve ?? (async (h: string) => (await lookup(h)).address))(host);
  } catch {
    return refuse(client, 502, `${host} does not resolve`);
  }
  const forbidden = o.forbidden ?? ((a: string) => forbiddenAddress(a, o.own ?? ownAddresses()));
  if (forbidden(address)) return refuse(client, 403, `${host} is Orbit Web's own host or a local address: never reached through the proxy`);
  const upstream = connect({ host: address, port });
  upstream.on("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => refuse(client, 502, `${host}:${port} could not be reached`));
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
}

export function startEgressProxy(port: number, o: ProxyOptions, host = "0.0.0.0"): Promise<Server> {
  const server = createServer((_req, res) => {
    res.writeHead(405, { "content-type": "text/plain", connection: "close" });
    res.end("Orbit Web governance: only HTTPS (CONNECT) leaves the agent's container, and only where the Constitution allows.\n");
  });
  server.on("connection", (socket: Socket) => {
    if (!o.admit(socket.remoteAddress)) socket.destroy();
  });
  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on("error", () => undefined);
    void tunnel(o, req, client, head).catch(() => refuse(client, 502, "the proxy failed"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
