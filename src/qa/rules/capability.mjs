// A capability gap is a thing that cannot be automated, not a thing to leave out.
//
// `blockers[].kind` already says so in its own doc -- "`map` and `capability`
// block AUTOMATION — they are not a reason to drop the scenario from the plan"
// -- and `need: "unverifiable"` already says "a capability gap, not a lowered
// bar". This family is what holds a plan to both sentences.
//
// The hole it closes is narrow and worth naming. `mutation.mjs` already makes
// every witness layer compulsory for a scenario that WRITES, and `expect.mjs`
// already refuses an `unverifiable` with no reason. Neither fires for a
// READ-ONLY scenario: one that requires `ui`, says nothing about anything else
// and quietly drops the integration it actually depends on passes clean. So if
// the capability in question sits on a read path, nothing until now noticed.
//
// The engine may not go and ASK whether a capability exists -- that is
// `architecture ensure`, run by a person or a playbook, and a plan checker that
// scanned a repository would be a plan checker with a new way to be slow and a
// new way to be wrong. What this can do is hold the plan to its own claims,
// which is all `src/qa/` is ever allowed to do.
import { advice, error } from "../finding.mjs";
import { at, filled, members, scenariosOf } from "./common.mjs";
import { needsWhere } from "../vocab.mjs";

// Computed once, at module scope, from the column rather than from the word --
// the idiom src/qa/vocab.mjs documents for exactly this. A fourth `need` next
// year is covered by its own row and nothing here changes.
const PROVING = needsWhere("proves");

export const CAPABILITY = "capability";

export const capabilityFindings = (p) => scenariosOf(p).flatMap((s) => oneScenario(p, s));

const oneScenario = (p, s) => [...saidFindings(p, s), ...agreementFindings(p, s)];

// Demonstrable: a blocker of this kind whose `says` is empty. "Something is in
// the way" with no sentence is a line that reads as diligence at sign-off and
// tells the next person nothing -- and it is the one thing here a rule can show.
function saidFindings(p, s) {
  const silent = blockers(s).filter((b) => !filled(b.says));
  return silent.map(() => error(at(p, s), `carries a ${CAPABILITY} blocker that does not say what is missing, or what would unblock it`));
}

const blockers = (s) => members(s, "blockers").filter((b) => b.kind === CAPABILITY);

// Heuristic, so advice: a scenario that names a capability gap while every
// layer still claims `required` is saying two things at once. One of them is
// wrong, and which one is a judgement -- the plan may be stale, or the blocker
// may have been resolved and never cleared.
function agreementFindings(p, s) {
  if (!blockers(s).length || !committed(s).length) return [];
  if (committed(s).some((n) => !PROVING.has(n))) return [];
  return [advice(at(p, s), `names a ${CAPABILITY} blocker and still commits every layer to \`required\` — either a layer it cannot check should say \`unverifiable\` with that reason, or the blocker is resolved and should go`)];
}

const committed = (s) => Object.values(s?.expect ?? {}).map((e) => e?.need).filter(filled);
