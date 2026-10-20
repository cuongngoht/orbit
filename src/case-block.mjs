// The CASE BLOCK: how a case's own JSON is written into a report, and read back
// out of one. A LEAF, for the reason src/hash.mjs and src/quote.mjs are leaves --
// two branches need it and neither may import the other.
//
// src/report/ writes the block. src/dsl/ reads it, because a report is the last
// copy of a case once the file is gone: deleted, rewritten, or simply on
// somebody else's machine. The report is the artefact that travels and the one
// thing that is never pruned, so "can you run that again?" is answered by what
// is already attached to the ticket -- `run-case <that-report.html>`.
//
// The escaping table lives here rather than in the template because the reader
// needs the exact inverse of what the writer did. Two copies of four entities
// is two copies that can drift, and the drift would show up as a case that
// parses but is subtly not the case that ran.
//
// ONE block in the page, not two. A hidden <script type="application/json">
// beside the visible <pre> would be a second source able to disagree with the
// first, invisibly. So the block a person reads IS the block this parses.

export const CASE_ID = "orbit-case";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ESCAPES[c]);

// One pass over the inverse declaration: decoded text is never scanned again,
// so `&amp;lt;` comes back as `&lt;`, not `<`.
const BACK = Object.fromEntries(Object.entries(ESCAPES).map(([from, to]) => [to, from]));
const ENTITY = new RegExp(Object.keys(BACK).join("|"), "g");

export const unesc = (s) => String(s ?? "").replace(ENTITY, (entity) => BACK[entity]);

const BLOCK = new RegExp(`<pre id="${CASE_ID}">([\\s\\S]*?)</pre>`);

// Pure: the caller reads the file. `_broken` rather than a throw, so a report
// made before reports carried a case becomes a sentence and not a stack trace.
export function caseInPage(html, file) {
  const found = BLOCK.exec(String(html ?? ""));
  if (!found) return { _file: file, _broken: "holds no Orbit case block" };
  return parsed(unesc(found[1]), file);
}

function parsed(text, file) {
  try { return objectCase(JSON.parse(text), file); }
  catch (e) { return { _file: file, _broken: `has a case block that is not valid JSON: ${e.message}` }; }
}

function objectCase(value, file) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { _file: file, _broken: "has a case block that is not a JSON object" };
  return { ...value, _file: file };
}
