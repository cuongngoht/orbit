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

// THE HEAD OUTRANKS THE TAIL (0.5.0, B5): what the person typed comes first, and a log, a file or a report pasted after
// it must not decide what the prompt is about. A cue in the first HEAD_LIMIT characters weighs WEIGHTS.head, one only
// in the rest WEIGHTS.tail (src/routing/classify.mjs): nothing, so a paste never decides the intent, while its words
// still add a refinement and still name a provider (a specification's acceptance criteria may sit past the head).
// Data, so the weight is changed here and nowhere else.
export const HEAD_LIMIT = 2000;
export const WEIGHTS = { head: 1, tail: 0 };

export const headGramsOf = (text) => gramsOf(String(text ?? "").slice(0, HEAD_LIMIT));

// The OPENING: the first words a person typed. A cue that steers the work already under way -- continue it, halt it --
// counts only here (src/routing/intents.mjs MARKS), so "continue" inside a new request is part of that request.
export const OPENING_LIMIT = 80;

export const openingGramsOf = (text) => gramsOf(String(text ?? "").trimStart().slice(0, OPENING_LIMIT));

// A prompt's SHAPE (0.5.0): counts, and never a word of it -- how long it is, how many of its lines read as list items
// (a specification is a list), and how many work-item references its head names.
const LIST_ITEM = /^[ \t]{0,8}(?:[-*•+]|\d{1,3}[.)])[ \t]+\S/gm;

export const shapeOf = (text) => ((t) => ({ chars: t.length, items: (t.slice(0, TEXT_LIMIT).match(LIST_ITEM) ?? []).length, refs: refsOf(t).length }))(String(text ?? ""));

// The work-item references a person named: an upper-case key, a hyphen and a number -- ORD-12, PBI-482 -- read off the
// head only, in this process's memory, for the one lookup of the work tracked under each (src/work/track/open.mjs). A
// standard's name is not an item, so the keys of encodings, digests and protocols are not references.
const REF = /\b[A-Z][A-Z0-9]{1,15}-\d{1,9}\b/g;
const NOT_REFS = ["UTF", "SHA", "MD", "ISO", "RFC", "CVE", "HTTP", "TLS", "SSL", "AES", "RSA", "IPV", "ES"];
export const MAX_REFS = 5;

const itemRef = (ref) => !NOT_REFS.includes(ref.slice(0, ref.indexOf("-")));

export const refsOf = (text) => [...new Set(String(text ?? "").slice(0, HEAD_LIMIT).match(REF) ?? [])].filter(itemRef).slice(0, MAX_REFS);
