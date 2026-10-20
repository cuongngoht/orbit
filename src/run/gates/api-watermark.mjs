import { Refused } from "../errors.mjs";
import { asksRequests, marksRequests } from "../watermark.mjs";

// An `api` step proves the UI made a call SINCE the last action. A slice that
// begins at (or after) the api step contains no action to count from, so the
// step could only fall back to "any request the session ever logged" -- which is
// precisely the false pass the watermark exists to remove. Refuse instead, and
// say how to widen the slice, before the browser is touched.
export function apiWatermarkGate(ctx, run) {
  const marks = marksRequests(ctx.dsl);
  const asks = asksRequests(ctx.dsl);
  const acted = run.slice.findIndex((s) => marks.has(s.do));
  const api = run.slice.findIndex((s) => asks.has(s.do));
  if (api >= 0 && (acted < 0 || acted > api)) throw new Refused(unanchored(run, run.slice[api]));
}

const unanchored = (run, s) =>
  `steps ${run.from}..${run.to}: step ${s.i} (api) has no action before it in this slice — an api step proves a call the UI made SINCE the last action, so start the slice at or before the step that causes the call`;
