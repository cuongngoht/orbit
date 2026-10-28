// The STAGE MACHINE, as two tables -- never a branch per stage.
//
//   STAGES   which actions each stage allows, and which declared purposes a check may run there
//   MOVES    what a SETTLED action moves: the first row whose stages, kind and result hold says
//            which task operations follow -- a new stage, an attempt opened or ended, a block.
//            The last row always matches and moves nothing.
//
// The host never names a stage. It sends one action; the engine runs it, records how it ended,
// and these rows say where the task goes from there. A stage that allows no such action refuses
// the step before anything is written.
//
// Moves are DATA (`[op, given]`), applied in order through the task's one write door by
// src/orchestration/loop.mjs, so what a row says is exactly what lands on the journal.
import { blockedBy, currentAttempt, openOf } from "./journal.mjs";
import { afterBuild, buildDone, firstCheckStage, testsDone } from "./obligations.mjs";
import { BUILDING_PURPOSES, CAUSE, PURPOSES, RESULT, STAGE, STOP, TESTING_PURPOSES } from "./vocab.mjs";

const S = STAGE;

export const STAGES = [
  { stage: S.REQUIREMENT, actions: ["check-requirement"], purposes: [], doc: "the requirement the task rests on is read back" },
  { stage: S.CONTEXT, actions: ["gather-context"], purposes: [], doc: "what the project already knows, memory first" },
  { stage: S.ENVIRONMENT, actions: ["check-environment", "start-runtime", "gather-context"], purposes: [], doc: "whether the declared checks can run here" },
  { stage: S.WORKSPACE, actions: ["prepare-workspace"], purposes: [], doc: "the task's own isolated workspace" },
  { stage: S.PLANNING, actions: ["plan", "check", "gather-context", "prepare-sandbox", "implement"], purposes: PURPOSES, doc: "the smallest change and its scope -- which says what it reaches and which checks it is held to; a check here is a baseline; implement begins the first attempt" },
  { stage: S.IMPLEMENTING, actions: ["implement", "record-changes", "gather-context"], purposes: [], doc: "the change, made in the workspace and read back" },
  { stage: S.BUILDING, actions: ["check"], purposes: BUILDING_PURPOSES, doc: "the builds and static checks of what the change reaches" },
  { stage: S.TESTING, actions: ["check", "link-investigation", "invoke", "start-runtime", "prepare-sandbox", "start-sandbox"], purposes: TESTING_PURPOSES, doc: "a test of what the change reaches" },
  { stage: S.DIAGNOSING, actions: ["diagnose", "check", "gather-context", "prepare-sandbox", "start-sandbox"], purposes: PURPOSES, doc: "why it failed, before anything else changes: a look at the running application is a look, never a verdict" },
  { stage: S.FIXING, actions: ["implement", "record-changes", "gather-context"], purposes: [], doc: "the change the diagnosis pointed at" },
  { stage: S.REGRESSION, actions: ["check", "link-investigation", "invoke", "prepare-sandbox", "start-sandbox"], purposes: TESTING_PURPOSES, doc: "every test the change is held to, since the last change" },
  { stage: S.REVIEWING, actions: ["review", "commit", "push", "link-investigation", "gather-context", "start-sandbox"], purposes: [], doc: "the change as a whole, against its plan; once verified it may be committed in the workspace (autonomous) and that commit pushed (a protected boundary: a person approves the exact push once) before the review completes the task" },
];

export const stageOf = (name) => STAGES.find((s) => s.stage === name) ?? null;

// The stages in which a check holds an attempt to account: its failure ends that attempt.
export const CHECKING = [S.BUILDING, S.TESTING, S.REGRESSION];

// What may run while the task is BLOCKED: what can show its block is gone. The recheck of a
// stop may run in any stage; a stage's own action that clears it runs in that stage.
export const CLEARS = { "check-requirement": STOP.REQUIREMENT_BLOCKED, "check-environment": STOP.ENVIRONMENT_BLOCKED, "prepare-workspace": STOP.ENVIRONMENT_BLOCKED, check: STOP.ENVIRONMENT_BLOCKED, "prepare-sandbox": STOP.ENVIRONMENT_BLOCKED, "start-sandbox": STOP.ENVIRONMENT_BLOCKED };

const RECHECKS = { [STOP.REQUIREMENT_BLOCKED]: ["check-requirement"], [STOP.ENVIRONMENT_BLOCKED]: ["check-environment"] };

// While a change is being made (an `implement` is open), only reading it back -- or reading the
// project -- may run.
const WHILE_IMPLEMENTING = ["record-changes", "gather-context"];

const WHILE = [
  { when: (lw) => blockedBy(lw) !== null, allowed: (lw, row) => [...new Set([...(RECHECKS[blockedBy(lw)] ?? []), ...row.actions.filter((k) => CLEARS[k] === blockedBy(lw))])] },
  { when: (lw) => openOf(lw, "implement") !== null, allowed: () => WHILE_IMPLEMENTING },
  { when: () => true, allowed: (lw, row) => row.actions },
];

// The actions a step may take NOW.
export function allowedNow(lw) {
  const row = stageOf(lw.view.stage);
  if (!row) return [];
  return WHILE.find((w) => w.when(lw)).allowed(lw, row);
}

export const purposesNow = (lw) => stageOf(lw.view.stage)?.purposes ?? [];

// ---- the moves ----------------------------------------------------------------------------------

export const to = (stage) => ["stage", { stage }];
const opened = (cause) => ["attempt-start", { cause }];
const ended = (outcome, failureSignature) => ["attempt-complete", { outcome, failureSignature }];
const blocked = (stop, needs, because) => ["block", { stop, needs, because }];

const ANY = null;
const has = (list, x) => list === ANY || list.includes(x);

// A baseline that ran and FAILED moves nothing: a change may exist to fix exactly that, and the
// failure is kept as evidence a later failure is compared with. One that could not run at all
// says the workspace cannot run what the project declares, and that blocks.
const baselineSay = (r) => `before any change, ${r.summary ?? "a declared check"} could not run in the workspace${r.reason ? ` (${r.reason})` : ""} — restore what it needs there, then run it again`;

const diagnosed = (lw, r) => (r.then === "retest" ? [opened(CAUSE.RETEST), to(firstCheckStage(lw))] : [opened(CAUSE.FIX), to(S.FIXING)]);

const afterTests = (lw) => [to(S.REGRESSION), ...(testsDone(lw) ? [to(S.REVIEWING)] : [])];

// Where a check that SETTLED -- passed, or failed exactly as at its baseline -- leaves its checking stage.
const ONWARD = {
  [S.BUILDING]: (lw) => (buildDone(lw) ? [to(afterBuild(lw))] : []),
  [S.TESTING]: (lw) => afterTests(lw),
  [S.REGRESSION]: (lw) => (testsDone(lw) ? [to(S.REVIEWING)] : []),
};

const onward = (lw) => ONWARD[lw.view.stage](lw);

// A sandbox that could not be prepared or started blocks the environment, naming who must act: a
// person (trust it in Control), the machine, or a capability. One whose application came up from the
// changed code and stopped by itself is a failure of the change, and goes to diagnosis.
const sandboxBlocked = (lw, r) => [blocked(STOP.ENVIRONMENT_BLOCKED, r.needs ?? "environment", r.because ?? r.reason)];

const sandboxFailed = (lw, r) => [...(currentAttempt(lw) ? [ended("failed", r.failure?.signature)] : []), to(S.DIAGNOSING)];

const SANDBOXED = [S.TESTING, S.REGRESSION, S.REVIEWING];

export const MOVES = [
  { stages: [S.REQUIREMENT], kind: "check-requirement", results: [RESULT.SUCCEEDED], then: () => [to(S.CONTEXT)] },
  { stages: ANY, kind: "check-requirement", results: [RESULT.FAILED, RESULT.ERROR], then: (lw, r) => [blocked(STOP.REQUIREMENT_BLOCKED, "requirement", r.because ?? r.reason)] },
  { stages: [S.CONTEXT], kind: "gather-context", results: [RESULT.SUCCEEDED], then: () => [to(S.ENVIRONMENT)] },
  { stages: [S.ENVIRONMENT], kind: "check-environment", results: [RESULT.SUCCEEDED], then: () => [to(S.WORKSPACE)] },
  { stages: ANY, kind: "check-environment", results: [RESULT.FAILED, RESULT.ERROR], then: (lw, r) => [blocked(STOP.ENVIRONMENT_BLOCKED, r.needs ?? "environment", r.because ?? r.reason)] },
  { stages: [S.WORKSPACE], kind: "prepare-workspace", results: [RESULT.SUCCEEDED], then: (lw, r) => [["link-workspace", { workspace: r.workspace.id, baseRevision: r.workspace.baseRevision }], to(S.PLANNING)] },
  { stages: [S.WORKSPACE], kind: "prepare-workspace", results: [RESULT.FAILED, RESULT.ERROR], then: (lw, r) => [blocked(STOP.ENVIRONMENT_BLOCKED, "environment", r.because ?? r.reason)] },
  { stages: [S.PLANNING], kind: "check", results: [RESULT.ERROR], then: (lw, r) => [blocked(STOP.ENVIRONMENT_BLOCKED, "environment", baselineSay(r))] },
  { stages: [S.IMPLEMENTING, S.FIXING], kind: "record-changes", results: [RESULT.SUCCEEDED], then: (lw) => [to(firstCheckStage(lw))] },
  { stages: ANY, kind: "prepare-sandbox", results: [RESULT.FAILED, RESULT.ERROR], then: sandboxBlocked },
  { stages: ANY, kind: "start-sandbox", results: [RESULT.ERROR], then: sandboxBlocked },
  { stages: SANDBOXED, kind: "start-sandbox", results: [RESULT.FAILED], then: sandboxFailed },
  { stages: CHECKING, kind: "check", results: [RESULT.FAILED], when: (lw, r) => r.asBefore === true, then: onward },
  { stages: CHECKING, kind: "check", results: [RESULT.FAILED], then: (lw, r) => [ended("failed", r.failure?.signature), to(S.DIAGNOSING)] },
  { stages: CHECKING, kind: "check", results: [RESULT.ERROR], then: (lw, r) => [...(currentAttempt(lw) ? [ended("abandoned")] : []), blocked(STOP.ENVIRONMENT_BLOCKED, "environment", r.reason)] },
  { stages: CHECKING, kind: "check", results: [RESULT.SUCCEEDED], then: onward },
  { stages: [S.DIAGNOSING], kind: "diagnose", results: [RESULT.SUCCEEDED], then: (lw, r) => diagnosed(lw, r) },
  { stages: [S.REVIEWING], kind: "review", results: [RESULT.SUCCEEDED], then: () => [ended("succeeded")] },
  { stages: [S.REVIEWING], kind: "review", results: [RESULT.FAILED], then: (lw, r) => [ended("failed", r.failure?.signature), to(S.DIAGNOSING)] },
  { stages: ANY, kind: ANY, results: ANY, then: () => [] },
];

const matches = (row, lw, kind, r) => has(row.stages, lw.view.stage) && (row.kind === ANY || row.kind === kind) && has(row.results, r.outcome) && (row.when?.(lw, r) ?? true);

// The moves a settled action makes, read against the task as it stands AFTER the action's own
// records were written (its receipt, its files, how it ended).
export const movesOf = (lw, kind, r) => MOVES.find((row) => matches(row, lw, kind, r)).then(lw, r);

// A block is lifted by the engine only when an action that can clear it shows the condition gone:
// the recheck succeeded, or -- for a check -- it ran at all (whatever it found, the machine ran it).
const SHOWS_GONE = { check: (r) => r.outcome !== RESULT.ERROR };

const cleared = (lw, kind, r) => blockedBy(lw) !== null && CLEARS[kind] === blockedBy(lw) && (SHOWS_GONE[kind] ?? ((x) => x.outcome === RESULT.SUCCEEDED))(r);

export const unblocks = (lw, kind, r) => (cleared(lw, kind, r) ? [["unblock", { because: `${kind} shows it can go on` }]] : []);

// The actions whose failure ends the attempt they run in, so each belongs to one.
const ACCOUNTED = ["check", "start-sandbox"];

// Before an action starts: the first `implement` after a plan begins the first attempt, in IMPLEMENTING;
// a check (or a sandbox's start) in a checking stage belongs to an attempt, and one that has none (its
// attempt was abandoned when the environment blocked it) opens one, cause `retry`.
const BEFORE = [
  { when: (lw, kind) => kind === "implement" && lw.view.stage === S.PLANNING, ops: () => [opened(CAUSE.FRESH), to(S.IMPLEMENTING)] },
  { when: (lw, kind) => ACCOUNTED.includes(kind) && CHECKING.includes(lw.view.stage) && !currentAttempt(lw), ops: () => [opened(CAUSE.RETRY)] },
  { when: () => true, ops: () => [] },
];

export const beforeAct = (lw, kind) => BEFORE.find((b) => b.when(lw, kind)).ops();
