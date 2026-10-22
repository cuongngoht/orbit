// CONTEXT: what the host reads before its next decision -- the mission's view, what it may do now, and one suggested
// next step with the decision it would send (its expectedRevision filled in). Writes nothing. SHOW is the view alone;
// EVENTS the journal from a line on; LIST every mission of this project.
import { readRevision } from "../planning/plan.mjs";
import { eventsOf } from "../projection/fold.mjs";
import { missionDirOf, missionFile } from "../store/rooms.mjs";
import { readGoal } from "./goal.mjs";
import { listMissions } from "../store/rooms.mjs";
import { quietly } from "../store/text.mjs";
import { actionShapes, allowedNow } from "./actions.mjs";
import { protocolRules } from "./decision.mjs";
import { viewOf } from "./view.mjs";
import { DECISION_SCHEMA, REPORT_SCHEMA } from "./vocab.mjs";
import { worldOf } from "./world.mjs";

const decisionOf = (v, action) => ({ schemaVersion: DECISION_SCHEMA, decisionId: "<yours>", expectedRevision: v.revision, action, observed: "<what you saw, in one sentence>" });

const readyUnit = (v) => v.units.find((u) => u.state === "ready") ?? null;

const openRun = (v) => v.agentRuns.find((r) => r.lifecycle !== "ended") ?? null;

const reportCommand = (v, r) => `node <satellite>/cli/satellite.mjs agent report ${v.mission.id} ${r.id} < report.json`;

const NEXT = [
  { when: (v) => Boolean(v.ended), say: (v) => `the mission has ended ${v.ended.kind}`, decide: () => null },
  { when: (v) => !v.intent, say: () => "read the goal into a structured intent: facts, hypotheses, assumptions, constraints, acceptance criteria and unknowns, kept apart", decide: (v) => decisionOf(v, { kind: "analyze", intent: { facts: [{ statement: "<a fact the goal states>", sourceRef: `goal@${v.mission.goalDigest.slice(0, 8)}` }], hypotheses: [{ statement: "<what might be true>" }], acceptanceCriteria: [{ statement: "<what the outcome is held to>" }], unknowns: [{ statement: "<what nobody knows yet>", blocks: [] }] } }) },
  { when: (v) => v.plan.revisions === 0, say: () => "propose the first work graph: investigate before choosing who changes what", decide: (v) => decisionOf(v, { kind: "plan", units: [{ key: "explore", kind: "explore", objective: "<what to find out first>", acceptanceCriteriaRefs: v.intent.acceptanceCriteria.map((a) => a.id) }] }) },
  { when: (v) => Boolean(readyUnit(v)) && !readyUnit(v).rolePin, say: (v) => `${readyUnit(v).id} is ready and has no role: resolve one from its responsibilities (reused when one answers for them)`, decide: (v) => decisionOf(v, { kind: "resolve-role", unit: readyUnit(v).id, responsibilities: [{ activity: "<verb>", subject: "<what>" }], profile: "READ_ONLY", purpose: "<one sentence>", restrictions: ["<what it never does>"], completionCriteria: ["<what its output must show>"] }) },
  { when: (v) => Boolean(readyUnit(v)) && !readyUnit(v).templatePin, say: (v) => `${readyUnit(v).id} has a role: resolve its agent template`, decide: (v) => decisionOf(v, { kind: "resolve-template", unit: readyUnit(v).id }) },
  { when: (v) => Boolean(readyUnit(v)), say: (v) => `${readyUnit(v).id} is staffed: dispatch it`, decide: (v) => decisionOf(v, { kind: "dispatch", unit: readyUnit(v).id }) },
  { when: (v) => Boolean(openRun(v)), say: (v) => `${openRun(v).id} is ${openRun(v).lifecycle}: when its agent returns, ${reportCommand(v, openRun(v))}`, decide: () => null },
  { when: (v) => v.lifecycle === "SETTLED", say: () => "every unit is done: finish derives the verdict from the evidence", decide: () => null },
  { when: (v) => v.lifecycle === "BLOCKED", say: (v) => `nothing is ready (${v.units.filter((u) => !["done", "skipped", "cancelled"].includes(u.state)).map((u) => `${u.id} ${u.state}`).join(", ")}): revise the plan, skip a unit, or finish with a stop the journal shows`, decide: (v) => decisionOf(v, { kind: "replan", cause: v.triggers.at(-1)?.trigger ?? "HOST_REVISION", units: [], because: "<why>" }) },
  { when: () => true, say: () => "nothing is ready yet: an open action finishes first", decide: () => null },
];

const nextOf = (v) => ((row) => ({ say: row.say(v), decide: row.decide(v) }))(NEXT.find((r) => r.when(v)));

export const protocolOf = () => ({ decisionSchema: DECISION_SCHEMA, reportSchema: REPORT_SCHEMA, actions: actionShapes(), rules: protocolRules() });

// Whether the latest plan revision on disk is still the one its journal line names.
const intactPlan = (ports, lw) => ((p) => (p ? Boolean(quietly(() => readRevision(ports.io, missionFile(ports.rooms, lw.id, ...p.file.split("/"))))?.digest === p.digest) : null))(lw.m.plans.at(-1));

export function contextOf(ports, id) {
  const lw = worldOf(ports, id);
  const v = viewOf(ports, lw);
  return { ...v, plan: { ...v.plan, intact: intactPlan(ports, lw) }, allowed: allowedNow(lw), next: nextOf(v), protocol: { decisionSchema: DECISION_SCHEMA, reportSchema: REPORT_SCHEMA, actions: actionShapes() } };
}

// The goal as the person submitted it, read back with its digest checked -- what a resumed session reads first.
export const goalOf = (ports, id) => ((lw, g) => ({ mission: id, digest: g.digest, bytes: g.bytes, body: g.body, matches: g.digest === lw.m.meta.goalDigest }))(worldOf(ports, id), readGoal(ports.io, missionDirOf(ports.rooms, id)));

export const showOf = (ports, id) => viewOf(ports, worldOf(ports, id));

export function eventsView(ports, id, since = 0) {
  const lw = worldOf(ports, id);
  const events = eventsOf(lw.journal.read());
  return { mission: id, revision: lw.m.position, since, events: events.slice(Math.max(0, since)) };
}

export const listOf = (ports) => listMissions(ports.io, ports.rooms).map((id) => quietly(() => ((v) => ({ id, objective: v.mission.objective, lifecycle: v.lifecycle, verdict: v.verdict, revision: v.revision, createdAt: v.mission.createdAt }))(showOf(ports, id))) ?? { id, unreadable: true });
