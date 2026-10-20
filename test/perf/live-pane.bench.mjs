// What Live Pane 2.0 COSTS (1.8.6), measured on this machine and said with its denominators. Skipped in the suite;
// run it on purpose and read the numbers:
//
//   ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/live-pane.bench.mjs
//
// Shapes: a coordinated workflow with a 12-step plan and its engineering task with 100, 1,000 and 3,000 journal lines
// (the window a viewer keeps) and twelve observed checks of 200 cases each; for each, the time to build the pane's
// whole answer (paneOf: rows, views, progress, plan, timeline) and the terminal's pane-layout frame (P50/P95 over RUNS),
// and the bytes of the JSON a docked pane is handed every two seconds. Then one real `live pane` process against an
// empty checkout, wall time over a few runs. A target is never a claim about another machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paneOf } from "../../src/live/tui/pane.mjs";
import { frameOf } from "../../src/live/tui/frame.mjs";
import { reduce } from "../../src/live/tui/reducer.mjs";
import { ENG, WF, ago, engView, fed, stateOf, wfView } from "../live-tui.fixture.mjs";
import { sealed } from "../home.mjs";

const RUNS = 30;
const skip = !process.env.ORBIT_BENCH;
const LIVE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli", "live.mjs");
const KINDS = ["stage", "decision", "action-started", "action-completed", "file-changed", "receipt"];

const lines = (n) => Array.from({ length: n }, (_, i) => ({ source: "task", n: i, at: ago(n - i), kind: KINDS[i % KINDS.length], stage: "TESTING", id: `act-${i}`, type: "test", outcome: i % 7 ? "succeeded" : "failed", summary: "x".repeat(60), observed: "o" }));

const steps = Array.from({ length: 12 }, (_, i) => ({ id: i ? `playbook.cap-${i}.verification` : "context", kind: i ? "playbook" : "context", after: i ? ["context"] : [], for: i ? `cap-${i}.verification` : null, because: "why this step is in the plan, in one sentence", strict: false }));

const plan = { ref: "0123456789abcdef", schema: 2, n: 4, workflow: "playbook", limit: 12, steps, replans: [1, 2, 3].map((k) => ({ n: k + 1, trigger: "CAPABILITY_MISSING", response: "insert-generation", step: `playbook.cap-${k}.verification`, summary: "a draft and a register step go in" })) };

const observation = (action) => ({ version: 1, task: ENG, action, command: { purpose: "test", program: "npm" }, adapter: { id: "tap", runner: "TAP", capabilities: { cases: "reported" } }, state: "ended", startedAt: ago(90), lastAt: ago(10), endedAt: ago(9), counts: { passed: 190, failed: 10, skipped: 0, todo: 0, cancelled: 0 }, reported: 200, total: 200, totals: { tests: 200, passed: 190, failed: 10 }, recent: Array.from({ length: 200 }, (_, i) => ({ key: `${i}`, name: `case ${i}`, state: i % 20 ? "passed" : "failed", seq: i })), failures: Array.from({ length: 10 }, (_, i) => ({ key: `${i}`, name: `case ${i * 20}`, category: "assertion", message: "expected 2 · actual 1", expected: "2", actual: "1", stack: [], seq: i })), failuresMore: 0, output: null, outcome: "failed", aborted: null, seq: 400, complete: true, mismatch: false, gaps: [] });

function world(n) {
  const base = fed(fed(stateOf({ root: WF, columns: 72, rows: 40 }), WF, wfView(), [{ source: "task", n: 0, at: ago(400), kind: "created" }]), ENG, engView(), lines(n), "child");
  const acts = Array.from({ length: 12 }, (_, i) => ({ event: "activity-view", id: "t=9", data: { source: "activity", task: ENG, action: `act-${i}`, revision: 400, view: observation(`act-${i}`) } }));
  return reduce(reduce(base, { type: "frames", task: ENG, frames: acts }), { type: "frames", task: WF, frames: [{ event: "plan-view", id: "t=9", data: { source: "plan", task: WF, ref: plan.ref, revision: plan.n, view: plan } }] });
}

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const ms = (n) => `${n.toFixed(2)} ms`;

function timed(fn) {
  const at = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - at) / 1e6;
}

function measured(name, fn) {
  const times = Array.from({ length: RUNS }, () => timed(fn));
  console.log(`${name.padEnd(44)} p50 ${ms(pct(times, 50))}  p95 ${ms(pct(times, 95))}  max ${ms(Math.max(...times))}`);
  return pct(times, 95);
}

test("the pane's whole answer and the terminal's pane frame, by journal size", { skip }, () => {
  for (const n of [100, 1_000, 3_000]) {
    const s = world(n);
    const p95 = measured(`paneOf · ${n} lines · 12 checks · 12-step plan`, () => paneOf(s));
    const bytes = Buffer.byteLength(JSON.stringify(paneOf(s)));
    console.log(`${"  pane JSON".padEnd(44)} ${(bytes / 1024).toFixed(1)} KiB`);
    measured(`frameOf (pane layout) · ${n} lines`, () => frameOf({ ...s, viewer: { ...s.viewer, layout: "pane", view: "timeline", redraw: true } }));
    assert.ok(bytes < 48 * 1024, "the answer a pane is handed stays bounded");
    assert.ok(p95 < 250, "a pane asks every two seconds: one answer is a small part of that");
  }
});

test("one real `live pane` process, wall time", { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pane-bench-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off" });
  const times = Array.from({ length: 8 }, () => timed(() => spawnSync(process.execPath, [LIVE, "pane", "--host=claude"], { cwd: repo, env, input: JSON.stringify({ session_id: "s", cwd: repo }) })));
  console.log(`${"live pane process (empty checkout)".padEnd(44)} p50 ${ms(pct(times, 50))}  p95 ${ms(pct(times, 95))}  max ${ms(Math.max(...times))}`);
});
