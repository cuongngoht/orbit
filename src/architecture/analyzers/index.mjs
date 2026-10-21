// The analysers, as a table. Adding one is a row plus a file; no caller
// anywhere spells their names out.
//
// Each is PURE -- `(input) => {facts, unknowns}` -- which is what makes a
// targeted scan possible at all: a scan is this table filtered, over an input
// narrowed to the paths the question named. An analyser that reached for the
// filesystem itself could not be narrowed, and could not be tested without one.
//
// `reads` is a column because it is the only thing that costs anything. A
// targeted or incremental scan runs the analysers that would look where the
// question points, and says which ones it left out.
import { docs } from "./docs.mjs";
import { imports } from "./imports.mjs";
import { manifests } from "./manifests.mjs";
import { shape } from "./shape.mjs";
import { topology } from "./topology.mjs";

export const ANALYZERS = [
  { name: "manifests", reads: "manifests", run: manifests, doc: "what this project declares it depends on, and the gates it runs on itself" },
  { name: "shape", reads: "listing", run: shape, doc: "what the tracked paths alone demonstrate: modules, repeated shapes, sibling directories that look like an extension point" },
  { name: "imports", reads: "source", run: imports, doc: "which module actually imports which — observed, never prescribed" },
  { name: "docs", reads: "documents", run: docs, doc: "what this project's own documents SAY about its boundaries. Quoted, never obeyed" },
  { name: "topology", reads: "declarations", run: topology, doc: "what a composition file declares about the running system: its services, what each starts after, the networks each is attached to. Read, never run" },
];

export const ANALYZER_NAMES = ANALYZERS.map((a) => a.name);

export const analyzersReading = (kinds) => ANALYZERS.filter((a) => kinds.includes(a.reads));

export const analyseWith = (rows, input) => rows.map((a) => tagged(a, input)).reduce(merged, { facts: [], unknowns: [] });

// One analyser hitting an odd file must not take the other three down with it. A
// snapshot that learned three quarters and SAYS which quarter is missing beats
// one that learned nothing because a manifest had a byte-order mark -- the rule
// src/learn/families/index.mjs already applies for the same reason.
function tagged(a, input) {
  try {
    return { ...a.run(input), from: a.name };
  } catch (e) {
    return { facts: [], unknowns: [`the ${a.name} analysis could not read this tree — ${e.message}`], from: a.name };
  }
}

const merged = (all, one) => ({ facts: [...all.facts, ...one.facts], unknowns: [...all.unknowns, ...one.unknowns] });
