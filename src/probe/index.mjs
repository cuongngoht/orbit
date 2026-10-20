// The PROBE port: is something answering on THIS machine?
//
// What a readiness check needs and nothing a scanner would: one connection to
// one port, or one GET of one URL, with a deadline, and the answer as data. It
// exists so that "the dev server is up" is something Orbit can SAY and a test
// can fake -- nothing under src/runtime/ imports node:net or node:http.
//
// LOOPBACK ONLY, and that is the rule that makes it safe to hand to a setting a
// person types. A development server a person asked Orbit to start listens here;
// a probe that could be pointed at any host would be a way to make this machine
// knock on another one, from inside a tool that holds the developer's network.
// A target on another host is REFUSED, not skipped: `{ ok: false, refused: true }`
// with the sentence, and the caller says so out loud.
//
// Like the Process port it never throws: a connection that was refused, a
// deadline that was spent and a host that is not allowed are all `{ ok: false,
// error }`, and which of them is a blocker is the caller's judgement. Nothing a
// server answers is kept -- a status code and nothing of the body.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";

export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

// A connection that is ACCEPTED is not yet an answer. A container runtime publishes a port by listening
// on it itself and forwarding each connection inside -- and when nothing listens in there, it accepts
// and closes at once. So an accepted connection is held a moment: one the peer closes before saying
// anything is a forwarder with nobody behind it; one still open, or one that has spoken, is somebody
// listening. A server waits for its client or greets it; neither hangs up first.
export const HOLD_MS = 250;

// What counts as "this machine". Bracketed and bare IPv6 are the same address.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export const isLoopback = (host) => LOOPBACK.has(String(host).toLowerCase());

export function createProbe(deps = {}) {
  const io = { connect: deps.connect ?? netConnect, http: deps.http ?? httpRequest, https: deps.https ?? httpsRequest, timeoutMs: deps.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, holdMs: deps.holdMs ?? HOLD_MS };
  return { tcp: (port, opts = {}) => tcpProbe(io, port, opts), http: (url, opts = {}) => httpProbe(io, url, opts) };
}

const refusal = (host) => ({ ok: false, refused: true, error: `${host} is not this machine — a readiness probe only looks at localhost` });

// `localhost` can be either family: current Node, and most development servers, listen on ::1 alone,
// and a probe that only ever asked 127.0.0.1 would call a server that is up "not answering". So a probe
// that was not TOLD a host asks both loopbacks, and answers if either does; one that was told asks
// that one.
const LOOPBACKS = ["127.0.0.1", "::1"];

const bare = (host) => String(host).replace(/^\[|\]$/g, "");

async function tcpProbe(io, port, opts) {
  const hosts = opts.host === undefined ? LOOPBACKS : [opts.host];
  const elsewhere = hosts.find((h) => !isLoopback(h));
  if (elsewhere) return refusal(elsewhere);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: `${port} is not a port` };
  return firstAnswer(io, hosts.map(bare), port, opts.timeoutMs ?? io.timeoutMs);
}

async function firstAnswer(io, hosts, port, timeoutMs) {
  const answers = [];
  for (const host of hosts) {
    const got = await new Promise((resolve) => connected(io, host, port, timeoutMs, resolve));
    if (got.ok) return got;
    answers.push(got);
  }
  return { ok: false, error: answers.map((a) => a.error).join("; ") };
}

function connected(io, host, port, timeoutMs, resolve) {
  const socket = io.connect({ host, port });
  const done = once((answer) => (socket.destroy(), resolve(answer)));
  socket.setTimeout?.(timeoutMs);
  answering(socket, done, `${host}:${port}`, timeoutMs, io.holdMs);
}

function answering(socket, done, where, timeoutMs, holdMs) {
  socket.on("connect", () => held(socket, done, where, holdMs));
  socket.on("timeout", () => done({ ok: false, error: `nothing answered on ${where} within ${timeoutMs / 1000}s` }));
  socket.on("error", (e) => done({ ok: false, error: `${where} refused the connection (${e.code ?? e.message})` }));
}

function held(socket, done, where, holdMs) {
  const timer = setTimeout(() => done({ ok: true }), holdMs);
  const settle = (answer) => (clearTimeout(timer), done(answer));
  socket.on("data", () => settle({ ok: true }));
  for (const hangUp of ["end", "close"]) socket.on(hangUp, () => settle({ ok: false, error: `${where} accepted the connection and closed it before answering — a forwarded port with nothing listening behind it` }));
}

function httpProbe(io, url, opts) {
  const target = parsed(url);
  if (!target) return Promise.resolve({ ok: false, error: `${url} is not an http(s) URL` });
  if (!isLoopback(target.hostname)) return Promise.resolve(refusal(target.hostname));
  return new Promise((resolve) => requested(io, target, opts.timeoutMs ?? io.timeoutMs, resolve));
}

function parsed(url) {
  try {
    const target = new URL(url);
    return ["http:", "https:"].includes(target.protocol) ? target : null;
  } catch {
    return null;
  }
}

// GET, no headers of ours, no body kept. A development server's own certificate
// is rarely one a machine trusts, and nothing secret is sent, so over https the
// certificate is not what is being checked here -- only whether it answers.
function requested(io, target, timeoutMs, resolve) {
  const done = once(resolve);
  const send = target.protocol === "https:" ? io.https : io.http;
  const req = send(requestOptions(target, timeoutMs), (res) => (res.resume(), done({ ok: true, status: res.statusCode })));
  failing(req, done, target, timeoutMs);
  req.end();
}

const requestOptions = (target, timeoutMs) => ({ host: target.hostname.replace(/^\[|\]$/g, ""), port: target.port || undefined, path: `${target.pathname}${target.search}`, method: "GET", timeout: timeoutMs, rejectUnauthorized: false });

function failing(req, done, target, timeoutMs) {
  req.on("timeout", () => (req.destroy(), done({ ok: false, error: `${target.origin} did not answer within ${timeoutMs / 1000}s` })));
  req.on("error", (e) => done({ ok: false, error: `${target.origin} could not be reached (${e.code ?? e.message})` }));
}

// A socket may report an error AFTER a timeout destroyed it; the first answer
// is the answer.
export function once(fn) {
  let spent = false;
  return (value) => {
    if (spent) return;
    spent = true;
    fn(value);
  };
}
