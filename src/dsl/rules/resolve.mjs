// `resolve` runs read-only SQL BEFORE the browser and feeds the answers in as
// params, so a case names the SHAPE of its target instead of an id that rots.
//
// `as` being an UPPER_SNAKE name and both fields being present are declared in
// fields.mjs and enforced by constraints.mjs; the shape of `resolve` itself is
// settled by rules/shape.mjs before this file runs.
import { constraintFindings, missingFindings } from "../../constraints.mjs";
import { RESOLVE_FIELDS } from "../fields.mjs";
import { placeholders } from "../interpolate.mjs";
import { readOnlyProblem, unknownFields, unquotedPlaceholders } from "./common.mjs";

const KEYS = new Set(Object.keys(RESOLVE_FIELDS));
const REQUIRED = ["as", "sql"];

export function resolveFindings(c) {
  if (c.resolve === undefined) return [];
  const filled = new Set((c.params ?? []).map((p) => p.n));
  return c.resolve.flatMap((r, i) => oneResolve(r, `${c.id} resolve ${i + 1}`, filled));
}

function oneResolve(r, at, filled) {
  const declared = [...missingFindings(REQUIRED, r, at), ...constraintFindings(RESOLVE_FIELDS, r, at)];
  const order = orderFindings(r, at, filled);
  if (r.as) filled.add(r.as);
  return [...unknownFields(r, KEYS, at), ...declared, ...order, ...sqlOf(r, at)];
}

// The rows run in ORDER and feed each other, so a row may only use what an
// earlier one filled. A forward reference validated clean and then asked the
// database about the literal text `${LATER}`.
const orderFindings = (r, at, filled) =>
  [...new Set(placeholders(r.sql ?? ""))].filter((p) => !filled.has(p)).map((p) => `${at}: uses \${${p}}, which no param and no EARLIER resolve provides`);

function sqlOf(r, at) {
  if (typeof r.sql !== "string") return [];
  const problem = readOnlyProblem(r.sql);
  const bad = problem ? [`${at}: sql ${problem}`] : [];
  return [...bad, ...unquotedPlaceholders(r.sql).map((p) => `${at}: \${${p}} is not inside a quoted value — write '\${${p}}'`)];
}
