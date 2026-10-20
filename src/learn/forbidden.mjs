// Three changes this tool must never recommend, and the honest account of how
// hard that is enforced.
//
// The REAL guarantee is upstream, in the recipe table: there is no recipe that
// emits a bigger timeout, a retry, or a removed verdict, and the timing family
// proposes no budget change at all. A rule that cannot be produced cannot be
// recommended.
//
// What is here is a backstop over prose -- text this engine wrote from a template,
// plus whatever a person typed into `learn remember`. It is a regex over English,
// so it is a heuristic and not a boundary, and pretending otherwise would be the
// same kind of false confidence it exists to prevent.
//
// A refused recommendation is PRINTED, with the rule it broke. Dropping it
// silently would leave somebody wondering where their suggestion went, and would
// hide the one case worth looking at: the tool trying to talk itself into it.
export const FORBIDDEN = [
  {
    rule: "never raise a timeout or a poll budget to make a case pass",
    why: "a case that only passes with longer to wait is measuring the wait, not the product",
    hits: (text) => /\b(raise|raising|increase|increasing|bump|lengthen|extend|more)\b[^.]{0,40}\b(timeout|timeouts|tries|budget|deadline|poll|polls)\b/i.test(text),
  },
  {
    rule: "never add a retry",
    why: "this engine has no retry on purpose; adding one turns an intermittent defect into a green tick",
    hits: (text) => /\b(retry|retries|re-?run until|try again until|attempt again)\b/i.test(text) || /\btimes\s*:\s*[2-9]/.test(text),
  },
  {
    rule: "never weaken an assertion to lift a pass rate",
    why: "the verdict is the only thing that makes a PASS mean anything",
    hits: (text) => /\b(remove|removing|drop|dropping|relax|relaxing|loosen|soften|weaken|widen)\b[^.]{0,40}\b(assert|assertion|verdict|expect|check|api|sql|match)\b/i.test(text),
  },
];

export const brokenRule = (text) => FORBIDDEN.find((f) => f.hits(String(text ?? ""))) ?? null;

export const refuseForbidden = (recs) => recs.map(judged);

function judged(rec) {
  const broke = brokenRule(`${rec.change} ${rec.expect ?? ""}`);
  if (!broke) return rec;
  return { ...rec, state: "refused", refusedBy: broke.rule, refusedWhy: broke.why };
}
