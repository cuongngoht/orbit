// What a piece of text is ASKING ABOUT, reduced to tokens -- a LEAF, because
// architecture (`ensure --for`) and engineering (`recall --for`) both ask it,
// and neither may import the other for it.
//
// Tokenising is also the SANITISER, and that is deliberate rather than lucky. A
// token is `[a-z0-9]+` by construction, so storing one cannot open a heading, a
// link or a code fence in whatever reads it next, and it cannot carry a
// secret's punctuation either. The raw text is never stored anywhere.
//
// Words that carry no subject. Kept deliberately small: the risk of a long list
// is dropping the one word that WAS the question.
export const STOPWORDS = new Set("a an the is are was were be been it its this that of on in to for and or not no at by with from as but than then so if when we our you your can could should would need needs using use via through into out about all any each every some".split(" "));

export const MIN_LENGTH = 3;

export function tokens(text) {
  const words = String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set(words.filter((w) => w.length >= MIN_LENGTH && !STOPWORDS.has(w)))];
}

