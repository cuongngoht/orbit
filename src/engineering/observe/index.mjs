// The ENGINEERING OBSERVER: a session's working set, plus the tracked tree,
// in -- candidates out -- and every candidate through the same door a person's
// would take.
//
// It never writes a fact and never edits one. It proposes. Each candidate is
// held to src/engineering/candidate.mjs exactly as a piped `record` is (the
// observer is never `trusted`, so it can say `observed` or `suggested` and
// nothing more), then src/engineering/ingest.mjs stamps and reconciles it. So
// the observer cannot make anything certain on its own -- one session is one
// session however often it runs -- and cannot move a strength at all.
//
// Candidates are judged ONE AT A TIME, unlike a piped batch: a batch came from
// one investigation and is all or nothing, while these came from independent
// analysers, and one that proposed something the contract refuses must not
// cost the others. A refusal is a finding, never a crash.
import { analysed } from "../analyzers/index.mjs";
import { ingest } from "../ingest.mjs";
import { judge, trackedSet } from "../record.mjs";

export function proposed(ctx, input) {
  const files = input.files ?? ctx.source.files() ?? [];
  return { ...analysed({ ...input, files }), files };
}

// Each run is said to the session trail through `ctx.trace` when a composition root bound one (1.8.9,
// `learning.observed`): counts and words only, and a trail that cannot be written costs the observation nothing.
export function observed(ctx, input, seenBy, opts = {}) {
  const found = proposed(ctx, input);
  const decisions = admitted(ctx, found.candidates, { ...opts, files: found.files, gates: input.gates, seenBy });
  traced(ctx, { host: seenBy?.host ?? null, milestone: opts.milestone ?? null, operation: opts.operation ?? null, candidates: found.candidates.length, accepted: decisions.length });
  return { ...found, decisions };
}

function traced(ctx, data) {
  try { ctx.trace?.("learning.observed", data); }
  catch { /* the trail is fail-open; the observation stands */ }
}

// The door for candidates something OTHER than a person produced -- this
// observer's analysers, or project intelligence's bridge. Never trusted, so
// nothing through here can claim adopted or enforced; judged one at a time,
// refusals kept as findings; reconciled by ingest like everything else.
export function admitted(ctx, candidates, opts = {}) {
  const world = { tracked: trackedSet(opts.files ?? ctx.source.files() ?? []), gates: opts.gates ?? new Set(), trusted: false };
  const verdicts = candidates.map((raw, i) => ({ raw, verdict: judge([{ i, raw }], world) }));
  refusals(ctx, verdicts);
  return ingest(ctx, verdicts.flatMap((v) => v.verdict.accepted), { seenBy: opts.seenBy, operation: opts.operation });
}

function refusals(ctx, verdicts) {
  for (const v of verdicts.filter((x) => x.verdict.refused)) ctx.eng.addFinding({ kind: "observer-candidate-refused", candidateKey: v.raw.key, say: v.verdict.rejected.map((r) => r.why).join(" · ").slice(0, 300) });
}
