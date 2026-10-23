// Where a mission and each of its units STAND, derived from the model on every read and stored nowhere.
//
// A unit is DONE when an agent run of it -- after its last reset -- ended `succeeded`, which the engine decides from
// the evidence its owners hold (src/evidence/), never from what the run said. It is READY when every unit it depends
// on is done or skipped; UNRESOLVED while an unknown nobody settled blocks its kind; FAILED when its attempts are spent;
// BLOCKED when its last run or its last dispatch was stopped by something a decision must change.
import { isOpenStatus } from "../execution/vocab.mjs";
import { ENDINGS, NO_PROGRESS_REPEATS } from "./vocab.mjs";

export const openActions = (m) => [...m.actions.values()].filter((a) => isOpenStatus(a.status));

export const runsOfUnit = (m, u) => [...m.runs.values()].filter((r) => r.unit === u.id && r.n > u.resetAt);

export const endedRunsOf = (m, u) => runsOfUnit(m, u).filter((r) => r.ended);

const attemptsAllowed = (m, u) => Math.min(u.executionBudget?.maxAttempts ?? m.meta?.budget?.attempts ?? 4, m.meta?.budget?.attempts ?? 4);

const lastEnded = (m, u) => endedRunsOf(m, u).at(-1)?.ended ?? null;

const deniedSinceReset = (m, u) => m.permissions.some((p) => p.kind === "permission.denied" && p.unit === u.id && p.n > u.resetAt);

export const unknownsBlocking = (m, kind) => (m.intent?.unknowns ?? []).filter((k) => !k.settled && (k.blocks ?? []).includes(kind));

const ROWS = [
  { state: "cancelled", when: (m, u) => Boolean(u.cancelled) },
  { state: "skipped", when: (m, u) => Boolean(u.skipped) },
  { state: "running", when: (m, u, c) => c.open.some((a) => a.unit === u.id) || runsOfUnit(m, u).some((r) => !r.ended) },
  { state: "done", when: (m, u) => endedRunsOf(m, u).some((r) => r.ended.outcome === "succeeded") },
  { state: "blocked", when: (m, u) => lastEnded(m, u)?.outcome === "blocked" || deniedSinceReset(m, u) },
  { state: "failed", when: (m, u) => endedRunsOf(m, u).length >= attemptsAllowed(m, u) },
  { state: "unresolved", when: (m, u) => unknownsBlocking(m, u.kind).length > 0 },
  { state: "ready", when: (m, u, c) => (u.dependencyIds ?? []).every((d) => ["done", "skipped"].includes(stateOf(m, d, c))) },
  { state: "planned", when: () => true },
];

function stateOf(m, id, c) {
  if (c.memo.has(id)) return c.memo.get(id);
  const u = m.units.get(id);
  const state = u ? ROWS.find((row) => row.when(m, u, c)).state : "planned";
  c.memo.set(id, state);
  return state;
}

export function unitStates(m) {
  const c = { open: openActions(m), memo: new Map() };
  for (const id of m.units.keys()) stateOf(m, id, c);
  return c.memo;
}

export const readyOf = (m, states = unitStates(m)) => [...states].filter(([, s]) => s === "ready").map(([id]) => id);

export const allDone = (m, states = unitStates(m)) => states.size > 0 && [...states.values()].every((s) => ["done", "skipped", "cancelled"].includes(s));

const ENDED_AS = { "mission.completed": "COMPLETED", "mission.reported": "REPORTED", "mission.failed": "FAILED", "mission.cancelled": "CANCELLED" };

const LIFECYCLE = [
  { id: (m) => ENDED_AS[m.ended.kind], when: (m) => Boolean(m.ended) && ENDINGS.includes(m.ended.kind) },
  { id: () => "CREATED", when: (m) => !m.intent },
  { id: () => "ANALYZED", when: (m) => m.plans.length === 0 },
  { id: () => "RUNNING", when: (m, s) => s.open.length > 0 },
  { id: () => "SETTLED", when: (m, s) => allDone(m, s.states) },
  { id: () => "BLOCKED", when: (m, s) => readyOf(m, s.states).length === 0 },
  { id: () => "PLANNED", when: () => true },
];

export const lifecycleOf = (m, s = { open: openActions(m), states: unitStates(m) }) => LIFECYCLE.find((row) => row.when(m, s)).id(m);

// How many of a unit's latest ended runs failed in a row with ONE signature: three is NO_PROGRESS, and the engine stops
// the mission rather than try the same thing again.
export function repeatsOf(m, u) {
  const runs = endedRunsOf(m, u).reverse();
  const signature = runs[0] && runs[0].ended.outcome !== "succeeded" ? runs[0].ended.failureSignature : null;
  if (!signature) return 0;
  const broken = runs.findIndex((r) => r.ended.failureSignature !== signature);
  return broken < 0 ? runs.length : broken;
}

export const noProgressOf = (m) => [...m.units.values()].find((u) => repeatsOf(m, u) >= NO_PROGRESS_REPEATS) ?? null;

// What the mission has spent of its budget.
export function spentOf(m, nowMs) {
  const created = Date.parse(m.meta?.at ?? "") || nowMs;
  return { actions: [...m.actions.values()].filter((a) => a.intended).length, agentRuns: m.runs.size, replans: Math.max(0, m.plans.length - 1), generated: ["role.generated", "template.generated", "skill.generated", "workflow.generated"].reduce((n, k) => n + (m.counts[k] ?? 0), 0), handoffs: m.counts["handoff.published"] ?? 0, minutes: Math.floor((nowMs - created) / 60000) };
}
