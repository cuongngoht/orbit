// How long ONE status line call takes, the way Claude Code makes it: a fresh `node` process reading the session
// JSON, finding the checkout without git, choosing the task and reading it once. Skipped in the suite (it spawns a
// few hundred processes); run it on purpose and read the numbers:
//
//   ORBIT_BENCH=1 node --test test/perf/live-statusline.bench.mjs
//
// Shapes: one task; 20 tasks in the checkout (one of them this session's); 200 tasks, one with a 5,000-line journal.
// The release plan reports P50/P95/P99 per shape against the 150 ms P95 target -- a target, never a claim.
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { realIo } from "../../src/store/io.mjs";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { createTasks } from "../../src/task/store.mjs";
import { apply, createTask } from "../../src/task/ops.mjs";
import { hostSession, taskSessionMark } from "../../src/memory/session.mjs";
import { sealed } from "../home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNS = 40;
const SESSION = "bench-session";

function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-bench-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off" });
  const first = JSON.parse(execFileSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "create", "first", "--json"], { cwd: repo, env, encoding: "utf8" })).task;
  return { dir, repo, env, first };
}

// More tasks, written through the task's own write door, in the checkout the first one bound.
function seeded(c, count, mine, longLines) {
  const tasks = createTasks(projectStoreRoot(join(c.dir, "store"), project(c)), realIo());
  const meta = tasks.read(c.first)[0];
  const ctx = (session) => ({ tasks, project: meta.project, checkout: meta.checkout, session, door: null, now: () => new Date().toISOString() });
  for (let i = 1; i < count; i += 1) createTask(ctx(i === mine ? taskSessionMark(hostSession("claude", SESSION)) : null), { project: meta.project, checkout: meta.checkout, objective: `task ${i}` });
  for (let i = 0; i < longLines; i += 1) apply(ctx(null), c.first, "decide", { observed: `line ${i}`, hypothesis: "h", nextAction: "next" });
}

const project = (c) => execFileSync("ls", [join(c.dir, "store")], { encoding: "utf8" }).split("\n").find((n) => n.startsWith("repo-"));

function timed(c) {
  const input = JSON.stringify({ session_id: SESSION, workspace: { current_dir: c.repo } });
  const ms = [];
  for (let i = 0; i < RUNS; i += 1) {
    const at = process.hrtime.bigint();
    spawnSync(process.execPath, [join(ROOT, "cli", "live.mjs"), "statusline", "--host=claude"], { cwd: c.repo, env: { ...c.env, COLUMNS: "120" }, input, encoding: "utf8" });
    ms.push(Number(process.hrtime.bigint() - at) / 1e6);
  }
  return ms.sort((a, b) => a - b);
}

const pct = (ms, p) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))].toFixed(1);

const node = () => ((ms) => ms)(timed({ repo: tmpdir(), env: sealed() }));

for (const [shape, count, mine, longLines] of [["1 task", 1, 0, 0], ["20 tasks, one this session's", 20, 7, 0], ["200 tasks, a 5000-line journal", 200, 150, 5000], ["the shown task has a 5000-line journal", 1, 0, 5000]]) {
  test(`status line, ${shape}`, { skip: !process.env.ORBIT_BENCH }, (t) => {
    const c = checkout(t);
    seeded(c, count, mine, longLines);
    const ms = timed(c);
    console.log(`# status line, ${shape}: p50 ${pct(ms, 50)} ms · p95 ${pct(ms, 95)} ms · p99 ${pct(ms, 99)} ms (${RUNS} runs)`);
  });
}

test("a bare `node` start on this machine, for reference", { skip: !process.env.ORBIT_BENCH }, () => {
  const ms = node();
  console.log(`# status line outside any checkout (process start and nothing found): p50 ${pct(ms, 50)} ms · p95 ${pct(ms, 95)} ms`);
});
