// Every acceptance criterion is either covered or DISPOSED OF, out loud.
//
// The old rule was "every criterion needs a P1 scenario", which is a rule teams
// satisfy by writing a P1 scenario. What a plan actually owes its reader is an
// answer per criterion -- covered by these scenarios, handed to a person,
// deliberately excluded, deferred, or still open. "Still open" is a legitimate
// answer and a visible gap; silence is neither.
import { advice, error } from "../finding.mjs";
import { disagreements } from "../risk.mjs";
import { designOf } from "../states.mjs";
import { at, checksOf, criteriaOf, filled, listed, scenariosOf } from "./common.mjs";

export const coverFindings = (p) => [...criterionFindings(p), ...scenarioFindings(p), ...readinessFindings(p), ...priorityFindings(p)];

// A person may overrule the score -- that is what `because` is for. What is
// worth a word is overruling it in SILENCE, because the next reader cannot tell
// a judgement from a typo. Advice, never an error: a band is a heuristic over
// numbers somebody estimated.
const priorityFindings = (p) => disagreements(scenariosOf(p)).map((d) => advice(`${p.id} ${d.id}`, `is ${d.priority} while its risk score (${d.score.total} of ${d.score.of}, from ${d.score.given.join(", ")}) bands it ${d.band} — say why in "because", or change one of them`));

function criterionFindings(p) {
  const covered = coveredIds(p);
  return criteriaOf(p).flatMap((c) => oneCriterion(p, c, covered.has(c.id)));
}

// Coverage is what a scenario or a check DECLARES it covers. Never inferred from
// a case name: `create-thing` covering AC3 is a guess, and a guess in a coverage
// report is worse than a blank.
const coveredIds = (p) => new Set([...scenariosOf(p), ...checksOf(p)].flatMap((m) => (Array.isArray(m.covers) ? m.covers : [])));

function oneCriterion(p, c, covered) {
  if (covered) return c.disposition ? [advice(at(p, c), "is both covered and disposed of — the disposition will be ignored by coverage")] : [];
  if (!c.disposition) return [error(at(p, c), "no scenario or manual check covers it, and it states no disposition — say why, even if the reason is that it is not decided yet")];
  return c.disposition.state === "open" ? [advice(at(p, c), `is not covered: ${c.disposition.because}`)] : [];
}

const scenarioFindings = (p) => scenariosOf(p).flatMap((s) => oneScenario(p, s));

function oneScenario(p, s) {
  const unlinked = !listed(s.covers) && !filled(s.why);
  const mustSaid = s.must === true && !filled(s.why) && !filled(s.because);
  return [...(unlinked ? [advice(at(p, s), "covers no acceptance criterion and gives no reason — say which risk it is here for")] : []),
    ...(mustSaid ? [error(at(p, s), "is marked must but explains nothing — a scenario that runs in every profile has to justify the room it takes")] : [])];
}

const readinessFindings = (p) => scenariosOf(p).flatMap((s) => oneReadiness(p, s));

// The two halves of the same mistake: something declared ready while a blocker
// is still listed against it, and something declared blocked by nothing.
function oneReadiness(p, s) {
  const blocked = Array.isArray(s.blockers) && s.blockers.length > 0;
  if (designOf(s).ready && blocked) return [error(at(p, s), `is ready but still lists ${s.blockers.length} blocker(s) — clear them, or say it is blocked`)];
  if (s.readiness === "blocked" && !blocked) return [error(at(p, s), "is blocked by nothing — name the blocker, or it cannot be unblocked")];
  return s.readiness === undefined ? [advice(at(p, s), "states no readiness — read as ready, which is the strictest reading")] : [];
}
