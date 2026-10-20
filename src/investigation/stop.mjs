// Why the loop should stop NOW -- the first row that holds -- or null to go on.
//
// The order is the order of urgency. A person's cancel, then a write whose
// outcome nobody knows, then a spent budget; then, when nothing is left to
// take, WHO has to act: this machine (a browser, a database), a person's
// approval, a person's answer, or a capability nobody has; then a loop going
// round without learning anything; and only then a finished scope. "Completed"
// is never PASS for the product: it means every obligation has a disposition,
// and the report says which.
import { OBLIGATION_STATES } from "./vocab.mjs";

const open = new Set(OBLIGATION_STATES.filter((s) => s.open).map((s) => s.id));

export const unsettled = (model) => model.decisions.filter((d) => !model.settled.some((s) => s.decision === d.id));

// The minutes budget runs from the start of the current stretch of work, as the
// DEADLINE gate reads it (src/investigation/gates.mjs).
const deadlineOf = (lw) => Date.parse(lw.model.resumed.at(-1)?.at ?? lw.model.meta?.at) + lw.settings.limits.minutes * 60000;

const spent = (lw) => lw.model.actions.length >= lw.settings.limits.actions || lw.model.decisions.length >= lw.settings.limits.decisions || (lw.now ? lw.now() > deadlineOf(lw) : false);

// The last `noProgress` settled steps produced no new evidence and moved no status.
function idle(lw) {
  const last = lw.model.settled.slice(-lw.settings.limits.noProgress);
  return last.length >= lw.settings.limits.noProgress && last.every((s) => s.progress === false);
}

const nothingLeft = (lw) => !lw.frontier.length && !lw.obligations.some((o) => open.has(o.status));
const waitingOn = (lw, blocker) => nothingLeft(lw) && lw.obligations.some((o) => o.blocker === blocker && !["satisfied", "violated", "not-applicable"].includes(o.status));

export const STOPS = [
  { id: "cancelled", when: (lw) => lw.model.lifecycle === "cancelled" },
  { id: "ambiguous-side-effect", when: (lw) => unsettled(lw.model).some((d) => d.mutates) },
  { id: "budget-exhausted", when: (lw) => spent(lw) },
  { id: "environment-blocked", when: (lw) => waitingOn(lw, "environment") },
  { id: "needs-approval", when: (lw) => nothingLeft(lw) && lw.obligations.some((o) => o.status === "needs-approval") },
  { id: "needs-requirement", when: (lw) => waitingOn(lw, "person") },
  { id: "no-eligible-capability", when: (lw) => waitingOn(lw, "capability") },
  { id: "no-progress", when: (lw) => idle(lw) },
  { id: "completed-scope", when: (lw) => nothingLeft(lw) },
];

export const stopOf = (lw) => STOPS.find((r) => r.when(lw))?.id ?? null;
