// Which names a step MAY use, step by step.
//
// A param exists before the run; a `resolve` target exists once its SQL has run,
// still before the browser; an `into` value exists only once the step that binds
// it has executed. So "is this ${NAME} declared" is not one question about the
// case -- it is a different question at every step, and asking the case-wide one
// let a step read a value a LATER step produces, which at run time is a hole.
export function bindingsAt(c) {
  const seen = new Set([...(c.params ?? []).map((p) => p.n), ...(c.resolve ?? []).map((r) => r.as)]);
  const at = (c.steps ?? []).map((st) => snapshot(seen, st));
  return { at, all: seen };
}

// The set as it stands BEFORE this step runs -- a step never sees its own
// binding, because the value does not exist until the step has produced it.
function snapshot(seen, st) {
  const before = new Set(seen);
  if (st?.into) seen.add(st.into);
  return before;
}
