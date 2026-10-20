// What OBSERVING a running check costs (1.8.5, ADR 0020), measured, never assumed. Skipped in the suite (it writes
// hundreds of megabytes of output and runs real children); run it on purpose and read the numbers:
//
//   ORBIT_BENCH=1 node --test --test-reporter=spec test/perf/activity.bench.mjs
//
// Shapes:
//   throughput  100,000 TAP cases fed through an observation in 64 KiB chunks, written to a real sidecar: events a
//               second, the sidecar's size, what the budget dropped, and the heap the observation held at its peak
//   burst       one 4 MiB chunk of 40,000 lines: how long one chunk holds the reader (the child's pipe waits on it)
//   replay      folding that sidecar again, as a viewer that attaches does: the time and the projection's size
//   delivery    a producer flushing 100 events a second for 10 s, a follower polling at the live core's own 500 ms:
//               the delay from a line written to the projection holding it -- p50 / p95 / max
//   overhead    a child printing 200,000 lines, run by run() and by runObserved() with an observer: the wall time
//               of each, and the difference
// The budgets in docs/plans/release-1.8.5-live-engineering-cockpit.md §4 are targets; this prints what the machine did.
import { test } from "node:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObservation } from "../../src/orchestration/activity/observe.mjs";
import { ACTIVITY_SOURCE, activityFile } from "../../src/orchestration/activity/source.mjs";
import { LIMITS } from "../../src/orchestration/activity/vocab.mjs";
import { ADAPTERS } from "../../skills/orbit-engineer/observers/index.mjs";
import { activitySubject } from "../../src/live/subjects.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { realIo } from "../../src/store/io.mjs";

const ON = process.env.ORBIT_BENCH === "1";
const TASK = "tsk-0123456789ab";

const room = (t) => ((d) => (t.after(() => rmSync(d, { recursive: true, force: true })), d))(mkdtempSync(join(tmpdir(), "orbit-bench-activity-")));

function observing(file, budget = LIMITS.ACTION_BYTES) {
  const io = realIo();
  io.ensureDir(join(file, ".."));
  return createObservation({ identity: { task: TASK, action: "act-1", attempt: "att-1", check: "chk-1" }, command: { id: "t", purpose: "test", component: "node:bench", declaredAs: "test", argv: ["npm", "test"] }, why: "benchmark", adapters: ADAPTERS, sink: { append: (text) => io.append(file, text) }, clock: () => Date.now(), budget });
}

const tapCases = (n) => `TAP version 13\n${Array.from({ length: n }, (_, i) => (i % 97 === 0 ? `# Subtest: case ${i}\nnot ok ${i + 1} - case ${i}\n  ---\n  duration_ms: 0.5\n  error: 'expected ${i} to be ${i + 1}'\n  ...` : `# Subtest: case ${i}\nok ${i + 1} - case ${i}\n  ---\n  duration_ms: 0.3\n  ...`)).join("\n")}\n1..${n}\n# tests ${n}\n`;

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
const pct = (list, p) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))];

test("throughput, burst and replay of an observed run", { skip: ON ? false : "ORBIT_BENCH=1 to run" }, (t) => {
  const dir = room(t);
  const file = activityFile(dir, TASK, "act-1");
  const text = Buffer.from(tapCases(100_000));
  const heap0 = process.memoryUsage().heapUsed;
  const o = observing(file);
  const began = performance.now();
  let peak = heap0;
  for (let i = 0; i < text.length; i += 64 * 1024) {
    o.chunk("out", text.subarray(i, i + 64 * 1024));
    if (i % (64 * 1024 * 64) === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
  }
  const view = o.settled({ ok: false, started: true, status: 1, durationMs: 1 });
  const took = performance.now() - began;
  console.log(`throughput: ${mb(text.length)} of TAP, 100,000 cases in ${took.toFixed(0)} ms = ${(100_000 / (took / 1000)).toFixed(0)} cases/s; sidecar ${mb(statSync(file).size)} (budget ${mb(LIMITS.ACTION_BYTES)}); counted ${view.reported} (passed ${view.counts.passed}, failed ${view.counts.failed}); gaps: ${view.gaps.join("; ") || "none"}; heap peak +${mb(peak - heap0)}`);
  const burst = observing(join(dir, "orchestration", TASK, "activity", "act-2.jsonl"));
  const big = Buffer.from(Array.from({ length: 40_000 }, (_, i) => `ok ${i + 1} - burst ${i} ${"x".repeat(60)}`).join("\n"));
  const b0 = performance.now();
  burst.chunk("out", Buffer.from("TAP version 13\n"));
  burst.chunk("out", big);
  console.log(`burst: one ${mb(big.length)} chunk of 40,000 lines held the reader ${(performance.now() - b0).toFixed(0)} ms`);
  const r0 = performance.now();
  const subject = activitySubject(ACTIVITY_SOURCE, realIo(), file);
  subject.poll();
  const replayed = subject.view();
  console.log(`replay: folding the ${mb(statSync(file).size)} sidecar took ${(performance.now() - r0).toFixed(0)} ms; projection ${(JSON.stringify(replayed).length / 1024).toFixed(1)} KiB, reported ${replayed.reported}`);
});

test("delivery latency from a line written to the projection holding it, at the live core's own poll", { skip: ON ? false : "ORBIT_BENCH=1 to run" }, async (t) => {
  const dir = room(t);
  const file = activityFile(dir, TASK, "act-1");
  const o = observing(file);
  const subject = activitySubject(ACTIVITY_SOURCE, realIo(), file);
  const written = new Map();
  const delays = [];
  o.chunk("out", Buffer.from("TAP version 13\n"));
  let n = 0;
  const producer = setInterval(() => {
    n += 1;
    written.set(`case ${n}`, performance.now());
    o.chunk("out", Buffer.from(`ok ${n} - case ${n}\n`));
  }, 10);
  const follower = setInterval(() => {
    if (!subject.poll()) return;
    const now = performance.now();
    for (const r of subject.view().recent) if (written.has(r.name)) delays.push(now - written.get(r.name)) && written.delete(r.name);
  }, 500);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  clearInterval(producer);
  clearInterval(follower);
  console.log(`delivery: ${delays.length} of ${n} cases measured (the projection keeps the last ${LIMITS.CASES_KEPT}); p50 ${pct(delays, 0.5).toFixed(0)} ms, p95 ${pct(delays, 0.95).toFixed(0)} ms, max ${Math.max(...delays).toFixed(0)} ms at a 500 ms poll`);
});

test("what observing adds to a child that prints 200,000 lines", { skip: ON ? false : "ORBIT_BENCH=1 to run" }, async (t) => {
  const dir = room(t);
  const child = join(dir, "child.mjs");
  writeFileSync(child, `const line = "ok 1 - a case that passed\\n";\nfor (let i = 0; i < 200000; i++) process.stdout.write(line);\n`);
  const p = createProcess();
  const s0 = performance.now();
  p.run(process.execPath, [child], { timeoutMs: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const plain = performance.now() - s0;
  const o = observing(activityFile(dir, TASK, "act-1"));
  const o0 = performance.now();
  await p.runObserved(process.execPath, [child], { timeoutMs: 120_000, maxBuffer: 64 * 1024 * 1024, observe: o.chunk });
  const watched = performance.now() - o0;
  console.log(`overhead: run() ${plain.toFixed(0)} ms, runObserved() with an observer ${watched.toFixed(0)} ms (+${(watched - plain).toFixed(0)} ms for 200,000 lines)`);
});
