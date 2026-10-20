// SEVERAL checkouts behind the one source-tree port -- the Composite pattern,
// because every caller already speaks to `createFrontend`'s six methods and
// none of them should learn that a project can span repositories.
//
// A project may declare more than one checkout (`frontend.roots`), and
// src/architecture/context.mjs `scanRoots` has always returned every one that
// is genuinely separate -- but `createFrontend` keeps only the FIRST that
// exists, so a second repository was declared and then silently never read.
// This is where the others are read.
//
// Paths stay in one language, with one extension:
//
//   the PRIMARY root (the first that exists) keeps plain repo-relative paths,
//   exactly as before -- so every fact and every map record already written
//   against it still means what it meant
//   every OTHER root is namespaced `<alias>::<path>`, the alias being its
//   directory name, so `src/index.ts` in two repositories is two paths and
//   never one
//
// Each method asks each repository once and merges: a fingerprint is computed
// per repository, so a commit in one never moves a scope in another. `commit()`
// and `changed()` are the primary's -- "which commit is this" has one answer
// per port, and a map record is dated by it.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createFrontend, gitlinks } from "./index.mjs";

export const SEPARATOR = "::";

// The one reading of that path language: which checkout a path belongs to, and
// what it is called inside it. The primary's prefix is "". Anything that has
// to reason per repository -- a manifest adapter that must never see `::`, a
// fact keyed per checkout -- asks this rather than splitting the string itself.
export function splitPath(path) {
  const at = String(path).indexOf(SEPARATOR);
  return at < 0 ? { prefix: "", local: String(path) } : { prefix: String(path).slice(0, at + SEPARATOR.length), local: String(path).slice(at + SEPARATOR.length) };
}

// `submodules: true` reads the primary checkout's initialised SUBMODULES too, each under its own path
// -- `<path>/<file>`, never an alias -- because what it holds is in the working tree exactly there, and
// that is where a start launches it (src/runtime/). Opt-in: every other subject has always read a
// checkout's own tree, and a project that declares the same repository as a root of its own would
// read it twice.
export function createSourceTree(roots, exec = execFileSync, { submodules = false, staged = false } = {}) {
  const present = [...new Set(roots)].filter((r) => existsSync(r));
  const members = aliased(present).map((m, i) => ({ ...m, prefix: i === 0 ? "" : `${m.alias}${SEPARATOR}`, port: createFrontend([m.root], exec, { staged }) }));
  const all = submodules && members.length ? [members[0], ...submodulesOf(present[0], "", exec, SUBMODULE_DEPTH), ...members.slice(1)] : members;
  return all.length <= 1 ? createFrontend(roots, exec, { staged }) : composite(all);
}

// A submodule inside a submodule is read too, this many levels down and no further.
const SUBMODULE_DEPTH = 3;

// The initialised submodules under `root`, DEEPEST first, so a path routes to the innermost checkout
// that holds it. One that was never initialised has no files to read, and is left out.
function submodulesOf(root, prefix, exec, depth) {
  const here = depth > 0 ? (gitlinks(root, exec) ?? []).filter((p) => existsSync(join(root, p, ".git"))) : [];
  const members = here.map((p) => ({ root: join(root, p), alias: `${prefix}${p}`, prefix: `${prefix}${p}/`, port: createFrontend([join(root, p)], exec) }));
  const nested = members.flatMap((m) => submodulesOf(m.root, m.prefix, exec, depth - 1));
  return [...nested, ...members].sort((a, b) => b.prefix.length - a.prefix.length);
}

// A directory name, made unique: two checkouts both called `app` become
// `app` and `app-2`, in the order they were declared.
function aliased(roots) {
  const seen = new Map();
  return roots.map((root) => ({ root, alias: unique(basename(root), seen) }));
}

function unique(name, seen) {
  const n = (seen.get(name) ?? 0) + 1;
  seen.set(name, n);
  return n === 1 ? name : `${name}-${n}`;
}

function composite(members) {
  const primary = members[0].port;
  return { root: primary.root, roots: members.map(({ alias, root, prefix }) => ({ alias, root, prefix })), commit: () => primary.commit(), branch: () => primary.branch(), changed: (from) => primary.changed(from), ...merged(members) };
}

const merged = (members) => ({
  files: () => listed(members, (m) => m.port.files()),
  search: (pattern) => listed(members, (m) => (m.port.search(pattern) ?? []).map((hit) => ({ ...hit, path: m.prefix + hit.path })), true),
  read: (rel) => routed(members, rel).port.read(stripped(routed(members, rel), rel)),
  fingerprints: (scopes) => fingerprinted(members, scopes),
});

// The primary answering null means there is no readable checkout at all; a
// secondary answering null costs that repository and nothing else.
function listed(members, ask, prefixed = false) {
  const answers = members.map(ask);
  if (answers[0] === null) return null;
  return answers.flatMap((list, i) => (list ?? []).map((p) => (prefixed ? p : members[i].prefix + p)));
}

const routed = (members, rel) => members.slice(1).find((m) => String(rel).startsWith(m.prefix)) ?? members[0];

const stripped = (member, rel) => String(rel).slice(member.prefix.length);

function fingerprinted(members, scopes) {
  const byMember = members.map((m) => ({ m, mine: scopes.filter((s) => routed(members, s) === m) }));
  const answers = byMember.map(({ m, mine }) => (mine.length ? m.port.fingerprints(mine.map((s) => stripped(m, s))) : {}));
  if (answers[0] === null) return null;
  return Object.fromEntries(byMember.flatMap(({ m, mine }, i) => mine.map((s) => [s, answers[i]?.[stripped(m, s)] ?? null])));
}
