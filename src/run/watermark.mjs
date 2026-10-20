// The line between "the UI had already done this" and "the UI just did this".
//
// An `api` step asks about the call its own click caused, and the request log
// holds every earlier one too -- so without a mark, a call made minutes ago by
// the page load or the previous case satisfied it. That is a PASS that proves
// nothing, which is the whole class of defect this engine exists to avoid.
//
// The mark is taken BEFORE the action, never after: after the click the call may
// already be in the log, and a mark that includes it proves nothing either.
import { CORE } from "../dsl/registry.mjs";
import { highestRequest } from "../browser/index.mjs";

// Both sets come off the verb table (`requests: "mark" | "since"`). Writing
// them out here was a second verb list, which is what the table exists to end --
// and it is where `as` belongs, since switching identity switches to a DIFFERENT
// browser's log whose numbering has nothing to do with this one's.
export const marksRequests = (dsl) => dsl.verbsWhere("requests", "mark");
export const asksRequests = (dsl) => dsl.verbsWhere("requests", "since");

// Only worth paying for when something will ask. A case with no `api` step costs
// no extra round trip at all.
export function watermarkOf(slice, dsl = CORE) {
  const asks = asksRequests(dsl);
  return slice.some((s) => asks.has(s.do)) ? { n: 0, step: null } : null;
}

export function markRequests(ctx, run, s) {
  if (!run.watermark || !marksRequests(ctx.dsl).has(s.do)) return;
  run.watermark.n = highestRequest(ctx.browser.requestList());
  run.watermark.step = s;
}
