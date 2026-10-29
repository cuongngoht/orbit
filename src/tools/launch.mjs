// HOW A TOOL IS STARTED -- the one place that decides what a child of a tool that keeps IDENTITY STATE is given.
//
// Some tools remember who somebody is: a sign-in, a token cache, a profile. A tool like that must never be started
// with the environment of the person's own shell, because its notion of "my profile" is then THEIR profile -- and
// whatever Orbit did with it (a login, a logout, a changed default) would be done to them. So a catalog row may
// declare a PROFILE (`profile.env`: the variable that names the directory the tool keeps that state in) and a LAUNCH
// (what else the child is given), and from then on every child of that tool is started through `launcherOf` here:
//
//   env     = the few names any process needs to start (src/process/env.mjs) + the names the row lets through
//             (`launch.inherit`: a proxy, a certificate bundle, a display) + the row's pins + the profile variable,
//             set LAST, so nothing the person's environment says can win over it. A name the row does not declare
//             is never copied: the person's own value for the profile variable, and every other variable the tool
//             reads its configuration from, simply is not there.
//   dir     `session`  the directory Orbit keeps that tool's state in, under the machine store (`rooms.authSessions`)
//             -- one per PROFILE, for the whole machine, never inside a repository
//           `probe`    a directory made for THIS question and removed after it: asking a version, or verifying an
//             install, must neither create the session directory (a read creates no state) nor touch anybody's
//
// A row with no `profile` is not started through here at all: `launcherOf` hands back the file and its arguments and
// leaves the environment unnamed, exactly as every tool was started before. Everything about WHICH names, WHICH pins
// and WHICH variable is catalog data; this file names none of them.
import { posix, win32 } from "node:path";
import { Blocked } from "../errors.mjs";
import { childEnv } from "../process/env.mjs";

export const pathOf = (platform) => (platform === "win32" ? win32 : posix);

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const VALUE = /^[A-Za-z0-9._-]{1,32}$/;
const ARG = /^[A-Za-z0-9._-]{1,40}$/;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const RELATIVE = /^(\.\.\/)?[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const objectOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const listOf = (v) => (Array.isArray(v) ? v : []);

// ---- what a row declares -------------------------------------------------------------------------------------------
// Anything that is not well formed is dropped HERE. The shipped rows are held to "every declared pin survives" by the
// suite (test/tools-launch.test.mjs), because a dropped pin is a pin that is not applied.

// `name` is the profile's own name: every row that serves one tool -- a private copy, one found on the machine -- names
// the SAME profile, so which of them runs today never changes whose sign-in it is.
export const profileOf = (p) => (NAME.test(String(p?.env ?? "")) && PROFILE.test(String(p?.name ?? "")) ? { env: p.env, name: p.name } : null);

const pinsOf = (v) => Object.fromEntries(Object.entries(objectOf(v)).filter(([k, x]) => NAME.test(k) && VALUE.test(String(x))).map(([k, x]) => [k, String(x)]));

const argsOf = (v) => listOf(v).filter((a) => typeof a === "string" && ARG.test(a));

const namesOf = (v) => listOf(v).filter((n) => typeof n === "string" && NAME.test(n));

// `args` go between the file and the tool's own arguments; `inherit` is never the profile variable itself.
export function launchOf(l, profile = null) {
  if (!l || typeof l !== "object") return null;
  const { win32: w, posix: p } = objectOf(l.platformEnv);
  return { args: argsOf(l.args), env: pinsOf(l.env), platformEnv: { win32: pinsOf(w), posix: pinsOf(p) }, inherit: namesOf(l.inherit).filter((n) => n !== profile?.env) };
}

// A `.cmd` wrapper that only forwards to an interpreter beside it: where that interpreter is, relative to the
// directory the wrapper is in (one step up at most), and what it is given. Windows only, because that is the only
// place a wrapper cannot be started by itself without a shell.
export function wrapperOf(w) {
  const one = objectOf(objectOf(w).win32);
  return RELATIVE.test(String(one.interpreter ?? "")) ? { win32: { interpreter: one.interpreter, args: argsOf(one.args) } } : null;
}

// ---- what a child is given -----------------------------------------------------------------------------------------

const kindOf = (platform) => (platform === "win32" ? "win32" : "posix");

// The environment of ONE child of a profile tool. `asset` is the pinned build it runs when it is a private install,
// whose own `launch.env` (how THAT build says it was installed) sits on top of the row's pins.
export function launchEnv(entry, { parent, platform, profileDir, asset = null }) {
  const launch = entry.launch ?? { env: {}, platformEnv: { win32: {}, posix: {} }, inherit: [] };
  const pins = { ...launch.env, ...launch.platformEnv[kindOf(platform)], ...(asset?.launch?.env ?? {}) };
  return { ...childEnv(parent, launch.inherit), ...pins, [entry.profile.env]: profileDir };
}

// The directory a profile tool's state lives in, and the refusal when it cannot live there: under WSL a directory on
// a Windows drive is shared with Windows, carries no POSIX modes and is not "its own Orbit state".
export function sessionDir(entry, ctx) {
  const dir = pathOf(ctx.platform).join(ctx.rooms.authSessions, entry.profile.name);
  if (onWindowsDrive(dir, ctx)) throw new Blocked(`the sign-in state of ${entry.name} cannot live on a Windows drive (${dir}); keep Orbit's store on this system's own filesystem`);
  return dir;
}

export const onWindowsDrive = (path, ctx) => listOf(ctx.windowsMounts).some((root) => new RegExp(`^${escaped(root)}[a-z](/|$)`, "i").test(path));

const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A scratch directory for ONE probe: `ctx.scratch()` makes it and says how it goes away.
const probeDir = (ctx) => {
  const scratch = ctx.scratch();
  return { dir: scratch.dir, release: scratch.dispose };
};

const NOTHING = () => {};

// found.launch = { file, args }: where the tool is and what goes between it and its own arguments.
// purpose: "session" (a login, a token, a logout) or "probe" (a version, an install's verification).
export function launcherOf(entry, found, ctx, purpose, asset = null) {
  const { file, args } = found.launch;
  if (!entry.profile) return { file, args, env: undefined, profileDir: null, release: NOTHING };
  const where = purpose === "session" ? { dir: sessionDir(entry, ctx), release: NOTHING } : probeDir(ctx);
  return { file, args, env: launchEnv(entry, { parent: ctx.env ?? {}, platform: ctx.platform, profileDir: where.dir, asset }), profileDir: where.dir, release: where.release };
}

// What a probe is asked with: the environment (when there is one) and the row's own deadline (when it has one).
export const askOptions = (entry, launcher) => ({ ...(launcher.env ? { env: launcher.env } : {}), ...(entry.detection.timeoutMs ? { timeoutMs: entry.detection.timeoutMs } : {}) });

// ONE question of a tool, through its launcher: the question's arguments after the launcher's own. A probe with no
// options is asked exactly as it always was; one with an environment or a deadline says so.
export function ask(ctx, entry, launcher, args = entry.detection.versionArgs) {
  const options = askOptions(entry, launcher);
  const argv = [...launcher.args, ...args];
  return Object.keys(options).length ? ctx.run(launcher.file, argv, options) : ctx.run(launcher.file, argv);
}
