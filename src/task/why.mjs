// WHY a task did what it did (0.6.0, P6): `task why <task>`. For each decision its journal keeps -- what was observed,
// the hypothesis, the reason and the evidence it cited -- how it SETTLED (the action it started, how that action ended
// and the receipts its owners hold for it) and what the journal recorded next that MOVED the task (a stage, a
// verification row, an attempt's end, the task's end), each with the receipt it rests on.
//
// Pure, and read off the task's own fold (model.mjs) and nothing else: no owner is asked again, nothing is judged again.
// What the journal does not prove is said so -- an action with no receipt is REPORTED, never proven; one that started
// and never settled is OPEN, for reconcile to read back; one whose owner said AMBIGUOUS (it may have changed something,
// and what ran it is gone) was read back and is never sent again. A decision is the window of journal lines from it to
// the next decision: what it started is in that window, and how that ended is the fold's, wherever it was written.
import { stateOf } from "./model.mjs";
import { actionState, receiptsFor } from "./views.mjs";

export const WHY_VERSION = 1;

// The lines that move a task, as `why` says them: a stage, a verification row, an attempt's end, a block, the end.
const MOVES = {
  stage: (r) => ({ kind: "stage", to: r.stage, because: r.because ?? null }),
  verification: (r) => ({ kind: "verification", obligation: r.obligation, state: r.state, evidence: r.evidence ?? null }),
  "attempt-completed": (r) => ({ kind: "attempt", to: r.outcome, attempt: r.id }),
  blocked: (r) => ({ kind: "blocked", to: r.stop, because: r.because ?? null }),
  unblocked: (r) => ({ kind: "unblocked", because: r.because ?? null }),
  completed: (r) => ({ kind: "completed", summary: r.summary ?? null }),
  failed: (r) => ({ kind: "failed", to: r.stop, because: r.because ?? null }),
};

const receiptKey = (r) => `${r.domain}:${r.ref}`;

// What a decision's evidence names, found in this journal -- or not, which is said.
const CITED = [
  { is: "receipt", when: (m, id) => m.receipts.has(id) || [...m.receipts.values()].some((r) => r.ref === id) },
  { is: "action", when: (m, id) => m.actions.has(id) },
  { is: "decision", when: (m, id) => m.decisions.some((d) => d.id === id) },
  { is: "verification", when: (m, id) => m.verifications.has(id) },
  { is: "unknown", when: () => true },
];

const citedOf = (m, d) => (d.evidence ?? []).map((id) => ({ id, is: CITED.find((c) => c.when(m, id)).is }));

// ---- how a decision settled -----------------------------------------------------------------------------------------

const outcomesOf = (m, keys) => keys.map((k) => m.receipts.get(k)?.outcome ?? null).filter(Boolean);

const receiptView = (m, key) => ((r) => ({ key, outcome: r.outcome ?? null, summary: r.summary ?? null }))(m.receipts.get(key));

function actionWhy(m, id) {
  const a = m.actions.get(id);
  const keys = receiptsFor(m, a);
  return { id, type: a.type, label: a.label ?? null, mutates: a.mutates === true, state: actionState(a), summary: a.ended?.summary ?? null, reason: a.ended?.reason ?? null, receipts: keys.map((k) => receiptView(m, k)), outcomes: outcomesOf(m, keys) };
}

const said = (actions, word) => actions.some((a) => a.outcomes.includes(word));

// Ordered, the first row that holds; the last always does. A settlement is proven only by an owner's receipt.
export const SETTLED = [
  { word: "ASKED", when: (s) => !s.actions.length && s.asked.length > 0, say: (s) => `it asked a person first (${s.asked.join(", ")}) and started nothing until one decides` },
  { word: "NOTHING_STARTED", when: (s) => !s.actions.length, say: () => "it started no action: a note in the journal" },
  { word: "AMBIGUOUS", when: (s) => said(s.actions, "AMBIGUOUS"), say: () => "what ran it is gone and it may have changed something: read back, never sent again -- a person decides" },
  { word: "OPEN", when: (s) => s.actions.some((a) => a.state === "running"), say: () => "started and never settled: reconcile reads it back from its owner, and never sends it again" },
  { word: "INTERRUPTED", when: (s) => said(s.actions, "INTERRUPTED"), say: () => "read back: what ran it is gone, and it only read, so a later attempt asks again" },
  { word: "RECEIPT", when: (s) => s.actions.every((a) => a.receipts.length > 0), say: () => "settled on its owner's receipt" },
  { word: "REPORTED", when: () => true, say: () => "settled on what was reported, never proven: no receipt of its owner names it" },
];

const settledOf = (s) => ((row) => ({ word: row.word, say: row.say(s), actions: s.actions }))(SETTLED.find((r) => r.when(s)));

// ---- what moved the task next, and on what --------------------------------------------------------------------------

// The receipts in hand when a line moved the task: the one it cites, else every receipt linked since the decision.
const byOf = (line, before) => (line.kind === "verification" ? [line.evidence].filter(Boolean) : before.filter((r) => r.kind === "receipt").map(receiptKey));

const movedOf = (m, lines) => lines.filter((r) => MOVES[r.kind]).map((r) => ({ n: r.n, at: r.at, ...MOVES[r.kind](r), by: byOf(r, lines.filter((x) => x.n < r.n)).map((k) => ({ key: k, found: m.receipts.has(k) })) }));

// ---- one decision, and the task --------------------------------------------------------------------------------------

const windowOf = (m, i) => ((d, next) => m.records.slice(d.n + 1, next ? next.n : m.records.length).map((r, k) => ({ ...r, n: d.n + 1 + k })))(m.decisions[i], m.decisions[i + 1]);

const startedIn = (lines) => lines.filter((r) => r.kind === "action-started").map((r) => r.id);

const askedIn = (lines) => lines.filter((r) => r.kind === "approval-requested").map((r) => r.id);

function decisionWhy(m, d, i) {
  const lines = windowOf(m, i);
  const settled = settledOf({ actions: startedIn(lines).filter((id) => m.actions.has(id)).map((id) => actionWhy(m, id)), asked: askedIn(lines) });
  return { id: d.id, n: d.n, at: d.at, attempt: d.attempt ?? null, observed: d.observed, hypothesis: d.hypothesis, reason: d.reason ?? null, nextAction: d.nextAction, ref: d.ref ?? null, cited: citedOf(m, d), settled, moved: movedOf(m, lines) };
}

const countBy = (rows) => rows.reduce((n, r) => ({ ...n, [r.settled.word]: (n[r.settled.word] ?? 0) + 1 }), {});

// -> the task's decisions, each with how it settled and what moved the task after it; `now` is the reader's clock.
export function whyOf(model, now) {
  const decisions = model.decisions.map((d, i) => decisionWhy(model, d, i));
  return { version: WHY_VERSION, task: model.meta.id, objective: model.meta.objective, revision: model.position, lifecycle: stateOf(model, now).lifecycle, settled: countBy(decisions), decisions };
}
