// What a fact is ABOUT, as tokens -- the one answer both `ensure --for` and
// `recall --for` ask, so "does anything recorded speak to this task" cannot mean
// two different things in two commands.
//
// Asked of the fields that carry a SUBJECT -- kind, key, scopes, the shared
// shape -- never of the statement, which is a sentence and would match on its
// grammar. src/architecture/tokens.mjs's `covers` draws the same line.
import { tokens } from "../tokens.mjs";

export const subjectTokens = (fact) => new Set([...tokens(fact.kind), ...tokens(fact.key), ...(fact.scope ?? []).flatMap(tokens), ...tokens(fact.pattern ?? "")]);

export const speaks = (fact, wanted) => {
  const known = subjectTokens(fact);
  return wanted.filter((t) => known.has(t));
};

// Which of the asked tokens something recorded speaks to at all.
export const answeredBy = (facts, wanted) => wanted.filter((t) => facts.some((f) => speaks(f, [t]).length > 0));
