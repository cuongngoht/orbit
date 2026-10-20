// The SECRET PORT: where a secret VALUE comes from, at the moment it is used --
// and only then. One port for everything Orbit connects to: a managed MCP server
// (src/mcp/) and a project-report source connection (src/connections/) alike.
//
// A Orbit document never holds a value. It holds a REFERENCE:
//
//   "NAME"          an environment variable -- exactly what a managed MCP
//                   definition has always named (src/mcp/managed.mjs)
//   { vault: id }   an item in the OS secret store of THIS machine and user,
//                   put there once by a person through Orbit Control
//
//   has(name) / value(name)   the environment, synchronously -- the MCP broker's
//                             unchanged half
//   read(ref)                 either kind, as a promise; null when it is not set
//   store(ref, value)         a vault reference only: an environment variable is
//                             set by a person in their own shell, never by Orbit
//   remove(ref)               a vault reference only
//   backend()                 which OS store is bound here, or null
//
// A value is never returned by an API, logged or written into a Orbit document,
// and it never reaches a child process. With no OS store bound, a vault
// reference is BLOCKED -- there is no plaintext fallback, because a file beside
// the store is exactly the thing a vault exists to replace.
//
// The vault itself (macOS Keychain, Windows DPAPI) is concrete, so it lives with
// the other real host bindings (skills/orbit-control/vault.mjs) and is handed in.
// Nothing here reads process.env.
import { Blocked, Refused } from "./errors.mjs";

export const envSecrets = (env = {}) => ({ has: (name) => typeof env[name] === "string" && env[name].length > 0, value: (name) => (typeof env[name] === "string" ? env[name] : null) });

// The ones a definition names and this port does not have.
export const unsetSecrets = (names, secrets) => names.filter((n) => !secrets.has(n));

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const VAULT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// What a reference may be -- and the sentence when it is not. It never echoes
// what it was given: a pasted token in the wrong field must not come back in an
// error that a page then shows.
export function referenceProblem(ref) {
  if (typeof ref === "string") return ENV_NAME.test(ref) ? null : "an environment reference is a variable NAME such as REPORT_SOURCE_TOKEN, not a value";
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "a credential reference is an environment variable name or { vault: <id> }";
  const keys = Object.keys(ref);
  return keys.length === 1 && keys[0] === "vault" && VAULT_ID.test(ref.vault) ? null : "a vault reference is { vault: <id> } and carries nothing else — never the credential itself";
}

// What a credential VALUE may look like before any OS store is handed it: one
// line of printable ASCII without quotes or backslashes. The OS commands behind
// the vault read it off stdin, where a newline would start a second command.
export function credentialProblem(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4096) return "a credential is 8 to 4096 characters";
  return /^[\x21-\x7e]+$/.test(value) && !/["'\\`]/.test(value) ? null : "a credential is one line of printable characters without spaces, quotes or backslashes";
}

export const isVaultRef = (ref) => Boolean(ref) && typeof ref === "object" && typeof ref.vault === "string";

export function secretSource({ env = {}, vault = null } = {}) {
  const fromEnv = envSecrets(env);
  return { ...fromEnv, read: (ref) => read(fromEnv, vault, ref), store: (ref, value) => stored(vault, ref, value), remove: (ref) => removed(vault, ref), backend: () => vault?.id ?? null };
}

async function read(fromEnv, vault, ref) {
  checked(ref);
  if (!isVaultRef(ref)) return fromEnv.value(ref) || null;
  return (await bound(vault).read(ref.vault)) || null;
}

async function stored(vault, ref, value) {
  if (!isVaultRef(checked(ref))) throw new Refused("only a vault reference can be stored by Orbit; an environment variable is set in your own shell");
  const wrong = credentialProblem(value);
  if (wrong) throw new Refused(wrong);
  await bound(vault).store(ref.vault, value);
}

async function removed(vault, ref) {
  if (!isVaultRef(checked(ref))) return;
  await bound(vault).remove(ref.vault);
}

function checked(ref) {
  const wrong = referenceProblem(ref);
  if (wrong) throw new Refused(wrong);
  return ref;
}

function bound(vault) {
  if (!vault) throw new Blocked("no OS secret store is available on this machine, so Orbit keeps no credential here — reference an environment variable instead");
  return vault;
}
