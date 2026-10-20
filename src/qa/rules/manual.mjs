// A manual check is work somebody has to DO, so it is written as work: who,
// what they do, what they must see, and what they bring back.
//
// The failure mode this family exists for is the line "check the queue manually"
// at the bottom of a plan. Nobody owns it, nobody knows what right looks like,
// and at sign-off it is read as covered because it is written down.
import { error } from "../finding.mjs";
import { at, checksOf, filled, listed, needs, needsListed } from "./common.mjs";

export const UNASSIGNED = "unassigned";

const SAID = { because: "why it is not automated", expect: "what the person must see" };
const STEPS = { steps: "what the person does, in order" };

export const manualFindings = (p) => checksOf(p).flatMap((m) => oneCheck(p, m));

const oneCheck = (p, m) => [...saidFindings(p, m), ...ownerFindings(p, m), ...stateFindings(p, m)];

function saidFindings(p, m) {
  const say = (what) => error(at(p, m), `is a manual check that does not say ${what}`);
  return [...needs(m, SAID, say), ...needsListed(m, STEPS, say)];
}

// `unassigned` is a legitimate answer and an empty field is not: one says nobody
// has been asked yet, the other leaves a reader to assume somebody has.
const ownerFindings = (p, m) => (filled(m.owner) ? [] : [error(at(p, m), `names nobody to do it — a person, a team, or the word "${UNASSIGNED}"`)]);

// The claim half. "Done" is a statement about work a machine did not watch, so
// it has to arrive with whatever the check said it would bring back.
function stateFindings(p, m) {
  if (m.state === "blocked" && !(m.blockers ?? []).length) return [error(at(p, m), "is blocked by nothing — name the blocker")];
  if (m.state === "done" && !listed(m.evidence)) return [error(at(p, m), "is marked done but carries no evidence — a manual PASS nobody can check is a claim, not a result")];
  return [];
}
