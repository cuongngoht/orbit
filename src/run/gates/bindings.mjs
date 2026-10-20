import { unresolved } from "../../dsl/interpolate.mjs";
import { Refused } from "../errors.mjs";

// A slice is a debugging tool, and it is honest only while it is self-contained.
// --from past the step that binds ${ID} asks a question with a hole in it, and
// the runner would discover that three steps in, with the browser already open.
// The validator has already proved every binding comes before its use, so the
// only question left is whether the binder is inside the slice at all.
export function bindingGate(ctx, run) {
  const bound = new Set([...Object.keys(run.values), ...(run.c.resolve ?? []).map((r) => r.as), ...run.slice.map((s) => s.into).filter(Boolean)]);
  const missing = [...new Set(run.slice.flatMap(unresolved))].filter((n) => !bound.has(n));
  if (missing.length) throw new Refused(`steps ${run.from}..${run.to} use ${missing.map((n) => `\${${n}}`).join(", ")} — bound by a step outside the slice. Widen the slice, or pass the value as a param.`);
}
