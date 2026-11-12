#!/usr/bin/env node
// THE PACK GRADER, inside a fresh container with no network, after the agent's container is gone. It applies the
// agent's patch to the task's starting repository, puts back every pass-to-pass test file exactly as the start had it
// (a patch that edited or deleted one is graded by the original), writes the hidden fail-to-pass tests over whatever
// the patch put at their names, and runs each test file on its own. It prints ONE JSON line: what applied, and how
// each file ended. It judges nothing beyond a file's exit code; the controller maps that onto an outcome word.
// Copied into its container alone; it imports nothing but Node.
//
//   node /grade/grade-pack.mjs [brief]        brief: /grade/brief.json by default
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const git = (repo, args, o = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: o.binary ? "buffer" : "utf8", maxBuffer: 256 * 1024 * 1024 });

const nonEmpty = (file) => {
  try { return statSync(file).size > 0; }
  catch { return false; }
};

function applied(b) {
  if (!nonEmpty(b.patch)) return { applied: true, empty: true };
  const r = git(b.repo, ["apply", "--binary", "--whitespace=nowarn", b.patch]);
  return { applied: r.status === 0, empty: false, why: r.status === 0 ? null : String(r.stderr).slice(-600) };
}

function restored(b, rel) {
  const r = git(b.repo, ["show", `HEAD:${rel}`], { binary: true });
  if (r.status !== 0) return { rel, ok: false };
  mkdirSync(dirname(join(b.repo, rel)), { recursive: true });
  writeFileSync(join(b.repo, rel), r.stdout);
  return { rel, ok: true };
}

function placed(b, t) {
  mkdirSync(dirname(join(b.repo, t.target)), { recursive: true });
  copyFileSync(join(b.hidden, t.file), join(b.repo, t.target));
  return t.target;
}

const countOf = (text, word) => Number((new RegExp(`^# ${word} (\\d+)$`, "m").exec(text) ?? [])[1] ?? NaN);

function ranFile(b, rel, kind) {
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", rel], { cwd: b.repo, encoding: "utf8", timeout: (b.perFileSeconds ?? 180) * 1000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, EVAL_HIDDEN: b.hidden } });
  const text = `${r.stdout ?? ""}`;
  return { file: rel, kind, ok: r.status === 0, code: r.status, timedOut: r.error?.code === "ETIMEDOUT", pass: countOf(text, "pass"), fail: countOf(text, "fail"), tail: `${text}\n${r.stderr ?? ""}`.trim().slice(-3000) };
}

function main() {
  const b = JSON.parse(readFileSync(process.argv[2] ?? "/grade/brief.json", "utf8"));
  const a = applied(b);
  if (!a.applied) return process.stdout.write(`${JSON.stringify({ applied: false, why: a.why })}\n`);
  const back = b.p2p.map((rel) => restored(b, rel));
  const hidden = b.f2p.map((t) => placed(b, t));
  const tests = [...hidden.map((rel) => ranFile(b, rel, "f2p")), ...b.p2p.map((rel) => ranFile(b, rel, "p2p"))];
  process.stdout.write(`${JSON.stringify({ applied: true, empty: a.empty, restored: back, tests })}\n`);
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
