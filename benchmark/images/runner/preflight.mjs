#!/usr/bin/env node
// THE PREFLIGHT of a runner: whether the checks the subject DECLARES -- the ones Orbit's engineering loop holds a change
// to (`npm run lint`, `npm run test`) -- can be held here at all, in exactly the container a round runs in: the same
// user, the same read-only root, the same tmpfs and limits, no network and no credential. It clones the subject the way
// a task's workspace is made (no hard links into a read-only `.git`), runs each declared check as the engine would,
// and says whether each passed and whether the tree was left exactly as it was cloned -- a check that rewrites a file
// or leaves one behind can never be counted by the engine, so a round here could never complete.
//
//   node /bench/preflight.mjs [<script>…]     out: /work/out/preflight.json
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const WORK = "/tmp/preflight";

const run = (file, args, cwd, ms) => ((t0) => ((r) => ({ argv: [file, ...args].join(" "), exit: r.status, signal: r.signal ?? null, seconds: Math.round((Date.now() - t0) / 1000), tail: String(r.stdout ?? "").split("\n").slice(-12).join("\n").slice(-2000), err: String(r.stderr ?? "").split("\n").slice(-6).join("\n").slice(-1000) }))(spawnSync(file, args, { cwd, env: process.env, encoding: "utf8", timeout: ms, maxBuffer: 64 * 1024 * 1024 })))(Date.now());

const status = (cwd) => String(spawnSync("git", ["--no-optional-locks", "status", "--porcelain=v1", "--ignored", "-uall"], { cwd, encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean);

function main(scripts) {
  const clone = run("git", ["clone", "--quiet", "--no-hardlinks", "/work/repo", WORK], "/tmp", 300000);
  const checks = clone.exit === 0 ? scripts.map((s) => run("npm", ["run", s], WORK, 30 * 60000)) : [];
  const left = clone.exit === 0 ? status(WORK) : [];
  writeFileSync("/work/out/preflight.json", `${JSON.stringify({ clone, checks, left: left.slice(0, 50), clean: left.length === 0, holds: clone.exit === 0 && checks.every((c) => c.exit === 0) && left.length === 0 }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2).length ? process.argv.slice(2) : ["lint", "test"]);
