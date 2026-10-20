import { Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";
import { AC_ROW, ANALYSIS_FIELDS, REQUIREMENT_ROW, SOURCE_REF, STAMPED } from "./fields.mjs";
import { intentFindings } from "./intent.mjs";
import { REQ_KINDS, TITLE_LIMIT } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

const rowFindings = (row, table, where) => {
  const out = [];
  if (!isObject(row)) return [`${where}: must be an object`];
  for (const [k, spec] of Object.entries(table)) {
    if (row[k] === undefined || row[k] === null) continue;
    if (spec.type === "string" && typeof row[k] !== "string") out.push(`${where}: ${k} must be a string`);
    if (spec.maxLength && String(row[k]).length > spec.maxLength) out.push(`${where}: ${k} is too long`);
    if (spec.pattern && !new RegExp(spec.pattern).test(String(row[k]))) out.push(`${where}: ${k} has the wrong shape`);
    if (spec.enum && !spec.enum.includes(row[k])) out.push(`${where}: ${k} must be one of ${spec.enum.join(", ")}`);
  }
  return out;
};

const unknownFields = (raw) => Object.keys(raw).filter((k) => !ANALYSIS_FIELDS.includes(k) && !STAMPED.includes(k)).map((k) => `analysis: unknown field "${k}"`);

const stampedFields = (raw) => STAMPED.filter((k) => k in raw).map((k) => `analysis: ${k} is the engine's to say`);

const objectiveFinding = (raw) => {
  if (typeof raw.objective !== "string" || !raw.objective.trim()) return ["analysis: objective is one short sentence"];
  if (raw.objective.length > TITLE_LIMIT) return ["analysis: objective is too long for display"];
  return [];
};

const rowListFindings = (raw) => [...list(raw.requirements).flatMap((r, i) => rowFindings(r, REQUIREMENT_ROW, `requirements[${i}]`)), ...list(raw.acceptance).flatMap((r, i) => rowFindings(r, AC_ROW, `acceptance[${i}]`))];

const refFindings = (raw) => [...list(raw.requirements), ...list(raw.acceptance)].flatMap((r) => (r.sourceRef && !SOURCE_REF.test(r.sourceRef) ? [`bad sourceRef ${r.sourceRef}`] : []));

// What the host SENT, judged before anything is filled in: a field nobody declared, a field the engine stamps, and the
// structured intent (src/goal/intent.mjs) are refused as sent -- never dropped on the way to the journal.
export function rawFindings(raw) {
  if (!isObject(raw)) return ["analysis: must be a JSON object"];
  return [...unknownFields(raw), ...stampedFields(raw), ...intentFindings(raw.intent)];
}

// What the analysis SAYS once the engine filled in its ids and references.
export function analysisFindings(stamped, specDigest) {
  return [...objectiveFinding(stamped), ...rowListFindings(stamped), ...refFindings(stamped), ...kindFindings(stamped), ...secretFindings(stamped)];
}

const kindFindings = (raw) => list(raw.requirements).filter((r) => r.kind && !REQ_KINDS.includes(r.kind)).map((k) => `analysis: unknown requirement kind ${k.kind}`);

const secretFindings = (raw) => [raw.objective, ...list(raw.requirements).map((r) => r.statement), ...list(raw.acceptance).map((r) => r.statement)].filter((t) => typeof t === "string" && scrub(t) !== t).map(() => "analysis: text that looks like a secret is refused");

export function refuseAnalysis(findings) {
  if (!findings.length) return null;
  throw new Refused(findings[0]);
}
