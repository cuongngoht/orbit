// A prompt, reduced to what a routing table can be matched against -- in THIS
// process's memory, and never kept.
//
// A TERM is a run of letters and digits in any script (so Vietnamese, with its
// composed vowels, tokenises as itself), allowed to carry the punctuation a
// technology's name does: `.net`, `asp.net`, `c#`, `t-sql`. A GRAM is one to
// three consecutive terms joined by a space, which is what lets a table say
// "pull request" or "how does" and still be a Set lookup.
//
// Bounded: only the first TEXT_LIMIT characters are read, because a prompt can
// carry a pasted file and routing has to cost the same on every one of them.
export const TEXT_LIMIT = 20000;
export const GRAM_LIMIT = 3;

const TERM = /\.?[\p{L}\p{N}][\p{L}\p{N}.#+_-]*/gu;

export function termsOf(text) {
  const found = String(text ?? "").slice(0, TEXT_LIMIT).normalize("NFC").toLowerCase().match(TERM) ?? [];
  return found.map((t) => t.replace(/[._-]+$/, "")).filter(Boolean);
}

// How a table entry is spelled once normalised -- the same reduction, so a cue
// written "Pull Request" matches a prompt that says "pull request".
export const keyOf = (phrase) => termsOf(phrase).join(" ");

export function gramsOf(text) {
  const terms = termsOf(text);
  const grams = new Set();
  terms.forEach((_, at) => added(grams, terms, at));
  return grams;
}

function added(grams, terms, at) {
  for (let n = 1; n <= GRAM_LIMIT && at + n <= terms.length; n++) grams.add(terms.slice(at, at + n).join(" "));
}

export const mentions = (grams, phrase) => grams.has(keyOf(phrase));
