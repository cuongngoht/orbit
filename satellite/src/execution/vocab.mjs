// The STATUS of one action, read off which lines its journal holds -- never stored. Recording an intent is not
// running, an invocation is not success, and a result is not verification: each is its own word, earned by its own
// line. AMBIGUOUS is terminal: a write that may have happened is read back by its owner, never sent again.
export const ACTION_STATUSES = Object.freeze([
  { id: "NOT_DISPATCHED", open: false, say: "proposed; nothing was dispatched" },
  { id: "REFUSED", open: false, say: "refused before anything ran" },
  { id: "INTENT_PERSISTED", open: true, say: "the dispatch intent is on disk; nothing has been observed running yet" },
  { id: "PROVIDER_ACCEPTED", open: true, say: "the provider accepted it" },
  { id: "EXECUTION_OBSERVED", open: true, say: "its execution was observed; its result is not recorded yet" },
  { id: "RESULT_RECORDED", open: false, say: "its result is recorded" },
  { id: "EVIDENCE_VERIFIED", open: false, say: "its evidence was read back from an independent owner and holds" },
  { id: "AMBIGUOUS", open: false, say: "it may have had a side effect nobody can read back: it is never resent, a person decides" },
]);

export const STATUS_NAMES = Object.freeze(ACTION_STATUSES.map((s) => s.id));

export const STATUS_OF_KIND = Object.freeze({ "action.proposed": "NOT_DISPATCHED", "action.refused": "REFUSED", "action.intended": "INTENT_PERSISTED", "action.accepted": "PROVIDER_ACCEPTED", "action.observed": "EXECUTION_OBSERVED", "action.recorded": "RESULT_RECORDED", "action.ambiguous": "AMBIGUOUS" });

export const isOpenStatus = (status) => ACTION_STATUSES.find((s) => s.id === status)?.open === true;

export const statusSay = (status) => ACTION_STATUSES.find((s) => s.id === status)?.say ?? status;

// Who carries an action out. `engine` is Satellite itself through a port; `host-agent` is an agent run the HOST
// executes from a dispatch envelope; `engineering` is an agent run that drives one of Orbit's autonomous-engineering
// tasks (the only way source changes); `context`, `knowledge` and `capability` are Orbit owners asked read-only.
export const PROVIDER_IDS = Object.freeze(["engine", "host-agent", "engineering", "context", "knowledge", "capability"]);

export const CORRELATION = Object.freeze(["eventId", "actionId", "parentActionId", "agentRunId", "parentAgentRunId", "workUnitId"]);
