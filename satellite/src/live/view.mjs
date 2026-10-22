// SATELLITE LIVE's view of one mission: a pure function of the SAME model the engine decides with, and of the events
// the projection named -- so what a viewer shows is what the journal holds, never a second state. Sections:
//
//   mission       id, objective, lifecycle, verdict, revision
//   graph         work units (state, dependencies, gate, attempts, best evidence) and every plan revision
//   agents        every agent run: parent and children, generated role name, objective, CURRENT mode, provider,
//                 lifecycle and outcome -- each run its own mode, never one for all
//   factory       roles, templates, skills and workflows generated, reused, validated, registered, rejected
//   execution     open and recent actions: mode, operation kind, status, provider reference
//   memory        handoffs (consumed, rejected), checkpoints, recalls, pinned definitions
//   verification  each acceptance criterion's evidence level, each hypothesis, what is owed, every blocker
//   timeline      the latest events, numbered
//
// Nothing here reads a clock: how long ago something happened is the viewer's (viewer.mjs), and a tick never moves it.
import { acceptanceOf, hypothesesOf, verdictOf } from "../evidence/verdict.mjs";
import { allDone, endedRunsOf, lifecycleOf, openActions, unitStates } from "../mission/state.mjs";
import { currentModeOf, runLifecycleOf } from "../mission/view.mjs";
import { TERMINAL } from "../mission/vocab.mjs";
import { list } from "../store/text.mjs";

export const LIVE_VIEW_VERSION = 1;

export const TIMELINE_KEPT = 40;

export const FACTORY_WORDS = Object.freeze({ "role.generated": "ROLE_CREATED", "role.reused": "ROLE_REUSED", "role.validated": "ROLE_VALIDATED", "role.registered": "ROLE_REGISTERED", "role.rejected": "ROLE_REJECTED", "template.generated": "TEMPLATE_CREATED", "template.reused": "TEMPLATE_REUSED", "template.registered": "TEMPLATE_REGISTERED", "skill.discovered": "SKILL_DISCOVERED", "skill.generated": "SKILL_DRAFTED", "skill.written": "SKILL_WRITTEN", "skill.validated": "SKILL_VALIDATED", "skill.registered": "SKILL_REGISTERED", "skill.reused": "SKILL_REUSED", "skill.invoked": "SKILL_INVOKED", "workflow.generated": "WORKFLOW_CREATED", "workflow.validated": "WORKFLOW_VALIDATED", "workflow.registered": "WORKFLOW_REGISTERED", "workflow.reused": "WORKFLOW_REUSED" });

const nameOfRole = (m, pin) => m.roles.get(pin)?.displayName ?? (pin ? pin.split(":")[0] : null);

const unitRow = (m, u, states) => ({ id: u.id, key: u.key, kind: u.kind, objective: u.objective, state: states.get(u.id), deps: u.dependencyIds ?? [], gate: u.verificationContract, attempts: endedRunsOf(m, u).length, rolePin: u.rolePin, templatePin: u.templatePin, revision: u.planRevision });

const runRow = (m, r) => ({ id: r.id, parent: r.parentAgentRun ?? null, children: [...m.runs.values()].filter((c) => c.parentAgentRun === r.id).map((c) => c.id), role: nameOfRole(m, r.rolePin), rolePin: r.rolePin, unit: r.unit, objective: m.units.get(r.unit)?.objective ?? null, mode: currentModeOf(r), modes: r.stack.map((s) => s.mode), provider: r.actualProvider, providerRef: r.providerRef ?? null, profile: r.profile, lifecycle: runLifecycleOf(r), outcome: r.ended?.outcome ?? null, dispatch: r.dispatch, depth: r.depth ?? 0, attempt: r.attempt, tools: list(m.tools.byRun[r.id]).length });

const factoryRow = (f) => ({ n: f.n, at: f.at, word: FACTORY_WORDS[f.kind] ?? f.kind, kind: f.kind, pin: f.pin ?? null, name: f.displayName ?? f.capability ?? f.workflowId ?? f.roleId ?? null, unit: f.unit ?? null, ok: f.ok ?? null, findings: f.findings ?? [] });

const actionRow = (a) => ({ id: a.id, type: a.type, mode: a.mode, operationKind: a.operationKind, effect: a.effect, status: a.status, provider: a.provider, providerRef: a.accepted?.providerRef ?? null, agentRun: a.agentRun ?? null, unit: a.unit ?? null, parent: a.parentAction ?? null, outcome: a.recorded?.outcome ?? null, level: a.recorded?.level ?? null, at: a.at });

const blockersOf = (m) => [...m.permissions.filter((p) => p.kind === "permission.denied").map((p) => ({ kind: "permission.denied", ref: p.action, say: p.say })), ...[...m.actions.values()].filter((a) => a.status === "AMBIGUOUS").map((a) => ({ kind: "ambiguous", ref: a.id, say: a.ambiguous?.because ?? "may have had a side effect; a person decides" })), ...[...m.runs.values()].filter((r) => r.ended?.outcome === "violated").map((r) => ({ kind: "violated", ref: r.id, say: "the primary checkout changed while this run was open" }))];

const memoryOf = (m) => ({ handoffs: [...m.handoffs.values()].map((h) => ({ id: h.id, unit: h.unit, agentRun: h.agentRun, digest: h.digest, targets: h.targets ?? [], consumedBy: h.consumed.map((c) => c.agentRun), rejected: h.rejected.map((r) => r.rule), proposes: h.proposes === true })), checkpoints: m.checkpoints.map((c) => ({ n: c.n, revision: c.revision, file: c.file })), recalls: [...m.actions.values()].filter((a) => a.type === "recall").map((a) => ({ id: a.id, operationKind: a.operationKind, status: a.status, outcome: a.recorded?.outcome ?? null })), pinned: { roles: [...new Set([...m.units.values()].map((u) => u.rolePin).filter(Boolean))], templates: [...new Set([...m.units.values()].map((u) => u.templatePin).filter(Boolean))], skills: [...new Set([...m.units.values()].flatMap((u) => u.skillPins))] } });

// m: the mission model; events: the projection's events (a bounded tail is kept).
export function liveViewOf(m, events = []) {
  const states = unitStates(m);
  const lifecycle = m.meta ? lifecycleOf(m) : "UNREADABLE";
  const settled = TERMINAL.includes(lifecycle) || allDone(m, states);
  return { version: LIVE_VIEW_VERSION, mission: { id: m.meta?.id ?? null, objective: m.meta?.objective ?? null, lifecycle, verdict: m.meta ? verdictOf(m, settled).verdict : "PENDING", revision: m.position, createdAt: m.meta?.at ?? null, endedAt: m.ended?.at ?? null, stop: m.ended?.stop ?? null }, graph: { units: [...m.units.values()].map((u) => unitRow(m, u, states)), revisions: m.plans.map((p) => ({ n: p.n, cause: p.cause, affected: p.affectedUnits ?? [], invalidated: p.invalidatedResults ?? [], cancelled: p.cancelled ?? [], reset: p.reset ?? [] })), triggers: m.replans.map((t) => ({ trigger: t.trigger, response: t.response, unit: t.unit ?? null })) }, agents: [...m.runs.values()].map((r) => runRow(m, r)), factory: m.factory.map(factoryRow), execution: { open: openActions(m).map(actionRow), recent: [...m.actions.values()].slice(-12).map(actionRow) }, memory: memoryOf(m), verification: { acceptance: acceptanceOf(m), hypotheses: hypothesesOf(m), owed: verdictOf(m, settled).owed, blockers: blockersOf(m) }, tools: { observed: m.tools.lines, byRun: Object.fromEntries(Object.entries(m.tools.byRun).map(([k, v]) => [k, v.length])) }, timeline: events.slice(-TIMELINE_KEPT), meta: { seq: m.position, lastEventAt: m.lastAt } };
}
