// FILE-LEVEL RELATIONS, followed on demand from what a task touches (0.6.0, U3) -- ONE hop out and ONE hop in from the
// direct files, never a graph of the repository. Pure: the tracked listing, a read of one committed file and a search of
// the index are handed in by the composition root (cli/context-grounding.mjs), and nothing here is stored.
//
// What a file names and how a name resolves to a file belong to the language it is written in, so they live in a
// RELATION ADAPTER a pack provides (skills/orbit-develop/relations/), never here:
//
//   { id,
//     detects(path)                  -> true when this adapter reads files like this one
//     specifiersOf(text)             -> the names a file's text (or one line of it) imports
//     resolve(specifier, from, tree) -> the tracked path a name in `from` resolves to, or null -- never a guess
//     testsOf(path, tree)            -> the tracked tests that go with a path, by the language's own convention
//     importersPattern(path)         -> ONE fixed string every line that imports the path contains }
//
// For each direct file (at most DIRECT_LIMIT):
//   out      the file is READ once, and each name it imports that resolves to a tracked file is a `dependency`
//   in       ONE fixed-string search of the index for who imports it: a hit counts only when its own adapter resolves a
//            name on that line back to the file -- a `downstream` item, or `verification` when it is one of its tests
//   tests    what the adapter says goes with it: `verification`
//   routes   a ROUTE-SHAPED string literal in it (a quoted `/a/b`, two or more segments) that another tracked file also
//            holds -- one fixed-string search per literal -- is a HYPOTHESIS, not an edge: nothing here knows the two
//            ends speak to each other. The host verifies it by reading both, and proposes it with `--with-refs`
//   gap      a direct file no adapter detects: nothing here can say what it relates to, so the host reads it and
//            proposes what it found (`context --with-refs`, verified against the tree) -- never a guessed edge
//
// Bounded: at most `maxFiles` items (the composition root hands in MAX_EVIDENCE_FILES), LITERAL_LIMIT literals per file,
// and a direct file is read once. A read or a search that could not run is a gap, never "nothing relates to it".
export const DIRECT_LIMIT = 8;
export const LITERAL_LIMIT = 3;
export const ADAPTER_FIELDS = ["id", "detects", "specifiersOf", "resolve", "testsOf", "importersPattern"];
export const RELATION_SOURCES = ["imports", "imported-by", "test", "route-literal"];
export const GAP_TARGET = Object.freeze({ source: "host", target: "references", run: "context --with-refs" });

// A quoted absolute path of two or more segments, the quote it opened with closing it.
const ROUTE = /(["'`])(\/[\w.~-]+(?:\/[\w.~-]+)+)\/?\1/g;

// A fixed string as an extended regular expression git and the tests' fake search read alike.
export const fixed = (text) => String(text).replace(/[.[\]()*+?{}|^$\\]/g, "\\$&");

// An adapter is held to its contract before it is used: a missing method is refused by name, never called.
export const adapterFindings = (a) => ADAPTER_FIELDS.filter((f) => (f === "id" ? typeof a?.id !== "string" || !a.id : typeof a?.[f] !== "function")).map((f) => `a relation adapter needs ${f}`);

function quietly(fn, otherwise = null) {
  try { return fn() ?? otherwise; }
  catch { return otherwise; }
}

const held = (r, p) => typeof p === "string" && r.tree.files.has(p);

const adapterOf = (r, path) => r.adapters.find((a) => quietly(() => a.detects(path), false)) ?? null;

const gap = (ref, why) => ({ type: "gap", ref, why, target: GAP_TARGET });

const item = (ref, cls, source, id) => ({ type: "item", ref, class: cls, evidence: [{ source, id }] });

// ---- one hop out: what the file's own text imports ----------------------------------------------------------------

const resolved = (r, a, spec, from) => quietly(() => a.resolve(spec, from, r.tree));

const outOf = (r, a, path, text) => [...new Set(quietly(() => a.specifiersOf(text), []))].map((spec) => resolved(r, a, spec, path)).filter((to) => held(r, to) && to !== path).map((to) => item(to, "dependency", "imports", `${path} -> ${to}`));

// ---- what goes with it ----------------------------------------------------------------------------------------------

const testsOf = (r, a, path) => quietly(() => a.testsOf(path, r.tree), []).filter((p) => held(r, p) && p !== path);

const withTests = (r, a, path) => testsOf(r, a, path).map((t) => item(t, "verification", "test", path));

// ---- one hop in: who imports it, by one search ------------------------------------------------------------------------

const importsIt = (r, hit, path) => ((a) => Boolean(a) && quietly(() => a.specifiersOf(hit.text), []).some((spec) => resolved(r, a, spec, hit.path) === path))(adapterOf(r, hit.path));

const filesOf = (hits) => [...new Set(hits.map((h) => h.path))];

const importerItem = (tests, from, path) => item(from, tests.includes(from) ? "verification" : "downstream", "imported-by", `${from} -> ${path}`);

function importersOf(r, a, path) {
  const pattern = quietly(() => a.importersPattern(path));
  const hits = pattern ? quietly(() => r.search(fixed(pattern))) : [];
  if (hits === null) return [gap(path, "who imports it could not be searched here")];
  return filesOf(hits.filter((h) => held(r, h.path) && h.path !== path && importsIt(r, h, path))).slice(0, r.maxFiles).map((from) => importerItem(testsOf(r, a, path), from, path));
}

// ---- a route-shaped literal another file also holds -----------------------------------------------------------------

const literalsIn = (text) => [...new Set([...String(text ?? "").matchAll(ROUTE)].map((m) => m[2]))].slice(0, LITERAL_LIMIT);

// The literal as itself on the hit's line: not a prefix of a longer name (`/api/session` is not `/api/sessionClient`).
const whole = (literal) => new RegExp(`${fixed(literal)}(?![\\w.~-])`);

const sharing = (r, literal, path) => filesOf(quietly(() => r.search(fixed(literal)), []).filter((h) => held(r, h.path) && h.path !== path && whole(literal).test(h.text)));

const hypothesesOf = (r, path, text) => literalsIn(text).flatMap((literal) => sharing(r, literal, path).slice(0, r.maxFiles).map((ref) => ({ type: "hypothesis", ref, literal, from: path })));

// ---- one direct file ------------------------------------------------------------------------------------------------

const unread = (path) => [gap(path, "its committed text could not be read here")];

const NO_ADAPTER = (path) => `no relation adapter here reads ${path.includes(".") ? `*${path.slice(path.lastIndexOf("."))}` : "this kind of"} file — read it, and propose what it relates to`;

function aroundOne(r, path) {
  const a = adapterOf(r, path);
  if (!a) return [gap(path, NO_ADAPTER(path))];
  const text = quietly(() => r.read(path));
  return text === null ? unread(path) : [...outOf(r, a, path, text), ...withTests(r, a, path), ...importersOf(r, a, path), ...hypothesesOf(r, path, text)];
}

// ---- one entry per ref, bounded -------------------------------------------------------------------------------------

const RANK = ["dependency", "downstream", "verification"];

const sameEvidence = (a, b) => a.source === b.source && a.id === b.id;

const merged = (a, b) => (a ? { ...a, class: RANK.indexOf(b.class) < RANK.indexOf(a.class) ? b.class : a.class, evidence: [...a.evidence, ...b.evidence.filter((e) => !a.evidence.some((x) => sameEvidence(x, e)))] } : b);

function byRef(entries, into = new Map()) {
  for (const e of entries) into.set(e.ref, merged(into.get(e.ref), e));
  return [...into.values()];
}

const ofType = (found, type) => found.filter((e) => e.type === type);

const unique = (list, key) => list.filter((x, at) => list.findIndex((y) => key(y) === key(x)) === at);

const strip = ({ type, ...rest }) => rest;

function bounded(r, found) {
  const items = byRef(ofType(found, "item").filter((e) => !r.direct.includes(e.ref))).slice(0, r.maxFiles);
  const hypotheses = unique(ofType(found, "hypothesis"), (h) => h.ref).slice(0, r.maxFiles);
  return { items: items.map(strip), gaps: unique(ofType(found, "gap"), (g) => g.ref).map(strip), hypotheses: hypotheses.map(strip) };
}

const worldOf = (input) => ({ direct: [...new Set(input.direct ?? [])].slice(0, DIRECT_LIMIT), tree: input.tree ?? { files: new Set() }, adapters: (input.adapters ?? []).filter((a) => adapterFindings(a).length === 0), read: input.read ?? (() => null), search: input.search ?? (() => null), maxFiles: input.maxFiles ?? Infinity });

// -> { items: [{ ref, class: dependency | downstream | verification, evidence: [{ source, id }] }],
//      gaps: [{ ref, why, target }], hypotheses: [{ ref, literal, from }] }
//    input: { direct: [path], tree (src/context/refs.mjs treeOf), adapters, read: (path) => text | null,
//             search: (pattern) => [{ path, line, text }] | null, maxFiles }
export function relatedOf(input) {
  const r = worldOf(input);
  if (!r.direct.length || !input.tree) return { items: [], gaps: [], hypotheses: [] };
  return bounded(r, r.direct.flatMap((path) => aroundOne(r, path)));
}
