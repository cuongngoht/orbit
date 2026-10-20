// Does a case need a BROWSER PAGE at all? Asked of the vocabulary, never of a
// list of verb names.
//
// A case whose every step is a `sql` or a `call` -- the verbs whose row says
// `pageless` -- asks nothing of a screen. It still went through the session
// gate, still had to end with a `report` evaluated in the page, and on a FAIL
// still asked a browser for a screenshot, the console and the request log. So a
// requirement that lives behind an API or in a database could not be verified
// on a machine with no browser at all. The answer comes in two strengths:
//
//   pageNeedOf   what the CASE shows: a step whose verb is not pageless, any
//                `wait`, an identity (proved from the page's token), a start
//                screen. What the validator can know, with no registry of
//                capabilities in hand -- src/dsl/ never imports src/run/.
//   runNeedOf    what the RUN must provide: the above, and every `call` asking
//                a capability that DECLARED `page: false`. One that declared
//                nothing is taken to need a page: an unstated need read as "none"
//                is a gate skipped on a guess.
//
// Each answer is the first reason that holds, as a sentence, or null.
import { CORE } from "./registry.mjs";

const CASE_NEEDS = [
  (c) => (c.identity ? "it declares an identity, which is proved from the page's own token" : null),
  (c) => (c.start ? `it starts on screen ${c.start}` : null),
];

const STEP_NEEDS = [
  (s, dsl) => (dsl.verbsWhere("pageless").has(s.do) ? null : `step ${s.do} reads or drives the page`),
  (s) => (s.wait ? `step ${s.do} waits on the page` : null),
];

export function pageNeedOf(c, dsl = CORE) {
  const steps = (c?.steps ?? []).flatMap((s) => STEP_NEEDS.map((f) => f(s, dsl)));
  return [...CASE_NEEDS.map((f) => f(c ?? {})), ...steps].find(Boolean) ?? null;
}

// Pageless by what the case itself says -- what validation may rely on.
export const pagelessByVerbs = (c, dsl = CORE) => (c?.steps ?? []).length > 0 && pageNeedOf(c, dsl) === null;

// pageOf(id): what a registered capability declared about the page -- `false`
// for "never touches it", anything else for "may".
export function runNeedOf(c, dsl, pageOf = () => undefined) {
  const byCase = pageNeedOf(c, dsl);
  if (byCase) return byCase;
  const undeclared = [...new Set((c?.steps ?? []).filter((s) => s.capability && pageOf(s.capability) !== false).map((s) => s.capability))];
  return undeclared.length ? `capability ${undeclared.join(", ")} did not declare page: false` : null;
}

export const needsPage = (c, dsl, pageOf) => runNeedOf(c, dsl, pageOf) !== null;
