// The locator a step drives, before interpolation: literal wins; otherwise the
// named edge's, unless the edge never captured one.
export function selectorOf(step, graph) {
  if (step.selector) return step.selector;
  const e = graph.edgeOn.get(step.on);
  return e?.selector && e.selector !== "UNKNOWN" ? e.selector : null;
}

export const screenOfStep = (step, prev) => step.screen ?? step.on?.split("/")[0] ?? prev;

// The predicate a step waits on, or null. A `wait` step's own `js` IS its wait,
// and two display sites were each spelling that out -- one definition, in the
// layer that owns the vocabulary, so neither has to know the verb.
export const waitOf = (step) => step.wait ?? (step.do === "wait" ? step.js : null);
export const viaOf = (step) => step.on?.split("/").slice(1).join("/");
