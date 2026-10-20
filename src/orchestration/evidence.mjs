// Whether the LIVE evidence a task holds is about the code it holds now -- derived on every read, as
// ordered rows, first row that holds. Live evidence is taken from a source tree: the sandbox runs one,
// and an investigation records which one its browser looked at. If the workspace has moved since, that
// evidence is about code that no longer exists.
//
//   none      there is nothing to rest on (no sandbox, or evidence of another environment or task)
//   stale     there is evidence, and it is about a tree the workspace has left
//   pending   an investigation is still being made
//   current   the investigation looked at the sandbox of THIS task, at THIS tree, and ended
//
// It is printed in the context and is NOT a completion row: what completion needs stays as it was.
import { SANDBOX_STATE } from "./vocab.mjs";

const NONE = "none";
const STALE = "stale";
const PENDING = "pending";
const CURRENT = "current";

// `e`: { task, taskTree: { live, recorded }, sandbox (src/orchestration/sandbox.mjs sandboxOf, or null),
// investigation: { ended, runtime: { environment, task, sourceTree } | null } | null }
export const EVIDENCE = [
  { id: "NO_SANDBOX", state: NONE, when: (e) => e.sandbox === null, say: () => "no sandbox holds this task's change: live evidence would be about whatever the developer's checkout runs" },
  { id: "NOT_OWNED", state: NONE, when: (e) => e.sandbox.owner !== undefined && e.sandbox.owner !== e.task, say: () => "the sandbox belongs to another task" },
  { id: "UNRECORDED_EDITS", state: STALE, when: (e) => Boolean(e.taskTree.recorded) && Boolean(e.taskTree.live) && e.taskTree.recorded !== e.taskTree.live, say: () => "the workspace holds edits record-changes has not read back: nothing run against them is evidence of the recorded change" },
  { id: "SANDBOX_STALE", state: STALE, when: (e) => e.sandbox.state === SANDBOX_STATE.STALE || e.sandbox.stale === true, say: () => "the workspace moved since the sandbox was prepared: it runs code that no longer exists" },
  { id: "NO_INVESTIGATION", state: NONE, when: (e) => !e.investigation, say: () => "no investigation of the running application is linked yet" },
  { id: "OTHER_ENVIRONMENT", state: NONE, when: (e) => e.investigation.runtime?.environment !== e.sandbox.environment, say: () => "the linked investigation did not look at this task's sandbox" },
  { id: "OTHER_TASK", state: NONE, when: (e) => e.investigation.runtime.task !== e.task, say: () => "the linked investigation says it ran for another task" },
  { id: "INVESTIGATION_STALE", state: STALE, when: (e) => e.investigation.runtime.sourceTree !== e.taskTree.live, say: () => "the linked investigation looked at a source tree the workspace has left" },
  { id: "UNSETTLED", state: PENDING, when: (e) => e.investigation.ended !== true, say: () => "the linked investigation has not ended" },
  { id: "CURRENT", state: CURRENT, when: () => true, say: () => "the linked investigation looked at this task's sandbox, at the tree the workspace holds now" },
];

// -> { state, id, say }
export function currentRuntimeEvidence(e) {
  const row = EVIDENCE.find((r) => r.when(e));
  return { state: row.state, id: row.id, say: row.say() };
}

// The latest investigation linked to a task, as the loop reads them: the last receipt's outcome.
export const latestInvestigation = (receipts, outcomes) => outcomes.get(receipts.at(-1)?.ref) ?? null;
