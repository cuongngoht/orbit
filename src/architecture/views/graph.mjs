// `architecture graph [--json]`: the SYSTEM GRAPH this snapshot holds, as a projection
// (src/architecture/graph-view.mjs) -- read, never written: nothing is stored beside the facts.
//
// The vocabulary the roles are read from (`ctx.topology`) and the ids other subjects know their
// things by (`ctx.joins`) are bound by the composition root, cli/architecture.mjs. A context with
// neither still prints the graph, every name undeclared and nothing linked -- and says so.
import { out } from "../../query/format.mjs";
import { mergeVocabulary } from "../../topology/vocabulary.mjs";
import { graphOf } from "../graph-view.mjs";

export function graph(ctx, args = []) {
  const view = graphOf(ctx.arch.all(), ctx.topology ?? mergeVocabulary([]), ctx.joins ?? []);
  if (args.includes("--json")) return void out(JSON.stringify(view, null, 2));
  if (!view.nodes.length && !view.relations.length) return void out(EMPTY);
  printed(view);
}

const EMPTY = "no node or relation fact is recorded yet — `architecture ensure` reads what composition files declare, and `architecture record` takes evidence-backed candidates for the rest";

function printed(view) {
  out(`SYSTEM GRAPH  ${view.counts.nodes} node(s) · ${view.counts.relations} relation(s) · digest ${view.digest.slice(0, 12)}`);
  for (const n of notes(view.counts)) out(`  ${n}`);
  nodesOf(view.nodes);
  relationsOf(view.relations);
  conflictsOf(view.conflicts);
}

const NOTES = [
  { when: (c) => c.undeclared > 0, say: (c) => `${c.undeclared} kind(s) or relation(s) no vocabulary declares — shown, deriving nothing` },
  { when: (c) => c.unknownEnds > 0, say: (c) => `${c.unknownEnds} relation(s) with an end nobody could fix — unknown, never guessed` },
  { when: (c) => c.notFresh > 0, say: (c) => `${c.notFresh} fact(s) not fresh — stale means re-read it, never false` },
];

const notes = (counts) => NOTES.filter((n) => n.when(counts)).map((n) => n.say(counts));

function nodesOf(nodes) {
  out("\nnodes:");
  for (const n of nodes) out(`  ${String(n.role ?? "—").padEnd(13)} ${String(n.nodeKind).padEnd(16)} ${clip(n.key, 56).padEnd(56)} ${n.status.padEnd(7)} ${n.confidence}${linksText(n)}`);
}

function relationsOf(relations) {
  out("\nrelations:");
  for (const r of relations) out(`  ${clip(r.from, 40)} ─${r.relation}${r.role ? "" : " (undeclared)"}→ ${clip(r.to, 40)}  ${r.status} ${r.confidence}`);
}

function conflictsOf(conflicts) {
  if (!conflicts.length) return;
  out("\nconflicts (shown, never resolved here):");
  for (const c of conflicts) out(`  ${clip(c.relation, 60)}\n      ${c.says}`);
}

const linksText = (n) => (Object.keys(n.links ?? {}).length ? `  ↔ ${Object.keys(n.links).join(", ")}` : "");

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
