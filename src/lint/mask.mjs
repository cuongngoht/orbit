// Blank out everything that is not code -- comments, strings, templates, regex
// literals -- keeping newlines and length, so brace matching and word lookup
// can run over the result without a parser. Heuristic by design: it is a
// structural lint for our own one-statement-per-line style, not a compiler.
const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]$|^\s*$|\b(return|typeof|case|in|of)$/;

export function mask(text) {
  const out = text.split("");
  const state = { i: 0, text, out };
  while (state.i < text.length) step(state);
  return out.join("");
}

// Each scanner answers "where does the non-code region starting here end?",
// or -1 when this position does not start one.
const SCANNERS = [
  (s, c, n) => (c === "/" && n === "/" ? closing(s.text, s.i, "\n") : -1),
  (s, c, n) => (c === "/" && n === "*" ? closing(s.text, s.i + 2, "*/") + 2 : -1),
  (s, c) => (c === '"' || c === "'" ? quoteEnd(s.text, s.i, c) + 1 : -1),
  (s, c) => (c === "`" ? templateEnd(s.text, s.i) + 1 : -1),
  (s, c) => (c === "/" && regexStarts(s) ? regexEnd(s.text, s.i) + 1 : -1),
];

function step(s) {
  const c = s.text[s.i], n = s.text[s.i + 1];
  const end = SCANNERS.map((f) => f(s, c, n)).find((e) => e !== -1);
  if (end === undefined) return s.i++;
  blank(s, end);
}

// Replace [from, to) with spaces, newlines kept.
function blank(s, to) {
  const end = Math.min(to, s.text.length);
  for (let k = s.i; k < end; k++) if (s.out[k] !== "\n") s.out[k] = " ";
  s.i = Math.max(end, s.i + 1);
}

const closing = (text, from, needle) => { const k = text.indexOf(needle, from); return k < 0 ? text.length : k; };

function quoteEnd(text, from, q) {
  for (let k = from + 1; k < text.length; k++) {
    if (text[k] === "\\") { k++; continue; }
    if (text[k] === q || text[k] === "\n") return k;
  }
  return text.length;
}

// Whole template including ${...} expressions: expressions inside a template are
// treated as text here, which only ever hides code, never invents a function.
function templateEnd(text, from) {
  let depth = 0;
  for (let k = from + 1; k < text.length; k++) {
    if (text[k] === "\\") { k++; continue; }
    depth = templateDepth(text, k, depth);
    if (text[k] === "`" && depth === 0) return k;
  }
  return text.length;
}

function templateDepth(text, k, depth) {
  if (text[k] === "$" && text[k + 1] === "{") return depth + 1;
  return text[k] === "}" && depth > 0 ? depth - 1 : depth;
}

function regexStarts(s) {
  const before = s.out.slice(Math.max(0, s.i - 40), s.i).join("").replace(/\s+$/, "");
  return REGEX_BEFORE.test(before.slice(-12)) || before === "";
}

function regexEnd(text, from) {
  let inClass = false;
  for (let k = from + 1; k < text.length; k++) {
    if (text[k] === "\\") { k++; continue; }
    if (text[k] === "\n") return k - 1;
    inClass = text[k] === "[" ? true : text[k] === "]" ? false : inClass;
    if (text[k] === "/" && !inClass) return flagsEnd(text, k);
  }
  return text.length;
}

const flagsEnd = (text, k) => { let e = k; while (/[a-z]/.test(text[e + 1] ?? "")) e++; return e; };
