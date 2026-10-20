// WHERE a component could run natively, operating system by operating system -- kept per
// component and never folded into "the project's OS": a checkout whose web client runs anywhere
// and whose classic backend runs only on one system is both, and a person deciding which machine
// a component belongs on needs the matrix, not a word.
//
// From what BINDS the component (src/runtime/resolve/compat.mjs `bindingOf`: its own requirements
// and the checkout's, declared by a file and needed to run) and the catalog's `os` for each:
//
//   yes       every binding requirement can be met there
//   no        one of them can only be met on other systems -- said, with which
//   unknown   one of them has no catalog row, or nothing a file declares says what it needs
//
// What a pipeline or a script shows about where the checkout is built is EVIDENCE, kept apart:
// it is where somebody runs it, never what it requires. Pure.
import { requirement as row } from "../catalog.mjs";
import { bindingOf } from "./compat.mjs";

const UNSAID = { state: "unknown", because: "nothing a file declares says what it needs to run" };
const YES = { state: "yes", because: null };

// -> { [platform id]: { state, because } }, one cell per platform the catalog names.
export function osMatrix(component, shared, catalog) {
  const bound = bindingOf(component, shared).bound;
  return Object.fromEntries((catalog.platforms ?? []).map((p) => [p.id, cell(bound, catalog, p)]));
}

function cell(bound, catalog, platform) {
  if (!bound.length) return UNSAID;
  const entries = bound.map((r) => ({ id: r.requirement, entry: row(catalog, r.requirement) }));
  const unread = entries.find((e) => !e.entry);
  return unread ? { state: "unknown", because: `no catalog row says where ${unread.id} can be met` } : excludedOr(entries, catalog, platform);
}

function excludedOr(entries, catalog, platform) {
  const out = entries.find((e) => e.entry.os && !e.entry.os.includes(platform.id));
  return out ? { state: "no", because: `${out.entry.name} can only be met on ${namesOf(catalog, out.entry.os)}` } : YES;
}

const namesOf = (catalog, ids) => ids.map((id) => (catalog.platforms ?? []).find((p) => p.id === id)?.name ?? id).join(" or ");

// Where the checkout's own files show it is built or run -- a pipeline's runners, its scripts --
// one line per thing said, with every file that said it.
export function osEvidence(view) {
  const groups = new Map();
  for (const o of [...(view.shared?.os ?? []), ...view.components.flatMap((c) => c.os ?? [])]) groups.set(said(o), [...(groups.get(said(o)) ?? []), o]);
  return [...groups.values()].map((g) => ({ os: g[0].os, exclusive: g[0].exclusive, source: g[0].source ?? null, evidence: [...new Set(g.flatMap((o) => o.evidence))] }));
}

const said = (o) => `${o.source}|${o.exclusive}|${o.os.join(",")}`;
