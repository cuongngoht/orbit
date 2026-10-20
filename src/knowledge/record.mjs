// The one door a knowledge candidate comes through -- src/engineering/record.mjs's
// discipline: one candidate per line, every cited path tracked, and a batch is
// all or nothing, because the lines came from ONE investigation and storing the
// readable half stores half an answer.
//
// This module JUDGES and nothing else. What a candidate may claim is
// src/knowledge/candidate.mjs; what it does to the store is
// src/knowledge/ingest.mjs, through reconciliation. `world.tracked` (every
// tracked file and directory) and `world.gates` are handed IN by the
// composition root, so nothing here reads another subsystem's store.
import { candidateFindings, candidateOf } from "./candidate.mjs";
import { isReference, pathsIn } from "./model.mjs";

export const MAX_BATCH = 200;

export function parseCandidates(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, MAX_BATCH + 1).map((line, i) => parsed(line, i));
}

function parsed(line, i) {
  try {
    return { i, raw: JSON.parse(line) };
  } catch (e) {
    return { i, raw: null, why: `line ${i + 1}: not valid JSON — ${e.message}` };
  }
}

export function judge(candidates, world) {
  if (candidates.length > MAX_BATCH) return { accepted: [], rejected: [{ i: MAX_BATCH, why: `more than ${MAX_BATCH} candidates in one batch — split it` }], refused: true };
  const rows = candidates.map((c) => (c.why ? c : weighed(c, world)));
  const rejected = rows.filter((r) => r.why);
  return { accepted: rejected.length ? [] : rows.map((r) => r.candidate), rejected, refused: rejected.length > 0 };
}

function weighed(c, world) {
  const at = `line ${c.i + 1}`;
  const why = [...candidateFindings(c.raw, at, world), ...citeFindings(c, world)];
  return why.length ? { ...c, why: why.join("\n      ") } : { ...c, candidate: candidateOf(c.raw) };
}

// Every path a candidate names is a path a reader will open: the evidence, the
// scope, and the gate it says enforces it. A recorded claim cites PATHS; the
// `scheme:id` references are the engine's own, stamped, never typed in.
const CITED = [
  { field: "evidence", say: (at, p) => `${at}: evidence "${p}" is not tracked here — a claim may not cite a file this repository does not have` },
  { field: "scope", say: (at, p) => `${at}: scope "${p}" matches no tracked file` },
  { field: "enforcedBy", say: (at, p) => `${at}: enforcedBy "${p}" is not tracked here — a gate nobody committed enforces nothing` },
];

function citeFindings(c, world) {
  const at = `line ${c.i + 1}`;
  const refs = (f) => (Array.isArray(c.raw?.[f.field]) ? c.raw[f.field] : []);
  return CITED.flatMap((f) => [...refs(f).filter((p) => pathsIn([p]).length === 0).map(() => `${at}: ${f.field} may cite tracked paths only`), ...pathsIn(refs(f)).filter((p) => !world.tracked.has(p)).map((p) => f.say(at, p))]);
}

// The engine's OWN door, for candidates it built from records it keeps -- an
// investigation's receipts. The same Specification (candidate.mjs, with the
// stamped sources allowed) and the same reconciliation after it; what differs
// is only what counts as evidence: a REFERENCE in one of the schemes the
// composition root hands in, resolved by it against the record it names --
// never a path, and never anything a person or a model typed.
//
// world: { schemes: ["investigation"], resolves(ref) -> boolean, tracked: Set, gates }
export function judgeStamped(candidates, world) {
  const rows = candidates.map((raw, i) => stampedWeighed({ i, raw }, world));
  const rejected = rows.filter((r) => r.why);
  return { accepted: rejected.length ? [] : rows.map((r) => r.candidate), rejected, refused: rejected.length > 0 };
}

function stampedWeighed(c, world) {
  const at = `candidate ${c.i + 1}`;
  const why = [...candidateFindings(c.raw, at, { ...world, stamped: true }), ...referenceFindings(c.raw, at, world), ...scopeFindings(c.raw, at, world)];
  return why.length ? { ...c, why: why.join("\n      ") } : { ...c, candidate: candidateOf(c.raw) };
}

const schemeOf = (ref) => String(ref).slice(0, String(ref).indexOf(":"));

const referenceFindings = (raw, at, world) => (raw.evidence ?? []).flatMap((ref) => referenceWhy(ref, at, world));

function referenceWhy(ref, at, world) {
  if (!isReference(ref) || !world.schemes.includes(schemeOf(ref))) return [`${at}: evidence "${ref}" is not a reference this door accepts (${world.schemes.join(", ")})`];
  return world.resolves(ref) ? [] : [`${at}: evidence "${ref}" names no record`];
}

const scopeFindings = (raw, at, world) => pathsIn(raw.scope ?? []).filter((p) => !world.tracked.has(p)).map((p) => `${at}: scope "${p}" matches no tracked file`);
