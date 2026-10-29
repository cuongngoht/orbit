// A fake `az` that behaves the way the REAL one does about STATE -- which is the whole question of isolation.
//
//   its profile   is `AZURE_CONFIG_DIR`, and when that is not set it is `$HOME/.azure` (`%USERPROFILE%\.azure` on
//                 Windows): so a caller that forgets to name the profile is silently handed the developer's, here as
//                 in life, and the test that watches for it can fail
//   a session     lives in the profile -- unless the platform keeps it SOMEWHERE ELSE: the Windows account broker,
//                 which is one per OS user and shared by every profile that uses it (on by default, off only when
//                 `AZURE_CORE_ENABLE_BROKER_ON_WINDOWS=false`); or an OS keystore entry with FIXED names, shared by
//                 every profile that uses it (on only when `AZURE_CORE_ENCRYPT_TOKEN_CACHE=true`, or by default when a
//                 test says a newer release made it the default). Each is how a profile of one's own stops being one
//   any command   creates the profile directory, as `az --version` really does
//
// It is a Process port (`run`, `runAsync`, `runObserved`) so the adapter and the tools layer run over it unchanged,
// and every call is recorded with the profile it touched and the NAMES of the variables it was given (never values).
import { posix, win32 } from "node:path";

export function createFakeAz({ platform = "linux", home = "/fake/developer", parentEnv = {}, developer = null, people = [], keystoreByDefault = false, nowSeconds = () => 1_800_000_000 } = {}) {
  const path = platform === "win32" ? win32 : posix;
  const state = { profiles: new Map(), dirs: new Set(), broker: { account: null }, keystore: { account: null }, calls: [], people: [...people], issued: [], seq: 0 };
  const developerDir = path.join(home, ".azure");
  if (developer) seed(state, developerDir, developer);
  const run = (file, args, opts = {}) => execute(state, { platform, path, home, parentEnv, keystoreByDefault, nowSeconds, file, args, env: opts.env ?? parentEnv });
  const process = { run, runAsync: async (file, args, opts) => run(file, args, opts), runObserved: async (file, args, opts = {}) => observed(run(file, args, opts), opts) };
  return { process, state, developerDir, snapshotOf: (dir) => JSON.stringify(state.profiles.get(dir) ?? null), io: { exists: (p) => state.dirs.has(p), ensurePrivateDir: (p) => state.dirs.add(p) } };
}

function seed(state, dir, account) {
  state.profiles.set(dir, { account, files: ["azureProfile.json", "msal_token_cache"] });
  state.dirs.add(dir);
}

function observed(result, opts) {
  if (result.err && opts.observe) opts.observe("err", Buffer.from(result.err));
  return result;
}

const LAUNCHER = ["-IBm", "azure.cli"];

const commandOf = (args) => (args.slice(0, 2).join(" ") === LAUNCHER.join(" ") ? args.slice(2) : args);

function execute(state, c) {
  const argv = commandOf(c.args.map(String));
  const configDir = c.env.AZURE_CONFIG_DIR ?? c.path.join(c.env.HOME ?? c.env.USERPROFILE ?? "/nowhere", ".azure");
  state.dirs.add(configDir);
  const record = { file: c.file, argv, configDir, envNames: Object.keys(c.env), env: { ...c.env }, wrote: [] };
  state.calls.push(record);
  return handled(state, c, record, sessionOf(state, c, configDir));
}

// WHERE the session is kept: the shared broker, the shared keystore entry, or the profile.
function sessionOf(state, c, configDir) {
  if (c.platform === "win32" && c.env.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS !== "false") return state.broker;
  const encrypted = c.env.AZURE_CORE_ENCRYPT_TOKEN_CACHE === "true" || (c.env.AZURE_CORE_ENCRYPT_TOKEN_CACHE === undefined && c.keystoreByDefault && c.platform !== "win32");
  if (encrypted && c.platform !== "win32") return state.keystore;
  if (!state.profiles.has(configDir)) state.profiles.set(configDir, { account: null, files: [] });
  return state.profiles.get(configDir);
}

const NOT_SIGNED_IN = { ok: false, out: "", err: "ERROR: Please run 'az login' to setup account.\n", error: "ERROR: Please run 'az login' to setup account.", status: 1 };

const ok = (out = "", err = "") => ({ ok: true, out, err, status: 0 });

const ABOUT = { version: () => ok("azure-cli                         2.91.0\n\ncore                              2.91.0\n"), "--version": () => ok("azure-cli                         2.91.0\n\ncore                              2.91.0\n") };

const HANDLERS = {
  login: (state, c, r, session) => signIn(state, c, r, session),
  logout: (state, c, r, session) => signOut(r, session),
  "account show": (state, c, r, session) => (session.account ? ok(JSON.stringify({ user: { name: session.account.name }, tenantId: session.account.tenant })) : NOT_SIGNED_IN),
  "account get-access-token": (state, c, r, session) => token(state, c, r, session),
  "account list": (state, c, r, session) => (session.account ? ok(JSON.stringify(session.account.tenants ?? [session.account.tenant])) : NOT_SIGNED_IN),
  "account set": (state, c, r) => (r.wrote.push("account"), ok()),
  "config set": (state, c, r) => (r.wrote.push("config"), ok()),
  "extension add": (state, c, r) => (r.wrote.push("extension"), ok()),
};

function handled(state, c, record, session) {
  const [a, b] = record.argv;
  const key = HANDLERS[`${a} ${b}`] ? `${a} ${b}` : a;
  const about = ABOUT[a];
  if (about) return about();
  return HANDLERS[key] ? HANDLERS[key](state, c, record, session) : { ok: false, out: "", err: `ERROR: '${a}' is not in the fake\n`, status: 2 };
}

function signIn(state, c, record, session) {
  const person = state.people.shift();
  if (!person) return { ok: false, out: "", err: "ERROR: Authentication was cancelled by the user\n", error: "ERROR: Authentication was cancelled by the user", status: 1 };
  session.account = person;
  record.wrote.push("session");
  const notice = record.argv.includes("--use-device-code") ? "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD1234 to authenticate.\n" : "A web browser has been opened at https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize. Please continue the login in the web browser.\n";
  return ok("", notice);
}

function signOut(record, session) {
  if (!session.account) return { ok: false, out: "", err: "ERROR: There are no active accounts.\n", error: "ERROR: There are no active accounts.", status: 1 };
  session.account = null;
  record.wrote.push("session");
  return ok();
}

function token(state, c, record, session) {
  if (!session.account) return NOT_SIGNED_IN;
  if (session.account.expire) return { ok: false, out: "", err: `ERROR: AADSTS${session.account.expire}: the session needs a person again\n`, error: `ERROR: AADSTS${session.account.expire}`, status: 1 };
  state.seq += 1;
  const value = `tok.${session.account.name}.${state.seq}.ZXhhbXBsZS10b2tlbi1wYWRkaW5n`;
  state.issued.push(value);
  return ok(JSON.stringify({ accessToken: value, expires_on: c.nowSeconds() + 3600, tenant: session.account.tenant, tokenType: "Bearer" }));
}
