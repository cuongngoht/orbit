// WHEN an action is finished is the project's vocabulary too. The engine knows
// one timing, `sync`: done when the response returns. A product whose work
// continues on a queue or a timer declares that in graph/meta.json:
//
//   "timings": [
//     { "name": "sync" },
//     { "name": "queue", "layer": "queue",
//       "note": "The HTTP 200 is NOT success — allow for the consumer, then check the dead letters." }
//   ]
//
// `layer` is what an effect with that timing must then name: a deferred effect
// that does not say WHAT finishes it sends a QC engineer to watch nothing.
// `note` is printed by `plan` above the step it applies to.
const SYNC = { name: "sync" };

export const timingsOf = (meta) => (Array.isArray(meta?.timings) && meta.timings.length ? meta.timings : [SYNC]);

export const timingOf = (meta, name) => timingsOf(meta).find((t) => t.name === name) ?? null;
