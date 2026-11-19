import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunResult } from "../../infra/process/process.port.js";
import { mapOrbitPanel } from "./orbit-status.mapper.js";

const out = (stdout: unknown, code = 0): RunResult => ({ code, signal: null, spawnError: null, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "", timedOut: false, truncated: false });
const at = "2026-11-19T13:00:00.000Z";

// Shapes captured from Orbit 0.6.0 (`live status --json`, `task show --json`, `autonomous-engineering context --json`).
const LIVE_IDLE = { work: null, association: { how: "none", task: null, ids: [], createdAt: null }, presentation: { state: "IDLE", sinceLastLineMs: null }, lifecycle: null, stage: null, attempt: null, revision: null, failure: null, session: { state: "NONE", checks: [], files: [] } };
const LIVE_TASK = { ...LIVE_IDLE, association: { how: "session", task: "tsk-e17dcb29a49f", ids: ["tsk-e17dcb29a49f"] }, presentation: { state: "LIVE", sinceLastLineMs: 5231, pulse: 2 }, lifecycle: "VERIFYING", stage: "VERIFY", revision: 9, session: { state: "ACTIVE", checks: [{ at: "2026-11-19T13:01:00Z", kind: "command", class: "test", exe: "node", ok: true }], files: ["sum.mjs"] } };
const TASK = (lifecycle: string, extra: Record<string, unknown> = {}) => ({ task: { id: "tsk-e17dcb29a49f", objective: "Fix the incorrect addition in sum.mjs" }, revision: 9, lifecycle, terminal: lifecycle === "COMPLETED" || lifecycle === "FAILED", stage: "VERIFY", stopReason: null, attempt: { number: 1, limit: 8 }, changes: { files: 1 }, verification: [], approvals: [], ...extra });
const CONTEXT = { verificationPlan: { source: "changes", word: "SCOPED", required: [{ id: "rt-command-00000003", purpose: "test", component: "root", declaredAs: "npm test", state: "passed", settled: true, baseline: "failed" }], excluded: [], missing: [] }, latestFailure: null, completion: null, stop: null };

test("a checkout Orbit does not know (exit 3) is not seated, and the verdict is unknown", () => {
  const p = mapOrbitPanel({ live: out("", 3), task: null, context: null, checkedAt: at });
  assert.equal(p.state, "not_seated");
  assert.equal(p.verdict.word, "unknown");
});

test("Orbit that cannot run is unavailable, never a pass", () => {
  const p = mapOrbitPanel({ live: { ...out(""), code: null, spawnError: "ENOENT" }, task: null, context: null, checkedAt: at });
  assert.equal(p.state, "unavailable");
  assert.equal(p.verdict.word, "unknown");
});

test("no task in this session: Orbit has given no verdict", () => {
  const p = mapOrbitPanel({ live: out(LIVE_IDLE), task: null, context: null, checkedAt: at });
  assert.equal(p.state, "available");
  assert.equal(p.task, null);
  assert.equal(p.verdict.word, "unknown");
  assert.match(p.verdict.source, /No Orbit task/);
});

test("a task in progress shows Orbit's words and still no verdict, even when a check passed", () => {
  const p = mapOrbitPanel({ live: out(LIVE_TASK), task: out(TASK("VERIFYING")), context: out(CONTEXT), checkedAt: at });
  assert.equal(p.task?.lifecycle, "VERIFYING");
  assert.equal(p.task?.stage, "VERIFY");
  assert.equal(p.planWord, "SCOPED");
  assert.deepEqual(p.checks, [{ id: "rt-command-00000003", purpose: "test", component: "root", declaredAs: "npm test", state: "passed" }]);
  assert.deepEqual(p.sessionChecks, [{ at: "2026-11-19T13:01:00Z", kind: "test", program: "node", ok: true }]);
  assert.equal(p.presentation, "LIVE");
  assert.equal(p.verdict.word, "unknown");
});

test("verified only when Orbit says so: a COMPLETED task, or work evidence `verified`", () => {
  assert.equal(mapOrbitPanel({ live: out(LIVE_TASK), task: out(TASK("COMPLETED")), context: out(CONTEXT), checkedAt: at }).verdict.word, "verified");
  const evidence = mapOrbitPanel({ live: out({ ...LIVE_TASK, work: { lifecycle: { state: "REPORTED_DONE" }, evidence: { level: "verified", say: "a linked task completed" }, liveness: "ENDED" } }), task: out(TASK("VERIFYING")), context: out(CONTEXT), checkedAt: at });
  assert.equal(evidence.verdict.word, "verified");
  assert.equal(evidence.work?.evidenceSays, "a linked task completed");
  const reported = mapOrbitPanel({ live: out({ ...LIVE_TASK, work: { evidence: { level: "reported" } } }), task: out(TASK("VERIFYING")), context: out(CONTEXT), checkedAt: at });
  assert.equal(reported.verdict.word, "unknown", "a report is not a verification");
});

test("not verified only on Orbit's own failure words", () => {
  assert.equal(mapOrbitPanel({ live: out(LIVE_TASK), task: out(TASK("FAILED", { stopReason: "VERIFICATION_FAILED" })), context: out(CONTEXT), checkedAt: at }).verdict.source, "task tsk-e17dcb29a49f lifecycle = FAILED (VERIFICATION_FAILED)");
  const violated = mapOrbitPanel({ live: out(LIVE_TASK), task: out(TASK("VERIFYING", { verification: [{ obligation: "root · test npm test passes", state: "violated", evidence: "check:chk-7" }] })), context: out(CONTEXT), checkedAt: at });
  assert.equal(violated.verdict.word, "not_verified");
  const regressed = mapOrbitPanel({ live: out(LIVE_TASK), task: out(TASK("VERIFYING")), context: out({ ...CONTEXT, verificationPlan: { ...CONTEXT.verificationPlan, required: [{ id: "c1", state: "regressed" }] } }), checkedAt: at });
  assert.equal(regressed.verdict.word, "not_verified");
});

test("open approvals, unmet completion rows and the latest failure are shown as Orbit wrote them", () => {
  const p = mapOrbitPanel({
    live: out(LIVE_TASK),
    task: out(TASK("WAITING_APPROVAL", { approvals: [{ id: "apr-1", action: "repository.push", state: "pending", open: true, boundary: "GIT_PUSH", title: "Git push", risk: "high", destructive: false, expires: null }, { id: "apr-0", state: "consumed", open: false }] })),
    context: out({ ...CONTEXT, completion: [{ id: "TESTS", say: "a required test has not passed" }], latestFailure: { class: "TEST", command: "rt-command-00000003", excerpt: ["✖ adds", `GH_TOKEN=secret`] } }),
    checkedAt: at,
  });
  assert.deepEqual(p.approvals, [{ id: "apr-1", title: "Git push", boundary: "GIT_PUSH", state: "pending", risk: "high", destructive: false, expires: null }]);
  assert.deepEqual(p.completion, [{ id: "TESTS", says: "a required test has not passed" }]);
  assert.deepEqual(p.failure, { failureClass: "TEST", command: "rt-command-00000003", excerpt: ["✖ adds", "GH_TOKEN=[redacted]"] });
});
