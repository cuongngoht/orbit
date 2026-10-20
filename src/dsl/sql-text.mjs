// What can be told about a SQL string WITHOUT a database and without knowing a
// dialect: is it one statement, does it start with SELECT or WITH, and does it
// contain a word that writes.
//
// Three levels, and only the third is a guarantee:
//
//   this file    refuses the shapes it can recognise -- at `check` time, and
//                again after ${PARAM} interpolation, so no value can turn a
//                SELECT into two statements at run time
//   the adapter  re-checks, because it is also run by hand and by agents and it
//                is the half that holds the credential; it may add what it knows
//                about ITS OWN vendor, which the engine must not learn
//   the login    db_datareader and nothing else
//
// A regex protects against a mistake. A read-only principal protects against
// everything, and it is the only thing here that is a security control.
//
// Masking is lexical, not dialectal, which is why it lives in the engine. The
// list of vendor words does not.
import { PLACEHOLDER } from "./interpolate.mjs";

// Where a region that is NOT code begins, and how to find its end. One table, so
// a dialect's quoting style is a row rather than a branch.
const OPENERS = [
  { open: "'", close: (s, i) => endOfLiteral(s, i) },
  { open: '"', close: (s, i) => endOfDelimited(s, i, '"') },
  { open: "[", close: (s, i) => endOfDelimited(s, i, "]") },
  { open: "`", close: (s, i) => endOfDelimited(s, i, "`") },
  { open: "--", close: (s, i) => endOfLine(s, i) },
  { open: "/*", close: (s, i) => endOfBlock(s, i) },
];

// Every non-code region blanked, keeping its LENGTH -- so a ${PARAM}'s position
// still means something, which is what unquotedPlaceholders reads.
export function maskSql(sql) {
  const s = String(sql ?? "");
  const out = [...s];
  for (const [from, to] of regions(s)) for (let i = from; i < to; i++) out[i] = " ";
  return out.join("");
}

// ONE left-to-right pass, because no chain of regexes can decide whether a `--`
// sits inside a literal or an apostrophe sits inside a comment.
function regions(s) {
  const out = [];
  let i = 0;
  while (i < s.length) i = region(s, i, out);
  return out;
}

function region(s, i, out) {
  const hit = OPENERS.find((o) => s.startsWith(o.open, i));
  if (!hit) return i + 1;
  const end = hit.close(s, i);
  out.push([i, end]);
  return end;
}

// '' is an escaped quote INSIDE a literal, not the end of one.
function endOfLiteral(s, i) {
  let j = i + 1;
  while (j < s.length && !closes(s, j)) j += s[j] === "'" ? 2 : 1;
  return Math.min(j + 1, s.length);
}

const closes = (s, j) => s[j] === "'" && s[j + 1] !== "'";

const endOfDelimited = (s, i, close) => at(s.indexOf(close, i + 1), s, 1);
const endOfLine = (s, i) => at(s.indexOf("\n", i), s, 0);
const endOfBlock = (s, i) => at(s.indexOf("*/", i + 2), s, 2);
const at = (found, s, width) => (found < 0 ? s.length : found + width);

const STARTS = /^\s*(SELECT|WITH)\b/i;
const WRITES = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|REPLACE|UPSERT)\b/i;
const INTO = /\bINTO\b/i;

export const statements = (masked) => masked.split(";").map((t) => t.trim()).filter(Boolean);

// A problem in words, or null. The prefix test alone used to pass all three of
// `SELECT 1; DROP TABLE x`, `WITH x AS (...) DELETE FROM y` and `SELECT * INTO z`.
export function readOnlyProblem(sql) {
  const masked = maskSql(sql);
  if (!STARTS.test(masked)) return "must be a read-only SELECT or WITH";
  if (statements(masked).length > 1) return "must be ONE statement — there is a ; with more after it";
  return writeProblem(masked);
}

function writeProblem(masked) {
  const write = WRITES.exec(masked);
  if (write) return `contains ${write[1].toUpperCase()}, which writes`;
  return INTO.test(masked) ? "contains INTO, which creates a table" : null;
}

// A ${PARAM} spliced OUTSIDE a quoted value changes the STATEMENT rather than
// the question: `WHERE Id = ${ID}` with ID = "1 OR 1=1" asks something else
// entirely. Inside a literal, doubling the quote (escape.mjs) keeps it one value
// -- which is escaping, not binding, and the README says so.
export function unquotedPlaceholders(sql) {
  const masked = maskSql(sql);
  const found = [...String(sql ?? "").matchAll(PLACEHOLDER)];
  return [...new Set(found.filter((m) => !blanked(masked, m)).map((m) => m[1]))];
}

const blanked = (masked, m) => masked.slice(m.index, m.index + m[0].length).trim() === "";
