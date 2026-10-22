// One event as ONE plain line: its time, its sequence, what kind of line it is, the mode its action or run works in,
// the run, the status the line moved its action to, and a short summary taken from the line itself. Every string goes
// through Orbit Live's clean() first, so a terminal is handed nothing but text.
import { clean } from "../../../../src/live/render/ansi.mjs";
import { clockOf } from "../../../../src/live/render/lines.mjs";
import { FACTORY_WORDS } from "../view.mjs";

const n = (v) => (Array.isArray(v) ? v.length : 0);

const SUMMARIES = {
  "mission.created": (r) => `mission ${r.id}: ${r.objective}`,
  "intent.recorded": (r) => `intent ${r.n}: ${n(r.facts)} fact(s), ${n(r.hypotheses)} hypothesis(es), ${n(r.acceptanceCriteria)} criterion(a), ${n(r.unknowns)} unknown(s)`,
  "plan.revised": (r) => `${r.n === 1 ? "PLAN" : "WORKFLOW_REVISED"} revision ${r.n} (${r.cause}): +${n(r.units)} unit(s), ${n(r.cancelled)} cancelled, ${n(r.reset)} reset`,
  "unit.created": (r) => `${r.id} ${r.unitKind}: ${r.objective}`,
  "unit.updated": (r) => `${r.id}${r.rolePin ? ` role ${r.rolePin}` : ""}${r.templatePin ? ` template ${r.templatePin}` : ""}${r.reset ? " reset" : ""}`,
  "unit.cancelled": (r) => `${r.id} cancelled: ${r.because ?? ""}`,
  "unit.skipped": (r) => `${r.id} skipped: ${r.because ?? ""}`,
  "agentrun.created": (r) => `AGENT_SPAWNED ${r.id} for ${r.unit} as ${r.agent} (${r.dispatch}, ${r.profile})`,
  "agentrun.started": (r) => `${r.id} started (${r.by}${r.providerRef ? `, ${r.providerRef}` : ""})`,
  "agentrun.reported": (r) => `${r.id} reported ${r.executionState}: ${r.summary ?? ""}`,
  "agentrun.ended": (r) => `${r.id} ended ${r.outcome}`,
  "action.proposed": (r) => `${r.id} ${r.type} proposed`,
  "action.refused": (r) => `${r.id} REFUSED ${r.rule}: ${r.say ?? ""}`,
  "action.intended": (r) => `${r.id} intent persisted`,
  "action.accepted": (r) => `${r.id} accepted by ${r.providerRef ?? r.by}`,
  "action.observed": (r) => `${r.id} observed (${r.by}): ${n(r.refs)} reference(s)`,
  "action.recorded": (r) => `${r.id} ${r.outcome} at ${r.level}: ${r.summary ?? ""}`,
  "action.ambiguous": (r) => `${r.id} AMBIGUOUS: ${r.because ?? ""}`,
  "permission.evaluated": (r) => `${r.action} ${r.verdict} (${r.rule})`,
  "permission.denied": (r) => `DENIED ${r.operationKind} in ${r.mode} for ${r.profile}: ${r.rule}`,
  "handoff.published": (r) => `${r.id} published by ${r.agentRun}${n(r.targets) ? ` for ${r.targets.join(", ")}` : ""}`,
  "handoff.consumed": (r) => `${r.id} consumed by ${r.agentRun}`,
  "handoff.rejected": (r) => `${r.id} REJECTED for ${r.unit}: ${r.rule}`,
  "evidence.linked": (r) => `${r.id} ${r.level}${r.independent ? " (independent)" : ""} ${r.ref}`,
  "verification.derived": (r) => `verdict ${r.verdict}${n(r.owed) ? `, owed ${r.owed.join(", ")}` : ""}`,
  "replan.triggered": (r) => `${r.trigger} -> ${r.response}: ${r.because ?? ""}`,
  "mission.completed": (r) => `COMPLETED ${r.verdict}`,
  "mission.reported": (r) => `REPORTED ${r.verdict}: ${r.summary ?? ""}`,
  "mission.failed": (r) => `FAILED ${r.stop}: ${r.because ?? ""}`,
  "mission.cancelled": (r) => `CANCELLED by ${r.by}: ${r.because ?? ""}`,
  "checkpoint.written": (r) => `checkpoint ${r.n} at revision ${r.revision}`,
  "recovery.reconciled": (r) => `${r.action} ${r.from} -> ${r.to}: ${r.because ?? ""}`,
  "tool.observed": (r) => `${r.toolName ?? r.tool} ${r.phase}${r.ok === false ? " failed" : ""} (${r.attribution})`,
};

const factorySummary = (r) => `${FACTORY_WORDS[r.kind]} ${r.displayName ?? r.capability ?? r.workflowId ?? r.roleId ?? r.draft ?? ""} ${r.pin ?? ""}`.trim();

const summaryOf = (r) => (SUMMARIES[r.kind] ?? (FACTORY_WORDS[r.kind] ? factorySummary : () => r.kind))(r);

export const plainLine = (event, record) => clean(`${clockOf(event.at)} ${String(event.seq).padStart(4)}  ${event.kind.padEnd(21)} ${String(event.mode ?? "-").padEnd(16)} ${String(event.agentRunId ?? "-").padEnd(6)} ${String(event.actionStatus ?? "-").padEnd(18)} ${summaryOf(record)}`);

export const SUMMARIZED = Object.freeze(Object.keys(SUMMARIES));
