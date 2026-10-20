// The one door a fact this engine did not derive comes through.
//
// The scanner agent investigates a bounded question and reports candidates. It
// has no Write and no store access, on purpose: an observer that can also record
// is an observer whose guesses become facts. So the parent pipes the candidates
// here, and here they are held to the same table the analysers are held to, plus
// one rule the analysers satisfy for free:
//
//   EVERY path a fact cites must be tracked in the repository.
//
// That is what makes "do not store unsupported guesses" structural. A fact is a
// claim about a tree, and a claim about a tree that cites a file the tree does
// not have is not a weak fact, it is a fabricated one. Checked against
// `files()` rather than against the filesystem, deliberately: a gitignored build
// artefact exists on disk and is exactly the sort of thing that must not count
// as evidence.
//
// A batch is all or nothing. The candidates come from ONE investigation, so
// accepting the readable half stores half an answer and tells nobody -- the same
// reasoning that makes a projection all-or-nothing. Every rejection is listed,
// not just the first: a caller fixing one line at a time through a pipe is a
// caller who gives up.
import { factFindings, makeFact } from "./model.mjs";

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

// Every directory that holds a tracked file, alongside every tracked file, so a
// scope like `src/dsl` is one lookup rather than a scan of the listing per
// candidate. `git ls-files` lists files only; a scope is usually a directory.
export function trackedSet(files) {
  const all = new Set(files ?? []);
  for (const f of files ?? []) for (const d of dirsOf(f)) all.add(d);
  return all;
}

const dirsOf = (f) => f.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

export function judge(candidates, world) {
  const rows = candidates.map((c) => (c.why ? c : weighed(c, world)));
  const rejected = rows.filter((r) => r.why);
  return { accepted: rejected.length ? [] : rows.map((r) => r.fact), rejected, refused: rejected.length > 0 };
}

function weighed(c, world) {
  const why = [...factFindings(c.raw, `line ${c.i + 1}`), ...citeFindings(c, world)];
  if (why.length) return { ...c, why: why.join("\n      ") };
  return { ...c, fact: makeFact(c.raw, world.stamps ?? {}) };
}

function citeFindings(c, world) {
  const at = `line ${c.i + 1}`;
  const evidence = (c.raw?.evidence ?? []).filter((p) => !world.tracked.has(p));
  const scope = (c.raw?.scope ?? []).filter((p) => !world.tracked.has(p));
  return [...evidence.map((p) => `${at}: evidence "${p}" is not tracked here — a fact may not cite a file this repository does not have`), ...scope.map((p) => `${at}: scope "${p}" matches no tracked file`)];
}
