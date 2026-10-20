// Which module actually imports which -- OBSERVED, never prescribed.
//
// The only analyser that reads source at scale, and therefore the only one with
// a budget. The budget follows src/run/budget.mjs's discipline rather than
// inventing a second one: one limit, and the answer SAYS which limit stopped it,
// because "we read 400 of 3000 files" and "this project has 400 files" are
// completely different sentences and only one of them is about the product.
//
// What comes out is a `boundary` fact per observed edge -- "src/run imports
// src/dsl" -- with `certain` confidence, because it is a parse of committed
// text. Whether that edge is ALLOWED is a different question and a different
// source: a document saying "cli may not import run" is the docs analyser's
// business, and the two disagreeing is the most useful thing this pair can find.
// Found with ONE search over the index rather than by reading every source file.
// That is the difference between a bootstrap that takes eight seconds and one
// that takes half of one, and it is also stricter: the search reads committed
// blobs, so an untracked file cannot contribute an edge.
const SEARCH = "(from|require\\(|import\\()[[:space:]]*['\"]\\.";

const SPECIFIER = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'](\.[^"']*)["']/;

const SOURCE_FILE = /\.(mjs|cjs|js|jsx|ts|tsx)$/;

export const DEFAULT_BUDGET = 4000;

export function imports(input) {
  const modules = moduleRoots(input.facts ?? []);
  const hits = (input.search?.(SEARCH) ?? null);
  if (hits === null) return { facts: [], unknowns: [NO_SEARCH] };
  return harvest(hits.filter((h) => SOURCE_FILE.test(h.path)), modules, input.budget ?? DEFAULT_BUDGET);
}

const NO_SEARCH = "which module imports which — the index could not be searched, so no boundary here was observed";

function harvest(hits, modules, budget) {
  const edges = new Map();
  for (const h of hits.slice(0, budget)) edgesIn(edges, h, modules);
  return { facts: edgeFacts(edges, modules), unknowns: spent(hits, budget) };
}

// The modules the shape analysis already found, so this one does not decide what
// a module is a second time. Deepest first, so `src/dsl` wins over `src`.
const moduleRoots = (facts) => facts.filter((f) => f.kind === "module").map((f) => f.key).sort((a, b) => b.length - a.length);

function edgesIn(edges, hit, modules) {
  const from = owner(hit.path, modules);
  const spec = SPECIFIER.exec(hit.text)?.[1];
  if (!from || !spec) return;
  count(edges, from, resolved(hit.path, spec, modules));
}

const owner = (path, modules) => modules.find((m) => path.startsWith(`${m}/`)) ?? null;

function count(edges, from, to) {
  if (!to || to === from) return;
  const k = `${from} -> ${to}`;
  edges.set(k, (edges.get(k) ?? 0) + 1);
}

// Only a RELATIVE specifier can name another module in this tree. A bare one is
// a dependency, which the manifest analysis already has and which this must not
// report a second time under a different name.
function resolved(file, spec, modules) {
  if (!spec.startsWith(".")) return null;
  return owner(join(dirOf(file), spec), modules);
}

const dirOf = (f) => f.split("/").slice(0, -1).join("/");

// POSIX and by hand, because the paths came from git and must stay in git's
// spelling. node:path would hand back backslashes on Windows, and a key that
// changes with the operating system is a fact that changes with it too.
function join(dir, spec) {
  const parts = `${dir}/${spec}`.split("/");
  const out = parts.reduce((acc, p) => step(acc, p), []);
  return out.join("/");
}

const step = (acc, p) => (p === ".." ? acc.slice(0, -1) : p === "." || p === "" ? acc : [...acc, p]);

const edgeFacts = (edges, modules) => [...edges].map(([k, n]) => edgeFact(k, n, modules));

function edgeFact(k, n, modules) {
  const [from, to] = k.split(" -> ");
  return { kind: "boundary", key: k, statement: `${from} imports ${to}`, scope: [from, to].filter((s) => modules.includes(s)), evidence: [from, to], source: "repository", confidence: "certain", because: `${n} import(s) observed`, unknowns: [ALLOWED_UNKNOWN] };
}

const ALLOWED_UNKNOWN = "whether this edge is intended — an import that exists is not an import that is allowed, and only a document or a person can say which";

const spent = (hits, budget) => (hits.length > budget ? [`what the remaining ${hits.length - budget} import(s) point at — the budget of ${budget} was spent first, so the edges below are a floor and never a complete list`] : []);
