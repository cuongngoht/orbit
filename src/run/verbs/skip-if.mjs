import { trunc } from "../errors.mjs";

export const SKIP = "SKIP";

export default {
  name: "skip-if",
  label: (s) => trunc(s.why ?? s.js, 60),
  act: (ctx, run, s) => (ctx.browser.truthy(s.js) ? SKIP : undefined),
  tail: (s, r) => (r.result === SKIP ? `SKIP — ${s.why ?? s.js}` : "not skipped"),
  logged: (r) => ({ result: r.result }),
  // The sentinel is a bare string, and the loop used to compare it against EVERY
  // verb's result -- so a report whose page expression happened to return "SKIP"
  // ended the case at exit 0. Only the verb that owns the sentinel reads it.
  stops: (result) => result === SKIP,
};
