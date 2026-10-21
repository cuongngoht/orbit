import { createHash } from "node:crypto";
import { analysisFindings, rawFindings, refuseAnalysis } from "./candidate.mjs";
import { intentOf } from "./intent.mjs";
import { acId, reqId } from "./plan.mjs";
import { digestOf } from "./spec.mjs";

export function stampAnalysis(raw, specDigest) {
  const ref = `spec@${specDigest}`;
  const requirements = (raw.requirements ?? []).map((r, i) => ({ id: r.id ?? reqId(`${specDigest}:r:${i}:${r.statement}`), kind: r.kind ?? "explicit", statement: String(r.statement ?? "").trim(), sourceRef: r.sourceRef ?? `${ref}#L${i + 1}` }));
  const acceptance = (raw.acceptance ?? []).map((a, i) => {
    const row = { id: a.id ?? acId(`${specDigest}:a:${i}:${a.statement}`), statement: String(a.statement ?? "").trim(), sourceRef: a.sourceRef ?? `${ref}#L${100 + i}`, verification: a.verification ?? "evidence from tests or inspection" };
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
