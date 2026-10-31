// GIT, as the benchmark asks it: read-only questions of the developer's checkout, and the one repository it makes for
// itself -- the subject a runner is handed, committed once with a fixed identity and date so the same subject is the
// same commit. Every call is an argument list, never a shell; fsmonitor and hooks never run, and a read takes no
// optional lock (a status never rewrites the developer's index). A repository the harness made is asked through an
// ANCHOR the way Orbit's own local clones are (src/frontend/local-clones.mjs): HOME and XDG_CONFIG_HOME a fresh empty
// directory, the global configuration an empty file in it (Git for Windows refuses the null device), no system
// configuration or attributes -- so nothing of this machine's decides what the subject's commit holds.
//
//   gitRead(cwd, args, env, opts) -> { ok, status, out, err }   (out: a string, or bytes with { bytes: true })
//   gitOwn(cwd, args, env)        -> the same, for a repository this harness made
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "../../src/process/env.mjs";

const SAFE = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${devNull}`];

const MAX = 512 * 1024 * 1024;

const answer = (r, bytes) => ({ ok: r.status === 0, status: r.status, out: bytes ? r.stdout ?? Buffer.alloc(0) : String(r.stdout ?? ""), err: String(r.stderr ?? "").trim().split("\n").at(-1) ?? "" });

const spawned = (cwd, args, env, opts) => spawnSync("git", [...SAFE, ...args], { cwd, env, input: opts.input === undefined ? undefined : Buffer.from(opts.input), maxBuffer: MAX, encoding: opts.bytes ? "buffer" : "utf8", windowsHide: true });

// The developer's own repository is read with their own configuration (what git shows them is what is frozen), and
// nothing else of this machine's environment.
export const gitRead = (cwd, args, env, opts = {}) => answer(spawned(cwd, args, childEnv(env, []), opts), opts.bytes);

const IDENTITY = { GIT_AUTHOR_NAME: "orbit-benchmark", GIT_AUTHOR_EMAIL: "benchmark@orbit.invalid", GIT_COMMITTER_NAME: "orbit-benchmark", GIT_COMMITTER_EMAIL: "benchmark@orbit.invalid", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };

const anchorEnv = (env, anchor) => ({ ...childEnv(env, []), HOME: anchor, XDG_CONFIG_HOME: anchor, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(anchor, "empty.gitconfig"), GIT_ATTR_NOSYSTEM: "1", ...IDENTITY });

export function gitOwn(cwd, args, env, opts = {}) {
  const anchor = mkdtempSync(join(tmpdir(), "orbit-bench-anchor-"));
  writeFileSync(join(anchor, "empty.gitconfig"), "");
  try { return answer(spawned(cwd, ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], anchorEnv(env, anchor), opts), opts.bytes); }
  finally { rmSync(anchor, { recursive: true, force: true }); }
}
