// The one door an ENGINEERING candidate this engine did not derive comes
// through -- src/architecture/record.mjs's identical discipline (one candidate
// per line, every cited path tracked, a batch is all or nothing), over a
// second subject.
//
// This module JUDGES and nothing else. What a candidate may claim is
// src/engineering/candidate.mjs; what it does to the store is
// src/engineering/ingest.mjs, through reconciliation. An accepted row here is
// still a candidate, not a fact -- it has no id, no confidence and no stamp
// until reconciliation gives it one.
import { candidateFindings, candidateOf, ignoredNotes } from "./candidate.mjs";

export function parseCandidates(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((line, i) => parsed(line, i));
}

function parsed(line, i) {
  try {
    return { i, raw: JSON.parse(line) };
  } catch (e) {
    return { i, raw: null, why: `line ${i + 1}: not valid JSON — ${e.message}` };
  }
}

// Every directory that holds a tracked file, alongside every tracked file, so
// a scope like `src/engineering` is one lookup rather than a scan of the
// listing per candidate.
export function trackedSet(files) {
  const all = new Set(files ?? []);
  for (const f of files ?? []) for (const d of dirsOf(f)) all.add(d);
  return all;
}

const dirsOf = (f) => f.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

export function judge(candidates, world) {
  const rows = candidates.map((c) => (c.why ? c : weighed(c, world)));
  const rejected = rows.filter((r) => r.why);
  return { accepted: rejected.length ? [] : rows.map((r) => r.candidate), rejected, refused: rejected.length > 0, notes: rows.flatMap((r) => r.notes ?? []) };
}

function weighed(c, world) {
  const at = `line ${c.i + 1}`;
  const why = [...candidateFindings(c.raw, at, world), ...citeFindings(c, world)];
  if (why.length) return { ...c, why: why.join("\n      ") };
  return { ...c, candidate: candidateOf(c.raw), notes: ignoredNotes(c.raw, at) };
}

// Every path a candidate names is a path a reader will open: the evidence, the
// scope, and the gate it says enforces it.
const CITED = [
  { field: "evidence", say: (at, p) => `${at}: evidence "${p}" is not tracked here — a fact may not cite a file this repository does not have` },
  { field: "scope", say: (at, p) => `${at}: scope "${p}" matches no tracked file` },
  { field: "enforcedBy", say: (at, p) => `${at}: enforcedBy "${p}" is not tracked here — a gate nobody committed enforces nothing` },
];

function citeFindings(c, world) {
  const at = `line ${c.i + 1}`;
  const cited = (f) => (Array.isArray(c.raw?.[f.field]) ? c.raw[f.field] : []).filter((p) => !world.tracked.has(p));
  return CITED.flatMap((f) => cited(f).map((p) => f.say(at, p)));
}
