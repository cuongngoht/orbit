// `plan-check` as a pure function, so the CLI is argv and an exit code and
// nothing else -- and so the exit-code contract can be tested without a
// filesystem.
//
// The contract, in one place:
//   0   no errors. Advisories may have printed; a heuristic never fails a build.
//   1   at least one error, in at least one plan.
//   2   usage, or a plan that was asked for and does not exist.
import { advisories, errors } from "./finding.mjs";
import { planIdOf } from "./load.mjs";
import { planFindings } from "./validate.mjs";

export const EXIT = { clean: 0, errors: 1, usage: 2 };

export function checkPlans(plans, world = {}) {
  const rows = plans.map((p) => onePlan(p, world));
  return { plans: rows, errors: rows.reduce((n, r) => n + r.errors.length, 0), advisories: rows.reduce((n, r) => n + r.advisories.length, 0) };
}

function onePlan(p, world) {
  const found = planFindings(p, world);
  return { id: idOf(p), file: p._file ?? null, errors: errors(found).map(say), advisories: advisories(found).map(say) };
}

const idOf = (p) => (typeof p?.id === "string" ? p.id : p?._file ? planIdOf(p._file) : "plan");

// The JSON form carries the anchor AND the sentence: a machine groups by `at`,
// a person reads `say`. One shape, so the two can never drift apart.
const say = (f) => ({ at: f.at, say: f.say });

export const exitOf = (report) => (report.errors ? EXIT.errors : EXIT.clean);

// What the text form prints. Errors first, because the advisories below them are
// things to consider and the errors are things to fix.
export function lines(report) {
  const per = report.plans.flatMap(planLines);
  return [...per, "", summary(report)];
}

function planLines(r) {
  const head = `${r.id}  ${r.errors.length ? `${r.errors.length} error(s)` : "no errors"}${r.advisories.length ? `, ${r.advisories.length} advisory` : ""}`;
  return [head, ...r.errors.map((f) => `  ERROR   ${f.say}`), ...r.advisories.map((f) => `  advice  ${f.say}`)];
}


const summary = (report) => `${report.plans.length} plan(s), ${report.errors} error(s), ${report.advisories} advisory — advisories never change the exit code`;
