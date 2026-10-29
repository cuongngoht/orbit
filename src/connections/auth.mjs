// The AUTH of a connection: how a request to its source is AUTHORISED -- the one contract every reader, collector and
// probe asks, so none of them knows whether a person pasted a token or signed in.
//
//   credential   a REFERENCE to a secret (src/secrets.mjs), read at the moment a request needs it
//   broker       a session a TOOL holds, asked for a short-lived token each time one is needed; the tool and what it
//                prints are an ADAPTER's (bound by a composition root, one per strategy id), never this file's
//
// What a caller gets from `resolve` is a RequestAuth, LAZY -- nothing is read or started until `headers()` is called:
//
//   headers()      the authorization header for the NEXT request. Asked for on every request (a token that was good
//                  when a long run began can be spent before it ends); a token is kept in memory until two minutes
//                  before it expires, and many requests asking at once cause ONE acquisition. Never stored anywhere
//   secrets()      every token this RequestAuth ever issued, so a snapshot or a response can be scanned for them
//   invalidate()   forget the token (the source said 401): the next headers() asks again
//   rejected(stop) the source refused what was asked even so: a BLOCKED answer that says which of two things it was --
//                  or, when the adapter knows better (which directory to name), that
//   expiresAt()    when the current token ends, or null
//
// `interactive` says what an acquisition may do when a person must act: "when-required" (the default) lets the adapter
// start a sign-in and show the person what to do through `notify`; "never" refuses instead and names the command that
// does it; "force" signs in again even though a token could be had.
//
// Pure of vendors and of tools: a provider's descriptor names its strategies (`authentication.strategies`), an adapter
// answers for a strategy id, and a strategy of kind `credential` is read from the secret port.
import { Refused } from "../errors.mjs";
import { AuthBlocked } from "./auth-errors.mjs";
import { configured, strategyOf } from "./model.mjs";

export { configured, strategyOf };

// A token is replaced this long before it expires: a request made now must still be good when the source reads it.
export const SAFETY_MS = 120_000;

const providerOf = (deps, connection) => deps.providers.find((p) => p.id === connection?.provider);

// deps: { secrets (secretSource), adapters: { <strategy id>: { acquire, status, signIn, signOut } }, providers, nowMs }
export function createAuth(deps) {
  const strategy = (c) => strategyOf(c, providerOf(deps, c));
  return {
    strategyOf: strategy,
    configured: (c) => configured(c, providerOf(deps, c)),
    resolve: (c, options = {}) => requestAuth(deps, c, strategy(c), options),
    status: (c) => statusOf(deps, c, strategy(c)),
    signIn: (c, options = {}) => signedIn(deps, c, strategy(c), options),
    signOut: (c) => signedOut(deps, c, strategy(c)),
  };
}

function requestAuth(deps, connection, strategy, options) {
  const held = { value: null, expiresAt: 0, pending: null, issued: new Set() };
  const acquire = () => (strategy.kind === "credential" ? fromCredential(deps, connection) : fromBroker(deps, connection, strategy, options));
  return {
    source: strategy.id,
    kind: strategy.kind,
    headers: async () => headerOf(strategy, await tokenOf(deps, held, acquire)),
    secrets: () => [...held.issued],
    expiresAt: () => (held.value ? held.expiresAt : null),
    invalidate: () => Object.assign(held, { value: null, expiresAt: 0 }),
    rejected: (stop) => refused(deps, connection, strategy, stop),
  };
}

// The kept token while it is good; else ONE acquisition, shared by everybody who asked while it ran.
function tokenOf(deps, held, acquire) {
  if (held.value && held.expiresAt - SAFETY_MS > deps.nowMs()) return held.value;
  held.pending ??= acquire().then((got) => kept(held, got)).finally(() => { held.pending = null; });
  return held.pending;
}

// A token with no expiry is not kept past the request that asked for it.
function kept(held, got) {
  Object.assign(held, { value: got.token, expiresAt: got.expiresAt ?? 0 });
  held.issued.add(got.token);
  return got.token;
}

async function fromCredential(deps, connection) {
  const value = connection.credential ? await deps.secrets.read(connection.credential) : null;
  if (!value) throw new AuthBlocked("AUTH_CREDENTIAL_MISSING", `connection ${connection.id} has no credential set on this machine`, "set one in Orbit Control, or reference an environment variable");
  return { token: value, expiresAt: Infinity };
}

const fromBroker = (deps, connection, strategy, options) => adapterOf(deps, strategy).acquire({ connection, strategy, interactive: options.interactive ?? "when-required", notify: options.notify });

function adapterOf(deps, strategy) {
  const adapter = deps.adapters?.[strategy.id];
  if (!adapter) throw new AuthBlocked("AUTH_TOOL_UNSUPPORTED", `nothing on this machine can sign in with "${strategy.id}"`);
  return adapter;
}

const basic = (token) => `Basic ${Buffer.from(`:${token}`).toString("base64")}`;

const headerOf = (strategy, token) => ({ Authorization: strategy.request === "basic" ? basic(token) : `Bearer ${token}` });

// 401 and 403 are two different things, and a person is told which: the first says the sign-in or the credential is not
// good for this source, the second that it is good and not allowed to read this. The status is the one the source
// answered with when the stop knows it: a sign-in page where data should be is a 203, and is told as one.
const REFUSALS = { forbidden: ["AUTH_FORBIDDEN", "the account may not read this", 403], auth: ["AUTH_REJECTED", "the source did not accept it", 401] };

// The adapter may know better than the status code (it can see what the sign-in reaches); else the two plain answers.
async function refused(deps, connection, strategy, stop) {
  const explained = await deps.adapters?.[strategy.id]?.explain?.({ connection, strategy, stop });
  throw explained ?? refusal(strategy, stop);
}

function refusal(strategy, stop) {
  const [code, says, status] = REFUSALS[stop?.kind] ?? REFUSALS.auth;
  return new AuthBlocked(code, `${strategy.kind === "broker" ? "the sign-in" : "the credential"} was refused: ${says} (HTTP ${stop?.status ?? status})`, strategy.kind === "broker" ? "sign in again, or sign in with another account" : "check the credential, what it may read and when it expires");
}

async function statusOf(deps, connection, strategy) {
  if (strategy.kind === "credential") return { strategy: strategy.id, state: connection.credential ? "credential-set" : "credential-missing" };
  return { strategy: strategy.id, ...(await adapterOf(deps, strategy).status({ connection, strategy })) };
}

function signedIn(deps, connection, strategy, options) {
  if (strategy.kind === "credential") throw new Refused(`connection ${connection.id} reads a credential: there is nothing to sign in to`);
  return adapterOf(deps, strategy).signIn({ connection, strategy, notify: options.notify, deviceCode: options.deviceCode, tenant: options.tenant });
}

function signedOut(deps, connection, strategy) {
  if (strategy.kind === "credential") throw new Refused(`connection ${connection.id} reads a credential: there is nothing to sign out of`);
  return adapterOf(deps, strategy).signOut({ connection, strategy });
}
