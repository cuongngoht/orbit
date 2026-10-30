// SATELLITE LIVE's view of one mission: a pure function of the SAME model the engine decides with, and of the events
// the projection named -- so what a viewer shows is what the journal holds, never a second state. Sections:
//
//   mission       id, objective, lifecycle, verdict, revision
//   graph         work units (state, dependencies, gate, attempts, best evidence) and every plan revision
//   agents        every agent run: parent and children, generated role name, objective, CURRENT mode, provider,
//                 lifecycle and outcome -- each run its own mode, never one for all -- and (0.2.2, ADR 0044) its
//                 qualified reference, its pins, the host agent that carries it with the word that says how anybody
//                 knows (src/hosts/attribution.mjs), the host's own lifecycle of that agent and the calls it made,
//                 direct and through the agents it launched, counted apart
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
import { runRefOf } from "../../../src/attribution.mjs";
import { bindingsOf } from "../hosts/attribution.mjs";

// 2 (0.2.2): a run says which host agent carries it and how that is known; the session's calls no run carries are
// UNATTRIBUTED (they were UNOBSERVED), and the coverage of the join is its own section.
export const LIVE_VIEW_VERSION = 2;

export const TIMELINE_KEPT = 40;

export const FACTORY_WORDS = Object.freeze({ "role.generated": "ROLE_CREATED", "role.reused": "ROLE_REUSED", "role.validated": "ROLE_VALIDATED", "role.registered": "ROLE_REGISTERED", "role.rejected": "ROLE_REJECTED", "template.generated": "TEMPLATE_CREATED", "template.reused": "TEMPLATE_REUSED", "template.registered": "TEMPLATE_REGISTERED", "skill.discovered": "SKILL_DISCOVERED", "skill.generated": "SKILL_DRAFTED", "skill.written": "SKILL_WRITTEN", "skill.validated": "SKILL_VALIDATED", "skill.registered": "SKILL_REGISTERED", "skill.reused": "SKILL_REUSED", "skill.invoked": "SKILL_INVOKED", "workflow.generated": "WORKFLOW_CREATED", "workflow.validated": "WORKFLOW_VALIDATED", "workflow.registered": "WORKFLOW_REGISTERED", "workflow.reused": "WORKFLOW_REUSED" });

const nameOfRole = (m, pin) => m.roles.get(pin)?.displayName ?? (pin ? pin.split(":")[0] : null);

const unitRow = (m, u, states) => ({ id: u.id, key: u.key, kind: u.kind, objective: u.objective, state: states.get(u.id), deps: u.dependencyIds ?? [], gate: u.verificationContract, attempts: endedRunsOf(m, u).length, rolePin: u.rolePin, templatePin: u.templatePin, revision: u.planRevision });

// What the join says of one run, or that nothing was joined (a viewer that read no trail).
const UNBOUND = { word: "UNATTRIBUTED", basis: null, hostAgent: null, agents: [], hostLifecycle: { startedAt: null, endedAt: null }, counts: { direct: 0, descendants: 0, failed: 0, unknown: 0 }, calls: [], children: [] };

const bindingRow = (b = UNBOUND) => ({ hostAgent: b.hostAgent, attribution: b.word, basis: b.basis, named: b.agents, hostLifecycle: b.hostLifecycle, counts: b.counts, calls: b.calls, hostChildren: b.children });

// A parent the journal does not hold is said so, and the run is drawn at the top -- never under the nearest root.
const parentRefOf = (m, r) => (r.parentAgentRun ? { kind: "agent-run", id: r.parentAgentRun, known: m.runs.has(r.parentAgentRun) } : null);

const runRow = (m, r, bindings) => ({ id: r.id, ref: runRefOf(m.meta?.id, r.id), parent: r.parentAgentRun ?? null, parentRef: parentRefOf(m, r), children: [...m.runs.values()].filter((c) => c.parentAgentRun === r.id).map((c) => c.id), role: nameOfRole(m, r.rolePin), rolePin: r.rolePin, pins: { role: r.rolePin ?? null, template: r.templatePin ?? null, skills: list(r.skillPins) }, unit: r.unit, objective: m.units.get(r.unit)?.objective ?? null, mode: currentModeOf(r), baseMode: r.mode, modes: r.stack.map((s) => s.mode), provider: r.actualProvider, providerRef: r.providerRef ?? null, task: r.task ?? null, profile: r.profile, lifecycle: runLifecycleOf(r), outcome: r.ended?.outcome ?? null, dispatch: r.dispatch, depth: r.depth ?? 0, attempt: r.attempt, ...bindingRow(bindings.get(r.id)), tools: bindings.get(r.id)?.counts.direct ?? 0 });

const factoryRow = (f) => ({ n: f.n, at: f.at, word: FACTORY_WORDS[f.kind] ?? f.kind, kind: f.kind, pin: f.pin ?? null, name: f.displayName ?? f.capability ?? f.workflowId ?? f.roleId ?? null, unit: f.unit ?? null, ok: f.ok ?? null, findings: f.findings ?? [] });

const actionRow = (a) => ({ id: a.id, type: a.type, mode: a.mode, operationKind: a.operationKind, effect: a.effect, status: a.status, provider: a.provider, providerRef: a.accepted?.providerRef ?? null, agentRun: a.agentRun ?? null, unit: a.unit ?? null, parent: a.parentAction ?? null, outcome: a.recorded?.outcome ?? null, level: a.recorded?.level ?? null, at: a.at });

const blockersOf = (m) => [...m.permissions.filter((p) => p.kind === "permission.denied").map((p) => ({ kind: "permission.denied", ref: p.action, say: p.say })), ...[...m.actions.values()].filter((a) => a.status === "AMBIGUOUS").map((a) => ({ kind: "ambiguous", ref: a.id, say: a.ambiguous?.because ?? "may have had a side effect; a person decides" })), ...[...m.runs.values()].filter((r) => r.ended?.outcome === "violated").map((r) => ({ kind: "violated", ref: r.id, say: "the primary checkout changed while this run was open" }))];

const memoryOf = (m) => ({ handoffs: [...m.handoffs.values()].map((h) => ({ id: h.id, unit: h.unit, agentRun: h.agentRun, digest: h.digest, targets: h.targets ?? [], consumedBy: h.consumed.map((c) => c.agentRun), rejected: h.rejected.map((r) => r.rule), proposes: h.proposes === true })), checkpoints: m.checkpoints.map((c) => ({ count: c.count, revision: c.revision, file: c.file })), recalls: [...m.actions.values()].filter((a) => a.type === "recall").map((a) => ({ id: a.id, operationKind: a.operationKind, status: a.status, outcome: a.recorded?.outcome ?? null })), pinned: { roles: [...new Set([...m.units.values()].map((u) => u.rolePin).filter(Boolean))], templates: [...new Set([...m.units.values()].map((u) => u.templatePin).filter(Boolean))], skills: [...new Set([...m.units.values()].flatMap((u) => u.skillPins))] } });

// THIS SESSION'S tool calls (src/live/session.mjs, read by the composition root from the working set the host's hooks
// keep): an allow-list of what a viewer may show. The session's OWN calls -- the ones no payload named an agent for --
// are attributed to no agent run: UNATTRIBUTED. Since 0.2.2 an agent the hooks named and no run is bound to is listed
// apart, by its hashed id and type, so it is never drawn under a run it was not shown to carry.
const SESSION_SHOWN = 8;

const entryOf = (e) => ({ at: e.at ?? null, kind: e.kind ?? "other", what: e.what ?? null, ok: e.ok ?? null, class: e.class ?? null });

const unboundOf = (a, bound) => list(a.agents).filter((g) => !bound.has(g.agent)).map((g) => ({ agent: g.agent, type: g.type ?? null, lifecycle: g.lifecycle ?? null, observed: g.observed ?? 0, run: g.run ?? null }));

const ownOf = (a) => (a.own ? { observed: a.own.observed ?? 0, running: list(a.own.running).length, recent: list(a.own.recent).slice(0, SESSION_SHOWN).map(entryOf) } : null);

const sessionOf = (a, bound) => (a ? { source: a.source, state: a.state ?? null, observed: a.observed ?? 0, running: list(a.running).length, recent: list(a.recent).slice(0, SESSION_SHOWN).map(entryOf), files: list(a.files).length, checks: list(a.checks).slice(0, 5).map(entryOf), lastAt: a.lastAt ?? null, partial: a.partial === true, own: ownOf(a), unbound: unboundOf(a, bound), attribution: "UNATTRIBUTED" } : null);

// What the join could stand on: whether the trail was read, what this host's payload says of an agent, and that the
// session's calls are a tail, never its whole.
const coverageOf = (trail, session) => ({ trail: trail?.source ?? "none", host: trail?.host ?? session?.coverage ?? null, basis: "the session trail's agent events and a subagent's calls, since the mission began; the session's own calls from its working-set tail", partial: session?.partial === true });

const boundAgents = (bindings) => new Set([...bindings.values()].map((b) => b.hostAgent).filter(Boolean));

const toolsOf = (bindings, session, trail) => ({ byRun: Object.fromEntries([...bindings].map(([id, b]) => [id, b.counts.direct])), session: sessionOf(session, boundAgents(bindings)), coverage: coverageOf(trail, session) });

// m: the mission model; events: the projection's events (a bounded tail is kept); session: this session's activity;
// trail: { source, events } the session trail since the mission began (the composition root's port), or null.
export function liveViewOf(m, events = [], session = null, trail = null) {
  const states = unitStates(m);
  const lifecycle = m.meta ? lifecycleOf(m) : "UNREADABLE";
  const settled = TERMINAL.includes(lifecycle) || allDone(m, states);
  const bindings = bindingsOf({ model: m, trail: trail?.events ?? [], trailSource: trail?.source ?? "none" });
  return { version: LIVE_VIEW_VERSION, mission: { id: m.meta?.id ?? null, objective: m.meta?.objective ?? null, lifecycle, verdict: m.meta ? verdictOf(m, settled).verdict : "PENDING", revision: m.position, createdAt: m.meta?.at ?? null, endedAt: m.ended?.at ?? null, stop: m.ended?.stop ?? null }, graph: { units: [...m.units.values()].map((u) => unitRow(m, u, states)), revisions: m.plans.map((p) => ({ rev: p.rev, cause: p.cause, affected: p.affectedUnits ?? [], invalidated: p.invalidatedResults ?? [], cancelled: p.cancelled ?? [], reset: p.reset ?? [] })), triggers: m.replans.map((t) => ({ trigger: t.trigger, response: t.response, unit: t.unit ?? null })) }, agents: [...m.runs.values()].map((r) => runRow(m, r, bindings)), factory: m.factory.map(factoryRow), execution: { open: openActions(m).map(actionRow), recent: [...m.actions.values()].slice(-12).map(actionRow) }, memory: memoryOf(m), verification: { acceptance: acceptanceOf(m), hypotheses: hypothesesOf(m), owed: verdictOf(m, settled).owed, blockers: blockersOf(m) }, tools: toolsOf(bindings, session, trail), timeline: events.slice(-TIMELINE_KEPT), meta: { seq: m.position, lastEventAt: m.lastAt } };
}
