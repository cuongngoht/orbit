// The `python-lock` installer: a tool that is a PYTHON PACKAGE, installed PRIVATELY from a lock into an environment of
// Orbit's own interpreter, in
//
//   <storeBase>/runtimes/tools/<tool>/<version>-<platform>-<arch>/
//
// and nowhere else: not the plugin, not a project, not PATH, not any Python the machine already has.
//
//   lock     the file the row's asset names (catalog/locks/), held to src/tools/lock.mjs's grammar BEFORE anything
//            runs, and required to pin the row's own package to the row's own version
//   python   ORBIT's interpreter -- a private install of the row `install.python` names, never the machine's -- so
//            no system Python, no virtual environment of a developer and no pip of theirs is touched or trusted
//   stage    a directory BESIDE the final one: `venv`, then pip over the lock with every flag that keeps the result
//            to what the lock names: --isolated (no environment variable or configuration of anybody's),
//            --require-hashes (a file the lock does not hash is refused), --only-binary=:all: (no code is built or
//            run to install anything), --no-deps (the lock IS the dependency graph)
//   verify   the staged runtime must start and name the pinned version, asked the way it will be run
//   promote  src/store/archive.mjs promote: an earlier copy is set aside, one rename puts the staged one in place
//
// So no half-built environment sits where detection looks, a lock that is not the grammar installs nothing, and the
// receipt (src/tools/install.mjs) is written only after this returns. Every effect is `ctx` (the Process port, the
// install io, the lock reader), faked in the suite.
import { dirname, join } from "node:path";
import { Blocked } from "../errors.mjs";
import { printable } from "../printable.mjs";
import { childEnv } from "../process/env.mjs";
import { contained } from "../project/boundary.mjs";
import { scrub } from "../scrub.mjs";
import { promote } from "../store/archive.mjs";
import { answers } from "./archive.mjs";
import { assetFor } from "./catalog.mjs";
import { lockProblems, pinnedIn } from "./lock.mjs";

// What pip is given. Nothing here is built from a row, a lock or an environment: a list the code owns.
export const PIP_FLAGS = ["--isolated", "--require-hashes", "--only-binary=:all:", "--no-deps", "--no-cache-dir", "--disable-pip-version-check", "--no-input"];

const VENV_DEADLINE_MS = 2 * 60_000;
const PIP_DEADLINE_MS = 15 * 60_000;
const OUTPUT_MOST = 4 * 1024 * 1024;

export const pythonLockInstaller = {
  strategy: "python-lock",
  supports: (entry, platform, arch) => (assetFor(entry, platform, arch) ? null : `no verified build of ${entry.name} is pinned for ${platform}-${arch}`),
  install: (entry, ctx) => installed(entry, assetFor(entry, ctx.platform, ctx.arch), ctx),
};

async function installed(entry, asset, ctx) {
  const lock = ctx.lockFile(asset.lock);
  held(entry, lock.text);
  const where = placement(entry, asset, ctx, lock.text);
  if (answers(join(where.final, asset.bin), entry, asset, ctx)) return { ...where.placed, reused: true };
  return (await built({ entry, asset, lock, final: where.final }, ctx), where.placed);
}

// A lock that is not a pinned, hashed list -- or that does not pin the row's own package to the row's own version --
// installs nothing, and says which line.
function held(entry, text) {
  const problems = lockProblems(text);
  if (problems.length) throw new Blocked(`the lock of ${entry.name} is not a pinned, hashed list (${problems[0]}); nothing was installed`);
  if (pinnedIn(text, entry.install.package) !== entry.install.version) throw new Blocked(`the lock of ${entry.name} does not pin ${entry.install.package} to ${entry.install.version}; nothing was installed`);
}

function placement(entry, asset, ctx, text) {
  const dir = join(entry.id, `${entry.install.version}-${ctx.platform}-${ctx.arch}`);
  const final = contained(ctx.rooms.toolRuntimes, join(ctx.rooms.toolRuntimes, dir));
  const placed = { version: entry.install.version, home: "toolRuntimes", dir, bin: asset.bin, checksum: `sha256:${ctx.io.sha256(Buffer.from(text))}`, source: `lock:${asset.lock}` };
  return { final, placed };
}

async function built(p, ctx) {
  const python = await ctx.ensurePython(p.entry.install.python);
  const stage = ctx.io.tempDir(dirname(p.final));
  try {
    await populated({ ...p, stage, python }, ctx);
    promote({ staged: stage, final: p.final, io: ctx.io, verify: (staged) => answers(join(staged, p.asset.bin), p.entry, p.asset, ctx), unverified: `the locked ${p.entry.name} did not answer as ${p.entry.install.version} on this machine` });
  } finally {
    ctx.io.remove(stage);
  }
}

async function populated(p, ctx) {
  await ran(ctx, p, p.python.file, ["-I", "-m", "venv", join(p.stage, environmentOf(p.asset))], "create its environment", VENV_DEADLINE_MS);
  await ran(ctx, p, join(p.stage, p.asset.bin), ["-I", "-m", "pip", "install", ...PIP_FLAGS, "-r", p.lock.path], "install its locked distributions", PIP_DEADLINE_MS);
}

// The environment is the first directory of the interpreter's path (`venv/bin/python` -> `venv`).
const environmentOf = (asset) => String(asset.bin).split(/[\\/]/)[0];

// One child of the install: argv only, from the stage, with the few variables a child needs and the ones the row lets
// through (a proxy, a certificate bundle) -- nothing else of this process's environment.
async function ran(ctx, p, file, args, what, timeoutMs) {
  const r = await ctx.process.runAsync(file, args, { timeoutMs, cwd: p.stage, env: childEnv(ctx.env ?? {}, p.entry.launch?.inherit ?? []), maxBuffer: OUTPUT_MOST });
  if (r.ok) return r;
  throw new Blocked(`could not ${what} for ${p.entry.name}: ${excerpt(r)}; nothing was installed`);
}

// What a failed child said, bounded and made safe to print: the last of its output, scrubbed, on one line.
const excerpt = (r) => scrub(printable(String(r.err || r.out || r.error?.message || "no output"))).replace(/\s+/g, " ").trim().slice(-400);
