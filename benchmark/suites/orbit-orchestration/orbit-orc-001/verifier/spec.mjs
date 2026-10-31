// THE SPEC of ORBIT-ORC-001: a change is held to what it REACHES (ADR 0019), written from that contract and from the
// header of the impact module, never from its code. Kept beside the probe and handed to no runner; the controller
// imports a FROZEN copy of it, and it never imports the subject. Every check is an input and an expectation over the
// ids the subject reports: `<component>:<REASON>` for a component reached and why, `unowned:<path>` for a changed path
// nothing holds, `required:<check>` and `excluded:<check>` for the declared checks a change is and is not held to,
// `word:<WORD>` for the plan's word, and a bare component key for a dependent. Both directions are checked -- what must
// be reached and what must not -- so an impact that holds a change to everything fails as surely as one that holds it
// to nothing.
//
// Seeded graphs draw components, dependencies, shared files and changed paths at random, with directories whose
// names are prefixes of one another. Where the contract does not decide (a component that would be reached only
// through one that is itself only UNRESOLVED, or an unresolved reference when nothing at all was reached), the check
// says nothing about that component.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-ORC-001";

export const GROUPS = {
  "modified": "a component that holds a changed path is reached as MODIFIED: the deepest component whose directory holds it",
  "directory-not-prefix": "a directory holds itself and what lies under it, never a sibling whose name only starts with the same letters",
  "unowned": "a changed path no component holds and none inherits is reported as unowned, once, never quietly dropped",
  "shared": "a component that inherits a changed shared file is reached as SHARED",
  "dependent": "a component that depends on a reached one, directly or through others, is reached as DEPENDENT",
  "unresolved": "a component naming a unit nothing resolves is reached as UNRESOLVED once anything is reached: unknown is never unrelated",
  "first-reason": "a component reached for several reasons is reported once, for the first that holds: MODIFIED, SHARED, DEPENDENT, UNRESOLVED",
  "unrelated": "a component a change does not reach is not reported, and a change of nothing reaches nothing",
  "dependents-of": "dependentsOf names every component that depends on one, directly or through others, and never that one itself",
  "held-to-reached": "a change is held to the declared checks of what it reaches and only those; every other declared check is excluded",
  "scope": "the scope is the change's own files once it has some, the plan's scope before that, and nothing before a plan",
  "no-graph-widened": "with no component graph, every component that holds a check is held to it once anything is in scope: WIDENED",
  "ungraphed-held": "a component holding a check that the graph does not know is held to its checks once anything is in scope",
  "seeded-graph": "random graphs and changes: every component reached for exactly the reason the contract derives, and nothing else",
  "seeded-dependents": "random graphs: dependentsOf names exactly the components that depend on one, directly or through others",
  "seeded-plan": "random graphs and declared checks: required exactly for what the change reaches, excluded for the rest",
};

const REASONS = ["MODIFIED", "SHARED", "DEPENDENT", "UNRESOLVED"];

// ---- the reference model: the contract, as data ---------------------------------------------------------------------

const isRoot = (dir) => dir === "." || dir === "";

// A directory holds itself and what lies under it; the root holds everything.
const holds = (dir, path) => isRoot(dir) || path === dir || path.startsWith(`${dir}/`);

const depthOf = (dir) => (isRoot(dir) ? 0 : dir.split("/").length);

// The component a path belongs to: the nearest one at or above it.
export const ownerRef = (components, path) => components.filter((c) => holds(c.dir, path)).sort((a, b) => depthOf(b.dir) - depthOf(a.dir))[0] ?? null;

const inherited = (components, path) => components.some((c) => (c.inherits ?? []).includes(path));

const byKey = (components) => new Map(components.map((c) => [c.key, c]));

// Does `key` depend on one of `targets`, directly or through others? Each component is followed once on a path.
function dependsOnAny(map, key, targets, seen) {
  const deps = (map.get(key)?.dependsOn ?? []).filter((d) => !seen.has(d));
  return deps.some((d) => targets.has(d) || dependsOnAny(map, d, targets, new Set([...seen, d])));
}

export const dependentsRef = (components, key) => components.filter((c) => c.key !== key && dependsOnAny(byKey(components), c.key, new Set([key]), new Set([c.key]))).map((c) => c.key);

const DIRECT = [
  { id: "MODIFIED", holds: (w, c) => w.paths.some((p) => ownerRef(w.components, p)?.key === c.key) },
  { id: "SHARED", holds: (w, c) => w.paths.some((p) => (c.inherits ?? []).includes(p)) },
];

const directReason = (w, c) => DIRECT.find((r) => r.holds(w, c))?.id ?? null;

const LATER = [
  { id: "DEPENDENT", holds: (w, c) => dependsOnAny(w.map, c.key, w.direct, new Set([c.key])) },
  { id: "UNRESOLVED", holds: (w, c) => (c.unresolved ?? []).length > 0 && w.direct.size > 0 },
];

const reasonOf = (w, c) => directReason(w, c) ?? LATER.find((r) => r.holds(w, c))?.id ?? null;

const worldOf = (paths, components) => ((w) => ({ ...w, direct: new Set(components.filter((c) => directReason(w, c)).map((c) => c.key)) }))({ paths, components, map: byKey(components) });

// Each component's reason (first that holds, or null), and whether the contract leaves it undecided.
export function reasonsRef(paths, components) {
  const w = worldOf(paths, components);
  const reasons = new Map(components.map((c) => [c.key, reasonOf(w, c)]));
  const onlyUnresolved = new Set([...reasons].filter(([, r]) => r === "UNRESOLVED").map(([k]) => k));
  return components.map((c) => ({ key: c.key, reason: reasons.get(c.key), open: undecided(w, c, reasons.get(c.key), onlyUnresolved) }));
}

const undecided = (w, c, reason, onlyUnresolved) => [null, "UNRESOLVED"].includes(reason) && (dependsOnAny(w.map, c.key, onlyUnresolved, new Set([c.key])) || (w.direct.size === 0 && (c.unresolved ?? []).length > 0));

export const unownedRef = (paths, components) => [...new Set(paths)].filter((p) => !ownerRef(components, p) && !inherited(components, p)).sort();

const reasonIds = (rows) => rows.filter((r) => r.reason).map((r) => `${r.key}:${r.reason}`);

// The whole answer, for an input where nothing is undecided.
export const impactRef = (paths, components) => [...reasonIds(reasonsRef(paths, components)), ...unownedRef(paths, components).map((p) => `unowned:${p}`)].sort();

const decidedHas = (rows) => reasonIds(rows.filter((r) => !r.open));

const decidedLacks = (rows) => rows.filter((r) => !r.open).flatMap((r) => REASONS.filter((x) => x !== r.reason).map((x) => `${r.key}:${x}`));

const ownedLacks = (paths, components) => [...new Set(paths)].filter((p) => !unownedRef(paths, components).includes(p)).map((p) => `unowned:${p}`);

const impactExpect = (paths, components) => ((rows) => ({ has: [...decidedHas(rows), ...unownedRef(paths, components).map((p) => `unowned:${p}`)], lacks: [...decidedLacks(rows), ...ownedLacks(paths, components)] }))(reasonsRef(paths, components));

// ---- what a plan is held to -------------------------------------------------------------------------------------------

const scopeOf = (w) => (w.changes.length ? w.changes : Array.isArray(w.planned) ? w.planned : []);

const checkHolders = (w) => [...new Set(w.checks.map((c) => c.component))];

const ungraphedRef = (w, paths) => (paths.length ? checkHolders(w).filter((k) => !w.graph.components.some((c) => c.key === k)) : []);

const reachedWith = (w, paths) => [...reasonsRef(paths, w.graph.components).filter((r) => r.reason).map((r) => r.key), ...ungraphedRef(w, paths)];

// The components a plan's scope reaches: by the graph, or -- with none -- every component that holds a check.
export const reachedRef = (w) => ((paths) => new Set(w.graph ? reachedWith(w, paths) : paths.length ? checkHolders(w) : []))(scopeOf(w));

const sourceNone = (w) => !w.changes.length && !Array.isArray(w.planned);

export function planExpect(w) {
  const reached = reachedRef(w);
  const required = w.checks.filter((c) => reached.has(c.component)).map((c) => c.id);
  const others = w.checks.map((c) => c.id).filter((id) => !required.includes(id));
  return { has: [...required.map((id) => `required:${id}`), ...(sourceNone(w) ? [] : others.map((id) => `excluded:${id}`)), ...(!w.graph && scopeOf(w).length ? ["word:WIDENED"] : [])], lacks: [...others.map((id) => `required:${id}`), ...required.map((id) => `excluded:${id}`), ...(w.graph ? ["word:WIDENED"] : [])] };
}

// ---- what the inputs are made of --------------------------------------------------------------------------------------

const node = (key, dir, dependsOn = [], extra = {}) => ({ key, dir, kind: "library", live: null, dependsOn, inherits: [], unresolved: [], ...extra });

// A monorepo: a web client and an api over a contracts package and a shared library, the api over a database
// package, and an infrastructure folder nothing depends on.
const MONO = [node("c:web", "web", ["c:contracts", "c:lib"]), node("c:api", "api", ["c:contracts", "c:lib", "c:db"]), node("c:contracts", "contracts"), node("c:lib", "lib"), node("c:db", "db"), node("c:infra", "infra")];

// A chain: the gateway over the api, over the domain, over the core -- and documentation beside it.
const CHAIN = [node("k-gateway", "gateway", ["k-api"]), node("k-api", "api", ["k-domain"]), node("k-domain", "domain", ["k-core"]), node("k-core", "core"), node("k-docs", "docs")];

const NESTED = [node("k-root", "."), node("k-packages", "packages"), node("k-ui", "packages/ui"), node("k-ui-kit", "packages/ui-kit", ["k-ui"])];

const LEGACY = [...MONO, node("c:legacy", "legacy", [], { unresolved: ["../vendor/Old.csproj"] })];

const TSCONFIG = "tsconfig.base.json";

const SHARING = [node("c:web", "web", ["c:lib"], { inherits: [TSCONFIG] }), node("c:api", "api", ["c:lib"], { inherits: [TSCONFIG, "web/shared.css"] }), node("c:lib", "lib"), node("c:admin", "admin", ["c:web"])];

const CYCLE = [node("k-a", "a", ["k-b"]), node("k-b", "b", ["k-a"]), node("k-c", "c")];

const impact = (paths, components) => ({ call: "impact", paths, graph: { components } });

const exact = (group, paths, components, ids) => ({ group, input: impact(paths, components), expect: { exactly: ids } });

const STRUCTURE = [
  exact("modified", ["web/src/App.tsx"], MONO, ["c:web:MODIFIED"]),
  exact("modified", ["packages/ui/Button.tsx"], NESTED, ["k-ui:MODIFIED", "k-ui-kit:DEPENDENT"]),
  exact("modified", ["packages/other/index.ts"], NESTED, ["k-packages:MODIFIED"]),
  exact("modified", ["README.md"], NESTED, ["k-root:MODIFIED"]),
  exact("modified", ["packages/ui-kit/Card.tsx"], NESTED, ["k-ui-kit:MODIFIED"]),
  exact("directory-not-prefix", ["webhooks/hook.ts"], MONO, ["unowned:webhooks/hook.ts"]),
  exact("directory-not-prefix", ["library/legacy.ts"], [node("k-root", "."), node("k-lib", "lib"), node("k-app", "app", ["k-lib"])], ["k-root:MODIFIED"]),
  exact("directory-not-prefix", ["libs/core-extra/x.ts"], [node("k-lib", "lib"), node("k-core", "libs/core"), node("k-app", "app", ["k-core"])], ["unowned:libs/core-extra/x.ts"]),
  exact("directory-not-prefix", ["apiary/x.cs", "dbx/seed.sql"], MONO, ["unowned:apiary/x.cs", "unowned:dbx/seed.sql"]),
  exact("directory-not-prefix", ["packages/uix/z.ts"], NESTED, ["k-packages:MODIFIED"]),
  exact("unowned", ["docs/notes.md"], MONO, ["unowned:docs/notes.md"]),
  exact("unowned", ["docs/b.md", "docs/a.md", "docs/b.md"], MONO, ["unowned:docs/a.md", "unowned:docs/b.md"]),
  exact("unowned", ["web/a.ts", "tools/gen.mjs"], MONO, ["c:web:MODIFIED", "unowned:tools/gen.mjs"]),
  exact("shared", [TSCONFIG], SHARING, ["c:web:SHARED", "c:api:SHARED", "c:admin:DEPENDENT"]),
  exact("shared", ["web/shared.css"], SHARING, ["c:web:MODIFIED", "c:api:SHARED", "c:admin:DEPENDENT"]),
  exact("dependent", ["core/id.ts"], CHAIN, ["k-core:MODIFIED", "k-domain:DEPENDENT", "k-api:DEPENDENT", "k-gateway:DEPENDENT"]),
  exact("dependent", ["api/routes.ts"], CHAIN, ["k-api:MODIFIED", "k-gateway:DEPENDENT"]),
  exact("dependent", ["lib/money.ts"], MONO, ["c:lib:MODIFIED", "c:web:DEPENDENT", "c:api:DEPENDENT"]),
  exact("dependent", ["db/migrations/001.sql"], MONO, ["c:db:MODIFIED", "c:api:DEPENDENT"]),
  exact("dependent", ["a/x.ts"], CYCLE, ["k-a:MODIFIED", "k-b:DEPENDENT"]),
  exact("unresolved", ["web/a.ts"], LEGACY, ["c:web:MODIFIED", "c:legacy:UNRESOLVED"]),
  exact("unresolved", ["infra/main.tf"], LEGACY, ["c:infra:MODIFIED", "c:legacy:UNRESOLVED"]),
  exact("first-reason", ["legacy/Old.cs"], LEGACY, ["c:legacy:MODIFIED"]),
  exact("first-reason", [TSCONFIG, "lib/x.ts"], SHARING, ["c:lib:MODIFIED", "c:web:SHARED", "c:api:SHARED", "c:admin:DEPENDENT"]),
  exact("first-reason", ["lib/x.ts"], [...MONO, node("c:jobs", "jobs", ["c:lib"], { unresolved: ["../ext/Queue.csproj"] })], ["c:lib:MODIFIED", "c:web:DEPENDENT", "c:api:DEPENDENT", "c:jobs:DEPENDENT"]),
  exact("unrelated", ["infra/main.tf"], MONO, ["c:infra:MODIFIED"]),
  exact("unrelated", ["docs/x.md"], CHAIN, ["k-docs:MODIFIED"]),
  exact("unrelated", [], LEGACY, []),
];

const dependents = (group, components, key, ids) => ({ group, input: { call: "dependents", components, key }, expect: { exactly: ids } });

const DEPENDENTS = [
  dependents("dependents-of", MONO, "c:lib", ["c:web", "c:api"]),
  dependents("dependents-of", CHAIN, "k-core", ["k-domain", "k-api", "k-gateway"]),
  dependents("dependents-of", CHAIN, "k-domain", ["k-api", "k-gateway"]),
  dependents("dependents-of", CHAIN, "k-gateway", []),
  dependents("dependents-of", CYCLE, "k-a", ["k-b"]),
  dependents("dependents-of", [node("k-self", "self", ["k-self"]), node("k-user", "user", ["k-self"])], "k-self", ["k-user"]),
];

// ---- plans: the declared checks a change is held to -----------------------------------------------------------------

const chk = (id, component, purpose = "test") => ({ id, purpose, component, declaredAs: `${purpose}:${id}` });

const MONO_CHECKS = [chk("rt-web-build", "c:web", "build"), chk("rt-web-test", "c:web"), chk("rt-api-build", "c:api", "build"), chk("rt-api-test", "c:api"), chk("rt-lib-test", "c:lib"), chk("rt-db-test", "c:db"), chk("rt-infra-verify", "c:infra", "verify")];

const plan = (group, w) => ({ group, input: { call: "plan", world: w }, expect: planExpect(w) });

const PLANS = [
  plan("held-to-reached", { changes: ["web/src/App.tsx"], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("held-to-reached", { changes: ["lib/money.ts"], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("held-to-reached", { changes: ["infra/main.tf", "db/x.sql"], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("held-to-reached", { changes: ["webhooks/hook.ts"], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("held-to-reached", { changes: ["core/id.ts"], checks: [chk("rt-gw", "k-gateway"), chk("rt-core", "k-core"), chk("rt-docs", "k-docs", "verify")], graph: { components: CHAIN } }),
  plan("scope", { changes: [], planned: ["api/Refunds.cs"], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("scope", { changes: ["infra/main.tf"], planned: ["web/src/App.tsx"], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("scope", { changes: [], checks: MONO_CHECKS, graph: { components: MONO } }),
  plan("no-graph-widened", { changes: ["anything/at/all.ts"], checks: MONO_CHECKS }),
  plan("no-graph-widened", { changes: [], planned: ["docs/x.md"], checks: MONO_CHECKS }),
  plan("no-graph-widened", { changes: [], checks: MONO_CHECKS }),
  plan("ungraphed-held", { changes: ["web/src/App.tsx"], checks: [...MONO_CHECKS, chk("rt-mobile-test", "c:mobile")], graph: { components: MONO } }),
  plan("ungraphed-held", { changes: [], checks: [...MONO_CHECKS, chk("rt-mobile-test", "c:mobile")], graph: { components: MONO } }),
];

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const some = (r, list, n) => list.filter(() => r() < n / list.length);

const DIRS = ["api", "apps/api", "apps/web", "lib", "libs/core", "web", "packages/ui", "services/billing", "db", "infra", "tools"];

// Paths in the directories above, and in siblings whose names only start like them.
const PATHS = ["api/src/Refunds.cs", "api-gateway/routes.ts", "apps/api/handler.ts", "apps/api-docs/index.md", "apps/web/App.tsx", "apps/webhooks/hook.ts", "lib/money.ts", "library/legacy.ts", "libs/core/id.ts", "libs/core-extra/x.ts", "web/index.html", "webapp/main.js", "packages/ui/Button.tsx", "packages/ui-kit/Card.tsx", "services/billing/Invoice.cs", "services/billing-old/Invoice.cs", "db/migrations/001.sql", "dbtools/seed.sql", "infra/main.tf", "infrastructure/legacy.tf", "tools/gen.mjs", "toolsets/x.mjs", "docs/README.md", "README.md"];

const SHARED = ["Directory.Build.props", "tsconfig.base.json", "package.json", "shared/settings.json"];

const keyOf = (dir) => (isRoot(dir) ? "k-root" : `k-${dir.replace(/\//g, "-")}`);

const seededNode = (r, dir, dirs) => node(keyOf(dir), dir, some(r, dirs.filter((d) => d !== dir), 1.2).map(keyOf), { inherits: r() < 0.3 ? [pick(r, SHARED)] : [], unresolved: r() < 0.15 ? ["../vendor/Missing.csproj"] : [] });

// At least two components, and now and then a root one that holds everything the others do not.
function seededGraph(r) {
  const chosen = some(r, DIRS, 4.5);
  const dirs = [...(chosen.length > 1 ? chosen : [pick(r, DIRS.slice(0, 5)), pick(r, DIRS.slice(5))]), ...(r() < 0.3 ? ["."] : [])];
  return dirs.map((dir) => seededNode(r, dir, dirs));
}

const seededPaths = (r) => [...Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, PATHS)), ...(r() < 0.3 ? [pick(r, SHARED)] : [])];

const seededImpact = (r) => ((components, paths) => ({ group: "seeded-graph", input: impact(paths, components), expect: impactExpect(paths, components) }))(seededGraph(r), seededPaths(r));

const seededDependents = (r) => ((components) => ((key) => dependents("seeded-dependents", components, key, dependentsRef(components, key)))(pick(r, components.map((c) => c.key))))(seededGraph(r));

const PURPOSES = ["build", "verify", "test"];

const seededChecks = (r, components) => [...components.filter(() => r() < 0.7).map((c, i) => chk(`rt-${i}-${c.key}`, c.key, pick(r, PURPOSES))), ...(r() < 0.3 ? [chk("rt-elsewhere", "k-elsewhere")] : [])];

// A plan over a graph with nothing unresolved: what it reaches is always decided.
const seededPlan = (r) => ((components) => plan("seeded-plan", { changes: seededPaths(r), checks: seededChecks(r, components), ...(r() < 0.2 ? {} : { graph: { components } }) }))(seededGraph(r).map((c) => ({ ...c, unresolved: [] })));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

const times = (n, make) => Array.from({ length: n }, make);

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, samples);
  return numbered([...STRUCTURE, ...DEPENDENTS, ...PLANS, ...times(n, () => seededImpact(r)), ...times(Math.max(4, Math.floor(n / 4)), () => seededDependents(r)), ...times(Math.max(4, Math.floor(n / 3)), () => seededPlan(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["a change in the web client reaches it alone", ["web/src/App.tsx"], MONO, ["c:web:MODIFIED"]],
  ["a change in the shared library reaches both its users", ["lib/money.ts"], MONO, ["c:lib:MODIFIED", "c:web:DEPENDENT", "c:api:DEPENDENT"]],
  ["a change at the bottom of a chain reaches all the way up it", ["core/id.ts"], CHAIN, ["k-core:MODIFIED", "k-domain:DEPENDENT", "k-api:DEPENDENT", "k-gateway:DEPENDENT"]],
  ["a sibling whose name starts like a component is not in it", ["webhooks/hook.ts"], MONO, ["unowned:webhooks/hook.ts"]],
  ["a nested component owns what lies under it", ["packages/ui/Button.tsx"], NESTED, ["k-ui:MODIFIED", "k-ui-kit:DEPENDENT"]],
  ["a changed shared file reaches those that inherit it, and is owned by nobody", [TSCONFIG], SHARING, ["c:web:SHARED", "c:api:SHARED", "c:admin:DEPENDENT"]],
  ["an unresolved reference is reached once anything is", ["infra/main.tf"], LEGACY, ["c:infra:MODIFIED", "c:legacy:UNRESOLVED"]],
  ["a component modified and unresolved is MODIFIED", ["legacy/Old.cs"], LEGACY, ["c:legacy:MODIFIED"]],
  ["a cycle reaches the other side and stops", ["a/x.ts"], CYCLE, ["k-a:MODIFIED", "k-b:DEPENDENT"]],
  ["nothing changed reaches nothing", [], LEGACY, []],
];

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => HAND.filter(([, paths, components, want]) => !sameIds(impactRef(paths, components), want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const exactFindings = () => STRUCTURE.filter((c) => !sameIds(impactRef(c.input.paths, c.input.graph.components), c.expect.exactly)).map((c) => `a fixed check is not what the reference model derives: ${c.group} ${JSON.stringify(c.input.paths)}`);

const dependentFindings = () => DEPENDENTS.filter((c) => !sameIds(dependentsRef(c.input.components, c.input.key), c.expect.exactly)).map((c) => `a fixed dependents check is not what the reference model derives: ${c.input.key}`);

export const selfTest = () => [...handFindings(), ...exactFindings(), ...dependentFindings()];
