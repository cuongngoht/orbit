// DISPATCH: one ready unit to one NEW agent run -- never an old run reused. The run is created from the unit's pinned
// template, role and skills (each read back intact and never revoked), after every handoff it rests on was CONSUMED
// (scope, compatibility, freshness, contract) and within the mission's limits for runs, concurrency and delegation
// depth. Its mode and operation are the unit kind's; its grants are what grants.mjs leaves of its role's profile.
//
//   host-agent              the run is created and its ENVELOPE handed to the host; the action stays INTENT_PERSISTED
//                           until the host acknowledges it or its report comes back
//   engineering (new task)  the engine asks Orbit's autonomous engineering to start a task for the unit, OUTSIDE the
//                           lock, and the action is PROVIDER_ACCEPTED with the task as its provider reference
//   engineering (inherited) a build or test unit drives the task its dependency handed off
import { consumeFinding, inputHandoffsOf, readHandoff } from "../../handoff/handoff.mjs";
import { refOf } from "../../evidence/vocab.mjs";
import { UNIT_KINDS } from "../../execution/unit-kinds.mjs";
import { subagentTypeOf } from "../../hosts/agents.mjs";
import { serialOnly } from "../../hosts/matrix.mjs";
import { noteSession } from "../../hosts/sessions.mjs";
import { nextId } from "../../store/ids.mjs";
import { missionFile } from "../../store/rooms.mjs";
import { clip, list, quietly } from "../../store/text.mjs";
import { servable } from "../../factories/skill/skill.mjs";
import { envelopeFor } from "../envelope.mjs";
import { runsOfUnit } from "../state.mjs";
import { finding } from "./common.mjs";

function pinsOf(ports, unit) {
  const template = unit?.templatePin ? quietly(() => ports.definitions.read(unit.templatePin)) : null;
  const role = template ? quietly(() => ports.definitions.read(template.content.rolePin)) : null;
  return { template, role, skills: list(unit?.skillPins).map((pin) => ({ pin, record: quietly(() => ports.definitions.read(pin)) })) };
}

const inputsOf = (ports, lw, unit, tree) => Object.values(inputHandoffsOf(lw.m, unit)).map((h) => ((record) => ({ published: h, record, finding: consumeFinding({ m: lw.m, unit, record, tree, published: h }) }))(readHandoff(ports.io, ports.rooms, lw.id, h.id)));

const inheritedTask = (inputs) => inputs.flatMap((i) => list(i.record?.evidenceRefs)).map(refOf).filter((r) => r?.domain === "task").at(-1)?.id ?? null;

export function planDispatch(ports, lw, a) {
  const unit = lw.m.units.get(a.unit) ?? null;
  const pins = pinsOf(ports, unit);
  const tree = quietly(() => ports.checkout.snapshot());
  const inputs = unit ? inputsOf(ports, lw, unit, tree) : [];
  return { unit, ...pins, kind: unit ? UNIT_KINDS[unit.kind] : null, state: unit ? lw.states().get(unit.id) : null, inputs, tree, parent: a.parentAgentRun ? lw.m.runs.get(a.parentAgentRun) ?? null : null, runId: nextId(lw.m, "agentrun.created"), task: inheritedTask(inputs) };
}

const profileOf = (p) => p.role?.content?.requestedPermissionProfile ?? "READ_ONLY";

const depthOf = (p) => (p.parent ? (p.parent.depth ?? 0) + 1 : 0);

const revokedPin = (ports, p) => [p.unit.templatePin, p.template?.content?.rolePin, ...list(p.unit.skillPins)].find((pin) => pin && ports.definitions.revoked(pin)) ?? null;

const openRuns = (lw) => [...lw.m.runs.values()].filter((r) => !r.ended);

const rejectedLines = (p, lw) => p.inputs.filter((i) => i.finding).map((i) => ["handoff.rejected", { id: i.published.id, unit: p.unit.id, rule: i.finding.rule, say: clip(i.finding.say), action: lw.action }]);

const RULES = [
  { rule: "UNIT_UNKNOWN", fails: (ports, lw, p) => !p.unit, say: (p, a) => `no unit ${a.unit} in this mission` },
  { rule: "UNIT_NOT_READY", fails: (ports, lw, p) => p.state !== "ready", say: (p) => `${p.unit.id} is ${p.state}; only a ready unit is dispatched` },
  { rule: "UNIT_NOT_STAFFED", fails: (ports, lw, p) => !p.unit.templatePin, say: (p) => `${p.unit.id} has no agent template yet: resolve-role, then resolve-template` },
  { rule: "PIN_UNREADABLE", fails: (ports, lw, p) => !p.template || !p.role || p.skills.some((s) => !s.record), say: (p) => `a definition ${p.unit.id} pins could not be read back intact` },
  { rule: "PIN_REVOKED", fails: (ports, lw, p) => Boolean(revokedPin(ports, p)), say: (p, a, ports) => `${revokedPin(ports, p)} was revoked by a person: a pin never outranks a revocation` },
  { rule: "SKILL_WITHDRAWN", fails: (ports, lw, p) => p.skills.some((s) => s.record?.content?.orbitPin && !servable(ports, s.record.content.orbitPin)), say: (p) => `${p.skills.filter((s) => s.record?.content?.orbitPin).map((s) => s.record.content.orbitPin).join(", ")} is no longer served (a person disabled, retired or quarantined it)` },
  { rule: "TEMPLATE_PROVIDER", fails: (ports, lw, p) => p.template.content.providerRequirements.provider !== p.kind.provider, say: (p) => `a ${p.unit.kind} unit is provided by ${p.kind.provider}, and its template runs ${p.template.content.providerRequirements.provider}` },
  { rule: "HANDOFF_REJECTED", fails: (ports, lw, p) => p.inputs.some((i) => i.finding), say: (p) => p.inputs.filter((i) => i.finding).map((i) => `${i.published.id}: ${i.finding.say}`).join("; "), lines: rejectedLines, trigger: "handoff" },
  { rule: "RUN_BUDGET", fails: (ports, lw) => lw.spent().agentRuns >= lw.limits.maxAgentRuns, say: (p, a, ports, lw) => `the mission started ${lw.spent().agentRuns} agent run(s), the most its budget allows` },
  { rule: "UNIT_RUN_BUDGET", fails: (ports, lw, p) => runsOfUnit(lw.m, p.unit).length >= p.unit.executionBudget.maxAgentRuns, say: (p) => `${p.unit.id} spent its ${p.unit.executionBudget.maxAgentRuns} agent run(s)` },
  { rule: "CONCURRENCY", fails: (ports, lw) => openRuns(lw).length >= lw.limits.maxConcurrency, say: (p, a, ports, lw) => `${openRuns(lw).length} agent run(s) are open, the most at once here (${serialOnly(ports.hostRow) ? "this host runs one at a time" : "the policy's maxConcurrency"})` },
  { rule: "PARENT_RUN", fails: (ports, lw, p, a) => Boolean(a.parentAgentRun) && (!p.parent || Boolean(p.parent.ended)), say: (p, a) => `${a.parentAgentRun} is no open agent run of this mission` },
  { rule: "DEPTH", fails: (ports, lw, p) => depthOf(p) > lw.limits.maxDepth, say: (p, a, ports, lw) => `delegation nests at most ${lw.limits.maxDepth} deep` },
  { rule: "TASK_INHERITED", fails: (ports, lw, p) => p.kind.task === "inherited" && !p.task, say: (p) => `a ${p.unit.kind} unit drives the engineering task a dependency handed off, and none of its inputs names one` },
];

function contracted(ports, lw, a, p) {
  const row = RULES.find((r) => r.fails(ports, lw, p, a));
  return row ? finding(row.rule, row.say(p, a, ports, lw), { lines: row.lines ? row.lines(p, lw) : [], trigger: row.trigger }) : null;
}

const runLineOf = (ports, lw, a, p, x) => ({ id: p.runId, unit: p.unit.id, parentAgentRun: a.parentAgentRun, templatePin: p.unit.templatePin, rolePin: p.template.content.rolePin, skillPins: list(p.unit.skillPins), actualHost: ports.hostId, actualProvider: p.kind.provider, agent: subagentTypeOf(profileOf(p)), profile: profileOf(p), grants: list(x?.grants), budget: { maxMinutes: p.unit.executionBudget.maxMinutes ?? null }, attempt: runsOfUnit(lw.m, p.unit).length + 1, mode: p.kind.mode, action: lw.action, dispatch: serialOnly(ports.hostRow) ? "serial" : "native", task: p.task ?? undefined, depth: depthOf(p), tree: p.tree ? { head: p.tree.head, digest: p.tree.digest } : undefined });

const consumed = (lw, p) => p.inputs.forEach((i) => lw.append("handoff.consumed", { id: i.published.id, unit: p.unit.id, agentRun: p.runId, action: lw.action }));

const invokedSkills = (lw, p, run) => p.skills.forEach((s) => lw.append("skill.invoked", { pin: s.pin, action: lw.action, agentRun: run.id, runs: s.record.content.runs ?? "followed" }));

function created(ports, lw, a, p, x) {
  consumed(lw, p);
  const run = runLineOf(ports, lw, a, p, x);
  ports.io.writePrivate(missionFile(ports.rooms, lw.id, "agent-runs", `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
  lw.append("agentrun.created", run);
  return Object.assign(run, invokedSkills(lw, p, run));
}

export function accepted(lw, run, providerRef, by) {
  lw.append("action.accepted", { id: run.action, providerRef, by });
  lw.append("agentrun.started", { id: run.id, action: run.action, providerRef, by });
}

const noted = (ports, lw, run) => noteSession(ports.io, ports.rooms, { session: ports.session, mission: lw.id, runs: [{ mission: lw.id, agentRunId: run.id, agentType: run.agent.split(":")[1], actionId: run.action, profile: run.profile, startedAt: ports.now(), endedAt: null }], at: ports.now() });

const handedOver = (ports, lw, run) => ({ open: true, outcome: "dispatched", result: { run: run.id, envelope: envelopeFor(ports, lw, run.id) } });

function dispatched(ports, lw, a, p, x) {
  const run = created(ports, lw, a, p, x);
  noted(ports, lw, run);
  if (run.task) accepted(lw, run, `task:${run.task}`, "engine");
  return handedOver(ports, lw, run);
}

// The engineering task a NEW implement unit runs in: asked of Orbit's own autonomous engineering, never made here.
const startsTask = (p) => p.kind?.provider === "engineering" && p.kind.task === "new";

async function taskStarted(ports, a, p) {
  const got = await ports.providers.engineering.start({ objective: p.unit.objective });
  return got?.task ? { task: got.task, created: got.created !== false } : { error: got?.error ?? "autonomous engineering answered no task" };
}

function settledStart(ports, lw, a, p, got) {
  const run = lw.m.runs.get(p.runId);
  if (got.error) return { outcome: "failed", level: "UNKNOWN", summary: `no engineering task could be started: ${got.error}`, ended: { id: run.id, outcome: "interrupted", because: clip(got.error) } };
  accepted(lw, run, `task:${got.task}`, "engine");
  return Object.assign(handedOver(ports, lw, { ...run, task: got.task }), { started: got.task });
}

export const dispatch = {
  fields: ["unit", "parentAgentRun"],
  required: ["unit"],
  plan: planDispatch,
  mode: (p) => p.kind?.mode ?? "DISPATCHING",
  operation: (p) => p.kind?.operation ?? "agent.dispatch",
  provider: (p) => p.kind?.provider ?? "host-agent",
  profile: (p) => profileOf(p),
  runOf: (p) => p.runId,
  contract: contracted,
  async: (p) => startsTask(p),
  before: (ports, lw, a, p, x) => created(ports, lw, a, p, x),
  run: dispatched,
  call: (ports, a, p) => taskStarted(ports, a, p),
  settle: settledStart,
};
