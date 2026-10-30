// The DISPATCH ENVELOPE: everything the host needs to run ONE agent run, and nothing more. It names the plugin agent
// whose host-enforced `tools:` allowlist carries the run's profile, the pinned role's contract, a bounded CONTEXT SLICE
// (the unit, the criteria it serves, the handoffs it rests on, the playbooks its skills pin) -- never the
// conversation, never a secret -- the operation kinds it is granted, and exactly how its report comes back. On a host
// with no native agents the dispatch is SERIAL, said so, and never shown as parallel. Derived from the journal and the
// pinned definitions, so the same run always has the same envelope.
import { MODES } from "../execution/modes.mjs";
import { UNIT_KINDS } from "../execution/unit-kinds.mjs";
import { scrub } from "../../../src/scrub.mjs";
import { list } from "../store/text.mjs";
import { AGENT_TOOLS, PROFILE_AGENTS, subagentTypeOf } from "./agents.mjs";
import { serialOnly } from "./matrix.mjs";
import { REPORT_API, REPORT_FIELDS, REPORT_LIMITS } from "./report.mjs";

export const ENVELOPE_API = "orbit.satellite.envelope/v1";

// 0.2.2 (ADR 0044): the run's parent and attempt travel with it, so the run, its parent and its retry are named where
// it is dispatched -- the mission ids under the API mark are what the hooks read off an Agent call (src/attribution.mjs).
export const ENVELOPE_FIELDS = Object.freeze(["api", "missionId", "agentRunId", "parentAgentRunId", "attempt", "actionId", "workUnitId", "agent", "profile", "mode", "operationKind", "role", "instruction", "contextSlice", "grants", "drive", "report", "dispatch", "fallback"]);

export const SLICE_LIMITS = Object.freeze({ handoffs: 6, findingsPerHandoff: 12, excerptChars: 2000, totalChars: 16000, playbookChars: 8000 });

export const DISPATCH = Object.freeze({
  native: { mode: "native", parallel: true, say: "dispatch it with the host's agent tool, as the agent named; several runs of one mission may be in flight at once" },
  serial: { mode: "serial", parallel: false, say: "this host runs no native agents: follow the role's instruction in this session, one run at a time, then report — it is never shown as parallel" },
});

const bounded = (text, n) => ((t) => (t.length > n ? `${t.slice(0, n - 1)}…` : t))(scrub(String(text ?? "")));

const handoffSlice = (h) => ({ id: h.id, sourceUnitId: h.sourceUnitId, findings: list(h.findings).slice(0, SLICE_LIMITS.findingsPerHandoff).map((f) => ({ say: bounded(f.say, 500), refs: list(f.refs) })), remainingUnknowns: list(h.remainingUnknowns).slice(0, 8), evidenceRefs: list(h.evidenceRefs), proposes: h.proposes ?? null });

const instructionOf = (x) => [`You are ${x.role.content.displayName}: ${x.role.content.purpose}`, `Work unit ${x.unit.id} (${x.unit.kind}): ${x.unit.objective}`, `You answer for: ${x.role.content.responsibilities.map((r) => `${r.activity} ${r.subject}`).join("; ")}.`, `You work in ${x.run.mode}: ${MODES[x.run.mode].say}. ${UNIT_KINDS[x.unit.kind].say}.`, `You never: ${x.role.content.restrictions.join(" ")}`, `You are done when: ${x.role.content.completionCriteria.join(" ")}`, "Return only the report JSON described under report: findings with the records that show them, the evidence references an owner keeps, what is still unknown -- never whether it worked."].join("\n");

const playbooksOf = (skills) => skills.map((s) => ({ pin: s.pin, capability: s.capability, playbook: bounded(s.playbook ?? "", SLICE_LIMITS.playbookChars) }));

const DRIVE = {
  engineering: (x) => ({ owner: "orbit autonomous-engineering", task: x.run.task, commands: [`node ${x.roots.orbit}/cli/autonomous-engineering.mjs context ${x.run.task} --json`, `node ${x.roots.orbit}/cli/autonomous-engineering.mjs step ${x.run.task} --json < decision.json`], say: `drive ${x.run.task} one decision at a time, editing only in the workspace its context names, until it completes or stops; then report task:${x.run.task} (and check:${x.run.task}:chk-<n> refs)` }),
  "host-agent": () => null,
};

const reportOf = (x) => ({ api: REPORT_API, by: x.run.profile === "READ_ONLY" || x.run.profile === "DESIGN" ? "host" : "agent", command: `node ${x.roots.satellite}/cli/satellite.mjs agent report ${x.m.meta.id} ${x.run.id}`, stdin: "the report JSON, one object", fields: REPORT_FIELDS, limits: REPORT_LIMITS, example: { schemaVersion: 1, agentRunId: x.run.id, executionState: "reported", findings: [{ say: "what was found, in one sentence", refs: ["file:<path>"] }], evidenceRefs: x.run.task ? [`task:${x.run.task}`] : [], remainingUnknowns: [], summary: "one sentence" } });

// x: { m, run, unit, role, template, skills: [{ pin, capability, playbook }], handoffs: [records], criteria, hostRow, roots }
export function envelopeOf(x) {
  const slice = { unit: { id: x.unit.id, kind: x.unit.kind, objective: x.unit.objective, scope: x.unit.scope, outputContract: x.unit.outputContract }, criteria: x.criteria, handoffs: x.handoffs.slice(0, SLICE_LIMITS.handoffs).map(handoffSlice), skills: playbooksOf(x.skills), conversation: false, secrets: false };
  const agent = PROFILE_AGENTS[x.run.profile];
  return { api: ENVELOPE_API, missionId: x.m.meta.id, agentRunId: x.run.id, parentAgentRunId: x.run.parentAgentRun ?? null, attempt: x.run.attempt ?? 1, actionId: x.run.action, workUnitId: x.unit.id, agent: { subagentType: subagentTypeOf(x.run.profile), name: agent, tools: AGENT_TOOLS[agent] }, profile: x.run.profile, mode: x.run.mode, operationKind: UNIT_KINDS[x.unit.kind].operation, role: { pin: x.run.rolePin, displayName: x.role.content.displayName, purpose: x.role.content.purpose, responsibilities: x.role.content.responsibilities, restrictions: x.role.content.restrictions, completionCriteria: x.role.content.completionCriteria }, instruction: { templatePin: x.run.templatePin, text: bounded(instructionOf(x), SLICE_LIMITS.totalChars) }, contextSlice: slice, grants: { operationKinds: list(x.run.grants), tools: AGENT_TOOLS[agent] }, drive: (DRIVE[x.run.actualProvider] ?? DRIVE["host-agent"])(x), report: reportOf(x), dispatch: serialOnly(x.hostRow) ? DISPATCH.serial : DISPATCH.native, fallback: DISPATCH.serial };
}
