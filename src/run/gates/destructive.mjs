import { Refused } from "../errors.mjs";

// A destructive case is read first (--dry), then run on purpose.
//
// The case's own flag is not the only source. The MAP knows which controls
// delete things, and a case that steps on one without saying so is precisely the
// case nobody meant to run unguarded -- the flag is a promise the author has to
// remember, and this is the half that does not depend on remembering. Either
// source is enough; both are named in the refusal.
export function destructiveGate(ctx, run) {
  const why = destructiveReasons(ctx.graph, run.c, run.slice);
  if (why.length && !run.args.force) throw new Refused(`${run.c.id} is DESTRUCTIVE (${why.join("; ")}) — read it with --dry, then pass --force-destructive`);
}

export function destructiveReasons(graph, c, steps) {
  const declared = c.destructive ? ['the case declares "destructive": true'] : [];
  return [...declared, ...destructiveSteps(graph, steps).map((s) => `step ${s.i} drives ${s.on}, which the map marks destructive`)];
}

// Only an `on` can be judged: a literal `selector` names no record in the map,
// so the engine infers nothing from it and the case's own flag governs -- that
// is the documented boundary. Guessing from a LABEL is what `check`'s coverage
// advisory does, and a guess must never refuse a run.
export const destructiveSteps = (graph, steps) => steps.filter((s) => s.on && graph.edgeOn.get(s.on)?.destructive);
