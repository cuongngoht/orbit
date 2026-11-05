// WHAT A TASK TOUCHES (0.5.0, B21): the `relevant` section of the context package, from evidence the owners already
// hold, every item naming its evidence and its freshness -- and a reference the tracked tree does not hold refused by
// name and never listed. Pure: src/context/relevance.mjs and src/context/refs.mjs are handed what each owner said; the
// composition over a real checkout is test/context-grounding.test.mjs.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { CLASSES, LISTING_LIMIT, RELEVANCE_LIMIT, basisOf, freshened, named, relevanceLines, relevanceOf, weightOf } from "../src/context/relevance.mjs";
import { MAX_REFS, envelopeOf, symbolPattern, symbolsOf, treeOf, verifiedRefs } from "../src/context/refs.mjs";
import { identifierTokens } from "../src/tokens.mjs";

const TRACKED = [
  "src/orders/createOrder.mjs", "src/orders/cancelOrder.mjs", "src/orders/listOrders.mjs",
  "src/db/pool.mjs", "src/db/migrate.mjs", "src/db/seed.mjs",
  "src/api/routes.mjs", "src/api/server.mjs", "src/api/auth.mjs",
  "src/report/summary.mjs", "worker/consume.mjs", "compose.yaml",
  "package.json", "packages/web/package.json", "packages/web/app.mjs", "README.md",
];
const tree = treeOf(TRACKED);
const TASK = "make createOrder refuse an empty order";

const module = (key) => ({ id: `arch-module-${key.replace(/\W/g, "")}`, kind: "module", key, scope: [key], evidence: [key] });
const boundary = (from, to) => ({ id: `arch-boundary-${from.replace(/\W/g, "")}-${to.replace(/\W/g, "")}`, kind: "boundary", key: `${from} -> ${to}`, scope: [from, to], evidence: [from, to] });
const gate = (manifest, name) => ({ id: `arch-invariant-${manifest.replace(/\W/g, "")}-${name}`, kind: "invariant", key: `${manifest}#${name}`, scope: [manifest], evidence: [manifest] });
const node = (key, name, evidence) => ({ id: `arch-node-${name}`, kind: "node", key, name, nodeKind: "component", scope: evidence, evidence });
const relation = (from, to) => ({ id: `arch-relation-${from.split(":")[1]}-${to.split(":")[1]}`, kind: "relation", key: `${from} calls ${to}`, relation: "calls", from, to, scope: ["compose.yaml"], evidence: ["compose.yaml"] });

const ARCHITECTURE = [module("src/orders"), module("src/db"), module("src/api"), boundary("src/orders", "src/db"), boundary("src/api", "src/orders"), gate("package.json", "test"), gate("packages/web/package.json", "test")];

const byRef = (listing) => Object.fromEntries(listing.items.map((i) => [`${i.kind}:${i.ref}`, i]));
const sources = (item) => item.evidence.map((e) => e.source);

// ---- the words a task names -------------------------------------------------------------------------------------------

test("an identifier is split before it is matched: createOrder names 'create order', and a name is named only when every word is the task's", () => {
  assert.deepEqual(identifierTokens("createOrder HTTPServer order_items"), ["create", "order", "http", "server", "items"]);
  const want = new Set(identifierTokens(TASK));
  assert.equal(named(want, "createOrder"), true);
  assert.equal(named(want, "orders"), true, "give or take a plural");
  assert.equal(named(want, "cancelOrder"), false, "cancel is not one of the task's words");
  assert.equal(named(want, ""), false, "a name with no words names nothing");
  assert.equal(named(new Set(identifierTokens("sửa luồng tạo đơn hàng")), "createOrder"), false, "no identifier, no word: nothing is matched on a guess");
});

// ---- references a host proposes -------------------------------------------------------------------------------------

const HITS = { createOrder: [{ path: "src/orders/createOrder.mjs", line: 3, text: "export function createOrder(order) {" }, { path: "src/api/routes.mjs", line: 1, text: "import { createOrder } from '../orders/createOrder.mjs';" }], nowhere: [], unsearched: null, createOrderLine: [{ path: "src/orders/createOrder.mjs", line: 9, text: "const createOrderLines = [];" }] };

test("a reference the tracked tree does not hold is refused by name, with the reason -- and never listed", () => {
  const refs = [
    { kind: "file", ref: "src/db/pool.mjs", why: "the insert happens here" },
    { kind: "file", ref: "src/orders/invented.mjs" },
    { kind: "file", ref: "src/orders" },
    { kind: "file", ref: "../outside.mjs" },
    { kind: "file", ref: "/etc/passwd" },
    { kind: "file", ref: "https://example.test/x.mjs" },
    { kind: "symbol", ref: "createOrder" },
    { kind: "symbol", ref: "nowhere" },
    { kind: "symbol", ref: "unsearched" },
    { kind: "symbol", ref: "createOrderLine" },
    { kind: "symbol", ref: "Orders.createOrder" },
    { kind: "class", ref: "Order" },
    { kind: "file", ref: "README.md", confidence: "high" },
  ];
  const { held, refused } = verifiedRefs(refs, { ...tree, hits: HITS, maxFiles: 1000 });
  assert.deepEqual(held.map((r) => `${r.kind}:${r.ref}`), ["file:src/db/pool.mjs", "symbol:createOrder"]);
  assert.deepEqual(held[1].where, [{ path: "src/orders/createOrder.mjs", line: 3 }, { path: "src/api/routes.mjs", line: 1 }]);
  const why = Object.fromEntries(refused.map((r) => [r.ref, r.why]));
  assert.match(why["src/orders/invented.mjs"], /the tracked tree holds no such file/);
  assert.match(why["src/orders"], /a directory the tree holds, not a file/);
  for (const bad of ["../outside.mjs", "/etc/passwd", "https://example.test/x.mjs"]) assert.match(why[bad], /repository-relative path/, bad);
  assert.match(why.nowhere, /no tracked file holds that identifier as a whole word/);
  assert.match(why.unsearched, /could not be searched/);
  assert.match(why.createOrderLine, /as a whole word/, "a longer identifier that contains it is not it");
  assert.match(why["Orders.createOrder"], /ONE identifier/);
  assert.match(why.Order, /kind is one of file, symbol/);
  assert.match(why["README.md"], /unknown field "confidence"/);
  const listing = relevanceOf({ task: TASK, tree, refs: held, architecture: ARCHITECTURE });
  for (const r of refused) assert.equal(listing.items.some((i) => i.kind === r.kind && i.ref === r.ref), false, `${r.kind} ${r.ref} is never listed`);
  assert.equal(listing.items.some((i) => i.by === "host-verified" && !held.some((h) => h.ref === i.ref)), false, "nothing the host proposed is listed unless the tree held it");
  const dir = listing.items.find((i) => i.ref === "src/orders");
  assert.deepEqual([dir.kind, dir.by], ["component", "engine"], "the directory refused as a file is the engine's own component, on the engine's own evidence");
});

test("with no tracked tree to ask, every proposed reference is refused and no path is listed", () => {
  const { held, refused } = verifiedRefs([{ kind: "file", ref: "src/db/pool.mjs" }, { kind: "symbol", ref: "createOrder" }], null);
  assert.deepEqual(held, []);
  assert.deepEqual(refused.map((r) => r.why), ["the tracked tree could not be listed here, so nothing can be verified against it", "the tracked tree could not be searched for it here"]);
  const listing = relevanceOf({ task: TASK, tree: null, architecture: ARCHITECTURE, refs: [{ kind: "file", ref: "src/db/pool.mjs", where: [] }] });
  assert.deepEqual(listing.items.filter((i) => i.kind === "file" || i.kind === "component"), [], "nothing the tree was not asked about is listed");
});

test("the envelope on stdin is held to its shape, and its bound refuses the whole call", () => {
  assert.deepEqual(envelopeOf('{ "task": "t", "refs": [{ "kind": "file", "ref": "a" }] }'), { task: "t", refs: [{ kind: "file", ref: "a" }] });
  assert.deepEqual(envelopeOf('{ "refs": [] }'), { task: null, refs: [] });
  assert.match(envelopeOf("not json").problem, /one JSON object on stdin/);
  assert.match(envelopeOf("[]").problem, /one JSON object on stdin/);
  assert.match(envelopeOf('{ "task": "t", "verdict": "pass" }').problem, /unknown field "verdict"/);
  assert.match(envelopeOf('{ "refs": {} }').problem, /refs is a list/);
  assert.match(envelopeOf(JSON.stringify({ refs: Array.from({ length: MAX_REFS + 1 }, (_, i) => ({ kind: "file", ref: `f${i}` })) })).problem, new RegExp(`at most ${MAX_REFS} references`));
  assert.match(verifiedRefs([{ kind: "file", ref: "README.md", why: "token=ghp_0123456789abcdefghijklmnopqrstuvwxyz" }], tree).refused[0].why, /looks like a secret/);
});

test("one search per symbol, as a whole word git and JavaScript read alike", () => {
  assert.deepEqual(symbolsOf([{ kind: "symbol", ref: "a$b" }, { kind: "symbol", ref: "a$b" }, { kind: "symbol", ref: "x.y" }, { kind: "file", ref: "z" }]), ["a$b"]);
  const word = new RegExp(symbolPattern("a$b"));
  assert.equal(word.test("const a$b = 1"), true);
  assert.equal(word.test("const xa$b = 1"), false);
  assert.equal(word.test("a$bc()"), false);
});

// ---- each class, from its own evidence ----------------------------------------------------------------------------

test("each class comes from its own evidence: named, depended on, depending, holding it, or merely present", () => {
  const nodes = [node("component:orders", "orders", ["compose.yaml"]), node("component:ledger", "ledger", ["compose.yaml"]), node("component:shipping", "shipping", ["compose.yaml"])];
  const relations = [relation("component:orders", "component:ledger"), relation("component:shipping", "component:orders"), { ...relation("component:orders", "component:x"), to: "unknown", id: "arch-relation-unknown" }];
  const integration = { id: "intel-integration-ledger-store", kind: "integration", key: "ledger-store:write", integration: "ledger-store", operation: "write", evidence: ["src/orders/createOrder.mjs"], scope: ["src/orders"] };
  const engineering = [{ id: "eng-convention-handlers", kind: "convention", key: "handler-shape", examples: [{ path: "src/report/summary.mjs", role: "example" }], evidence: ["src/report/summary.mjs"], scope: ["src/report"] }];
  const knowledge = [{ id: "k-000000000001", subject: "billing.invoice", object: "billing.ledger", paths: ["worker/consume.mjs"] }];
  const plan = { components: [{ key: ".", reason: "MODIFIED" }, { key: "web", reason: "DEPENDENT" }, { key: "tools", reason: "UNRESOLVED" }], checks: [{ id: "cmd-test", component: ".", declaredAs: "test" }] };
  const listing = relevanceOf({ task: `${TASK} in src/report/summary.mjs`, tree, refs: [{ kind: "symbol", ref: "createOrder", where: [{ path: "src/orders/createOrder.mjs", line: 3 }] }], architecture: [...ARCHITECTURE, ...nodes, ...relations], intelligence: [integration], engineering, knowledge, workingSet: { changed: ["src/api/auth.mjs", "src/gone.mjs"], read: [] }, plan });
  const at = byRef(listing);
  const said = (key) => [at[key]?.class, sources(at[key] ?? { evidence: [] })];
  assert.deepEqual(said("file:src/orders/createOrder.mjs"), ["direct", ["name", "tree"]], "every word of its name is the task's");
  assert.deepEqual(said("component:ledger-store:write"), ["dependency", ["intelligence"]], "a direct file does this integration");
  assert.deepEqual(said("file:src/report/summary.mjs"), ["direct", ["request", "name", "tree", "engineering"]], "the task writes the path out (and so names it)");
  assert.deepEqual(said("symbol:createOrder"), ["direct", ["tree"]], "a host's symbol the tree holds");
  assert.deepEqual(at["component:src/orders"].class, "direct", "the module a direct path lies in");
  assert.deepEqual(said("component:component:orders"), ["direct", ["graph"]], "a system-graph node the task names");
  assert.deepEqual(said("component:src/db"), ["dependency", ["architecture"]], "a direct module imports it");
  assert.deepEqual(said("component:component:ledger"), ["dependency", ["graph"]], "a direct node has an edge to it");
  assert.deepEqual(said("component:src/api"), ["downstream", ["architecture"]], "it imports a direct module");
  assert.deepEqual(said("component:component:shipping"), ["downstream", ["graph"]], "it has an edge to a direct node");
  assert.deepEqual(said("component:web"), ["downstream", ["impact"]], "impact.mjs says the change reaches it");
  assert.deepEqual(said("component:."), ["direct", ["impact"]], "a direct path lies in it");
  assert.deepEqual(said("check:cmd-test"), ["verification", ["obligations", "runtime"]], "obligations.mjs requires it of what the change reaches");
  assert.deepEqual(at["check:cmd-test"].evidence, [{ source: "obligations", id: "." }, { source: "runtime", id: "test" }], "the component it holds, and the name the checkout declared it by");
  assert.deepEqual(said("file:worker/consume.mjs"), ["unknown", ["knowledge"]], "knowledge recalled it, and the task names neither end of the claim");
  assert.deepEqual(said("file:src/api/auth.mjs"), ["unknown", ["working-set"]], "the latest session changed it");
  assert.deepEqual(said("component:tools"), ["unknown", ["impact"]], "what it depends on nothing resolves");
  assert.equal(at["file:src/gone.mjs"], undefined, "a path the tree does not hold is never listed, whoever cites it");
  assert.equal(at["component:unknown"], undefined, "an end the graph does not fix is never an item");
  assert.equal(Object.keys(at).some((k) => k.startsWith("check:package.json")), false, "with the change's own checks known, no manifest gate is listed beside them");
  assert.ok(listing.items.every((i) => i.evidence.length > 0), "every item names its evidence");
  assert.deepEqual([...new Set(listing.items.map((i) => i.class))], CLASSES.filter((c) => listing.items.some((i) => i.class === c)), "ordered by class");
});

test("a capability the task names lists where it is PROVIDED; one recorded as absent names nothing the task touches", () => {
  const provided = { id: "arch-capability-ledger", kind: "capability", key: "ledger", capability: "ledger", providedBy: "src/db", scope: ["src/db"], evidence: ["src/db"] };
  const absent = { id: "arch-capability-vault", kind: "capability", key: "vault", capability: "vault", scope: ["package.json"], evidence: ["package.json"] };
  const listing = relevanceOf({ task: "write the order to the Ledger, through the Vault", tree, architecture: [provided, absent] });
  assert.deepEqual(listing.items.filter((i) => sources(i).includes("architecture")).map((i) => [i.ref, i.class]), [["src/db", "direct"]]);
});

test("with no runtime graph, a direct path is held by the gates its own unit's manifest declares -- the deepest unit only", () => {
  const web = relevanceOf({ task: "the web app", tree, refs: [{ kind: "file", ref: "packages/web/app.mjs", where: [] }], architecture: ARCHITECTURE });
  assert.deepEqual(web.items.filter((i) => i.class === "verification").map((i) => i.ref), ["packages/web/package.json#test"]);
  const root = relevanceOf({ task: TASK, tree, architecture: ARCHITECTURE });
  assert.deepEqual(root.items.filter((i) => i.class === "verification").map((i) => [i.kind, i.ref, sources(i)]), [["check", "package.json#test", ["architecture"]]]);
});

test("a name the tree uses in many places names none of them -- unless the task names where it lies -- and the listing's names never crowd out what an owner holds", () => {
  const many = ["alpha/index.mjs", "bravo/index.mjs", "charlie/index.mjs", "delta/index.mjs", "echo/handler.mjs"];
  const common = relevanceOf({ task: "fix the index handler", tree: treeOf(many) });
  assert.deepEqual(common.items.map((i) => i.ref), ["echo/handler.mjs"], "four index.mjs files: the word names none of them");
  const placed = relevanceOf({ task: "fix the charlie index", tree: treeOf(many) });
  assert.deepEqual(placed.items.filter((i) => i.kind === "file").map((i) => [i.ref, i.evidence[0].id]), [["charlie/index.mjs", "charlie index"]], "the task names the directory it lies in too");
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
  const listed = relevanceOf({ task: words.join(" "), tree: treeOf([...words.map((w) => `n/${w}.mjs`), "src/db/pool.mjs"]), architecture: [module("src/db")], refs: [{ kind: "file", ref: "src/db/pool.mjs", where: [] }] });
  assert.equal(listed.items.filter((i) => sources(i).every((s) => s === "name" || s === "tree") && i.by === "engine").length, LISTING_LIMIT);
  assert.equal(listed.byClass.direct, words.length + 2, "what is set aside is still counted");
  assert.equal(listed.more, listed.total - listed.items.length);
});

test("at most 40 items, ordered by class and then by evidence weight, with the rest counted", () => {
  const targets = Array.from({ length: 60 }, (_, i) => `lib/m${String(i).padStart(2, "0")}`);
  const files = [...TRACKED, ...targets.map((t) => `${t}/x.mjs`)];
  const edges = [...targets.map((t) => boundary("src/orders", t)), boundary("src/db", "lib/m59"), boundary("src/api", "src/orders")];
  const architecture = [module("src/orders"), module("src/db"), module("src/api"), ...targets.map(module), ...edges];
  const listing = relevanceOf({ task: TASK, tree: treeOf(files), architecture, refs: [{ kind: "file", ref: "src/db/pool.mjs", where: [] }] });
  assert.equal(listing.items.length, RELEVANCE_LIMIT);
  assert.equal(listing.total, 4 + 60 + 1, "the named file and its module, the proposed file and its module, the 60 they import, and the module that imports one");
  assert.equal(listing.more, listing.total - RELEVANCE_LIMIT);
  assert.deepEqual(listing.byClass, { direct: 4, dependency: 60, downstream: 1, verification: 0, unknown: 0 });
  const ranks = listing.items.map((i) => CLASSES.indexOf(i.class));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "class first");
  const dependency = listing.items.filter((i) => i.class === "dependency");
  assert.deepEqual(dependency.map(weightOf), [...dependency.map(weightOf)].sort((a, b) => b - a), "then evidence weight");
  assert.equal(dependency[0].ref, "lib/m59", "two direct modules import it: the heaviest evidence comes first");
});

// ---- freshness ------------------------------------------------------------------------------------------------------

test("freshness is the least fresh of what an item rests on -- each record measured on its own, never one HEAD for all", () => {
  const listing = relevanceOf({ task: TASK, tree, architecture: ARCHITECTURE });
  const basis = basisOf(listing);
  assert.ok(basis.some((b) => b.owner === "architecture" && b.id === "arch-module-srcorders"), "a fact an item rests on is measured");
  assert.ok(basis.some((b) => b.owner === "tree" && b.id === "src/orders/createOrder.mjs"), "and a path the tree vouches for");
  const states = Object.fromEntries(basis.map((b) => [`${b.owner}:${b.id}`, "fresh"]));
  const current = freshened(listing, states);
  assert.ok(current.relevant.every((i) => i.freshness === "current"));
  assert.deepEqual(current.stale, []);
  const moved = freshened(listing, { ...states, "architecture:arch-module-srcorders": "stale", "architecture:arch-boundary-srcorders-srcdb": "stale", "tree:src/orders/createOrder.mjs": "unknown" });
  const at = Object.fromEntries(moved.relevant.map((i) => [i.ref, i.freshness]));
  assert.deepEqual([at["src/orders"], at["src/db"], at["src/orders/createOrder.mjs"], at["src/api"]], ["stale", "stale", "unknown", "current"], "the module and the edge that moved are stale; the file with an edit the index cannot see is unknown; an edge that did not move is current");
  assert.deepEqual(moved.stale, [{ ref: "src/orders", owner: "architecture", id: "arch-module-srcorders" }], "only what a direct or verification item rests on is a reason to re-read");
  assert.deepEqual(freshened(listing, {}).relevant.map((i) => i.freshness), listing.items.map(() => "unknown"), "nothing measured is unknown, never current");
  assert.deepEqual(Object.keys(current.relevant[0]), ["kind", "ref", "class", "evidence", "freshness", "by"]);
});

// ---- the text --------------------------------------------------------------------------------------------------------

test("the section a terminal reads is held to its line bound, says what it left out, and names every refused reference", () => {
  const targets = Array.from({ length: 50 }, (_, i) => `lib/m${String(i).padStart(2, "0")}`);
  const listing = relevanceOf({ task: TASK, tree: treeOf([...TRACKED, ...targets.map((t) => `${t}/x.mjs`)]), architecture: [module("src/orders"), ...targets.map(module), ...targets.map((t) => boundary("src/orders", t))] });
  const refused = ["a", "b", "c", "d", "e"].map((n) => ({ kind: "file", ref: `src/${n}\u001b[2J.mjs`, why: "the tracked tree holds no such file" }));
  const lines = relevanceLines(freshened(listing, {}).relevant, { ...listing, refused }, 24);
  assert.ok(lines.length <= 24, `${lines.length} lines`);
  assert.match(lines[0], new RegExp(`^${listing.total} item\\(s\\), by class then evidence`));
  assert.ok(lines.some((l) => /… \d+ more -- `--json` lists 40/.test(l)));
  assert.equal(lines.filter((l) => /^ {2}refused/.test(l)).length, 3);
  assert.ok(lines.some((l) => /… 2 more reference\(s\) refused/.test(l)));
  assert.equal(lines.some((l) => l.includes("\u001b")), false, "a name from a host reaches a terminal printable");
});

// ---- the boundary: src/context/ is data ----------------------------------------------------------------------------

test("src/context imports only leaves: no owner is reached from here -- the composition root hands everything in", () => {
  const dir = new URL("../src/context/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
    const imports = [...readFileSync(new URL(file, dir), "utf8").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    for (const spec of imports) assert.match(spec, /^(\.\/[a-z-]+\.mjs|\.\.\/(tokens|printable|scrub|errors)\.mjs)$/, `src/context/${file} imports ${spec}`);
  }
});
