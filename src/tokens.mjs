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

// An IDENTIFIER says its words joined -- `createOrder`, `HTTPServer`, `order_items` -- so it is split where a
// lower-case letter or a digit meets a capital, and where a run of capitals meets a capitalised word, BEFORE it is
// lowered: `createOrder` asks about "create" and "order", the way "create order" does (0.5.0, B21). No language is
// parsed: the split is about how a name is spelled, never about what a file of code means.
export const splitIdentifiers = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

export const identifierTokens = (text) => tokens(splitIdentifiers(text));

