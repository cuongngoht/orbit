// Append probed edges to the map, and refuse to leave it broken.
//
// Hand-appending is how a map ends up with a dangling `to`, a duplicate
// `from/via`, or a record whose `seen` claims "live" with no commit to pin it
// to. So the write goes through here: validated before, verified after (the
// full `check`), and rolled back if the map came out dirty.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { edgeKey } from "./load.mjs";

const REQUIRED = ["from", "via", "kind", "selector", "opens", "to", "seen"];
const OPENS = ["inline", "dialog", "panel", "screen", "none", "external"];

// One JSON record per line; `//` lines and blanks are skipped, bad JSON is reported.
export function parseCandidates(text, warn = () => {}) {
  return text.split("\n").map((l, i) => parseLine(l, i, warn)).filter(Boolean);
}

function parseLine(l, i, warn) {
  if (!l.trim() || l.startsWith("//")) return null;
  try { return JSON.parse(l); } catch { warn(`! line ${i + 1} is not valid JSON, skipped`); return null; }
}

export function judge(graph, candidates) {
  const known = new Set(graph.edges.map(edgeKey));
  const seenHere = new Set();
  const verdicts = candidates.map((e, i) => ({ e, i, why: reasonToReject(graph, e, known, seenHere) }));
  return { accepted: verdicts.filter((v) => !v.why).map((v) => strip(v.e)), rejected: verdicts.filter((v) => v.why) };
}

const strip = ({ t, ...e }) => e;

function reasonToReject(graph, e, known, seenHere) {
  if (e.t !== undefined && e.t !== "edge") return `t is "${e.t}", not "edge" — this tool only appends edges`;
  const missing = REQUIRED.filter((k) => !(k in e));
  if (missing.length) return `missing ${missing.join(", ")}`;
  return shapeReason(graph, e) ?? keyReason(e, known, seenHere);
}

function shapeReason(graph, e) {
  if (!graph.screens.has(e.from)) return `from "${e.from}" is not a screen in the graph`;
  if (e.to !== null && !graph.screens.has(e.to)) return `to "${e.to}" is neither null nor a known screen`;
  if (!OPENS.includes(e.opens)) return `opens "${e.opens}" is not one of ${OPENS.join("/")}`;
  if (!e.selector || e.selector === "UNKNOWN") return "selector is empty or UNKNOWN — a step cannot be driven from it";
  return seenReason(e);
}

// "live" is a claim about a specific build; without the commit `verify` cannot
// tell whether the claim has expired.
function seenReason(e) {
  if (e.seen === "live" && !e.fe_commit) return 'seen is "live" but fe_commit is missing';
  return ["live", "src"].includes(e.seen) ? null : `seen "${e.seen}" is neither "live" nor "src"`;
}

function keyReason(e, known, seenHere) {
  const key = edgeKey(e);
  if (known.has(key)) return `${key} is already in the graph — correct it with a new record, do not re-add it`;
  if (seenHere.has(key)) return `${key} appears twice in this input`;
  seenHere.add(key);
  return null;
}

// Append, re-check, and roll back on any finding. Returns the findings (empty = kept).
export function appendEdges(graphDir, accepted, recheck) {
  const file = join(graphDir, "edges.json");
  const before = existingEdges(file);
  writeFileSync(file, merged(before, accepted));
  return rollbackUnless(recheck(), file, before);
}

// A map whose screens are recorded but whose first control is not (1.8.9: a project just seated in the store has no
// edges.json yet) starts from an empty list, exactly what the loader already reads it as.
const existingEdges = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "[]\n");

const merged = (before, accepted) => JSON.stringify([...JSON.parse(before), ...accepted], null, 2) + "\n";

function rollbackUnless(findings, file, before) {
  if (findings.length) writeFileSync(file, before);
  return findings;
}

// Correct records the map already has, IN PLACE.
//
// `judge` refuses a key it already knows with the words "correct it with a new
// record, do not re-add it" -- and then this file refused that record too, so
// the only way to fix a drifted selector was to hand-edit edges.json: no
// validation, no re-check, no rollback, and no trace of what it used to say.
// Correcting a record is the commonest write the map ever takes, and it was the
// one write with no tool.
//
// The inverse of `judge`, rule for rule: the key MUST already exist, and only
// the fields the candidate carries are touched. The note somebody wrote at 2am,
// the `destructive` flag, the combobox's `options` -- all left exactly as they
// were, because a correction is not a re-recording. And the record is never
// removed and re-added: a wrong record is evidence of what changed, and its
// position in the file is how a diff stays readable.
export function judgeReplacements(graph, candidates) {
  const seenHere = new Set();
  const verdicts = candidates.map((e, i) => ({ e, i, why: reasonToRefuse(graph, e, seenHere) }));
  return { accepted: verdicts.filter((v) => !v.why).map((v) => correction(graph, v.e)), rejected: verdicts.filter((v) => v.why) };
}

function reasonToRefuse(graph, e, seenHere) {
  if (e.t !== undefined && e.t !== "edge") return `t is "${e.t}", not "edge" — this tool only corrects edges`;
  if (!e.from || !e.via) return "missing from, via — a correction has to name the record it corrects";
  const known = graph.edgeOn.get(edgeKey(e));
  if (!known) return `${edgeKey(e)} is not in the graph — append it without --replace; do not correct what is not there`;
  return onceOnly(e, seenHere) ?? replaceReason(graph, known, e);
}

// One writer, one correction. Two lines for one key in one file is the same
// collision as two agents editing the map, just earlier.
function onceOnly(e, seenHere) {
  const key = edgeKey(e);
  if (seenHere.has(key)) return `${key} is corrected twice in this input — one record, one correction`;
  seenHere.add(key);
  return null;
}

function replaceReason(graph, known, e) {
  const now = { ...known, ...strip(e) };
  if (!changed(known, now).length) return `${edgeKey(e)} already says that — nothing to correct`;
  if (e.seen === "live" && !e.fe_commit) return 'a correction claiming seen "live" must bring its own fe_commit — the record\'s old one pins the old observation';
  return shapeReason(graph, now);
}

// What the record said, what it will say, and which fields differ -- so the CLI
// can print a before and an after, and the reader can see the size of the claim.
function correction(graph, e) {
  const key = edgeKey(e);
  const was = graph.edgeOn.get(key);
  const now = { ...was, ...strip(e) };
  return { key, was, now, changed: changed(was, now) };
}

const changed = (was, now) => Object.keys(now).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]));

// Patched, re-checked, rolled back on any finding -- the same contract as an
// append, because a correction can break the map in exactly the same ways.
export function replaceEdges(graphDir, corrections, recheck) {
  const file = join(graphDir, "edges.json");
  const before = readFileSync(file, "utf8");
  writeFileSync(file, patched(before, corrections));
  return rollbackUnless(recheck(), file, before);
}

// map(), not filter-and-append: every record keeps its place and the file keeps
// its length, so the diff shows what changed and nothing else.
const patched = (before, corrections) => JSON.stringify(JSON.parse(before).map((r) => instead(r, corrections)), null, 2) + "\n";

const instead = (r, corrections) => corrections.find((c) => c.key === edgeKey(r))?.now ?? r;
