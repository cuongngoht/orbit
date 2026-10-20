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

const conventionFact = (s, n, files) => ({ kind: "convention", key: s, statement: `${n} tracked file(s) are named *.${s}`, scope: [...new Set(files.filter((f) => basename(f).endsWith(s)).map(dirname))].sort().slice(0, 8), evidence: files.filter((f) => basename(f).endsWith(s)).slice(0, 3), source: "repository", confidence: "possible", because: `counted ${n} of them`, unknowns: [REPEAT_IS_NOT_AGREEMENT] });

const REPEAT_IS_NOT_AGREEMENT = "whether anybody agreed to this — a repeated filename is a count, not a decision, and nothing in a listing can tell them apart";
