// CHANGE IMPACT: which components of the checkout a set of changed paths reaches, and WHY -- derived on
// every read from two things only: the paths (the plan's scope before a change exists, the change's own
// files after) and the component GRAPH runtime understanding read from the checkout's files, handed in
// as data. Nothing here knows a language, a framework or what kind of task it is: a path belongs to the
// nearest component at or above it (the rule runtime's assembler uses), and a component is affected for
// one of the reasons below, first that holds.
//
//   graph: { components: [{ key, dir, kind, live, dependsOn: [key], inherits: [path], unresolved: [ref] }] }
//
//   MODIFIED     a changed path lies in it
//   SHARED       a changed file is a shared file it inherits
//   DEPENDENT    it depends, directly or through others, on a component already affected
//   UNRESOLVED   it names a unit nothing read resolves, and something else is affected: what it depends
//                on is unknown, and unknown is never unrelated
//
// A changed path no component owns and no component inherits is UNOWNED: what it reaches is not known,
// and the caller says so -- it never quietly becomes "nothing".
const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

const encloses = (dir, path) => dir === "." || dir === "" || path === dir || path.startsWith(`${dir}/`);

const depth = (dir) => (dir === "." ? 0 : dir.length);

// The component that owns a path: the deepest one whose directory holds it.
export function ownerOf(components, path) {
  const holders = components.filter((c) => encloses(norm(c.dir), norm(path)));
  return holders.sort((a, b) => depth(norm(b.dir)) - depth(norm(a.dir)))[0] ?? null;
}

const inheritors = (components, path) => components.filter((c) => (c.inherits ?? []).map(norm).includes(norm(path)));

// The components that depend on `key`, directly or through others -- never `key` itself.
function reach(components, keys, seen) {
  const more = components.filter((x) => !seen.has(x.key) && (x.dependsOn ?? []).some((d) => keys.includes(d))).map((x) => x.key);
  return more.length ? reach(components, more, new Set([...seen, ...more])) : seen;
}

export const dependentsOf = (components, key) => [...reach(components, [key], new Set([key]))].filter((k) => k !== key);

const row = (key, reason, because) => ({ key, reason, because });

const modified = (components, paths) => paths.map((p) => [p, ownerOf(components, p)]).filter(([, c]) => c).map(([p, c]) => row(c.key, "MODIFIED", `${norm(p)} changed in it`));

const shared = (components, paths) => paths.flatMap((p) => inheritors(components, p).map((c) => row(c.key, "SHARED", `it inherits ${norm(p)}, which changed`)));

const directly = (components, key, on) => (components.find((c) => c.key === key)?.dependsOn ?? []).includes(on);

const dependents = (components, rows) => rows.flatMap((r) => dependentsOf(components, r.key).map((k) => row(k, "DEPENDENT", `it depends on ${r.key}${directly(components, k, r.key) ? "" : " through others"}`)));

const unresolved = (components, rows) => (rows.length ? components.filter((c) => (c.unresolved ?? []).length).map((c) => row(c.key, "UNRESOLVED", `it names ${c.unresolved[0]}, which nothing read resolves: what it depends on is unknown`)) : []);

// First reason wins: a component modified AND a dependent is MODIFIED.
const first = (rows) => rows.filter((r, i) => rows.findIndex((x) => x.key === r.key) === i);

const unownedOf = (components, paths) => paths.map(norm).filter((p) => !ownerOf(components, p) && !inheritors(components, p).length);

// -> { components: [{ key, reason, because }], unowned: [path] }
export function impactOf(paths, graph) {
  const components = graph.components ?? [];
  const direct = first([...modified(components, paths), ...shared(components, paths)]);
  const reached = first([...direct, ...dependents(components, direct)]);
  return { components: first([...reached, ...unresolved(components, reached)]), unowned: [...new Set(unownedOf(components, paths))].sort() };
}

// Directly reached: what the change itself touched, as opposed to what it reaches through others.
export const DIRECT = ["MODIFIED", "SHARED"];
