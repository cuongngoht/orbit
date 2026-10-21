// An accepted or a draft case's run-case result, recorded as EXECUTION: its
// verdict stays the runner's, and nothing here re-judges it.
//
// facts: { case, status, proved, cause, confidence, evidence, case_digest,
//          authority, version?, execution?, attempt? } -- computed by the
// composition root from the engine's own triage. `authority` says whose
// assertions ran: an accepted case's, or a draft an agent wrote
// (src/investigation/findings.mjs reads the difference). A generated test's run
// also names the frozen VERSION it ran, its EXECUTION and its test attempt
// (0.1.0, ADR 0032), which is how a result is traced back to its obligation.
import { current, withJournal } from "./act.mjs";

export function linkRun(w, facts) {
  return withJournal(w, () => w.store.append(w.id, "run", { ...facts, id: `run-${current(w).runs.length + 1}` }));
}
