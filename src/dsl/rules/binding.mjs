// `into` lets a step bind a runtime value for later steps. Three rules keep that
// from turning the DSL into a programming language:
//
//   a name is bound ONCE          -- no reassignment, so ${ID} means one thing
//   only forward                  -- checked per step in rules/step.mjs
//   and somebody reads it         -- a binding nobody uses is a typo
//
// Single assignment, no expressions, one namespace, use-after-bind. There is no
// arithmetic and no branch: every value a reader meets was produced by a step
// they can find by scrolling up.
import { placeholders } from "../interpolate.mjs";

export function bindingFindings(c) {
  const steps = c.steps ?? [];
  const taken = new Set([...(c.params ?? []).map((p) => p.n), ...(c.resolve ?? []).map((r) => r.as)]);
  return [...onceFindings(c, steps, taken), ...unusedFindings(c, steps)];
}

function onceFindings(c, steps, taken) {
  const out = [];
  steps.forEach((st, i) => out.push(...oneBinding(c, st, i, taken)));
  return out;
}

function oneBinding(c, st, i, taken) {
  if (!st.into) return [];
  if (taken.has(st.into)) return [`${c.id} step ${i + 1} (${st.do}): into "${st.into}" is already a param, a resolve target or an earlier binding — a name is bound once`];
  taken.add(st.into);
  return [];
}

// A binding nobody reads is a typo in the CONSUMER, not in the producer: the
// ${ID} that was meant to use it then reaches step 9 unresolved, and the run
// stops there rather than here.
function unusedFindings(c, steps) {
  const used = new Set(steps.flatMap((st) => placeholders(JSON.stringify(st))));
  return steps.flatMap((st, i) => (st.into && !used.has(st.into) ? [`${c.id} step ${i + 1} (${st.do}): binds \${${st.into}} but no later step uses it`] : []));
}
