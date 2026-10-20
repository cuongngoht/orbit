// The OS SECRET STORE of this machine and user, as the vault behind
// src/secrets.mjs -- concrete, so it lives here with the other real host
// bindings and is handed to the secret port, never imported by src/.
//
//   macOS    the login Keychain, through /usr/bin/security. The value goes in on
//            STDIN (`security -i` reads commands there), never in argv, where
//            any process on the machine could read it; src/secrets.mjs has
//            already refused a value with a quote, a backslash or a newline, so
//            it cannot end the command early or start a second one
//   Windows  DPAPI, CurrentUser scope, through the system PowerShell by its
//            absolute path (-NoProfile -NonInteractive -EncodedCommand, a fixed
//            script): the value in on stdin, the protected blob out on stdout,
//            kept under the store in control/connections/vault/<id>.dpapi. Only
//            this user on this machine can unprotect it
//   Linux    none: reference an environment variable instead
//
// What the OS says when it fails never reaches an error message: a keychain or
// a PowerShell can echo what it was given, and Orbit Control logs its errors. A
// vault protects a credential AT REST; it does not protect it from other code
// running as the same user, and nothing here claims it does.
import { join, win32 } from "node:path";
import { VAULT_ID, credentialProblem } from "../../src/secrets.mjs";

export const SERVICE = "orbit";

// How long one OS store operation may take. Normally a second or two; a cold
// PowerShell loading its assemblies on a busy Windows machine has been seen to
// need far longer, and a person saving a credential would rather wait than retry.
export const STORE_TIMEOUT_MS = 90_000;

// { platform, env, process (the Process port), io, dir } -> a vault, or null
export function osVault(deps) {
  const make = VAULTS[deps.platform];
  return make ? make(deps) : null;
}

const VAULTS = { darwin: (d) => keychain(d), win32: (d) => dpapi(d) };

// ---- macOS -------------------------------------------------------------------

const SECURITY = "/usr/bin/security";

function keychain({ process: p, io }) {
  return { id: "macos-keychain", available: async () => io.exists(SECURITY), read: async (id) => keychainRead(p, checkedId(id)), store: async (id, value) => keychainStore(p, checkedId(id), value), remove: async (id) => keychainRemove(p, checkedId(id)) };
}

// 44 is `security`'s "not found": an unset credential, not a failure.
async function keychainRead(p, id) {
  const r = await p.runAsync(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", id, "-w"], { timeoutMs: STORE_TIMEOUT_MS });
  if (r.status === 44) return null;
  return r.ok ? String(r.out).replace(/\r?\n$/, "") : failed("read");
}

async function keychainStore(p, id, value) {
  if (credentialProblem(value)) throw new Error(credentialProblem(value));
  const r = await p.runAsync(SECURITY, ["-i"], { input: `add-generic-password -U -s ${SERVICE} -a ${id} -w "${value}"\n`, timeoutMs: STORE_TIMEOUT_MS });
  if (!r.ok || /error|could not/i.test(String(r.err ?? ""))) failed("store");
}

async function keychainRemove(p, id) {
  const r = await p.runAsync(SECURITY, ["delete-generic-password", "-s", SERVICE, "-a", id], { timeoutMs: STORE_TIMEOUT_MS });
  if (!r.ok && r.status !== 44) failed("remove");
}

// ---- Windows -------------------------------------------------------------------

// Spelled with Windows' own separators whatever platform builds the path.
export const powershell = (env) => win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// Fixed scripts; the only thing that varies travels on stdin.
export const PROTECT = "Add-Type -AssemblyName System.Security; $v = [Console]::In.ReadToEnd(); $b = [System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v), $null, 'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($b))";
export const UNPROTECT = "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')))";

const encoded = (script) => Buffer.from(script, "utf16le").toString("base64");

function dpapi({ process: p, io, env, dir }) {
  const exe = powershell(env);
  const blob = (id) => join(dir, `${checkedId(id)}.dpapi`);
  return { id: "windows-dpapi", available: async () => io.exists(exe), read: async (id) => dpapiRead(p, exe, io, blob(id)), store: async (id, value) => dpapiStore(p, exe, io, blob(id), value), remove: async (id) => io.removeFile(blob(id)) };
}

// A command, not a script file, so no execution policy is asked to relax.
export const psArgs = (script) => ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)];

async function dpapiRead(p, exe, io, file) {
  const kept = io.read(file);
  if (!kept) return null;
  const r = await p.runAsync(exe, psArgs(UNPROTECT), { input: kept, timeoutMs: STORE_TIMEOUT_MS });
  return r.ok ? String(r.out) : failed("read");
}

async function dpapiStore(p, exe, io, file, value) {
  const r = await p.runAsync(exe, psArgs(PROTECT), { input: value, timeoutMs: STORE_TIMEOUT_MS });
  if (!r.ok || !/^[A-Za-z0-9+/=]+$/.test(String(r.out).trim())) failed("store");
  io.write(file, String(r.out).trim());
}

// ---- shared ---------------------------------------------------------------------

function checkedId(id) {
  if (!VAULT_ID.test(String(id))) throw new Error("a vault item id is lower-case letters, digits, dots, dashes and underscores");
  return id;
}

function failed(op) {
  throw new Error(`the OS secret store could not ${op} the credential (it may be locked, or access was denied); nothing was changed`);
}
