// What a task is ASKING ABOUT, reduced to tokens.
//
// This is how a capability question reaches the engine without the engine ever
// holding a list of capability names. `--for="verify the file through Acme
// Vault"` becomes `["verify", "file", "through", "acme", "vault"]` minus the
// words that mean nothing, and the scan looks for those. A row in a table here
// naming any real one would be this engine learning a product, which is the one
// thing it must not do -- hence the invented example, in a comment as much as
// anywhere else.
//
// Tokenising is also the SANITISER, and that is deliberate rather than lucky. A
// token is `[a-z0-9]+` by construction, so storing one cannot open a heading, a
// link or a code fence in whatever reads the snapshot next. The raw `--for`
// string is never stored anywhere -- it does not need the `quote` door because
// it never gets through this one intact.
//
// Short words go, because `to`, `an` and `db` match everything and settle
// nothing; a two-character token in a path search is noise wearing a verdict.

import { MIN_LENGTH, STOPWORDS, tokens } from "../tokens.mjs";

export { MIN_LENGTH, tokens };

// WHICH of a task's words name a capability, as opposed to describing what the
// task does. Getting this wrong in either direction is expensive: treat every
// word as a capability and `ensure` scans on every call, treat none as one and
// it never notices a missing integration.
//
// The signal is a proper name. "verify the file through Acme Vault" names
// one thing that could be absent from this project, and it is the capitalised
// one; "create a file" names none. That is a fact about how people write these
// sentences, not about any product -- which is exactly why it can live here
// while the name of an actual service never could.
//
// ACTIONS is the second half, and it has a precedent: `MUTATES` in
// src/query/check.mjs is the same kind of list, QA's own verbs rather than any
// stack's nouns. "Verify ..." at the start of a sentence is capitalised for
// grammar, and without this it would read as a capability called `verify`.
//
// When a sentence carries no proper name -- someone typed it in lower case, or
// the capability genuinely has no name -- this returns nothing and `ensure`
// falls through to freshness. `--capability=<name>` is the way to say it
// outright, and the output says so rather than quietly finding nothing.
const ACTIONS = new Set("verify check create open read write delete remove update edit submit confirm assert test run drive click fill wait save add new archive restore assign invite import export sync enable disable activate cover ensure scan record show recall plan design".split(" "));

const PROPER = /^[A-Z][A-Za-z0-9]*$/;

export function capabilityTokens(text) {
  const words = String(text ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return [...new Set(words.filter(named).map((w) => w.toLowerCase()))].filter((t) => !ACTIONS.has(t) && !STOPWORDS.has(t) && t.length >= MIN_LENGTH);
}

const named = (w) => PROPER.test(w) || w === w.toUpperCase();

// Does anything this fact already knows speak to those tokens? Asked of the
// fields that carry a SUBJECT -- the capability name, the key, the scopes --
// never of the statement, which is a sentence and would match on its grammar.
export function covers(fact, wanted) {
  const known = new Set([...tokens(fact.capability ?? ""), ...tokens(fact.key ?? ""), ...(fact.scope ?? []).flatMap(tokens)]);
  return wanted.some((t) => known.has(t));
}

// Which of the asked tokens nothing in the snapshot speaks to. The answer the
// decision table branches on, and the one the output has to echo -- "missing"
// with no list of what was looked for is unfalsifiable.
export const unanswered = (facts, wanted) => wanted.filter((t) => !facts.some((f) => covers(f, [t])));
