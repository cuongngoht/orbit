import { createHash } from "node:crypto";
import { analysisFindings, rawFindings, refuseAnalysis } from "./candidate.mjs";
import { intentOf } from "./intent.mjs";
import { acId, reqId } from "./plan.mjs";
import { digestOf } from "./spec.mjs";
import { DEFAULT_REQ_KIND } from "./vocab.mjs";

// A row's kind as the engine keeps it: the kind it was sent with, or -- when it names none -- DEFAULT_REQ_KIND, an
// assumption and never `explicit`, marked as the engine's default beside it. A row that names its kind keeps exactly
// the fields it always had.
const kindOf = (row) => (row.kind == null ? { kind: DEFAULT_REQ_KIND, kindDefaulted: true } : { kind: row.kind });

// A row's citation is the one it was SENT with, held to the field table as sent -- and a row sent with none keeps none.
// The engine once wrote `#L<i+1>` for a requirement and `#L<100+i>` for a criterion: a line nobody read, which every
// reader of a citation (a person, the benchmark's grounding judge) takes for the line the row came from. An invented
// citation is worse than none, so a row that cites no line is counted apart (`citesNoLine`, `goal analyze`'s `uncited`).
const citationOf = (row) => (row.sourceRef == null ? {} : { sourceRef: row.sourceRef });

// Whether a row cites a LINE of the specification: one sent with no citation, or naming the specification alone, does not.
export const citesNoLine = (row) => !/#L[0-9]+(-[0-9]+)?$/.test(String(row?.sourceRef ?? ""));

export function stampAnalysis(raw, specDigest) {
  const requirements = (raw.requirements ?? []).map((r, i) => ({ id: r.id ?? reqId(`${specDigest}:r:${i}:${r.statement}`), ...kindOf(r), statement: String(r.statement ?? "").trim(), ...citationOf(r) }));
  const acceptance = (raw.acceptance ?? []).map((a, i) => {
    const row = { id: a.id ?? acId(`${specDigest}:a:${i}:${a.statement}`), statement: String(a.statement ?? "").trim(), ...citationOf(a), verification: a.verification ?? "evidence from tests or inspection" };
    const req = a.requirementRef ?? requirements[0]?.id;
    if (req) row.requirementRef = req;
    return row;
  });
  return { objective: String(raw.objective ?? "").trim(), intent: intentOf(raw.intent), requirements, acceptance, unknowns: raw.unknowns ?? [], conflicts: raw.conflicts ?? [] };
}

// What the host sent is judged as it was sent, then the engine fills in what it owns, and that is judged again.
export function validateAnalysis(raw, specDigest) {
  refuseAnalysis(rawFindings(raw));
  const stamped = stampAnalysis(raw, specDigest);
  refuseAnalysis(analysisFindings(stamped, specDigest));
  const digest = createHash("sha256").update(JSON.stringify(stamped), "utf8").digest("hex");
  return { ...stamped, digest };
}

export function hintsFromSpec(body, specDigest) {
  const ref = `spec@${specDigest}`;
  const lines = String(body).split(/\r?\n/);
  const acLines = lines.map((l, i) => ({ i, t: l.trim() })).filter(({ t }) => /^(AC[-:]?\s*\d+|Acceptance|\*\s*AC)/i.test(t));
  const acceptance = acLines.map(({ i, t }, n) => ({ statement: t.slice(0, 240), sourceRef: `${ref}#L${i + 1}`, verification: "derived test or inspection" }));
  return { acceptanceHints: acceptance, lineCount: lines.length };
}
