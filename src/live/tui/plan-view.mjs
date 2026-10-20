// The PLAN a pane shows (1.8.6, ADR 0022): a coordinated workflow's steps as the graph they are -- each step's state
// in words that need their evidence (VERIFIED only on its owner's record), why it is there, what it waits for -- the
// plan's revisions and why each was made, and what the skill factory is doing for every capability a playbook is
// being drafted for. Read off the plan its source projected and the task's own receipts (src/live/plan.mjs); a task
// that is not a coordinated workflow says so, and points at its own steps.
//
//   planOf(ctx) -> { ref, n, workflow, steps, replans, skills } | null     the data a drawer may use
//   planRows(ctx) -> [row]                                                  the Plan view
//   nextStepOf(snap) -> step | null                                          the first step whose waits are all done
import { doneOn, goalOf, planViewOf, replansOf, skillsOf, stepWordOf, stepsOf } from "../plan.mjs";
import { isCoordinator } from "./model.mjs";
import { dim, joined, row, seg } from "./sections/parts.mjs";
import { skillRunRows } from "./skill-run-view.mjs";

export const DAG_ROWS = 24;

// How each step word looks (its word is src/live/plan.mjs STEP_STATE_WORDS -- the one table every viewer shares).
const STEP_LOOK = {
  VERIFIED: { tone: "success", glyph: "✓" },
  DONE: { tone: "success", glyph: "✓" },
  REPORTED: { tone: "warning", glyph: "~" },
  RUNNING: { tone: "info", glyph: "●" },
  FAILED: { tone: "danger", glyph: "✗" },
  BLOCKED: { tone: "warning", glyph: "■" },
  SKIPPED: { tone: "subtle", glyph: "-" },
  PENDING: { tone: "subtle", glyph: "○" },
};

export const stepState = (s) => ((word) => ({ word, ...STEP_LOOK[word] }))(stepWordOf(s));

export const nextStepOf = (snap) => ((steps) => steps.find((s) => stepState(s).word === "PENDING" && s.after.every((a) => doneOn(steps.find((x) => x.id === a) ?? {}))) ?? null)(stepsOf(snap?.plan, snap?.view));

export const currentStepOf = (snap) => stepsOf(snap?.plan, snap?.view).find((s) => s.outcome === "RUNNING") ?? null;

export { goalOf };

// The plan a pane's JSON carries: the projection every viewer shares (src/live/plan.mjs planViewOf), its steps cut to
// what a pane draws.
export function planOf(ctx) {
  const snap = ctx.d.root;
  if (!isCoordinator(snap?.view)) return null;
  return ((p) => ({ ...p, steps: p.steps.slice(0, DAG_ROWS) }))(planViewOf(snap.plan, snap.view, snap.events, snap.skills));
}

// ---- rows ----------------------------------------------------------------------------------------------

const stepRow = (s) => ((st) => row([seg(`${st.glyph} `, st.tone), seg(s.id, "label"), dim(s.because ? `  ${s.because}` : "")], [seg(st.word, st.tone), dim(s.after.length ? `  ← ${s.after.join(", ")}` : "")], { status: st.word, depth: 0 }))(stepState(s));

const goalWords = (view) => ((g) => (g ? ` · goal ${g.goal}${g.unit ? ` ${g.unit}` : ""}` : ""))(goalOf(view));

const headRow = (snap, steps, replans) => row([seg(`plan-${snap.plan?.n ?? "?"}`, "label"), dim(` (${snap.plan?.workflow ?? "workflow"}) · ${steps.length} step(s)${replans.length ? ` · revised ${replans.length}×` : ""}${snap.plan ? "" : " · read off its receipts"}${goalWords(snap.view)}`)]);

const replanRow = (r) => row([seg("↻ ", "info"), seg(`plan-${r.n}`, "label"), seg(` ${r.trigger ?? "revised"}`), dim(`${r.response ? ` → ${r.response}` : ""}${r.step ? ` at ${r.step}` : ""}`)], r.summary ? [dim(r.summary)] : []);

const wordOr = (w) => (w ? String(w) : "—");

const skillRows = (k) => [row([seg("SKILL ", "label"), seg(k.capability ?? "a capability")], k.reused ? [dim("reused")] : []), row(joined([dim(`draft ${wordOr(k.drafted)}`), dim(`contract ${wordOr(k.checked)}`), seg(`registered ${wordOr(k.registered)}`, k.registered === "REFUSED" ? "danger" : k.registered === "ACTIVE" ? "success" : "subtle"), dim(`followed ${wordOr(k.followed)}`), k.pin ? dim(k.pin) : null]), [], { depth: 1 })];

const notWorkflow = (ctx) => [row([dim(ctx.d.root?.view ? "not a coordinated workflow: its own steps are under TASK EXECUTION" : "no task here yet")])];

// A playbook step that ran a DECLARED workflow (0.0.4) shows the run under it: its skill and pin, and its own steps.
const withRun = (snap, nowMs) => (s) => [stepRow(s), ...(s.kind === "playbook" ? skillRunRows(snap, s.id, 1, nowMs) : [])];

export function planRows(ctx) {
  const snap = ctx.d.root;
  if (!isCoordinator(snap?.view)) return notWorkflow(ctx);
  const steps = stepsOf(snap.plan, snap.view).slice(0, DAG_ROWS);
  const replans = replansOf(snap.plan, snap.view);
  return [headRow(snap, steps, replans), ...steps.flatMap(withRun(snap, ctx.nowMs ?? snap.nowMs ?? 0)), ...replans.map(replanRow), ...skillsOf(snap.plan, snap.view).flatMap(skillRows)];
}
