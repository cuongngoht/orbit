// An accepted or a draft case's run-case result, recorded as EXECUTION: its
// verdict stays the runner's, and nothing here re-judges it.
//
// facts: { case, status, proved, cause, confidence, evidence, case_digest,
//          authority } -- computed by the composition root from the engine's
// own triage. `authority` says whose assertions ran: an accepted case's, or a
// draft an agent wrote (src/investigation/findings.mjs reads the difference).
import { current, withJournal } from "./act.mjs";

export function linkRun(w, facts) {
  return withJournal(w, () => w.store.append(w.id, "run", { ...facts, id: `run-${current(w).runs.length + 1}` }));
}
