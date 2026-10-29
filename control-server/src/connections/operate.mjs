// CONNECTIONS, shared by every project on this machine: which source, where,
// how it is let in, and where the credential comes from -- a person's to create,
// change, test and delete. The same operations the CLI performs
// (src/connections/manage.mjs, through core.mjs), over the machine store's
// control room.
//
// A credential VALUE arrives exactly once, in the body of PUT …/credential, and
// goes straight to the OS secret store through the secret port. No answer ever
// carries it -- an answer is a connection's public view, which says only
// whether a credential is set and where it comes from -- and no error repeats
// it: every sentence here is written from the request's shape, never its text.
// With no OS store on this machine the answer is 503 and nothing is kept.
//
// HOW a connection gets in is its `auth`, one of the strategies its provider's
// descriptor declares. One that SIGNS IN keeps no credential at all: what it
// uses is a session a tool holds, and the three operations below -- check,
// sign in, sign out -- are POSTs behind the token, because a status starts a
// program and a sign-in opens a browser; no GET does either. What they answer is
// the END STATE (the strategy, its state and what was found of the tool): the
// prompt the tool prints while a person signs in goes to the terminal Control
// runs in, never to the page, and no token is ever in an answer.
import { AuthBlocked, Blocked, Refused, connectionProblems, connectionsOf, excerpt, probeFor, providerDescriptors } from "../core.mjs";
import { guarded, invalid, missing, unavailable } from "../errors.mjs";
import { settingsOf } from "../reports/project.mjs";
import { providersView } from "./providers.mjs";

const managerOf = (ctx) => connectionsOf(ctx.world);

// A connection the request names that is not on this machine is a 404, before
// anything is asked of it.
function known(ctx, id) {
  if (typeof id !== "string" || !managerOf(ctx).list().some((c) => c.id === id)) throw missing("CONNECTION_NOT_FOUND", "there is no connection by that name on this machine");
  return managerOf(ctx);
}

export const listConnections = (ctx) => ({ connections: managerOf(ctx).list(), providers: providersView(), backend: ctx.world.secrets?.backend() ?? null });

export const readConnection = (ctx, id) => known(ctx, id).get(id);

// `auth` is { strategy, ...options }, held to the provider's descriptor by the manager: an unknown strategy, an option the
// strategy does not declare or one that is not in the form it asks for is a refusal that never repeats what it was given.
export const createConnection = (ctx, body) => guarded("CONNECTION_INVALID", () => managerOf(ctx).create(fieldsOf(body, ["id", "provider", "label", "host", "organization", "note", "auth"])));

export const updateConnection = (ctx, id, body) => guarded("CONNECTION_INVALID", () => known(ctx, id).update(id, fieldsOf(body, ["label", "host", "organization", "note", "auth"])));

export const removeConnection = (ctx, id) => guarded("CONNECTION_NOT_REMOVED", () => known(ctx, id).remove(id));

// { value } is kept in the OS secret store; { env } references a variable the
// person sets themselves. Exactly one of them.
export async function setCredential(ctx, id, body) {
  const input = credentialOf(body);
  const connection = await guarded("CREDENTIAL_NOT_SET", () => known(ctx, id).setCredential(id, input));
  ctx.log(`credential for connection ${id} set (${connection.credential.from})`);
  return { connection, backend: ctx.world.secrets?.backend() ?? null };
}

export const clearCredential = (ctx, id) => guarded("CREDENTIAL_NOT_CLEARED", () => known(ctx, id).clearCredential(id));

// Authentication, then the reads THIS project's report would make when it
// uses this provider -- and nothing more.
export const testConnection = (ctx, id) => guarded("CONNECTION_TEST_FAILED", () => known(ctx, id).test(id, probeFor(settingsOf(ctx), ctx.world.reportSources, ctx.world.fetch)));

// ---- how a connection gets in: its session, looked at and moved ---------------------------------------------------

const AUTH_INVALID = "CONNECTION_AUTH_INVALID";

// A look at the session (it never signs in, and never installs a tool), a sign-in -- the person's own act, which waits for them
// to finish it in the browser -- and a sign-out.
export const checkAuth = (ctx, id) => asked(ctx, id, (manager) => manager.authStatus(id));

export const signIn = (ctx, id, body) => asked(ctx, id, (manager) => manager.signIn(id, { ...signInOptions(manager, id, body), notify: (line) => ctx.log(`sign-in ${id}: ${line}`) }));

export const signOut = (ctx, id) => asked(ctx, id, (manager) => manager.signOut(id));

// One question put to the connection's manager, answered as the state it left the session in.
async function asked(ctx, id, run) {
  const manager = known(ctx, id);
  const state = await typed(() => run(manager));
  return stateView({ strategy: manager.get(id).auth.strategy, ...state });
}

async function typed(fn) {
  try { return await fn(); }
  catch (e) { throw translated(e); }
}

// The typed stops a sign-in can end in, in this server's words: BLOCKED (503) carries the engine's own code and the one next step a
// person can take, and every sentence passes the engine's sanitiser once more on the way out -- tokens masked, secrets scrubbed,
// control characters gone, one short line. A refusal is the request's fault (400). Anything else is a bug here: it is not echoed (what
// a tool or the disk said may carry a path) but passed on as it is, so the server logs it and the page is told the generic sentence.
function translated(e) {
  if (e instanceof AuthBlocked) return unavailable(e.code, excerpt(e.message, [], 400), e.next ? excerpt(e.next) : undefined);
  if (e instanceof Blocked) return unavailable("AUTH_BLOCKED", excerpt(e.message, [], 400));
  return e instanceof Refused ? invalid(AUTH_INVALID, excerpt(e.message, [], 400)) : e;
}

// What a page is told of a session, by an allow-list: what an adapter reports beyond this is the adapter's.
const stateView = (s) => ({ strategy: text(s.strategy, 64), state: text(s.state, 40), ...(s.tool ? { tool: toolView(s.tool) } : {}) });

const toolView = (t) => ({ found: t.found === true, version: text(t.version, 60), source: text(t.source, 40), acquirable: text(t.acquirable, 80), tried: (Array.isArray(t.tried) ? t.tried : []).map((x) => ({ id: text(x?.id, 80), reason: text(x?.reason, 240) })) });

const text = (value, most) => (typeof value === "string" && value ? excerpt(value, [], most) : null);

// ---- a sign-in's options ------------------------------------------------------------------------------------------

const SIGN_IN = ["tenant", "deviceCode"];

// The options of a sign-in are the strategy's own, held to the descriptor by the very rules an `auth` is held to when it is saved. That
// matters: one of them reaches a program as an argument, so nothing that is not in the form the descriptor allows ever gets there.
function signInOptions(manager, id, body) {
  const given = optionsOf(body);
  const record = manager.record(id);
  const problems = connectionProblems({ ...record, auth: { strategy: record.auth?.strategy ?? "credential", ...given } }, providerDescriptors()).filter((p) => p.startsWith("auth"));
  if (problems.length) throw invalid(AUTH_INVALID, `the sign-in was not started: ${problems.join("; ")}`);
  return given;
}

function optionsOf(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid(AUTH_INVALID, `the body is a JSON object: { ${SIGN_IN.join("?, ")}? }`);
  if (Object.keys(body).some((k) => !SIGN_IN.includes(k))) throw invalid(AUTH_INVALID, `a sign-in takes ${SIGN_IN.join(" and ")} only`);
  return Object.fromEntries(SIGN_IN.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
}

function fieldsOf(body, keys) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("CONNECTION_INVALID", "the body is a JSON object");
  return Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, typeof body[k] === "string" ? body[k].trim() : body[k]]));
}

function credentialOf(body) {
  const given = ["value", "env"].filter((k) => typeof body?.[k] === "string" && body[k].length > 0);
  if (given.length !== 1 || Object.keys(body ?? {}).some((k) => !["value", "env"].includes(k))) throw invalid("CREDENTIAL_INVALID", "send exactly one of { value } (kept in this machine's OS secret store) or { env } (the name of an environment variable you set)");
  return given[0] === "env" ? { env: body.env.trim() } : { value: body.value };
}
