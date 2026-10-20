// Three different things people call idempotency, kept apart.
//
//   1. the TEST can be run again safely        -- what skip-if is for
//   2. the PRODUCT handles the action twice    -- what an idempotency scenario is for
//   3. the PRODUCT handles two at once         -- concurrency, which a sequence is not
//
// The first is a property of the case. `skip-if` stops the second run before it
// touches anything, and a SKIP verifies nothing at all -- it is the absence of a
// test, correctly reported. A plan that offers the guard as evidence of (2) has
// swapped a test for the reason there is no test.
//
// So a scenario whose technique asks for a repeat has to perform the action
// AGAIN and say what the contract requires of the second attempt. Nothing here
// assumes what that is: a second create is not automatically a duplicate, and a
// second call is not automatically the same status.
import { error } from "../finding.mjs";
import { REPEAT, repeatsWhere, techniquesWhere } from "../vocab.mjs";
import { at, filled, scenariosOf } from "./common.mjs";

const ASKS_REPEAT = techniquesWhere("asks", "repeat");
const AGAIN = repeatsWhere("again");
const PARALLEL = repeatsWhere("parallel");

export const repeatFindings = (p) => scenariosOf(p).flatMap((s) => oneScenario(p, s));

function oneScenario(p, s) {
  if (!ASKS_REPEAT.has(s.technique)) return strayGuard(p, s);
  return [...requiredBlock(p, s), ...kindFindings(p, s), ...contractFindings(p, s), ...concurrencyFindings(p, s)];
}

// A guard declared on a scenario that is not about repeating is fine -- it is a
// re-run guard. It is only worth a word when it is the ONLY thing said.
const strayGuard = (p, s) => (s.repeat?.guarded === true && !filled(s.repeat?.expect) ? [error(at(p, s), "repeat says only that the case is guarded. A skip-if guard protects the RE-RUN; it says nothing about how the product handles the action twice")] : []);

const requiredBlock = (p, s) => (s.repeat ? [] : [error(at(p, s), `technique ${s.technique} needs a repeat block — say how the action happens a second time and what the contract requires of it`)]);

function kindFindings(p, s) {
  const kind = s.repeat?.kind;
  if (kind === undefined || AGAIN.has(kind)) return [];
  return [error(at(p, s), `repeat.kind is "${kind}", so the action never happens twice — ${REPEAT.get(kind)?.doc ?? ""}`)];
}

// What must the second attempt produce? Left blank, the case will be written to
// whatever the product happens to do, which is not a test of a contract.
const contractFindings = (p, s) => (!s.repeat || filled(s.repeat.expect) ? [] : [error(at(p, s), "repeat states no expected result for the second attempt — what does the contract say it must return, and what must NOT appear a second time?")]);

// The one substitution that cannot be allowed to pass as concurrency: doing it,
// waiting, and doing it again. Two sessions racing is a different question, and
// a plan that describes a sequence has not asked it.
function concurrencyFindings(p, s) {
  if (s.technique !== "concurrency" || s.repeat?.kind === undefined) return [];
  return PARALLEL.has(s.repeat.kind) ? [] : [error(at(p, s), `is a concurrency scenario with repeat.kind "${s.repeat.kind}" — that is a sequence. Use ${[...PARALLEL].join(" or ")}, or call it idempotency`)];
}
