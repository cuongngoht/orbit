// A zero-dependency PostgreSQL client for ONE thing: reading state below the interface. It opens a
// connection, authenticates as the startup user -- by SCRAM-SHA-256 with the server held to its own
// proof whenever a password is bound, or by nothing at all on a trusted network when none is; a
// server that asks for the password itself (cleartext, MD5) or says it accepted a connection that
// never finished its proof is refused, so the password never leaves and nobody can stand in for
// the server -- then runs the statements it is handed inside ONE
// transaction that is REPEATABLE READ and READ ONLY -- so every statement sees one snapshot, and
// the server itself refuses a write -- rolls it back and says goodbye.
//
// The socket comes from a factory the caller may hand in (`deps.socket`) and every clock from
// `deps.timers`, so a test needs no network and no waiting. Every way this ends badly is a
// PgError of one kind (errors.mjs), which a helper maps onto the orbit.helper/v1 classes without
// reading a message string.
import { createConnection } from "node:net";
import { PgError, serverError, closedError, protocolError, timeoutError, transportError } from "./errors.mjs";
import { MECHANISM, clientFinal, clientFirst, serverFirstOf, serverProved } from "./scram.mjs";
import { authCodeOf, columnsOf, createReader, fieldsOf, mechanismsOf, saslInitial, saslResponse, simpleQuery, startupMessage, statement, terminate, valuesOf } from "./wire.mjs";

const SYSTEM_TIMERS = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
const netSocket = (o) => createConnection({ host: o.host, port: o.port });

export const BEGIN = "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY";

// options: { host, port, user, password?, database?, timeoutMs }; statements: [{ sql, params }]
// -> [{ columns, rows: [[text|null]], command }], one per statement.
export async function readRows(options, statements, deps = {}) {
  const s = opened(options, deps);
  const timer = (deps.timers ?? SYSTEM_TIMERS).setTimeout(() => failed(s, timeoutError(`no answer within ${options.timeoutMs} ms`)), options.timeoutMs ?? 10000);
  try { return await conversation(s, options, statements); }
  finally { ended(s, deps, timer); }
}

async function conversation(s, options, statements) {
  await started(s);
  send(s, startupMessage({ user: options.user, database: options.database ?? options.user, client_encoding: "UTF8", application_name: "orbit" }));
  await authenticated(s, options);
  return readOnly(s, statements);
}

function ended(s, deps, timer) {
  (deps.timers ?? SYSTEM_TIMERS).clearTimeout(timer);
  if (s.open) s.socket.end(terminate());
  s.socket.destroy?.();
}

// ── the socket and the messages it delivers ────────────────────────────────

function opened(options, deps) {
  const s = { socket: (deps.socket ?? netSocket)(options), queue: [], waiters: [], error: null, open: false, accepted: false, scram: null, connected: deferred() };
  s.reader = createReader((m) => delivered(s, m));
  listened(s);
  return s;
}

// A connection that fails before anybody waits for it must not end the process: the rejection is
// observed here, and still thrown to whoever awaits it.
function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => Object.assign(d, { resolve, reject }));
  d.promise.catch(() => {});
  return d;
}

function listened(s) {
  s.socket.on("connect", () => s.connected.resolve((s.open = true)));
  s.socket.on("data", (chunk) => guarded(s, () => s.reader.push(chunk)));
  s.socket.on("error", (e) => failed(s, transportError(`the connection failed: ${e.code ?? e.message}`, e)));
  s.socket.on("close", () => failed(s, closedError("the server closed the connection")));
}

function guarded(s, fn) {
  try { fn(); }
  catch (e) { failed(s, e instanceof PgError ? e : protocolError(e.message)); }
}

const started = (s) => s.connected.promise;

function delivered(s, m) {
  const waiter = s.waiters.shift();
  if (waiter) return waiter.resolve(m);
  s.queue.push(m);
}

function failed(s, e) {
  s.error ??= e;
  s.open = false;
  s.connected.reject(s.error);
  for (const w of s.waiters.splice(0)) w.reject(s.error);
}

// The next message, or why there will be none. A connection that failed rejects every waiter.
function waitFor(s) {
  if (s.queue.length) return Promise.resolve(s.queue.shift());
  if (s.error) return Promise.reject(s.error);
  return new Promise((resolve, reject) => s.waiters.push({ resolve, reject }));
}

const send = (s, bytes) => s.socket.write(bytes);

// ── authentication ─────────────────────────────────────────────────────────

// Until the server is ready: an AuthenticationRequest is answered, parameters and keys are taken
// as they come, and an ErrorResponse is the end. Ready means authenticated as the binding requires.
async function authenticated(s, options) {
  for (let m = await waitFor(s); m.type !== "Z"; m = await waitFor(s)) {
    if (m.type === "E") throw serverError(fieldsOf(m.body));
    if (m.type === "R") answered(s, options, m.body);
  }
  if (!s.accepted) throw new PgError("refused", "the server said it was ready before it accepted this connection");
}

const hasPassword = (o) => typeof o.password === "string";

// One row per authentication request, and WHEN this client answers it. A password bound means SCRAM
// and nothing weaker; no password means a trusted network, and nothing that asks for one.
const AUTH = [
  { code: 0, allowed: (o, s) => (hasPassword(o) ? s.scram?.proved === true : !s.scram), answer: (s) => (s.accepted = true), say: "the server says it accepted this connection without the proof the bound password requires — it is not the server this connection was meant to reach" },
  { code: 3, allowed: () => false, say: "the server asks for the password in the clear — this client never sends one: it authenticates by SCRAM-SHA-256, or not at all" },
  { code: 5, allowed: () => false, say: "the server asks for an MD5 password — this client never sends a password a server can replay or crack: it authenticates by SCRAM-SHA-256, or not at all" },
  { code: 10, allowed: (o, s) => hasPassword(o) && !s.scram, answer: (s, o, body) => scramStarted(s, body), say: "the server asks for a password, and none is bound for this connection" },
  { code: 11, allowed: (o, s) => Boolean(s.scram?.first && !s.scram.final), answer: (s, o, body) => scramContinued(s, o, body), say: "the server continued a SCRAM exchange this client did not start" },
  { code: 12, allowed: (o, s) => Boolean(s.scram?.final && !s.scram.proved), answer: (s, o, body) => scramFinished(s, body), say: "the server finished a SCRAM exchange this client did not get to" },
];

function answered(s, options, body) {
  const row = AUTH.find((r) => r.code === authCodeOf(body));
  if (!row) throw new PgError("refused", `the server asks for an authentication this client does not speak (${authCodeOf(body)})`);
  if (!row.allowed(options, s)) throw new PgError("refused", row.say);
  row.answer(s, options, body);
}

function scramStarted(s, body) {
  if (!mechanismsOf(body).includes(MECHANISM)) throw new PgError("refused", `the server offers ${mechanismsOf(body).join(", ") || "no SASL mechanism"}, not ${MECHANISM}`);
  s.scram = { first: clientFirst() };
  send(s, saslInitial(MECHANISM, s.scram.first.message));
}

function scramContinued(s, o, body) {
  const server = serverFirstOf(body.subarray(4).toString("utf8"), s.scram.first.nonce);
  if (!server) throw protocolError("the server's SCRAM challenge does not extend this client's nonce");
  s.scram.final = clientFinal(o.password, s.scram.first, server);
  send(s, saslResponse(s.scram.final.message));
}

function scramFinished(s, body) {
  if (!serverProved(body.subarray(4).toString("utf8"), s.scram.final.serverSignature)) throw new PgError("refused", "the server could not prove it knows the password — it is not the server this connection was meant to reach");
  s.scram.proved = true;
}

// ── one read-only snapshot ─────────────────────────────────────────────────

async function readOnly(s, statements) {
  await simple(s, BEGIN);
  const results = [];
  for (const st of statements) results.push(await executed(s, st));
  await simple(s, "ROLLBACK");
  return results;
}

// A simple query whose answer is only that it was done.
async function simple(s, sql) {
  send(s, simpleQuery(sql));
  const out = await collected(s);
  if (out.error) throw serverError(out.error);
}

async function executed(s, st) {
  send(s, statement(st.sql, st.params ?? []));
  const out = await collected(s);
  if (out.error) throw serverError(out.error);
  return { columns: out.columns, rows: out.rows, command: out.command };
}

// Everything up to ReadyForQuery. After an ErrorResponse the server skips to its Sync, so the
// error is kept and the conversation read on to where it can continue.
async function collected(s) {
  const out = { columns: [], rows: [], command: null, error: null };
  for (let m = await waitFor(s); m.type !== "Z"; m = await waitFor(s)) took(out, m);
  return out;
}

const TAKES = { T: (out, b) => (out.columns = columnsOf(b)), D: (out, b) => out.rows.push(valuesOf(b)), C: (out, b) => (out.command = b.subarray(0, b.indexOf(0)).toString("utf8")), E: (out, b) => (out.error ??= fieldsOf(b)) };

const took = (out, m) => TAKES[m.type]?.(out, m.body);
