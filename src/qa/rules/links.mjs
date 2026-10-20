// Where the plan meets the cases: a link has to point at a file that exists, a
// claim about that file has to be true, and the case has to be ABLE to do what
// the scenario committed to.
//
// The last one is the point of the family. A scenario that says "the row must
// exist after the reload" and links a case whose only verdict is an assert on
// the screen is not covered -- and every report built from the link would say it
// was. Which layers a case can rule on is read off its steps through the VERB
// table, so this file names no verb and cannot fall behind a new one.
import { provedBy, verbsWhere } from "../../dsl/verbs.mjs";
import { commitments, provenBy } from "../commit.mjs";
import { canVerify } from "../capability.mjs";
import { advice, error } from "../finding.mjs";
import { LINK_STATE, techniquesWhere } from "../vocab.mjs";
import { at, checksOf, filled, scenariosOf } from "./common.mjs";

const CHANGES = verbsWhere("changes");
const ASKS_REPEAT = techniquesWhere("asks", "repeat");

export const linkFindings = (p, world) => scenariosOf(p).flatMap((s) => oneScenario(p, s, world));

function oneScenario(p, s, world) {
  const links = (s.cases ?? []).filter((l) => filled(l?.id));
  const found = links.map((l) => ({ link: l, c: world?.cases?.get(l.id) ?? null }));
  return [...missingFindings(p, s, found), ...claimFindings(p, s, found, world), ...verdictFindings(p, s, found, world), ...repeatFindings(p, s, found)];
}

const missingFindings = (p, s, found) => found.filter((f) => !f.c).map((f) => error(at(p, s), `links case ${f.link.id}, which no screen folder holds — write it, or correct the link`));

// A link is a CLAIM about a file. `validated` means `query check` is clean about
// that case, and a link saying so while the case has findings is the kind of
// green nobody earned.
function claimFindings(p, s, found, world) {
  const claims = found.filter((f) => f.c && LINK_STATE.get(f.link.state)?.validated);
  const broken = claims.map((f) => ({ ...f, problems: world.validate(f.c) })).filter((f) => f.problems.length);
  return broken.map((f) => error(at(p, s), `says ${f.link.id} is ${f.link.state}, but it does not validate — ${f.problems[0]}`));
}

function verdictFindings(p, s, found, world) {
  const able = new Set(found.flatMap((f) => [...provenBy(f.c?.steps, provedBy)]));
  const handed = handedOver(p, s);
  return commitments(s).flatMap((c) => oneVerdict(p, s, c, found, world, handed || able.has(c.layer)));
}

// Two different sentences, because they need two different fixes: a project with
// no way to read a layer has a capability gap to record, and a case that simply
// does not ask is a case to finish.
//
// A scenario with NO case yet is neither. A plan is written before the cases
// are, and reporting every unwritten one as a violation would make plan-check
// something to run only at the end -- which is the one time it is no use.
// Coverage reports that scenario as `designed`, which is what it is.
function oneVerdict(p, s, c, found, world, covered) {
  const says = `commits to ${c.layer} in ${c.from} — "${c.says}"`;
  if (!canVerify(world?.caps, c.layer)) return [advice(at(p, s), `${says} — but ${world.caps[c.layer].because}. A case can carry the step and still be BLOCKED here; record it as unverifiable with that reason, or give the project the tool`)];
  if (covered || !found.length) return [];
  return [error(at(p, s), `${says} — but ${cases(found)} rules on ${c.layer} nowhere. A link is not coverage`)];
}

const cases = (found) => found.map((f) => f.link.id).join(", ");

// A scenario may legitimately hand a layer to a person instead. The check has
// already been held to having an expected result by rules/manual.mjs.
function handedOver(p, s) {
  const ids = new Set((s.checks ?? []).filter((v) => typeof v === "string"));
  return checksOf(p).some((m) => ids.has(m.id) && filled(m.expect));
}

// The idempotency trap, read off the case rather than believed from the plan: a
// case whose guard fires SKIPS, and a SKIP verifies nothing. The second attempt
// has to be in the steps -- the same changing control driven twice, or once with
// `times`.
function repeatFindings(p, s, found) {
  if (!ASKS_REPEAT.has(s.technique)) return [];
  const weak = found.filter((f) => f.c && !attemptsTwice(f.c.steps));
  return weak.map((f) => error(at(p, s), `links ${f.link.id}, which performs its action once. ${guarded(f.c) ? "Its skip-if guard protects the re-RUN and makes the second attempt SKIP — a SKIP verifies nothing" : "An idempotency scenario has to do it again"}`));
}

const guarded = (c) => (c.steps ?? []).some((st) => st.do === "skip-if");

function attemptsTwice(steps) {
  const acts = (steps ?? []).filter((st) => CHANGES.has(st.do));
  const repeated = acts.some((st) => (st.times ?? 1) > 1);
  return repeated || duplicated(acts);
}

const duplicated = (acts) => acts.some((st, i) => acts.slice(i + 1).some((other) => keyOf(other) === keyOf(st)));

const keyOf = (st) => `${st.do}:${st.on ?? st.selector ?? st.key ?? ""}`;
