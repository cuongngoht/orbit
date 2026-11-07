// What the tracked PATHS alone demonstrate -- and nothing else.
//
// This analyser reads not one file, which is what makes a bootstrap affordable:
// the whole of it runs off one `git ls-files`. Three different questions come
// out of that one listing, and they used to be three files before it became
// clear they were three readings of one input rather than three analyses.
//
// The honesty constraint that shaped it: a repetition is not an agreement.
// `index.mjs` appearing four hundred times is a histogram, and reporting it as
// "this project's convention is an index per directory" would be the tool
// inventing a decision nobody made. So every convention carries its count, its
// confidence is `possible`, and its `unknowns` says so in words.
import { basename, dirname } from "node:path/posix";

// A directory with fewer tracked files than this is a folder, not a module.
export const MIN_MODULE_FILES = 3;

// Fewer siblings than this sharing a shape is a coincidence.
export const MIN_SIBLINGS = 2;

export function shape(input) {
  const dirs = byDirectory(input.files);
  return { facts: [...moduleFacts(dirs), ...extensionFacts(input.files), ...conventionFacts(input.files)], unknowns: [ROLE_UNKNOWN] };
}

const ROLE_UNKNOWN = "what any module is FOR — a path says where code lives, never what it is responsible for. That is what `architecture record` and the scanner agent are for";

// Grouped at depth 1 and 2: deeper than that is a file's neighbourhood rather
// than an architectural unit, and shallower loses every `src/<thing>` split.
function byDirectory(files) {
  const counts = new Map();
  for (const f of files) for (const d of levels(f)) counts.set(d, (counts.get(d) ?? 0) + 1);
  return counts;
}

const levels = (f) => f.split("/").slice(0, -1).slice(0, 2).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

// A directory is reported as a module only when nothing DEEPER already is, so
// `src` does not shadow `src/dsl` and `src/run` into one fact about "src".
function moduleFacts(dirs) {
  const named = [...dirs].filter(([, n]) => n >= MIN_MODULE_FILES).map(([d]) => d);
  const leaves = named.filter((d) => !named.some((other) => other !== d && other.startsWith(`${d}/`)));
  return leaves.map((d) => ({ kind: "module", key: d, statement: `${d} holds ${dirs.get(d)} tracked file(s)`, scope: [d], evidence: [d], source: "repository", confidence: "certain", unknowns: [ROLE_UNKNOWN] }));
}

// Sibling directories that all contain a file of the same name are the shape a
// new integration of that kind has to match. This is what answers "where would
// a new adapter go", and the `pattern` is what it has to look like -- read off
// what is there, never prescribed.
function extensionFacts(files) {
  const groups = new Map();
  for (const f of files) key(groups, f);
  return [...groups].filter(([, dirs]) => dirs.size >= MIN_SIBLINGS).map(([k, dirs]) => extensionFact(k, dirs));
}

function key(groups, f) {
  const dir = dirname(f);
  const parent = dirname(dir);
  if (parent === "." || dir === ".") return;
  add(groups, `${parent}/*/${basename(f)}`, dir);
}

const add = (groups, k, dir) => groups.set(k, (groups.get(k) ?? new Set()).add(dir));

const extensionFact = (pattern, dirs) => ({ kind: "extension-point", key: pattern, pattern, statement: `${dirs.size} sibling directories under ${pattern.split("/*/")[0]} each hold a ${pattern.split("/*/")[1]}`, scope: [...dirs].sort(), evidence: [...dirs].sort().slice(0, 4), source: "repository", confidence: "possible", because: `${dirs.size} siblings share the shape`, unknowns: [SIBLINGS_UNKNOWN] });

const SIBLINGS_UNKNOWN = "whether these siblings are an extension point or just directories that happen to be laid out alike — nothing in a path can tell the difference";

// The filename shapes this tree repeats. Capped, counted, and never stated as a
// rule: what comes out is "this happens 87 times", not "this is the convention".
const TOP_CONVENTIONS = 5;
const MIN_REPEATS = 5;

function conventionFacts(files) {
  const counts = new Map();
  for (const f of files) bump(counts, suffix(basename(f)));
  const top = [...counts].filter(([s, n]) => s && n >= MIN_REPEATS).sort((a, b) => b[1] - a[1]).slice(0, TOP_CONVENTIONS);
  return top.map(([s, n]) => conventionFact(s, n, files));
}

const bump = (counts, s) => counts.set(s, (counts.get(s) ?? 0) + 1);

// The last two dotted parts, so `.test.mjs` is a different shape from `.mjs`.
const suffix = (name) => name.split(".").slice(1).slice(-2).join(".");

// How many folders a convention WATCHES, at most. A count over the whole listing has no scope short of the whole tree
// that keeps it current -- a file named so can appear in any folder, a new one included -- and watching every folder it
// touches would move the commonest conventions (`*.json`, `*.md`) on nearly every commit: the snapshot keyed to HEAD
// that a root-level `.` scope once made, by another road. So a convention watches the CONVENTION_SCOPES folders holding
// the most of the files it counted (then by name), SAYS how many of how many in its `unknowns`, and every scan counts it
// again from the whole listing (src/architecture/scan.mjs `givenTo`).
export const CONVENTION_SCOPES = 8;

// Of exactly the files it counted: their suffix IS the convention's, so a `*.test.mjs` is never one of `*.mjs`'s.
function conventionFact(s, n, files) {
  const counted = files.filter((f) => suffix(basename(f)) === s);
  const folders = tallied(counted.map(watchedAs));
  const scope = mostHeld(folders);
  return { kind: "convention", key: s, statement: `${n} tracked file(s) are named *.${s}`, scope, evidence: counted.slice(0, 3), source: "repository", confidence: "possible", because: `counted ${n} of them`, unknowns: [REPEAT_IS_NOT_AGREEMENT, unwatchedSaid(scope.length, folders.size)] };
}

const tallied = (folders) => folders.reduce((held, d) => held.set(d, (held.get(d) ?? 0) + 1), new Map());

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const mostHeld = (folders) => [...folders].sort(([a, x], [b, y]) => y - x || byName(a, b)).slice(0, CONVENTION_SCOPES).map(([d]) => d).sort(byName);

// What a convention cannot see, said by the fact itself: its count is of the listing a scan read, and only the folders it
// watches move it.
const unwatchedSaid = (watched, all) => `how many there are now — this counted the listing a scan read, and watches ${watched === all ? `every one of the ${all}` : `${watched} of the ${all}`} folder(s) holding one: a file named so added, removed or renamed in any other folder leaves it as it was until a scan counts again`;

// What a convention watches of one of its files: the folder it sits in -- except at the root, whose folder is `.`, which
// every reader of a scope takes for the WHOLE tree (the fingerprint, freshness, an incremental scan's narrowing). A file
// at the root is watched as itself, or every commit anywhere would move the fact and the snapshot would be keyed to HEAD.
const watchedAs = (f) => (dirname(f) === "." ? f : dirname(f));

const REPEAT_IS_NOT_AGREEMENT = "whether anybody agreed to this — a repeated filename is a count, not a decision, and nothing in a listing can tell them apart";
