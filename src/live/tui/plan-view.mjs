// The PLAN a pane shows (1.8.6, ADR 0022): a coordinated workflow's steps as the graph they are -- each step's state
// in words that need their evidence (VERIFIED only on its owner's record), why it is there, what it waits for -- the
// plan's revisions and why each was made, and what the skill factory is doing for every capability a playbook is
// being drafted for. Read off the plan its source projected and the task's own receipts (src/live/plan.mjs); a task
// that is not a coordinated workflow says so, and points at its own steps.
//
//   planOf(ctx) -> { ref, n, workflow, steps, replans, skills } | null     the data a drawer may use
//   planRows(ctx) -> [row]                                                  the Plan view
//   nextStepOf(snap) -> step | null                                          the first step whose waits are all done
import { doneOn, replansOf, skillsOf, stepsOf } from "../plan.mjs";
import { isCoordinator } from "./model.mjs";
import { dim, joined, row, seg } from "./sections/parts.mjs";

export const DAG_ROWS = 24;

// A step's state, in a word its evidence earns: a strict step SUCCEEDED was verified on its owner's record; one that
// may stand on a report and did is DONE, and says it was reported.
const STEP_STATE = [
  { when: (s) => s.outcome === "SUCCEEDED" && s.strict === true, word: "VERIFIED", tone: "success", glyph: "✓" },
  { when: (s) => s.outcome === "SUCCEEDED", word: "DONE", tone: "success", glyph: "✓" },
  { when: (s) => s.outcome === "REPORTED", word: "REPORTED", tone: "warning", glyph: "~" },
  { when: (s) => s.outcome === "RUNNING", word: "RUNNING", tone: "info", glyph: "●" },
  { when: (s) => s.outcome === "FAILED", word: "FAILED", tone: "danger", glyph: "✗" },
  { when: (s) => s.outcome === "BLOCKED", word: "BLOCKED", tone: "warning", glyph: "■" },
  { when: (s) => s.outcome === "SKIPPED", word: "SKIPPED", tone: "subtle", glyph: "-" },
  { when: () => true, word: "PENDING", tone: "subtle", glyph: "○" },
];

export const stepState = (s) => STEP_STATE.find((r) => r.when(s));

export const nextStepOf = (snap) => ((steps) => steps.find((s) => stepState(s).word === "PENDING" && s.after.every((a) => doneOn(steps.find((x) => x.id === a) ?? {}))) ?? null)(stepsOf(snap?.plan, snap?.view));

export const currentStepOf = (snap) => stepsOf(snap?.plan, snap?.view).find((s) => s.outcome === "RUNNING") ?? null;

export function planOf(ctx) {
  const snap = ctx.d.root;
  if (!isCoordinator(snap?.view)) return null;
  return { ref: snap.plan?.ref ?? null, n: snap.plan?.n ?? null, workflow: snap.plan?.workflow ?? null, steps: stepsOf(snap.plan, snap.view).slice(0, DAG_ROWS).map((s) => ({ id: s.id, kind: s.kind, after: s.after, for: s.for ?? null, because: s.because ?? null, state: stepState(s).word })), replans: replansOf(snap.plan, snap.view), skills: skillsOf(snap.plan, snap.view) };
}

// ---- rows ----------------------------------------------------------------------------------------------

const stepRow = (s) => ((st) => row([seg(`${st.glyph} `, st.tone), seg(s.id, "label"), dim(s.because ? `  ${s.because}` : "")], [seg(st.word, st.tone), dim(s.after.length ? `  ← ${s.after.join(", ")}` : "")], { status: st.word, depth: 0 }))(stepState(s));

const headRow = (snap, steps, replans) => row([seg(`plan-${snap.plan?.n ?? "?"}`, "label"), dim(` (${snap.plan?.workflow ?? "workflow"}) · ${steps.length} step(s)${replans.length ? ` · revised ${replans.length}×` : ""}${snap.plan ? "" : " · read off its receipts"}`)]);

const replanRow = (r) => row([seg("↻ ", "info"), seg(`plan-${r.n}`, "label"), seg(` ${r.trigger ?? "revised"}`), dim(`${r.response ? ` → ${r.response}` : ""}${r.step ? ` at ${r.step}` : ""}`)], r.summary ? [dim(r.summary)] : []);

const wordOr = (w) => (w ? String(w) : "—");

const skillRows = (k) => [row([seg("SKILL ", "label"), seg(k.capability ?? "a capability")], k.reused ? [dim("reused")] : []), row(joined([dim(`draft ${wordOr(k.drafted)}`), dim(`contract ${wordOr(k.checked)}`), seg(`registered ${wordOr(k.registered)}`, k.registered === "REFUSED" ? "danger" : k.registered === "ACTIVE" ? "success" : "subtle"), dim(`followed ${wordOr(k.followed)}`), k.pin ? dim(k.pin) : null]), [], { depth: 1 })];

const notWorkflow = (ctx) => [row([dim(ctx.d.root?.view ? "not a coordinated workflow: its own steps are under TASK EXECUTION" : "no task here yet")])];

export function planRows(ctx) {
  const snap = ctx.d.root;
  if (!isCoordinator(snap?.view)) return notWorkflow(ctx);
  const steps = stepsOf(snap.plan, snap.view).slice(0, DAG_ROWS);
  const replans = replansOf(snap.plan, snap.view);
  return [headRow(snap, steps, replans), ...steps.map(stepRow), ...replans.map(replanRow), ...skillsOf(snap.plan, snap.view).flatMap(skillRows)];
}
