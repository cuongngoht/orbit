// Five Lines of Code, checked structurally over .mjs sources:
//   rule 1  a function body has at most `limit` statements (default 5); 30 is a hard ceiling
//   rule 4  no `else`
//   rule 5  no `switch`
// A statement is a line that starts at the body's own depth, outside any open
// paren/bracket, and is not a continuation (`.foo()`, `? :`, `&&`, `)`, `}`).
// One-statement-per-line is what makes the count exact; that is the style
// this engine is written in.
import { functionBodies } from "./functions.mjs";
import { mask } from "./mask.mjs";

const CONTINUATION = /^(\}|\)|\]|\.|\?\.|\?|:|&&|\|\||\?\?|[+\-*/%]=?\s|,|=>)/;
const KEYWORD = { else: /^\s*\}?\s*else\b/, switch: /^\s*switch\s*\(/ };

export function lintText(text, file, limit = 5, ceiling = 30) {
  const masked = mask(text);
  const lines = lineStarts(masked);
  return functionBodies(masked).flatMap((b) => judge(masked, lines, b, file, limit, ceiling));
}

function lineStarts(masked) {
  const starts = [0];
  for (let i = 0; i < masked.length; i++) if (masked[i] === "\n") starts.push(i + 1);
  return starts;
}

function judge(masked, lines, body, file, limit, ceiling) {
  const inside = lines.filter((s) => s > body.start && s < body.end).map((s) => ({ at: s, text: lineText(masked, s) }));
  const count = inside.reduce((n, l) => n + statementsOn(masked, body, l), 0);
  const line = lineNumber(lines, body.start);
  return [...countFindings(file, line, body.name, count, limit, ceiling), ...keywordFindings(file, lines, body.name, inside)];
}

const lineText = (masked, s) => masked.slice(s, masked.indexOf("\n", s) < 0 ? masked.length : masked.indexOf("\n", s));
const lineNumber = (lines, pos) => lines.filter((s) => s <= pos).length;

// 0 for a blank, continuation or nested line; otherwise the number of
// `;`-terminated statements the line holds at the body's own depth (so
// `a(); b();` on one line counts as 2 -- a line is not a statement).
function statementsOn(masked, body, l) {
  const t = l.text.trim();
  if (!t || CONTINUATION.test(t)) return 0;
  const first = l.at + l.text.indexOf(t[0]);
  const d = depthBetween(masked, body.start + 1, first);
  return d.brace === 0 && d.paren === 0 && d.bracket === 0 ? Math.max(1, semicolons(masked, first, l.at + l.text.length)) : 0;
}

function semicolons(masked, from, to) {
  const d = { brace: 0, paren: 0, bracket: 0 };
  let n = 0;
  for (let k = from; k < to; k++) { bump(d, masked[k]); n += masked[k] === ";" && d.brace === 0 && d.paren === 0 && d.bracket === 0 ? 1 : 0; }
  return n;
}

function depthBetween(masked, from, to) {
  const d = { brace: 0, paren: 0, bracket: 0 };
  for (let k = from; k < to; k++) bump(d, masked[k]);
  return d;
}

const DELTA = { "{": ["brace", 1], "}": ["brace", -1], "(": ["paren", 1], ")": ["paren", -1], "[": ["bracket", 1], "]": ["bracket", -1] };
function bump(d, c) {
  const hit = DELTA[c];
  if (hit) d[hit[0]] += hit[1];
}

function countFindings(file, line, name, count, limit, ceiling) {
  if (count > ceiling) return [{ file, line, name, rule: 1, level: "error", message: `${count} statements — above the ${ceiling}-line hard ceiling` }];
  if (count > limit) return [{ file, line, name, rule: 1, level: "warn", message: `${count} statements — Five Lines says ≤ ${limit}` }];
  return [];
}

function keywordFindings(file, lines, name, inside) {
  return inside.flatMap((l) => Object.entries(KEYWORD).filter(([, re]) => re.test(l.text)).map(([kw]) => ({ file, line: lineNumber(lines, l.at), name, rule: kw === "else" ? 4 : 5, level: "error", message: `uses \`${kw}\`` })));
}
