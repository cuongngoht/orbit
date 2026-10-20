// Publication metadata identifies the run and whether its rendered evidence is
// complete. It is not a verdict and never contains another copy of the case.
import { resolve } from "node:path";
import { sha } from "../hash.mjs";
import { EXIT } from "../run/errors.mjs";
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { ROOT_FIELDS, ROOT_REQUIRED, STEP_FIELDS } from "../dsl/fields.mjs";
import { shapeFindings } from "../dsl/rules/shape.mjs";
import { VERB } from "../dsl/verbs.mjs";

export const EXPORT_VERSION = "1";
export const END = "<!-- orbit-report-end -->";
export const exportKey = (records, dir) => sha(JSON.stringify([resolve(dir), records, records.complete !== false]));

export function complete(m, shots) {
  const c = m.run.source;
  return sourceValid(c) && m.run.case === c.id && Object.hasOwn(EXIT, m.result.status)
    && Number.isInteger(m.result.done) && m.steps.filter((s) => s.ok === true).length === m.result.done
    && m.inputComplete && shots.every((s) => Boolean(s.src));
}

function sourceValid(c) {
  if (shapeFindings(c).length) return false;
  const wrong = [...missingFindings(ROOT_REQUIRED, c, "case"), ...constraintFindings(ROOT_FIELDS, c, "case")];
  return !wrong.length && c.steps.every((s) => VERB.has(s.do) && !constraintFindings(STEP_FIELDS, s, "step").length);
}

export const meta = (html, name) => new RegExp(`<meta name="orbit-${name}" content="([^"]*)">`).exec(html)?.[1] ?? null;

export function ready(html, key) {
  return meta(html, "export-version") === EXPORT_VERSION && meta(html, "run-key") === key
    && meta(html, "complete") === "true" && html.trimEnd().endsWith(END);
}
