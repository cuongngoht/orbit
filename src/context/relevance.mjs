// WHAT A TASK TOUCHES, from evidence the owners already hold (0.5.0, B21; docs/backlog/0.5.0-proactive-orchestration.md
// §5.4) -- the `relevant` section of the context package. Pure: what each owner said is handed in by the composition
// root (cli/context.mjs), and a bounded, ordered list comes back, every item naming its evidence. Nothing here reads a
// file, asks git or imports an owner; src/context/ is data.
//
//   item  { kind: file | symbol | component | check, ref, class, evidence: [{ source, id }], freshness, by }
//
// CLASS -- the first of CLASSES that anything said about the item gives it:
//   direct        named by the request: the task writes the path out, or every word of the item's own name is one of
//                 the task's (identifiers split: `createOrder` is named by "create order"); a reference the host
//                 proposed and the tree holds; a module, a system-graph node or a component a direct path lies in
//   dependency    a direct item depends on it: a module a direct one imports (architecture's boundary facts), a node a
//                 direct one has an edge to (the system graph), an integration a direct file does (intelligence)
//   downstream    it depends on the change: a module that imports a direct one, a node with an edge to a direct one,
//                 a component impact.mjs says the change reaches
//   verification  a declared check that holds a direct path: what obligations.mjs requires of the components the
//                 change reaches -- or, with no runtime graph to ask, the gates a manifest declares for its own unit
//   unknown       present, with no relation evidence: what engineering or knowledge recalled for the task without the
//                 task naming it, a file the latest session changed, a component nothing resolved
//
// Within a class, items are ordered by EVIDENCE WEIGHT: one per owner record that cites the item, three for a path the
// task writes out, one per task word a name matches. At most RELEVANCE_LIMIT are listed and the rest COUNTED -- and a
// name nothing but the listing vouches for is listed at most LISTING_LIMIT times, so broad words never crowd out what
// an owner holds. FRESHNESS is the least fresh of what an item rests on, each measured by the composition root against
// that owner's own scope fingerprints (src/freshness.mjs, never HEAD), and joined after the bound (`freshened`).
//
// A PATH IS LISTED ONLY WHEN THE TRACKED TREE HOLDS IT: a fact citing a file since deleted lists nothing, and no
// listing at all lists no path. No embeddings, no dependency, and no language is parsed: a file-level import graph
// belongs to a language pack, never to src/.
import { printable } from "../printable.mjs";
import { identifierTokens } from "../tokens.mjs";

export const RELEVANCE_LIMIT = 40;
export const LISTING_LIMIT = 12;
export const COMMON_NAME = 3;
export const EVIDENCE_LIMIT = 6;
export const PATHS_PER_FACT = 4;
export const WORKED_LIMIT = 40;

export const CLASSES = ["direct", "dependency", "downstream", "verification", "unknown"];
export const ITEM_KINDS = ["file", "symbol", "component", "check"];
export const FRESHNESS = ["current", "stale", "unknown"];
export const FOUND_BY = ["engine", "host-verified"];

// The system graph's word for an end its source does not fix: never guessed, so never an item.
const UNKNOWN_END = "unknown";

// ---- the task's words, and the names that are its ----------------------------------------------------------------

// A word of a name is one of the task's, give or take a plural `s`.
const among = (want, word) => want.has(word) || want.has(`${word}s`) || (word.endsWith("s") && want.has(word.slice(0, -1)));

export const matchedWords = (want, text) => identifierTokens(text).filter((word) => among(want, word));

// NAMED: the name has words, and every one of them is the task's.
export const named = (want, text) => ((words) => words.length > 0 && words.every((word) => among(want, word)))(identifierTokens(text));

const lastName = (path) => String(path ?? "").split(/\/|::/).pop() ?? "";

const stem = (name) => name.replace(/\.[^.]+$/, "");

// What a path is called: a file by its last segment, its extension left out; a directory by its last segment.
const nameOfPath = (w, p) => (w.tree?.files.has(p) ? stem(lastName(p)) : lastName(p));

// The paths a task writes out, as git spells them.
const piecesOf = (task) => String(task ?? "").split(/[\s"'`<>()[\]{},;]+/).map((p) => p.replace(/[.:!?]+$/, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "")).filter((p) => /[/.]/.test(p));

// ---- candidates ------------------------------------------------------------------------------------------------------

const heldPath = (w, p) => Boolean(w.tree) && (w.tree.files.has(p) || w.tree.dirs.has(p));

const pathsHeld = (w, paths) => [...new Set((paths ?? []).filter((p) => typeof p === "string"))].filter((p) => heldPath(w, p));

const atPath = (w, p, cls, support) => ({ kind: w.tree.files.has(p) ? "file" : "component", ref: p, class: cls, by: "engine", path: true, basis: [{ owner: "tree", id: p }], ...support });

const atRef = (kind, ref, cls, support) => ({ kind, ref, class: cls, by: "engine", path: false, basis: [], ...support });

// The support of an owner's record: the evidence a reader opens, and what its freshness rests on.
const cited = (owner, source, f) => ({ evidence: [{ source, id: f.id }], basis: [{ owner, id: f.id }] });

const ARCH = (f) => cited("architecture", "architecture", f);
const GRAPH = (f) => cited("architecture", "graph", f);
const INTEL = (f) => cited("intelligence", "intelligence", f);
const ENG = (f) => cited("engineering", "engineering", f);
const KNOW = (c) => cited("knowledge", "knowledge", c);
const PLAN = (source, id) => ({ evidence: [{ source, id }], basis: [{ owner: "plan", id: "runtime" }] });

const ofKind = (facts, kind) => facts.filter((f) => f?.kind === kind);

// 1 · the host's references, each already verified against the tree (src/context/refs.mjs). A symbol is listed as itself,
// with where the tree holds it as its evidence -- a file that merely mentions the name is not made an item of its own.
const placeOf = (at) => ({ source: "tree", id: `${at.path}:${at.line}` });

const hostSymbol = (w, r) => [atRef("symbol", r.ref, "direct", { evidence: r.where.map(placeOf), basis: r.where.map((at) => ({ owner: "tree", id: at.path })), by: "host-verified" })];

const hostFile = (w, r) => (heldPath(w, r.ref) ? [atPath(w, r.ref, "direct", { evidence: [{ source: "tree", id: "tracked" }], by: "host-verified" })] : []);

const fromHost = (w) => w.refs.flatMap((r) => (r.kind === "symbol" ? hostSymbol(w, r) : hostFile(w, r)));

// 2 · what the request names: a path it writes out, or a tracked name every word of which is the task's.
const written = (w) => [...new Set(piecesOf(w.task))].filter((p) => heldPath(w, p)).map((p) => atPath(w, p, "direct", { evidence: [{ source: "request", id: p }] }));

const byName = (w, p) => atPath(w, p, "direct", { evidence: [{ source: "name", id: matchedWords(w.want, p).join(" ") }, { source: "tree", id: "tracked" }] });

// How many tracked files share a name, and how many directories: a name the tree uses in more than COMMON_NAME places
// (every `index`, every `package`) names none of them in particular, and is not taken as naming one.
const counted = (names) => names.reduce((counts, name) => counts.set(name, (counts.get(name) ?? 0) + 1), new Map());

const namesOf = (tree) => (tree ? { files: counted([...tree.files].map((p) => stem(lastName(p)))), dirs: counted([...tree.dirs].map(lastName)) } : null);

const specific = (w, p) => ((w.tree.files.has(p) ? w.names.files : w.names.dirs).get(nameOfPath(w, p)) ?? 0) <= COMMON_NAME;

const namedInTree = (w) => (w.tree && w.want.size ? [...w.tree.files, ...w.tree.dirs].filter((p) => named(w.want, nameOfPath(w, p)) && specific(w, p)).map((p) => byName(w, p)) : []);

// 3 · architecture: a module, a capability or a system-graph node the request names.
const namedModules = (w) => ofKind(w.architecture, "module").filter((f) => named(w.want, lastName(f.key)) && heldPath(w, f.key)).map((f) => atPath(w, f.key, "direct", ARCH(f)));

const namedCapabilities = (w) => ofKind(w.architecture, "capability").filter((f) => named(w.want, f.capability ?? f.key)).flatMap((f) => pathsHeld(w, f.scope).map((p) => atPath(w, p, "direct", ARCH(f))));

const nodeItems = (w, f) => [atRef("component", f.key, "direct", GRAPH(f)), ...pathsHeld(w, f.evidence).slice(0, PATHS_PER_FACT).map((p) => atPath(w, p, "direct", GRAPH(f)))];

const namedNodes = (w) => ofKind(w.architecture, "node").filter((f) => named(w.want, f.name ?? "")).flatMap((f) => nodeItems(w, f));

// 4 · intelligence: an integration the request names, and the files that do it.
const namedIntegrations = (w) => w.intelligence.filter((f) => named(w.want, f.integration ?? "")).flatMap((f) => [atRef("component", f.key, "direct", INTEL(f)), ...pathsHeld(w, f.evidence).slice(0, PATHS_PER_FACT).map((p) => atPath(w, p, "direct", INTEL(f)))]);

// 5 · what engineering and knowledge recalled for the task: direct when the task names its subject, else unknown.
const engPaths = (f) => [...(f.examples ?? []).map((e) => e?.path), ...(f.evidence ?? [])];

const fromEngineering = (w) => w.engineering.flatMap((f) => pathsHeld(w, engPaths(f)).slice(0, PATHS_PER_FACT).map((p) => atPath(w, p, named(w.want, lastName(f.key)) ? "direct" : "unknown", ENG(f))));

const claimNamed = (w, c) => named(w.want, c.subject ?? "") || named(w.want, c.object ?? "");

const fromKnowledge = (w) => w.knowledge.flatMap((c) => pathsHeld(w, c.paths).slice(0, PATHS_PER_FACT).map((p) => atPath(w, p, claimNamed(w, c) ? "direct" : "unknown", KNOW(c))));

// 6 · the working set: a file the latest session changed, and one it read that the task names.
const worked = (w, how) => pathsHeld(w, (w.workingSet[how] ?? []).slice(-WORKED_LIMIT));

const fromWorkingSet = (w) => [...worked(w, "changed").map((p) => atPath(w, p, named(w.want, nameOfPath(w, p)) ? "direct" : "unknown", { evidence: [{ source: "working-set", id: "changed" }] })), ...worked(w, "read").filter((p) => named(w.want, nameOfPath(w, p))).map((p) => atPath(w, p, "direct", { evidence: [{ source: "working-set", id: "read" }] }))];

// 7 · once paths are known: what impact.mjs says the change reaches, and the checks obligations.mjs requires of it.
const IMPACT_CLASS = { MODIFIED: "direct", SHARED: "direct", DEPENDENT: "downstream" };

const fromImpact = (w) => (w.plan?.components ?? []).map((c) => atRef("component", c.key, IMPACT_CLASS[c.reason] ?? "unknown", PLAN("impact", c.reason)));

const fromChecks = (w) => (w.plan?.checks ?? []).map((c) => atRef("check", c.id, "verification", PLAN("obligations", c.component)));

const OWN = [fromHost, written, namedInTree, namedModules, namedCapabilities, namedNodes, namedIntegrations, fromEngineering, fromKnowledge, fromWorkingSet, fromImpact, fromChecks];

// ---- what is related to a direct item ----------------------------------------------------------------------------------

const enclosing = (dir, p) => dir === "" || p === dir || p.startsWith(`${dir}/`);

const ownerModule = (modules, p) => modules.filter((m) => enclosing(m.key, p)).sort((a, b) => b.key.length - a.key.length)[0] ?? null;

const owningModules = (w, paths) => [...new Set([...paths].map((p) => ownerModule(ofKind(w.architecture, "module"), p)).filter(Boolean))].filter((m) => heldPath(w, m.key));

// A path SEEDS the relations when something besides a node's citation makes it direct: a file that declares a named
// service declares its neighbours too, and is no reason to call them direct.
const seeds = (c) => c.class === "direct" && c.path && c.evidence.some((e) => e.source !== "graph");

// The direct set the relations are asked from: its paths, and the modules they are or lie in.
function directOf(w, items) {
  const paths = new Set(items.filter(seeds).map((c) => c.ref));
  const owning = owningModules(w, paths);
  return { paths, owning, modules: new Set([...ofKind(w.architecture, "module").map((m) => m.key).filter((k) => paths.has(k)), ...owning.map((m) => m.key)]) };
}

const owners = (w, d) => d.owning.map((m) => atPath(w, m.key, "direct", ARCH(m)));

const ends = (f) => String(f.key ?? "").split(" -> ");

const boundaryItems = (w, f, modules) => ((from, to) => [...(modules.has(from) && heldPath(w, to) ? [atPath(w, to, "dependency", ARCH(f))] : []), ...(modules.has(to) && heldPath(w, from) ? [atPath(w, from, "downstream", ARCH(f))] : [])])(...ends(f));

const fromBoundaries = (w, d) => ofKind(w.architecture, "boundary").flatMap((f) => boundaryItems(w, f, d.modules));

const relationItems = (f, keys) => [...(keys.has(f.from) && f.to !== UNKNOWN_END ? [atRef("component", f.to, "dependency", GRAPH(f))] : []), ...(keys.has(f.to) && f.from !== UNKNOWN_END ? [atRef("component", f.from, "downstream", GRAPH(f))] : [])];

const directNodes = (w, d) => ofKind(w.architecture, "node").filter((f) => named(w.want, f.name ?? "") || (f.evidence ?? []).some((p) => d.paths.has(p)));

const fromGraph = (w, d) => ((nodes) => [...nodes.flatMap((f) => nodeItems(w, f)), ...ofKind(w.architecture, "relation").flatMap((f) => relationItems(f, new Set(nodes.map((n) => n.key))))])(directNodes(w, d));

const fromIntegrations = (w, d) => w.intelligence.filter((f) => (f.evidence ?? []).some((p) => d.paths.has(p))).map((f) => atRef("component", f.key, "dependency", INTEL(f)));

// A gate holds the unit its manifest sits in; a path is held by the gates of the deepest unit that holds it.
const unitOf = (path) => (String(path).includes("/") ? String(path).slice(0, String(path).lastIndexOf("/")) : "");

const reach = (gate, p) => Math.max(-1, ...(gate.scope ?? []).map(unitOf).filter((u) => enclosing(u, p)).map((u) => u.length));

const gatesFor = (gates, p) => ((best) => (best < 0 ? [] : gates.filter((g) => reach(g, p) === best)))(Math.max(-1, ...gates.map((g) => reach(g, p))));

const fromGates = (w, d) => ((w.plan?.checks ?? []).length ? [] : [...new Set([...d.paths].flatMap((p) => gatesFor(ofKind(w.architecture, "invariant"), p)))].map((f) => atRef("check", f.key, "verification", ARCH(f))));

const RELATED = [owners, fromBoundaries, fromGraph, fromIntegrations, fromGates];

// ---- one item per (kind, ref) ------------------------------------------------------------------------------------------

const keyOf = (c) => `${c.kind}\u0000${c.ref}`;

const rank = (cls) => CLASSES.indexOf(cls);

const uniqueBy = (list, key) => list.filter((x, at) => list.findIndex((y) => key(y) === key(x)) === at);

const evidenceKey = (e) => `${e.source}\u0000${e.id}`;

const basisKey = (b) => `${b.owner}\u0000${b.id}`;

const joined = (a, b) => (a ? { ...a, class: rank(b.class) < rank(a.class) ? b.class : a.class, evidence: uniqueBy([...a.evidence, ...b.evidence], evidenceKey), basis: uniqueBy([...a.basis, ...b.basis], basisKey), by: a.by === "engine" || b.by === "engine" ? "engine" : "host-verified", path: a.path || b.path } : b);

function merged(candidates, into = new Map()) {
  for (const c of candidates) into.set(keyOf(c), joined(into.get(keyOf(c)), c));
  return into;
}

// What the evidence weighs: a path the task wrote out three, a name one per task word it matches, anything else one.
const WEIGHT = { request: () => 3, name: (id) => String(id).split(" ").filter(Boolean).length };

export const weightOf = (item) => item.evidence.reduce((n, e) => n + (WEIGHT[e.source]?.(e.id) ?? 1), 0);

const ordered = (items) => [...items].sort((a, b) => rank(a.class) - rank(b.class) || weightOf(b) - weightOf(a) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || (a.kind < b.kind ? -1 : 1));

// A name nothing but the tracked listing vouches for.
const listingOnly = (item) => item.by === "engine" && item.evidence.every((e) => e.source === "name" || e.source === "tree");

// The listing's weakest names beyond LISTING_LIMIT are set aside before the relations are asked, and counted.
function setAside(map) {
  const aside = ordered([...map.values()].filter(listingOnly)).slice(LISTING_LIMIT);
  for (const item of aside) map.delete(keyOf(item));
  return aside.length;
}

// A path no tracked file or directory is: never listed, whoever cited it.
const listable = (w, item) => !item.path || heldPath(w, item.ref);

const countsOf = (items, aside) => Object.fromEntries(CLASSES.map((cls) => [cls, items.filter((i) => i.class === cls).length + (cls === "direct" ? aside : 0)]));

function listed(w, map, aside) {
  const all = ordered([...map.values()].filter((item) => listable(w, item)));
  const shown = all.slice(0, RELEVANCE_LIMIT);
  return { items: shown, total: all.length + aside, more: all.length + aside - shown.length, byClass: countsOf(all, aside), paths: shown.filter((i) => i.path && i.class === "direct").map((i) => i.ref) };
}

const worldOf = (input) => ({ task: input.task ?? "", tree: input.tree ?? null, names: namesOf(input.tree), want: new Set(identifierTokens(input.task)), refs: input.refs ?? [], architecture: input.architecture ?? [], intelligence: input.intelligence ?? [], engineering: input.engineering ?? [], knowledge: input.knowledge ?? [], workingSet: input.workingSet ?? {}, plan: input.plan ?? null });

// -> { items (at most RELEVANCE_LIMIT, still carrying the `basis` freshness is measured on), total, more, byClass, paths }
//    input: { task, tree (src/context/refs.mjs treeOf), refs (held), architecture, intelligence (integrations),
//             engineering (recalled), knowledge ({ id, subject, object, paths }), workingSet ({ changed, read }),
//             plan ({ components: [{ key, reason }], checks: [{ id, component }] } | null) }
export function relevanceOf(input) {
  const w = worldOf(input);
  const map = merged(OWN.flatMap((source) => source(w)));
  const aside = setAside(map);
  const d = directOf(w, [...map.values()]);
  return listed(w, merged(RELATED.flatMap((source) => source(w, d)), map), aside);
}

// ---- freshness, joined after the bound ---------------------------------------------------------------------------------

// The least fresh of what an item rests on: anything stale is stale, all fresh is current, anything else unknown.
const freshnessOf = (states) => (states.includes("stale") ? "stale" : states.length && states.every((s) => s === "fresh") ? "current" : "unknown");

const stateOf = (states, b) => states[`${b.owner}:${b.id}`] ?? "unknown";

const shownItem = (item, states) => ({ kind: item.kind, ref: item.ref, class: item.class, evidence: item.evidence.slice(0, EVIDENCE_LIMIT), freshness: freshnessOf(item.basis.map((b) => stateOf(states, b))), by: item.by });

// What a DISCOVER would re-read: the stale records under a direct or a verification item.
const staleUnder = (item, states) => (["direct", "verification"].includes(item.class) ? item.basis.filter((b) => stateOf(states, b) === "stale").map((b) => ({ ref: item.ref, owner: b.owner, id: b.id })) : []);

// -> { relevant: [item], stale: [{ ref, owner, id }] }   states: { "<owner>:<id>": "fresh" | "stale" | "unknown" }
export const freshened = (listing, states) => ({ relevant: listing.items.map((item) => shownItem(item, states)), stale: listing.items.flatMap((item) => staleUnder(item, states)) });

// Every record a listed item rests on, once: what the composition root measures.
export const basisOf = (listing) => uniqueBy(listing.items.flatMap((item) => item.basis), basisKey);

// ---- the section the context package prints ---------------------------------------------------------------------------

const REFUSED_LINES = 3;
const REF_WIDTH = 56;

const clipped = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

const sourcesOf = (item) => [...new Set(item.evidence.map((e) => e.source))].join(" ");

const itemLine = (item) => `  ${item.class.padEnd(12)} ${item.kind.padEnd(9)} ${clipped(printable(item.ref), REF_WIDTH).padEnd(REF_WIDTH)} ${item.freshness.padEnd(7)} ${item.by === "engine" ? "" : "host-verified · "}${sourcesOf(item)}`;

const header = (summary) => `${summary.total} item(s), by class then evidence: ${CLASSES.map((cls) => `${summary.byClass[cls] ?? 0} ${cls}`).join(" · ")}`;

const refusedLines = (refused) => [...refused.slice(0, REFUSED_LINES).map((r) => `  refused  ${r.kind} ${clipped(printable(r.ref), REF_WIDTH)} -- ${r.why}`), ...(refused.length > REFUSED_LINES ? [`  … ${refused.length - REFUSED_LINES} more reference(s) refused -- \`--json\` names each`] : [])];

const moreLine = (hidden) => (hidden > 0 ? [`  … ${hidden} more -- \`--json\` lists ${RELEVANCE_LIMIT} and counts the rest`] : []);

// One line per item, held to `limit` lines in all with what is left out counted, and every refused reference named.
export function relevanceLines(relevant, summary, limit) {
  const refusals = refusedLines(summary.refused ?? []);
  const room = Math.max(0, limit - 2 - refusals.length);
  const shown = relevant.slice(0, room);
  return [header(summary), ...shown.map(itemLine), ...moreLine(summary.total - shown.length), ...refusals];
}
