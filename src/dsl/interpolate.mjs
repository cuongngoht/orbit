// ${PARAM} substitution, and the detection of a placeholder nobody filled.
//
// An unfilled placeholder must never be silently kept: `WHERE Name = '${NAME}'`
// asks a different question and gets an answer that looks like a result. So
// interpolation leaves an unknown placeholder in place (a --dry run before SQL
// resolve legitimately has some), and the runner refuses to EXECUTE a step
// that still carries one -- see run/step.mjs.

import { encode } from "./escape.mjs";
import { CORE } from "./registry.mjs";

export const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g;

// `esc` is the language the result will be READ as -- see escape.mjs. The
// replacement is a FUNCTION on purpose: String.replace inserts what a function
// returns literally, so a value containing ${OTHER} is never re-expanded and a
// value containing $& or $1 is never interpreted as a back-reference.
export function interpolate(s, values, esc = "text") {
  if (typeof s !== "string") return s;
  return s.replace(PLACEHOLDER, (m, k) => (k in values ? encode(values[k], esc) : m));
}

export function placeholders(s) {
  return [...String(s).matchAll(PLACEHOLDER)].map((m) => m[1]);
}

// Every string field of a step except the ones that NAME something. Which are
// which, and what language each is read as, is the REGISTRY's answer -- so a
// field a project's own extension added is escaped by the same rule as `query`,
// rather than being the one string that reaches an interpreter raw.
export function interpolateStep(step, values, dsl = CORE) {
  const reg = dsl && typeof dsl.literalFields === "function" ? dsl : CORE;
  const out = { ...step };
  const literal = reg.literalFields();
  for (const k of Object.keys(step)) if (!literal.has(k)) out[k] = interpolate(step[k], values, reg.escOf(k));
  return out;
}

export function unresolved(step, dsl = CORE) {
  const reg = dsl && typeof dsl.literalFields === "function" ? dsl : CORE;
  const literal = reg.literalFields();
  const names = Object.entries(step).filter(([k]) => !literal.has(k)).flatMap(([, v]) => placeholders(v));
  return [...new Set(names)];
}
