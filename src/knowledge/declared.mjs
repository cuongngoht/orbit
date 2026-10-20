// Claims an ORGANISATION declares for its projects -- "our projects reach
// platform X this way", "our policy requires Y" -- read live from its own room
// and never copied into a project's store.
//
// A declaration is a person's word, so its source is `human-declared-memory`;
// declared at a layer whose row says `rules`, a decision (`adopted`) there ranks
// as a RULE (src/knowledge/vocab.mjs AUTHORITY). It is never reconciled: the
// same static file read on two days is not two independent sessions, and
// counting it so is how a memory talks itself into certainty. What the file
// says is what the claim says; editing the file is how it changes.
//
//   <storeBase>/organization/knowledge/claims/*.jsonl   one claim per line:
//     { subject, relation, object, context?, strength?, because?, unknowns? }
//
// A line this cannot read, or one its contract refuses, is RECORDED with its
// reason and the rest load -- one bad line must not cost an organisation its
// rules.
import { join } from "node:path";
import { CLAIM_VERSION, canonical, claimFindings, claimId, isObject } from "./model.mjs";

const LINE_KEYS = ["subject", "relation", "object", "context", "strength", "because", "unknowns"];
const STRENGTHS = ["adopted", "suggested"];
export const MAX_DECLARED = 512;

export function declaredClaims(io, dir, layer) {
  const files = io.list(dir).filter((n) => n.endsWith(".jsonl")).sort();
  const read = files.map((name) => fileClaims(io.read(join(dir, name)) ?? "", { name, layer }));
  return { claims: read.flatMap((r) => r.claims).slice(0, MAX_DECLARED), refused: read.flatMap((r) => r.refused) };
}

function fileClaims(text, where) {
  const lines = String(text).split("\n").map((l, i) => ({ l: l.trim(), at: `${where.name} line ${i + 1}` })).filter((x) => x.l);
  const judged = lines.map((x) => lineClaim(x.l, x.at, where));
  return { claims: judged.filter((j) => j.claim).map((j) => j.claim), refused: judged.filter((j) => j.why).map((j) => ({ at: j.at, why: j.why })) };
}

function lineClaim(line, at, where) {
  const raw = parsed(line);
  const claim = raw ? stamped(raw, where) : null;
  const wrong = claim ? [...keyProblems(raw, at), ...claimFindings(claim, at)] : [`${at}: not a JSON object`];
  return wrong.length ? { at, why: wrong.join("; ") } : { claim };
}

function keyProblems(raw, at) {
  const unknown = Object.keys(raw).filter((k) => !LINE_KEYS.includes(k)).map((k) => `${at}: unknown key "${k}" — a declaration says ${LINE_KEYS.join(", ")}`);
  const strength = raw.strength !== undefined && !STRENGTHS.includes(raw.strength) ? [`${at}: a declaration is ${STRENGTHS.join(" or ")}, not ${raw.strength} — nothing here can see an organisation's gates`] : [];
  const context = raw.context !== undefined && !isObject(raw.context) ? [`${at}: context must be an object — a context nobody could read would silently become "everywhere"`] : [];
  return [...unknown, ...strength, ...context];
}

function stamped(raw, where) {
  const claim = { v: CLAIM_VERSION, subject: raw.subject, relation: raw.relation, object: raw.object, context: canonical(raw.context), strength: raw.strength ?? "adopted", source: "human-declared-memory", layer: where.layer, evidence: [`declared:${where.layer}/${where.name}`], confidence: "possible", status: "unknown", because: typeof raw.because === "string" ? raw.because : "declared by the organisation", unknowns: Array.isArray(raw.unknowns) ? raw.unknowns : [] };
  return { ...claim, id: claimId(claim) };
}

function parsed(line) {
  try {
    const value = JSON.parse(line);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}
