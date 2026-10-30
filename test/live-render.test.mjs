// What a terminal is handed: the status line's few lines, the plain and JSONL lines, the full screen. Data a
// journal holds can never carry an escape sequence, a line break or a reordering mark to the terminal; widths
// hold; and nothing is invented -- every word comes from the view or a journal line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotOf } from "../src/live/snapshot.mjs";
import { compactLines } from "../src/live/render/compact.mjs";
import { plainLine } from "../src/live/render/plain.mjs";
import { jsonlLine } from "../src/live/render/jsonl.mjs";
import { screenLines } from "../src/live/render/screen.mjs";
import { displayWidth, fit } from "../src/live/render/width.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";

const NOW = Date.parse("2026-10-08T10:00:20.000Z");
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const RLO = String.fromCharCode(0x202e);
const HOSTILE = `${ESC}[2J${ESC}]0;pwned${BEL}evil${RLO}txt\nsecond line`;

const view = (over = {}) => ({ task: { id: "tsk-3f9a1c2b7d4e", createdAt: "2026-10-08T09:46:00.000Z", updatedAt: "2026-10-08T10:00:08.000Z", host: "mbp" }, revision: 41, lifecycle: "EXECUTING", terminal: false, stage: "TESTING", attempt: { current: "att-2", number: 2, count: 2, limit: 8 }, approvals: [], paused: null, blocked: null, actions: [], decision: { nextAction: "DIAGNOSING" }, ended: null, ...over });
const qaStep = (n, on) => ({ source: "inv-20261008-101233-abcd", n, at: `2026-10-08T10:00:0${n}.000Z`, kind: "qa.step", do: "click", on, state: "done", ms: 120, screenshot: true });
const events = (on = "Confirm Refund") => [{ source: "task", n: 0, at: "2026-10-08T09:46:00.000Z", kind: "created", objective: "PBI-482" }, { source: "inv-20261008-101233-abcd", n: 0, at: "2026-10-08T10:00:00.000Z", kind: "qa.started", mode: "observe" }, qaStep(1, on), qaStep(2, on), { source: "inv-20261008-101233-abcd", n: 3, at: "2026-10-08T10:00:08.000Z", kind: "qa.network", requests: [{ method: "POST", endpoint: "/api/refunds", status: 500 }] }];
const snap = (over = {}, evs = events()) => snapshotOf({ association: { how: "session", task: "tsk-3f9a1c2b7d4e", ids: ["tsk-3f9a1c2b7d4e"] }, collected: { view: view(over), cursor: "t=41" }, events: evs, nowMs: NOW });

test("one line says the stage, the attempt and the QA step in flight, from the journal's own words", () => {
  const [line] = compactLines(snap(), { lines: 1, columns: 200 });
  assert.match(line, /^Orbit [◐◓◑◒] ORBITING · TESTING · 2\/8 · QA → click Confirm Refund · 2 steps$/);
});

test("three lines add the task, its age, and the latest failure with what comes next", () => {
  const lines = compactLines(snap(), { lines: 3, columns: 200 });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /tsk-3f9a1c2b7d4e {2}EXECUTING · TESTING {2}attempt 2\/8 {2}last line 12s ago/);
  assert.match(lines[2], /✗ POST \/api\/refunds 500 · next: DIAGNOSING/);
});

test("a waiting approval, a block and an end are said as the lifecycle, never as LIVE", () => {
  const approval = compactLines(snap({ lifecycle: "WAITING_APPROVAL", approvals: [{ id: "apr-3", action: "database.migrate", open: true }] }), { lines: 2, columns: 200 });
  assert.match(approval[0], /⏸ WAITING APPROVAL/);
  assert.match(approval[1], /apr-3 · database.migrate · decide in Orbit Control/);
  assert.match(compactLines(snap({ lifecycle: "BLOCKED", blocked: { stop: "ENVIRONMENT_BLOCKED", needs: "environment" } }), { lines: 1, columns: 200 })[0], /■ BLOCKED .*ENVIRONMENT_BLOCKED \(needs environment\)/);
  assert.match(compactLines(snap({ lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed", summary: "refund validated" } }), { lines: 1, columns: 200 })[0], /✓ COMPLETED .*refund validated/);
});

test("a task quiet for longer than the idle window says IDLE and how long, and does not pulse", () => {
  const quiet = snapshotOf({ association: { how: "session", task: "tsk-3f9a1c2b7d4e", ids: [] }, collected: { view: view(), cursor: "t=1" }, events: events(), nowMs: NOW + 600_000 });
  assert.match(compactLines(quiet, { lines: 2, columns: 200 })[0], /○ IDLE .*last line 10m12s ago/);
});

test("nothing to show is no line at all; two candidates are said as such, with how to choose", () => {
  assert.deepEqual(compactLines(snapshotOf({ association: { how: "none", task: null, ids: [] }, collected: null, nowMs: NOW })), []);
  const two = compactLines(snapshotOf({ association: { how: "ambiguous", task: null, ids: ["tsk-111111111111", "tsk-222222222222"] }, collected: null, nowMs: NOW }), { lines: 3, columns: 200 });
  assert.deepEqual(two, ["Orbit ? 2 tasks in this checkout · pin one: live pin tsk-111111111111"]);
});

test("hostile text in a journal reaches no terminal: no escape, no bell, no reordering mark, no second line", () => {
  const hostile = snap({}, events(HOSTILE));
  const all = [...compactLines(hostile, { lines: 3, columns: 300, colour: true }), ...screenLines(hostile, { columns: 300, rows: 40, colour: true }), ...hostile.events.map((e) => plainLine({ event: "qa-event", data: e }))].join("\n");
  const sequences = all.match(/\u001b\[[0-9;?]*[A-Za-z]/g) ?? [];
  assert.ok(sequences.every((s) => /^\u001b\[(\d+(;\d+)*)?m$/.test(s)), "only colour, from the renderer itself");
  assert.equal(unstyled(all).includes(ESC), false);
  assert.equal(all.includes(BEL), false);
  assert.equal(all.includes(RLO), false);
  assert.match(all, /evil.*txt ⏎ second line/);
});

test("JSONL is the feed's frame, one per line, with every control and reordering character escaped", () => {
  const line = jsonlLine({ event: "qa-event", id: "t=1;inv-20261008-101233-abcd=3", data: { on: HOSTILE } });
  assert.equal(line.includes("\n"), false);
  assert.equal(line.includes(ESC), false);
  assert.equal(line.includes(RLO), false);
  assert.deepEqual(JSON.parse(line), { v: 1, event: "qa-event", id: "t=1;inv-20261008-101233-abcd=3", data: { on: HOSTILE } });
  assert.equal(jsonlLine({ event: "ping", data: {} }), null);
});

test("plain lines are deterministic and carry no colour", () => {
  const e = qaStep(1, "Confirm Refund");
  assert.equal(plainLine({ event: "qa-event", data: e }), "2026-10-08T10:00:01.000Z  qa    qa.step              click Confirm Refund · 120ms · 📸");
  assert.equal(plainLine({ event: "end", data: { reason: "terminal" } }), "-  end   terminal");
  assert.equal(plainLine({ event: "ping", data: {} }), null);
});

test("every line fits its width, counted the way a terminal counts wide characters and emoji", () => {
  for (const columns of [20, 40, 60, 80]) {
    const lines = [...compactLines(snap({}, events("退款确认 按钮 📸 Confirm Refund")), { lines: 3, columns, colour: true }), ...screenLines(snap(), { columns, rows: 20, colour: true })];
    for (const l of lines) assert.ok(displayWidth(unstyled(l)) <= columns, `${displayWidth(unstyled(l))} > ${columns}: ${unstyled(l)}`);
  }
  assert.equal(fit("退款确认", 5), "退款…");
  assert.equal(displayWidth("é"), 1);
});

test("the full screen has a header, the loop of stages, what runs now, and the timeline, newest last", () => {
  const lines = screenLines(snap(), { columns: 140, rows: 20 });
  assert.match(lines[0], /ORBIT LIVE .* tsk-3f9a1c2b7d4e {2}EXECUTING · TESTING {3}attempt 2\/8 {3}elapsed 14m20s {3}machine mbp/);
  assert.match(lines[1], /REQ · .* TEST ● DIAG ·/);
  assert.match(lines.at(-1), /qa\.network +POST \/api\/refunds 500/);
  assert.ok(lines.length <= 20);
});

test("a console shows the sandbox's lines as given, under its own rule, within the rows", () => {
  const lines = screenLines(snap(), { columns: 120, rows: 14, logs: { session: "rs-0123456789ab", stream: "out", lines: ["[12:00] started", `fail: ${HOSTILE}`] } });
  assert.ok(lines.some((l) => /sandbox rs-0123456789ab out · masked, read-only/.test(l)));
  assert.match(lines.at(-1), /fail: .*evil/);
  assert.equal(lines.join("").includes(ESC), false);
});

// ---- the milestone console and a coordinated workflow ---------------------------------------------

import { MILESTONES, milestoneLines, milestonesOf } from "../src/live/render/milestones.mjs";
import { protectedFold, protectedSay } from "../src/live/protected.mjs";
import { associate } from "../src/live/association.mjs";

const at = (s) => `2026-10-08T21:${s}.000Z`;
const t = (kind, s, extra = {}) => ({ source: "task", n: 0, at: at(s), kind, ...extra });

const engineering = [
  t("created", "40:00", { objective: "PBI-482" }),
  t("receipt", "40:01", { domain: "requirement", ref: "rs-0123456789ab", outcome: "READY" }),
  t("workspace", "40:08", { workspace: "ws-1" }),
  t("action-started", "42:00", { id: "act-3", type: "record-changes" }), t("action-completed", "42:11", { id: "act-3", outcome: "succeeded" }),
  t("action-started", "42:20", { id: "act-4", type: "build" }), t("action-completed", "42:55", { id: "act-4", outcome: "succeeded" }),
  t("action-started", "43:00", { id: "act-5", type: "test" }), t("action-completed", "43:30", { id: "act-5", outcome: "failed", summary: "1 assertion" }),
  t("decision", "43:32", { nextAction: "diagnose" }),
  t("stage", "43:40", { stage: "FIXING" }),
  t("attempt-started", "44:15", { cause: "fix" }),
];

const engineeringView = { task: { id: "tsk-9c1d2e3f4a5b", root: "req-0123456789ab" }, lifecycle: "EXECUTING", terminal: false, stage: "TESTING", attempt: { number: 2, limit: 8 }, attempts: [{ cause: "fresh", outcome: "failed" }, { cause: "fix", outcome: null }], approvals: [], actions: [{ id: "act-4", type: "build", state: "succeeded" }, { id: "act-6", type: "test", state: "running", startedAt: at("44:20") }], receipts: [], paused: null, blocked: null, decision: null };

const msnap = (view, evs, child = null) => snapshotOf({ association: { how: "session", task: view.task.id, ids: [view.task.id] }, collected: { view, cursor: "t=1" }, events: evs, nowMs: Date.parse(at("44:30")), child });

test("the milestone console says each milestone in a sentence, from the journal's own lines, and pulses only what still runs", () => {
  const lines = milestoneLines(msnap(engineeringView, engineering), { columns: 100, rows: 30 }).map(unstyled);
  assert.match(lines[0], /ORBIT LIVE — Full Console/);
  assert.match(lines[1], /TASK tsk-9c1d2e3f4a5b · req-0123456789ab · Attempt 2\/8/);
  const says = milestonesOf(engineering).map((m) => m.say);
  assert.deepEqual(says, ["Requirement snapshot loaded", "Task workspace prepared", "Implementation completed", "Build succeeded", "Tests failed · 1 assertion", "Agent diagnosing failure", "Fix recorded · running tests again"]);
  assert.ok(lines.some((l) => /21:44:15 {2}◐ {2}Fix recorded · running tests again/.test(l)), "the attempt still running pulses");
  assert.ok(lines.some((l) => /BUILD ✓ · TEST RETEST ●/.test(l)), "the strip of checks");
  assert.ok(!lines.some((l) => /FIXING/.test(l)), "a stage line is not a milestone");
});

test("every milestone row is reachable from a journal line, and hostile text in one reaches no terminal", () => {
  const push = t("approval-requested", "00:00", { id: "apr-9", boundary: "GIT_PUSH", shows: { remote: "origin", ref: "refs/heads/orbit/tsk-1" } });
  const fold = protectedFold([push, t("approval-consumed", "00:00", { id: "apr-9", action: "act-9" })]);
  const ctx = (e) => ({ types: new Map([["act-1", e.type ?? null]]), ...fold });
  const protectedLines = [push, t("approval-granted", "00:00", { id: "apr-9" }), t("approval-rejected", "00:00", { id: "apr-9" }), t("approval-expired", "00:00", { id: "apr-9" }), t("action-started", "00:00", { id: "act-9", approval: "apr-9" }), t("action-completed", "00:00", { id: "act-9", outcome: "succeeded" }), t("action-failed", "00:00", { id: "act-9" })];
  const lines = [t("receipt", "00:00", { domain: "step", ref: "qa", outcome: "SUCCEEDED" }), t("receipt", "00:00", { domain: "step", ref: "qa", outcome: "REPORTED" }), t("receipt", "00:00", { domain: "step", ref: "qa", outcome: "FAILED" }), t("receipt", "00:00", { domain: "step", ref: "qa", outcome: "BLOCKED" }), t("receipt", "00:00", { domain: "step", ref: "qa", outcome: "RUNNING" }), t("receipt", "00:00", { domain: "plan", ref: "x", outcome: "ACTIVE" }), t("receipt", "00:00", { domain: "task", ref: "tsk-1", outcome: "STARTED" }), t("receipt", "00:00", { domain: "skill", ref: "a:0.1.0:12345678", outcome: "ACTIVE" }), t("receipt", "00:00", { domain: "requirement", ref: "rs-1", outcome: "READY" }), t("workspace", "00:00"), { ...t("action-completed", "00:00", { id: "act-1", outcome: "succeeded" }), type: "record-changes" }, { ...t("action-completed", "00:00", { id: "act-1", outcome: "succeeded" }), type: "build" }, { ...t("action-completed", "00:00", { id: "act-1", outcome: "failed" }), type: "verify" }, t("receipt", "00:00", { domain: "impact", ref: "imp-3", outcome: "MISSING", summary: "changes: 1 component(s) reached" }), { ...t("action-completed", "00:00", { id: "act-1", outcome: "failed" }), type: "test" }, t("decision", "00:00", { nextAction: "diagnose" }), t("attempt-started", "00:00", { cause: "fix" }), t("attempt-started", "00:00", { cause: "retest" }), t("approval-requested", "00:00", { id: "apr-1" }), t("blocked", "00:00", { stop: "X" }), t("completed", "00:00"), t("failed", "00:00", { stop: "X" }), t("cancelled", "00:00"), ...protectedLines];
  MILESTONES.forEach((row, i) => assert.ok(lines.some((e) => row.when(e, ctx(e))), `row ${i} is unreachable`));
  const impact = milestonesOf([t("receipt", "00:00", { domain: "impact", ref: "imp-3", outcome: "MISSING", summary: "changes: 1 component(s) reached" })]);
  assert.deepEqual([impact[0].glyph, impact[0].say], ["▲", "Impact missing · changes: 1 component(s) reached"]);
  const evil = [t("receipt", "00:00", { domain: "step", ref: "qa", outcome: "FAILED", summary: HOSTILE })];
  const out = milestoneLines(msnap(engineeringView, evil), { columns: 200, rows: 20, colour: true }).join("\n");
  assert.ok(!out.includes(BEL) && !out.includes(RLO) && !/\u001b\]/.test(out));
});

test("a protected approval reads as its boundary and what a person reads, a set flag by its name and DESTRUCTIVE first", () => {
  const push = (force) => ({ boundary: "GIT_PUSH", shows: { remote: "origin", ref: "refs/heads/orbit/tsk-1", commit: "199dc26070a7", force } });
  assert.equal(protectedSay(push("false")), "Git push · origin · refs/heads/orbit/tsk-1 · 199dc26070a7", "an unset flag says nothing");
  assert.equal(protectedSay(push("true")), "Git push · origin · refs/heads/orbit/tsk-1 · 199dc26070a7 · force");
  assert.match(protectedSay({ boundary: "PRODUCTION_DESTRUCTIVE_DATA", destructive: true, shows: { database: "orders" } }), /^DESTRUCTIVE · .+ · orders$/);
  assert.equal(protectedSay({ id: "apr-1" }), "", "an approval that names no boundary reads as it always did");
});

test("a coordinated workflow shows its steps as a strip and the engineering task it started as one line", () => {
  const coordinator = { task: { id: "tsk-aaaaaaaaaaaa", provider: "automation" }, lifecycle: "EXECUTING", terminal: false, stage: "IMPLEMENTING", attempt: { number: 1, limit: 4 }, approvals: [], actions: [{ id: "act-4", type: "agent.dispatch", tool: "orbit-engineer", label: "engineering: the change", state: "running", startedAt: at("40:00") }], receipts: ["requirement:SUCCEEDED", "context:REPORTED", "runtime:SUCCEEDED", "engineering:RUNNING", "qa:PENDING"].map((x) => ({ domain: "step", ref: x.split(":")[0], outcome: x.split(":")[1] })), paused: null, blocked: null, decision: null };
  const lines = milestoneLines(msnap(coordinator, [], { ...engineeringView, task: { id: "tsk-9c1d2e3f4a5b" } }), { columns: 140, rows: 20 }).map(unstyled);
  assert.ok(lines.some((l) => /WORKFLOW requirement ✓ · context ~ · runtime ✓ · engineering ● · qa ·/.test(l)));
  assert.ok(lines.some((l) => /CHILD tsk-9c1d2e3f4a5b · EXECUTING · TESTING · attempt 2\/8 {2}BUILD ✓ · TEST RETEST ●/.test(l)));
  assert.ok(lines.some((l) => /c engineering task/.test(l)));
  assert.match(compactLines(msnap(coordinator, []), { lines: 2, columns: 120 }).map(unstyled)[1], /▶ agent orbit-engineer · engineering: the change 4m30s/);
});

test("a session's viewer follows the coordinated workflow, not the engineering task it started", () => {
  const rows = [{ id: "tsk-aaaaaaaaaaaa", checkout: "c", session: "m", terminal: false, createdAt: "1", endedAt: null, coordinates: true }, { id: "tsk-bbbbbbbbbbbb", checkout: "c", session: "m", terminal: false, createdAt: "2", endedAt: null, coordinates: false }];
  assert.deepEqual(associate({ mark: "m", checkout: "c", rows, now: 0 }).task, "tsk-aaaaaaaaaaaa");
  assert.equal(associate({ mark: "m", checkout: "c", rows: rows.map((r) => ({ ...r, coordinates: false })), now: 0 }).task, "tsk-bbbbbbbbbbbb", "without a coordinator: the newest, as before");
  assert.equal(associate({ mark: "m", checkout: "c", rows, pins: { checkout: "tsk-bbbbbbbbbbbb" }, now: 0 }).task, "tsk-bbbbbbbbbbbb", "a pin still wins");
});

test("once the workflow and its engineering task have ended, the viewer still shows the workflow -- new work after it wins", () => {
  const at = (m) => `2026-10-16T04:${String(m).padStart(2, "0")}:00.000Z`;
  const wf = { id: "tsk-aaaaaaaaaaaa", checkout: "c", session: "m", terminal: true, createdAt: at(8), endedAt: at(14), coordinates: true };
  const child = { id: "tsk-bbbbbbbbbbbb", checkout: "c", session: "m", terminal: true, createdAt: at(9), endedAt: at(10), coordinates: false };
  const now = Date.parse(at(15));
  assert.deepEqual(((a) => [a.how, a.task])(associate({ mark: "m", checkout: "c", rows: [wf, child], now })), ["finished", wf.id], "the child was created inside the workflow's run");
  const later = { id: "tsk-cccccccccccc", checkout: "c", session: "m", terminal: true, createdAt: "2026-10-16T04:14:30.000Z", endedAt: at(15), coordinates: false };
  assert.equal(associate({ mark: "m", checkout: "c", rows: [wf, child, later], now: Date.parse(at(16)) }).task, later.id, "a task created after the workflow ended is new work");
  assert.equal(associate({ mark: "m", checkout: "c", rows: [wf, child].map((r) => ({ ...r, coordinates: false })), now }).task, child.id, "without a coordinator: the newest, as before");
});

// 0.2.2, ADR 0044: a program reading `live watch --jsonl` gets the frames a pane draws a declared skill run from.
test("JSONL carries a workflow's plan and a playbook's projection, the frames a skill run's identity is drawn from", () => {
  for (const event of ["plan-view", "skill-view"]) assert.equal(JSON.parse(jsonlLine({ event, id: "t=4", data: { source: event.split("-")[0], task: "tsk-0123456789ab", view: {} } })).event, event);
});

test("the evidence overlay ranks a skill run's receipts with the rest and shows the run's pin, provider and digests", async () => {
  const { CONTEXT_FIELDS, EVIDENCE_DOMAINS, evidenceItems } = await import("../src/live/tui/overlays/evidence.mjs");
  const view = { readiness: {}, approvals: [], verification: [], actions: [], receipts: [{ domain: "invocation", ref: "srun-0123456789ab.notes.1", outcome: "OK" }, { domain: "zzz", ref: "x", outcome: "OK" }, { domain: "skillrun", ref: "srun-0123456789ab", outcome: "RUNNING" }] };
  assert.deepEqual(evidenceItems(view).filter((i) => i.kind === "receipt").map((i) => i.data.domain), ["skillrun", "invocation", "zzz"]);
  for (const field of ["pin", "providerKey", "operation", "queryDigest", "resultDigest"]) assert.ok(CONTEXT_FIELDS.receipt.includes(field), field);
  assert.ok(["skillrun", "skillstep", "invocation"].every((d) => EVIDENCE_DOMAINS.includes(d)));
});
