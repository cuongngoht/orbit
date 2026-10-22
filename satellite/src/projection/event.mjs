// The LIVE EVENT a journal line is, as the versioned contract `orbit.satellite.event/v1`: every field present (null
// when nothing says), its correlation taken from the model AS IT STANDS after that line -- which action it belongs to,
// which agent run and which unit, the run's parent and the action's parent, the mode and operation of the action, the
// status the line moved it to. `seq` is the line's index and `at` the line's own time: never a clock, so a replay and a
// live viewer name every event identically.
import { eventIdOf } from "../store/ids.mjs";

export const EVENT_API = "orbit.satellite.event/v1";

export const EVENT_FIELDS = Object.freeze(["schema", "eventId", "seq", "at", "missionId", "workUnitId", "agentRunId", "parentAgentRunId", "actionId", "parentActionId", "kind", "mode", "operationKind", "actionStatus", "rolePin", "skillPin", "providerRef", "artifactRefs", "evidenceRefs"]);

// Which action a line speaks for: an action line is its own; every other line written inside an action names it.
const actionIdOf = (r) => (r.kind.startsWith("action.") ? r.id : r.action ?? null);

// The run a line names itself: an agent run's own line, or the run a line was written for.
const runIdOfLine = (r) => (r.kind.startsWith("agentrun.") ? r.id : r.agentRun ?? null);

const unitIdOf = (r, a, run) => (r.kind.startsWith("unit.") ? r.id : r.unit ?? a?.unit ?? run?.unit ?? null);

// The mode a line is in when it is no action's: what the engine was doing to write it.
const MODE_OF_KIND = [["intent.", "ANALYZING"], ["plan.", "PLANNING"], ["unit.", "PLANNING"], ["replan.", "PLANNING"], ["handoff.", "HANDOFF"], ["recovery.", "RECOVERING"], ["checkpoint.", "RECOVERING"], ["verification.", "VERIFYING"]];

const modeOf = (r, a, run) => (r.kind === "tool.observed" ? r.mode ?? null : a?.mode ?? (run && !run.ended ? run.stack.at(-1)?.mode ?? run.mode : run?.mode) ?? MODE_OF_KIND.find(([p]) => r.kind.startsWith(p))?.[1] ?? null);

const ARTIFACT_KINDS = { "plan.revised": (r) => [r.file], "handoff.published": (r) => [r.file], "checkpoint.written": (r) => [r.file] };

const EVIDENCE_KINDS = { "evidence.linked": (r) => [r.ref], "action.observed": (r) => r.refs ?? [] };

export function eventOf(m, r, n) {
  const lineRun = m.runs.get(runIdOfLine(r)) ?? null;
  const a = m.actions.get(actionIdOf(r) ?? lineRun?.action) ?? null;
  const run = lineRun ?? m.runs.get(a?.agentRun) ?? null;
  const base = { schema: EVENT_API, eventId: eventIdOf(n), seq: n, at: r.at ?? null, missionId: m.meta?.id ?? null, workUnitId: unitIdOf(r, a, run), agentRunId: run?.id ?? runIdOfLine(r) ?? a?.agentRun ?? null, parentAgentRunId: run?.parentAgentRun ?? null, actionId: a?.id ?? actionIdOf(r), parentActionId: a?.parentAction ?? null, kind: r.kind };
  return { ...base, mode: modeOf(r, a, run), operationKind: a?.operationKind ?? null, actionStatus: a?.status ?? null, rolePin: r.kind.startsWith("role.") ? r.pin ?? null : run?.rolePin ?? null, skillPin: r.kind.startsWith("skill.") ? r.pin ?? null : null, providerRef: a?.accepted?.providerRef ?? run?.providerRef ?? null, artifactRefs: (ARTIFACT_KINDS[r.kind]?.(r) ?? []).filter(Boolean), evidenceRefs: (EVIDENCE_KINDS[r.kind]?.(r) ?? []).filter(Boolean) };
}
