// The Azure CLI as the way a connection signs in to Azure DevOps: the ADAPTER the generic contract
// (src/connections/auth.mjs) asks for a token, a status, a sign-in and a sign-out.
//
// It owns the SEQUENCE and the Azure-specific words; it owns NO environment and starts nothing but through a launcher
// the tools layer built (src/tools/launch.mjs), so whatever program runs -- a private copy Orbit keeps, or the machine's
// own as a program only -- runs in Orbit's profile, never anybody else's.
//
//   acquire   [no profile yet: no process, straight to "sign in"] -> token -> (sign-in required | a person must act) ->
//             `az login` ONCE, however many readers are waiting -> token ONCE. A sign-in is never repeated: a person
//             who cancelled, or one the service refused, is told, and nothing loops
//   status    never signs in and never installs: is a tool here, is anybody signed in
//   signIn    a person's act: the tool is fetched when none is usable, the sign-in shown to them as it appears
//   signOut   `az logout`, against Orbit's profile and nowhere else
//   explain   when the source refuses a token, say which directory to name if the sign-in reaches several
//
// Nothing that a command printed is ever shown as it came (`excerpt`), a token is only ever an answer -- never an
// argument, a variable or a log line -- and the sign-in prompt reaches the person's own terminal and nowhere else.
import { AuthBlocked, excerpt } from "../../../src/connections/auth-errors.mjs";
import { ToolBlocked } from "../../../src/tools/ensure.mjs";
import { alreadyOut, cancelled, classify } from "./azure-cli-classify.mjs";
import { loginArgs, logoutArgs, tenantsArgs, tokenArgs } from "./azure-cli-command.mjs";

const TOKEN_DEADLINE_MS = 90_000;
const LOGIN_DEADLINE_MS = 5 * 60_000;
const LOGOUT_DEADLINE_MS = 60_000;
const NOTICE_LINES = 20;

// deps: { tools: { ensure(ids), find(ids) }, process (runAsync, runObserved), io: { exists, ensurePrivateDir }, nowMs,
//         emit?({ phase, outcome }), next?: { signIn(connection) -> the command to type } }
export function azureCliAdapter(deps) {
  const flight = { login: null, tokens: new Map() };
  return { acquire: (a) => acquired(deps, flight, a), status: (a) => statusOf(deps, flight, a), signIn: (a) => signedIn(deps, flight, a), signOut: (a) => signedOut(deps, a), explain: (a) => explained(deps, a) };
}

const tenantOf = (a) => a.tenant ?? a.connection?.auth?.tenant ?? null;

const argsOf = (a) => ({ resource: a.strategy.resource, tenant: tenantOf(a), deviceCode: a.deviceCode ?? a.connection?.auth?.deviceCode === true });

const said = (deps, phase, outcome) => deps.emit?.({ phase, outcome });

const nextStep = (deps, connection) => deps.next?.signIn?.(connection) ?? "sign in with the connections sign-in command";

// ---- the tool ------------------------------------------------------------------------------------------------------

async function ensured(deps, strategy) {
  try { return await deps.tools.ensure(strategy.tools); }
  catch (error) { throw error instanceof ToolBlocked ? blockedTool(error) : error; }
}

const TOOL_CODES = { TOOL_MISSING: "AUTH_TOOL_MISSING", TOOL_UNSUPPORTED: "AUTH_TOOL_UNSUPPORTED", TOOL_UNVERIFIED: "AUTH_TOOL_UNVERIFIED", TOOL_INSTALL_FAILED: "AUTH_TOOL_MISSING" };

const blockedTool = (e) => new AuthBlocked(TOOL_CODES[e.code] ?? "AUTH_TOOL_MISSING", excerpt(e.message, [], 400), "install the Azure CLI, or use a personal access token for this connection instead");

const toolView = (seen) => ({ found: Boolean(seen.found), version: seen.found?.version ?? null, source: seen.found?.source ?? null, acquirable: seen.acquirable ?? null, tried: seen.tried.map((t) => ({ id: t.id, reason: t.reason ? excerpt(t.reason) : null })) });

// ---- a token -------------------------------------------------------------------------------------------------------

async function acquired(deps, flight, a) {
  const tool = await ensured(deps, a.strategy);
  const seen = a.interactive === "force" ? { need: "forced" } : await attempt(deps, flight, tool, a);
  if (seen.token) return seen.token;
  if (a.interactive === "never") throw signInNeeded(deps, a.connection, seen.need);
  return signedInThen(deps, flight, tool, a);
}

// No profile directory means nobody has signed in here: that is known without starting anything.
async function attempt(deps, flight, tool, a) {
  const launcher = tool.launcher("session");
  if (!deps.io.exists(launcher.profileDir)) return { need: "login-required" };
  return outcomeOf(deps, await tokenOf(deps, flight, launcher, a), a);
}

// Many readers asking at once start one process per tenant, not one each.
function tokenOf(deps, flight, launcher, a) {
  const key = String(tenantOf(a) ?? "");
  if (!flight.tokens.has(key)) flight.tokens.set(key, runOf(deps, launcher, tokenArgs(argsOf(a)), TOKEN_DEADLINE_MS).finally(() => flight.tokens.delete(key)));
  return flight.tokens.get(key);
}

// Every child runs FROM the profile directory: a directory only this user can enter and write. Never a shared one (a
// program that puts its working directory on its module search path would otherwise load what another user planted).
const runOf = (deps, launcher, args, timeoutMs) => deps.process.runAsync(launcher.file, [...launcher.args, ...args], { env: launcher.env, timeoutMs, cwd: launcher.profileDir });

function outcomeOf(deps, result, a) {
  const outcome = classify(result);
  said(deps, "token", outcome);
  return OUTCOME[outcome](deps, result, a);
}

const OUTCOME = {
  ok: (deps, r) => ({ token: parsed(deps, r.out) }),
  "login-required": () => ({ need: "login-required" }),
  "interaction-required": () => ({ need: "interaction-required" }),
  network: () => { throw new AuthBlocked("AUTH_TOKEN_FAILED", "the sign-in service could not be reached", "check the network or proxy, then try again"); },
  failed: (deps, r) => { throw new AuthBlocked("AUTH_TOKEN_FAILED", `the Azure CLI could not give a token: ${excerpt(r.err || r.out || r.error)}`); },
};

// `expires_on` is when the token ends, in seconds; a token without it is used once and never kept.
function parsed(deps, out) {
  const doc = readJson(out);
  if (typeof doc?.accessToken !== "string" || doc.accessToken.length < 20) throw new AuthBlocked("AUTH_TOKEN_FAILED", "the Azure CLI answered, but not with a token");
  const at = Number(doc.expires_on) * 1000;
  return { token: doc.accessToken, expiresAt: Number.isFinite(at) && at > deps.nowMs() ? at : null };
}

function readJson(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

const signInNeeded = (deps, connection, need) => new AuthBlocked("AUTH_LOGIN_REQUIRED", need === "interaction-required" ? "the Microsoft sign-in needs a person again (the session ended, or a policy asks for more)" : "no one has signed in to Microsoft for Orbit on this machine", nextStep(deps, connection));

// ---- signing in ----------------------------------------------------------------------------------------------------

async function signedInThen(deps, flight, tool, a) {
  await loggedIn(deps, flight, tool, a);
  const again = await attempt(deps, flight, tool, a);
  if (again.token) return again.token;
  throw new AuthBlocked("AUTH_LOGIN_FAILED", "the sign-in finished, but no token could be had after it", nextStep(deps, a.connection));
}

// ONE sign-in however many callers want it; the next caller after it ends may start another.
function loggedIn(deps, flight, tool, a) {
  flight.login ??= signing(deps, tool.launcher("session"), a).finally(() => { flight.login = null; });
  return flight.login;
}

// Signing in again is signing out first: the profile holds one account, so "another account" replaces it.
async function signing(deps, launcher, a) {
  if (a.interactive === "force") await loggedOut(deps, launcher);
  return login(deps, launcher, a);
}

async function login(deps, launcher, a) {
  deps.io.ensurePrivateDir(launcher.profileDir);
  a.notify?.("Opening Microsoft sign-in. Finish it in the browser; if none opens, follow the instructions below.");
  const result = await deps.process.runObserved(launcher.file, [...launcher.args, ...loginArgs(argsOf(a))], { env: launcher.env, timeoutMs: LOGIN_DEADLINE_MS, cwd: launcher.profileDir, observe: noticesTo(a.notify) });
  said(deps, "login", result.ok ? "ok" : cancelled(result) ? "cancelled" : "failed");
  if (!result.ok) throw loginFailure(deps, result, a);
}

const loginFailure = (deps, result, a) => (cancelled(result) ? new AuthBlocked("AUTH_LOGIN_CANCELLED", "the Microsoft sign-in was not finished", nextStep(deps, a.connection)) : new AuthBlocked("AUTH_LOGIN_FAILED", `the Microsoft sign-in failed: ${excerpt(result.err || result.out || result.error)}`, nextStep(deps, a.connection)));

// What the tool prints while a person signs in -- the browser notice, the device code -- goes to the person's own
// terminal, line by line, as it arrives: bounded, scrubbed, and never kept or logged anywhere else.
function noticesTo(notify) {
  if (!notify) return null;
  const seen = { pending: "", lines: 0 };
  return (stream, bytes) => { if (stream === "err") flushed(seen, bytes, notify); };
}

function flushed(seen, bytes, notify) {
  const parts = (seen.pending + bytes.toString("utf8")).split(/\r?\n/);
  seen.pending = parts.pop();
  for (const line of parts) if (seen.lines < NOTICE_LINES && line.trim()) (seen.lines += 1, notify(excerpt(line)));
}

async function loggedOut(deps, launcher) {
  const result = await runOf(deps, launcher, logoutArgs(), LOGOUT_DEADLINE_MS);
  said(deps, "logout", alreadyOut(result) ? "ok" : "failed");
  if (!alreadyOut(result)) throw new AuthBlocked("AUTH_TOKEN_FAILED", `the Azure CLI could not sign out: ${excerpt(result.err || result.out || result.error)}`);
}

async function signedIn(deps, flight, a) {
  const tool = await ensured(deps, a.strategy);
  await loggedIn(deps, flight, tool, { ...a, interactive: "force" });
  const now = await statusOf(deps, flight, a);
  if (now.state !== "authenticated") throw new AuthBlocked("AUTH_LOGIN_FAILED", "the sign-in finished, but it does not give a token", nextStep(deps, a.connection));
  return now;
}

// ---- looking, and signing out --------------------------------------------------------------------------------------

async function statusOf(deps, flight, a) {
  const seen = deps.tools.find(a.strategy.tools);
  if (!seen.found) return { state: "tool-missing", tool: toolView(seen) };
  return { state: await stateOf(deps, flight, seen.found.launcher("session"), a), tool: toolView(seen) };
}

const STATE = { ok: "authenticated", "login-required": "sign-in-required", "interaction-required": "interaction-required", network: "failed", failed: "failed" };

async function stateOf(deps, flight, launcher, a) {
  if (!deps.io.exists(launcher.profileDir)) return "sign-in-required";
  return STATE[classify(await tokenOf(deps, flight, launcher, a))];
}

async function signedOut(deps, a) {
  const seen = deps.tools.find(a.strategy.tools);
  if (!seen.found) return { state: "tool-missing", tool: toolView(seen) };
  const launcher = seen.found.launcher("session");
  if (deps.io.exists(launcher.profileDir)) await loggedOut(deps, launcher);
  return { state: "sign-in-required", tool: toolView(seen) };
}

// When a source does not accept the token and the sign-in reaches several directories, the connection must say which.
async function explained(deps, a) {
  if (a.stop?.kind !== "auth" || a.connection?.auth?.tenant) return null;
  const seen = deps.tools.find(a.strategy.tools);
  const tenants = seen.found ? await tenantsOf(deps, seen.found.launcher("session")) : [];
  return tenants.length > 1 ? new AuthBlocked("AUTH_TENANT_AMBIGUOUS", "this sign-in reaches more than one directory, and the source did not accept the token it got", "name the directory (its id or domain) on this connection, then try again") : null;
}

async function tenantsOf(deps, launcher) {
  const result = await runOf(deps, launcher, tenantsArgs(), TOKEN_DEADLINE_MS);
  return result.ok ? [...new Set((readJson(result.out) ?? []).filter((t) => typeof t === "string"))] : [];
}
