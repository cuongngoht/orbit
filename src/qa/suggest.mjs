// What the lessons have to say about a plan -- as SUGGESTIONS, with where each
// one came from.
//
// A lesson is evidence from past runs. It may legitimately propose a new
// regression scenario, a boundary nobody thought of, a look at the data setup
// behind a flaky case, or a revised estimate. It may never do any of these:
//
//   * rewrite an acceptance criterion. The criteria come from whoever owns the
//     feature; a lesson is an observation about the product as built, and the
//     two are different kinds of statement. Letting one become the other is how
//     a suite ends up certifying the bug.
//   * change an expected result so a test passes.
//   * remove a scenario that is failing.
//
// That is enforced the way src/learn/recommend.mjs enforces it: there is no
// recipe here that can produce one, and the same prose backstop runs over what
// comes out. Every suggestion carries its lesson id, its confidence and the
// sentence the lesson gave -- so a reader can go and check it.
import { brokenRule } from "../learn/forbidden.mjs";
import { quote } from "../quote.mjs";
import { scenariosOf } from "./rules/common.mjs";

// One recipe per lesson family, keyed by family and never by case name.
const RECIPES = {
  failures: { kind: "regression scenario", say: (l) => `add a regression scenario for what ${subject(l)} keeps failing on, so the next fix has something to prove itself against` },
  recovery: { kind: "review the setup", say: (l) => `${subject(l)} does not give one answer — review its preconditions and its test data before trusting either verdict` },
  timing: { kind: "revise the estimate", say: (l) => `${subject(l)} got slower; if the plan estimates it, the estimate is out of date` },
  drift: { kind: "re-read the map", say: (l) => `${subject(l)} has moved — re-read the scenarios that drive it before running them again` },
  notes: { kind: "fold into preconditions", say: (l) => `people keep writing the same thing about ${subject(l)} — put it in the preconditions where a case author will meet it` },
};

const subject = (l) => String(l.about ?? "this").replace(/^case:/, "").replace(/^screen:/, "");

export function suggestionsFrom(lessons, plan, opts = {}) {
  const usable = (lessons ?? []).filter((l) => RECIPES[l.family] && l.state !== "rejected" && l.state !== "superseded");
  return usable.map((l) => shaped(l, plan, opts)).filter((s) => !s.refused);
}

function shaped(l, plan, opts) {
  const recipe = RECIPES[l.family];
  const says = recipe.say(l);
  return { id: `plan-suggestion--${l.id}`, kind: recipe.kind, says, scenarios: touched(l, plan), source: l.id, confidence: l.state ?? "candidate", sessions: l.sessions ?? 0, because: quote(l.because ?? ""), evidence: quote(l.statement ?? ""), onlyWhen: l.applies ?? [], ...refusal(says, opts) };
}

// The backstop, and honest about being one: it is a regex over English, so it
// catches the tool talking itself into a forbidden change and is not a boundary.
// The boundary is that no recipe above can emit one.
function refusal(says, opts) {
  const broke = brokenRule(says);
  if (!broke) return { refused: false };
  return { refused: true, refusedBy: broke.rule, refusedWhy: broke.why, quiet: opts.quiet === true };
}

// Which scenarios a lesson is ABOUT, matched through the same key vocabulary the
// notes and the lessons already use -- a case id, a screen id, an edge.
function touched(l, plan) {
  const want = subject(l).toLowerCase();
  return scenariosOf(plan ?? {}).filter((s) => mentions(s, want)).map((s) => s.id);
}

function mentions(s, want) {
  const ids = (s.cases ?? []).map((l) => String(l?.id ?? "").toLowerCase());
  const edges = [s.mutation?.effect, ...(s.intent ?? [])].map((v) => String(v ?? "").toLowerCase());
  return ids.includes(want) || edges.some((e) => e.includes(want));
}
