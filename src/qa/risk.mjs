// Which scenarios to run when there is not room for all of them -- and what is
// left unproven when that happens.
//
// The scoring is deliberately unclever. Five factors, each 1-5, added up, and
// the answer is reported as "14 of a possible 20, from 4 of 5 factors". No
// weights, no decimals, no normalising a missing factor to the mean: a score
// that looks precise about data nobody supplied is worse than no score, because
// it ends arguments it should be starting. What is MISSING travels with the
// number, the way every learning family has to report what it could not compute.
//
// Selection is the same idea applied to time. A `must` scenario that does not
// fit is a SHORTFALL -- named, with the risk left on the table. Nothing is
// quietly demoted to make a budget balance, because the demotion is exactly the
// decision a person needs to make.
import { PRIORITIES } from "./vocab.mjs";

export const FACTORS = [
  { name: "impact", say: "what it costs the business to get this wrong" },
  { name: "likelihood", say: "how likely it is to be wrong" },
  { name: "usage", say: "how often this path is really used" },
  { name: "blast", say: "how much of the change touches it" },
  { name: "history", say: "how often this area has broken before" },
];

const MAX = 5;

// Bands are over the SHARE of what was actually scored, so a scenario graded on
// two factors is banded against two -- never against five it never claimed.
const BANDS = [
  { band: "P1", from: 0.7 },
  { band: "P2", from: 0.4 },
  { band: "P3", from: 0 },
];

export function scoreOf(risk) {
  const given = FACTORS.filter((f) => Number.isInteger(risk?.[f.name]));
  const total = given.reduce((n, f) => n + risk[f.name], 0);
  const of = given.length * MAX;
  return { total, of, given: given.map((f) => f.name), missing: FACTORS.filter((f) => !given.includes(f)).map((f) => f.name), band: bandOf(total, of), because: risk?.because ?? "" };
}

const bandOf = (total, of) => (of > 0 ? BANDS.find((b) => total / of >= b.from).band : null);

// Where the numbers and the declared priority disagree. Not an error -- a person
// is allowed to overrule a score, and `because` is where they say why. Silence
// is the only thing worth a word.
export function disagreements(scenarios) {
  const judged = scenarios.map((s) => ({ s, score: scoreOf(s.risk) }));
  const odd = judged.filter(({ s, score }) => score.band && s.priority && score.band !== s.priority);
  return odd.filter(({ s }) => !said(s)).map(({ s, score }) => ({ id: s.id, priority: s.priority, band: score.band, score }));
}

const said = (s) => typeof s.because === "string" && s.because.trim().length > 0;

const RANK = (s) => PRIORITIES.indexOf(s.priority ?? "P3");

// must first, then priority, then the risk score, then the id so two runs of
// this produce the same list. No score breaks a tie the keys already settled.
export const ORDER_IS = "must, then priority, then risk score, then id — the keys are the reason, so a reader can check the order";

export function ranked(scenarios) {
  const keys = (s) => [s.must === true ? 0 : 1, RANK(s) < 0 ? PRIORITIES.length : RANK(s), -scoreOf(s.risk).total, s.id];
  return [...scenarios].sort((a, b) => compare(keys(a), keys(b)));
}

const compare = (a, b) => a.map((v, i) => (v < b[i] ? -1 : v > b[i] ? 1 : 0)).find(Boolean) ?? 0;

// A profile is a name the team uses (smoke, regression, release); a scenario
// carrying none belongs to every one of them, and a `must` is always in.
export function inProfile(s, profile) {
  if (!profile) return true;
  const named = (s.profiles ?? []).filter((v) => typeof v === "string");
  return s.must === true || !named.length || named.includes(profile);
}

export function select(scenarios, opts = {}) {
  const all = ranked(scenarios);
  const eligible = all.filter((s) => inProfile(s, opts.profile));
  const musts = eligible.filter((s) => s.must === true);
  const spentByMusts = musts.reduce((n, s) => n + minutes(s), 0);
  return finish(opts, musts, fill(eligible.filter((s) => s.must !== true), left(opts, spentByMusts)), spentByMusts, all.filter((s) => !inProfile(s, opts.profile)));
}

const minutes = (s) => (Number.isInteger(s.estimate?.minutes) ? s.estimate.minutes : 0);

const left = (opts, spent) => (Number.isInteger(opts.minutes) ? opts.minutes - spent : null);

// With no budget, everything eligible is chosen and nothing is a shortfall. With
// one, scenarios are taken in order until it runs out; anything whose cost is
// unknown is OFFERED rather than assumed free -- an estimate with no basis was
// never allowed into the plan, so it must not be invented here either.
function fill(rest, budget) {
  if (budget === null) return { chosen: rest, over: [], unknown: [] };
  const unknown = rest.filter((s) => !minutes(s));
  return take(rest.filter((s) => minutes(s)), budget, unknown);
}

function take(costed, budget, unknown) {
  const filled = costed.reduce((acc, s) => afford(acc, s, budget), { chosen: [], spent: 0 });
  return { chosen: filled.chosen, over: costed.filter((s) => !filled.chosen.includes(s)), unknown };
}

const afford = (acc, s, budget) => (acc.spent + minutes(s) <= budget ? { chosen: [...acc.chosen, s], spent: acc.spent + minutes(s) } : acc);

function finish(opts, musts, filled, spentByMusts, outOfProfile) {
  const spent = spentByMusts + filled.chosen.reduce((n, s) => n + minutes(s), 0);
  const shortfall = Number.isInteger(opts.minutes) && spentByMusts > opts.minutes ? musts : [];
  return { profile: opts.profile ?? null, budget: opts.minutes ?? null, chosen: [...musts, ...filled.chosen], spent, shortfall, over: filled.over, unknown: filled.unknown, outOfProfile, residual: residual(filled, shortfall, outOfProfile) };
}

// What is NOT being run, said as risk rather than as a list of ids -- and a
// scenario left out by the PROFILE counts, because choosing a profile is a
// decision about risk exactly as choosing a budget is. A selection that showed
// only what it picked would make both decisions invisible.
function residual(filled, shortfall, outOfProfile) {
  const said = (s, why) => ({ id: s.id, name: s.name ?? "", priority: s.priority ?? "", why: why ?? s.why ?? "", score: scoreOf(s.risk) });
  const left = [...filled.over.map((s) => said(s, budgetWhy(s))), ...filled.unknown.map((s) => said(s, "no estimate, so nothing could budget it")), ...outOfProfile.map((s) => said(s, profileWhy(s)))];
  return { left, musts: shortfall.map((s) => ({ id: s.id, name: s.name ?? "", minutes: minutes(s) })) };
}

const budgetWhy = (s) => `${minutes(s)} min did not fit in what was left${s.why ? ` — ${s.why}` : ""}`;

const profileWhy = (s) => `not in this profile (it is in ${(s.profiles ?? []).join(", ") || "none"})${s.why ? ` — ${s.why}` : ""}`;
