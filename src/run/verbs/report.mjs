import { oneValue } from "../capture.mjs";
import { StepError, trunc } from "../errors.mjs";
import { parsed, verdict } from "../verdict.mjs";

export default {
  name: "report",
  label: (s) => (s.expect ? `expect ${trunc(s.expect, 50)}` : ""),
  act(ctx, run, s) {
    const raw = ctx.browser.ev(s.js);
    if (s.expect) verdict(s, raw, ctx);
    return raw;
  },
  tail: (s, r) => (typeof r.result === "string" ? r.result : JSON.stringify(r.result)),
  logged: (r) => ({ result: r.result }),
  // The value the RUN reports is the last one a report step produced. The loop
  // used to know that by name; knowing it here is what keeps a verb one file.
  after: (run, result) => { run.report = result; },
  capture: (step, result) => oneValue(step, single(step, parsed(result))),
};

// A placeholder substitutes into text, so a binding is one value. An object is
// told what to do about it in the case's own terms -- its `js` -- rather than
// binding "[object Object]" and failing three steps later where nothing explains it.
function single(step, it) {
  if (it !== null && typeof it === "object") throw new StepError(`into ${step.into}: this step produced ${trunc(JSON.stringify(it), 80)} — a placeholder binds one value, so return the value itself (e.g. String(x.id))`);
  if (it === null || it === undefined) throw new StepError(`into ${step.into}: this step produced nothing to bind`);
  return it;
}
