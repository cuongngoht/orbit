// What a mission IS right now, as one read-only view: what `context`, `show` and every viewer start from. Derived from
// the model on every read; writes nothing.
import { strongest } from "../evidence/vocab.mjs";
import { acceptanceOf, countedEvidence, hypothesesOf, verdictOf } from "../evidence/verdict.mjs";
import { list, quietly } from "../store/text.mjs";
import { allDone, endedRunsOf, lifecycleOf, openActions, readyOf, runsOfUnit, unitStates } from "./state.mjs";
import { TERMINAL } from "./vocab.mjs";

export const VIEW_VERSION = 1;

const bestOf = (m, u) => strongest(countedEvidence(m).filter((r) => r.unit === u.id).map((r) => r.level));

const unitView = (m, u, states) => ({ id: u.id, key: u.key, kind: u.kind, objective: u.objective, state: states.get(u.id), dependencyIds: u.dependencyIds, rolePin: u.rolePin, templatePin: u.templatePin, skillPins: u.skillPins, attempts: endedRunsOf(m, u).length, runs: runsOfUnit(m, u).map((r) => r.id), best: bestOf(m, u), min: u.verificationContract.min, owner: u.verificationContract.owner, acceptanceCriteriaRefs: u.acceptanceCriteriaRefs, planRevision: u.planRevision });

const RUN_LIFECYCLE = [
  { word: "ended", when: (r) => Boolean(r.ended) },
  { word: "reported", when: (r) => Boolean(r.reported) },
  { word: "started", when: (r) => Boolean(r.started) },
  { word: "dispatched", when: () => true },
];

export const runLifecycleOf = (r) => RUN_LIFECYCLE.find((x) => x.when(r)).word;

export const currentModeOf = (r) => (r.ended ? null : r.stack.at(-1)?.mode ?? r.mode);

const displayOf = (ports, pin) => quietly(() => ports.definitions.read(pin).content.displayName) ?? null;

const runView = (ports, r) => ({ id: r.id, unit: r.unit, role: displayOf(ports, r.rolePin), rolePin: r.rolePin, templatePin: r.templatePin, profile: r.profile, agent: r.agent, mode: currentModeOf(r), baseMode: r.mode, modes: r.stack.map((s) => s.mode), lifecycle: runLifecycleOf(r), outcome: r.ended?.outcome ?? null, dispatch: r.dispatch, provider: r.actualProvider, providerRef: r.providerRef ?? null, parentAgentRun: r.parentAgentRun ?? null, depth: r.depth ?? 0, attempt: r.attempt, action: r.action });

const actionView = (a) => ({ id: a.id, type: a.type, mode: a.mode, operationKind: a.operationKind, effect: a.effect, provider: a.provider, status: a.status, unit: a.unit ?? null, agentRun: a.agentRun ?? null, parentAction: a.parentAction ?? null, providerRef: a.accepted?.providerRef ?? null });

const intentView = (m) => (m.intent ? { n: m.intent.n, digest: m.intent.digest, facts: m.intent.facts, hypotheses: hypothesesOf(m), assumptions: m.intent.assumptions, constraints: m.intent.constraints, acceptanceCriteria: m.intent.acceptanceCriteria, unknowns: m.intent.unknowns, capabilities: m.intent.capabilities } : null);

export function viewOf(ports, lw) {
  const states = unitStates(lw.m);
  const lifecycle = lifecycleOf(lw.m);
  const verdict = verdictOf(lw.m, TERMINAL.includes(lifecycle) || allDone(lw.m, states));
  return { version: VIEW_VERSION, mission: { id: lw.id, objective: lw.m.meta.objective, goalDigest: lw.m.meta.goalDigest, createdAt: lw.m.meta.at, host: lw.m.meta.host ?? null }, revision: lw.m.position, lifecycle, verdict: verdict.verdict, stop: lw.m.ended?.stop ?? null, intent: intentView(lw.m), plan: { revisions: lw.m.plans.length, latest: lw.m.plans.at(-1) ? { n: lw.m.plans.at(-1).n, digest: lw.m.plans.at(-1).digest, cause: lw.m.plans.at(-1).cause } : null }, units: [...lw.m.units.values()].map((u) => unitView(lw.m, u, states)), ready: readyOf(lw.m, states), open: openActions(lw.m).map(actionView), agentRuns: [...lw.m.runs.values()].map((r) => runView(ports, r)), acceptance: acceptanceOf(lw.m), owed: verdict.owed, budget: { limits: lw.limits, spent: lw.spent() }, triggers: lw.m.replans.slice(-5).map((t) => ({ trigger: t.trigger, response: t.response, unit: t.unit ?? null, because: t.because })), ended: lw.m.ended ? { kind: lw.m.ended.kind, stop: list([lw.m.ended.stop])[0] ?? null, verdict: lw.m.ended.verdict ?? null, at: lw.m.ended.at } : null };
}
