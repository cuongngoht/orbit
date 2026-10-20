// Rules a shape cannot express: what a step must be FOLLOWED by, and what its
// own values must look like. A field's type, enum and range are declared in
// fields.mjs and enforced by constraints.mjs, so `status` and `method` are not
// re-checked here -- and `method` is no longer accepted in lowercase, which the
// hand-written rule allowed while the published schema never did.
import { readOnlyProblem, unquotedPlaceholders } from "./common.mjs";

export function semanticFindings(c, st, i, next) {
  const at = `${c.id} step ${i + 1} (${st.do})`;
  return [...clickFindings(at, st, next), ...apiFindings(at, st), ...sqlFindings(at, st)];
}

// A click whose landing is not asserted is the swallowed-click trap: the next
// step runs against the previous screen and fails somewhere that reads like a
// product defect.
const clickFindings = (at, st, next) => (st.do === "click" && !st.wait && next?.do !== "wait" ? [`${at}: click with no wait after it`] : []);

// "is a valid regex" is not a JSON-Schema keyword, so it stays a rule.
const apiFindings = (at, st) => (st.do === "api" ? regexOf(at, st.match) : []);

function regexOf(at, match) {
  if (typeof match !== "string") return [];
  try { new RegExp(match); return []; } catch (e) { return [`${at}: api match is not a valid regex — ${e.message}`]; }
}

function sqlFindings(at, st) {
  if (st.do !== "sql" || typeof st.query !== "string") return [];
  return [...readOnly(at, st.query), ...quoted(at, st.query)];
}

const readOnly = (at, query) => (readOnlyProblem(query) ? [`${at}: sql ${readOnlyProblem(query)}`] : []);

// A ${PARAM} outside a quoted value changes the STATEMENT rather than the
// question, and no amount of escaping helps once it is loose in the syntax.
const quoted = (at, query) => unquotedPlaceholders(query).map((p) => `${at}: \${${p}} is not inside a quoted value — write '\${${p}}'`);
