// The context package's `relevant` section and `sufficiency` word, composed over a REAL checkout (0.5.0, B21;
// cli/context-grounding.mjs): from what architecture, intelligence, engineering, knowledge, the working set and the
// runtime graph already hold, with every reference a host proposes verified against the tracked tree -- and a question
// asked only when one is already open about the task's own work. The tables themselves are
// test/context-relevance.test.mjs and test/context-sufficiency.test.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { CLASSES, FRESHNESS, ITEM_KINDS, RELEVANCE_LIMIT } from "../src/context/relevance.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { rootId, sourceRecord, workitemText } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { loginApp } from "./fakes/relations.mjs";
import { sealed } from "./home.mjs";

const ENGINE = fileURLToPath(new URL("..", import.meta.url));
const TEMP = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-context-grounding-")));
after(() => rmSync(TEMP, { recursive: true, force: true }));

const TASK = "make createOrder refuse an empty order";

const FILES = {
  "src/orders/createOrder.mjs": 'import { pool } from "../db/pool.mjs";\nexport function createOrder(order) { return pool.insert(order); }\n',
  "src/orders/cancelOrder.mjs": "export const cancelOrder = () => null;\n",
  "src/orders/listOrders.mjs": "export const listOrders = () => [];\n",
  "src/db/pool.mjs": "export const pool = { insert: (x) => x };\n",
  "src/db/migrate.mjs": "export const migrate = () => 0;\n",
  "src/db/seed.mjs": "export const seed = () => 0;\n",
  "src/api/routes.mjs": 'import { createOrder } from "../orders/createOrder.mjs";\nexport const routes = { createOrder };\n',
  "src/api/server.mjs": "export const server = 1;\n",
  "src/api/auth.mjs": "export const auth = 1;\n",
  "package.json": '{ "name": "shop", "scripts": { "test": "node --test" } }\n',
  "README.md": "# shop\n",
};

const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], { encoding: "utf8" });

const envOf = (name) => Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: join(TEMP, `${name}-store`) })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));

function checkout(name, extra = {}, files = FILES) {
  const root = join(TEMP, name);
  for (const [path, text] of Object.entries({ ...files, ...extra })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync("git", ["init", "-q", root]);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return { root, env: envOf(name) };
}

const cli = (at, name, args, input) => spawnSync(process.execPath, [join(ENGINE, "cli", `${name}.mjs`), ...args], { cwd: at.root, env: at.env, encoding: "utf8", input, timeout: 180000 });

function json(at, name, args, input) {
  const r = cli(at, name, args, input);
  assert.equal(r.status, 0, `${name} ${args.join(" ")}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const context = (at, args = [`--for=${TASK}`], input) => json(at, "context", [...args, "--json"], input);

const withRefs = (refs, task = TASK) => JSON.stringify({ task, refs });

const at = (pkg) => Object.fromEntries(pkg.relevant.map((i) => [`${i.kind}:${i.ref}`, i]));

test("the package lists what the task touches, every item with its class, evidence and freshness -- and verifies every reference a host proposes", () => {
  const shop = checkout("shop");
  const claims = [{ subject: "order", relation: "migrated-by", object: "order-migration", evidence: ["src/db/migrate.mjs"], source: "repository", strength: "observed" }, { subject: "invoice", relation: "stored-in", object: "ledger", evidence: ["src/api/server.mjs"], source: "repository", strength: "observed" }];
  assert.equal(cli(shop, "knowledge", ["record"], `${claims.map((c) => JSON.stringify(c)).join("\n")}\n`).status, 0);
  const refs = [{ kind: "file", ref: "src/db/pool.mjs", why: "the insert happens here" }, { kind: "file", ref: "src/orders/invented.mjs", why: "a guess" }, { kind: "symbol", ref: "pool" }, { kind: "symbol", ref: "nowhereInThisTree" }, { kind: "file", ref: "../outside.mjs" }];
  const pkg = context(shop, ["--with-refs"], withRefs(refs));
  const items = at(pkg);
  assert.deepEqual([items["file:src/db/migrate.mjs"].class, items["file:src/db/migrate.mjs"].evidence[0].source], ["direct", "knowledge"], "the claim knowledge answered for the task names a subject the task names");
  assert.equal(items["file:src/api/server.mjs"], undefined, "a claim knowledge did not answer for this task lists nothing");
  assert.deepEqual([items["file:src/orders/createOrder.mjs"].class, items["file:src/orders/createOrder.mjs"].by], ["direct", "engine"], "named by the request: every word of its name is the task's");
  assert.equal(items["component:src/orders"].class, "direct");
  assert.deepEqual([items["file:src/db/pool.mjs"].class, items["file:src/db/pool.mjs"].by], ["direct", "host-verified"]);
  assert.deepEqual(items["symbol:pool"].evidence.map((e) => e.id).sort(), ["src/db/pool.mjs:1", "src/orders/createOrder.mjs:1"], "where the tree holds it, the first place in each file");
  assert.equal(items["symbol:pool"].by, "host-verified");
  assert.deepEqual([items["component:src/api"].class, items["component:src/api"].evidence[0].source], ["downstream", "architecture"], "it imports a direct module");
  assert.deepEqual([items["check:package.json#test"].class, items["check:package.json#test"].evidence[0].source], ["verification", "architecture"], "the gate its unit's manifest declares");
  assert.deepEqual(pkg.relevance.refused.map((r) => [r.kind, r.ref]), [["file", "src/orders/invented.mjs"], ["symbol", "nowhereInThisTree"], ["file", "../outside.mjs"]]);
  assert.match(pkg.relevance.refused[1].why, /no tracked file holds that identifier as a whole word/);
  for (const r of pkg.relevance.refused) assert.equal(pkg.relevant.some((i) => i.ref === r.ref), false, `${r.ref} is refused by name and never listed`);
  const tracked = new Set(git(shop.root, "ls-files").trim().split("\n"));
  for (const i of pkg.relevant.filter((x) => x.kind === "file")) assert.ok(tracked.has(i.ref), `${i.ref} is a file the tree holds`);
  for (const i of pkg.relevant) {
    assert.ok(ITEM_KINDS.includes(i.kind) && CLASSES.includes(i.class) && FRESHNESS.includes(i.freshness), JSON.stringify(i));
    assert.ok(i.evidence.length > 0, `${i.ref} names its evidence`);
    assert.deepEqual(Object.keys(i), ["kind", "ref", "class", "evidence", "freshness", "by"]);
  }
  assert.ok(pkg.relevant.length <= RELEVANCE_LIMIT);
  assert.equal(pkg.relevance.total, pkg.relevance.listed + pkg.relevance.more);
  assert.deepEqual([pkg.sufficiency.word, pkg.sufficiency.question], ["ENOUGH", null]);
  assert.ok(Array.isArray(pkg.sections) && pkg.status.word, "everything the package said before is still said");
  const text = cli(shop, "context", ["--with-refs"], withRefs(refs)).stdout;
  assert.match(text, /^STATUS {2}\S+ -- .*\nSUFFICIENCY {2}ENOUGH -- /);
  assert.match(text, /== RELEVANT ==\n\d+ item\(s\), by class then evidence: /);
  assert.match(text, / {2}refused {2}file src\/orders\/invented\.mjs -- the tracked tree holds no such file/);
  const section = text.split("== RELEVANT ==\n")[1].split("\n\n")[0].split("\n");
  assert.ok(section.length <= 24, "held to the package's line bound");
});

test("freshness is each record's own: HEAD moving elsewhere moves nothing, and a record whose scope moved since its owner read it is stale -- a DISCOVER naming who re-reads it", () => {
  const shop = checkout("fresh");
  context(shop);
  const observed = '{"kind":"pattern","key":"create-order","statement":"An order is created through one handler per operation","scope":["src/orders"],"evidence":["src/orders/createOrder.mjs"],"source":"repository","strength":"observed"}\n';
  assert.equal(cli(shop, "engineering", ["record"], observed).status, 0);
  writeFileSync(join(shop.root, "README.md"), "# shop\n\nmore\n");
  git(shop.root, "commit", "-qam", "readme");
  const elsewhere = context(shop);
  assert.deepEqual(at(elsewhere)["file:src/orders/createOrder.mjs"].evidence.map((e) => e.source), ["name", "tree", "engineering"]);
  assert.ok(elsewhere.relevant.every((i) => i.freshness === "current"), "a commit that touched nothing they rest on stales nothing");
  assert.equal(elsewhere.sufficiency.word, "ENOUGH");
  writeFileSync(join(shop.root, "src/orders/cancelOrder.mjs"), "export const cancelOrder = () => undefined;\n");
  git(shop.root, "commit", "-qam", "orders");
  const moved = context(shop);
  const items = at(moved);
  assert.equal(items["file:src/orders/createOrder.mjs"].freshness, "stale", "engineering read src/orders before it moved");
  assert.equal(items["component:src/orders"].freshness, "current", "architecture has re-read the same scope since: its own record is current");
  assert.deepEqual([moved.sufficiency.word, moved.sufficiency.row], ["DISCOVER", "stale"]);
  assert.deepEqual(moved.sufficiency.targets, [{ source: "engineering", target: "src/orders/createOrder.mjs", run: `engineering why ${items["file:src/orders/createOrder.mjs"].evidence[2].id}` }]);
  writeFileSync(join(shop.root, "src/orders/listOrders.mjs"), "export const listOrders = () => [1];\n");
  assert.equal(at(context(shop))["component:src/orders"].freshness, "unknown", "an edit the index cannot see settles nothing either way");
});

test("once paths are known, what the change reaches and the declared checks that hold it come from runtime understanding, as impact.mjs and obligations.mjs read them", () => {
  const shop = checkout("reach", { "package-lock.json": '{ "name": "shop", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "shop" } } }\n' });
  const before = context(shop);
  assert.deepEqual([before.sufficiency.word, at(before)["check:package.json#test"]?.class], ["ENOUGH", "verification"], "with nothing understood, the manifest's own gate holds the unit");
  json(shop, "runtime", ["discover", "--json"]);
  const pkg = context(shop);
  const component = pkg.relevant.find((i) => i.kind === "component" && i.evidence.some((e) => e.source === "impact"));
  assert.deepEqual([component.class, component.evidence[0].id, component.freshness], ["direct", "MODIFIED", "current"], "the component a direct path lies in");
  const check = pkg.relevant.find((i) => i.kind === "check" && i.evidence.some((e) => e.source === "obligations"));
  assert.deepEqual([check.class, check.evidence.map((e) => e.source), check.freshness], ["verification", ["obligations", "runtime"], "current"]);
  assert.deepEqual(check.evidence, [{ source: "obligations", id: component.ref }, { source: "runtime", id: "test" }], "the component it holds, and the name the checkout declared it by");
  assert.equal(at(pkg)["check:package.json#test"], undefined, "the change's own required check, never a gate beside it");
  assert.equal(pkg.sufficiency.word, "ENOUGH");
});

// The read a DISCOVER names must be one that can fill the gap. A checkout whose files declare no component: before
// runtime understanding read it, `runtime discover` is owed; once it read it and found none, asking again finds the same
// nothing -- a host sent back to it would loop (0.5.0 review).
test("a missing component graph is DISCOVERed until runtime understanding has read the checkout, and never again once it found none", () => {
  const bare = checkout("bare", {}, { "src/orders/createOrder.mjs": FILES["src/orders/createOrder.mjs"], "README.md": "# shop\n" });
  const before = context(bare);
  assert.deepEqual([before.sufficiency.word, before.sufficiency.row, before.sufficiency.targets.map((t) => t.run)], ["DISCOVER", "unreached", ["runtime discover"]]);
  json(bare, "runtime", ["discover", "--json"]);
  const after = context(bare);
  assert.deepEqual([after.sufficiency.word, after.sufficiency.row], ["ENOUGH", "grounded"], "the read it named was made, and found no graph: nothing is left to read");
  assert.match(after.sufficiency.because, /0 verification item\(s\)/, "what holds the change is still said: nothing");
});

const snapshot = (dir) => (statSync(dir, { throwIfNoEntry: false }) ? readdirSync(dir, { recursive: true }).map(String).sort().filter((p) => statSync(join(dir, p)).isFile()).map((p) => `${p} ${createHash("sha256").update(readFileSync(join(dir, p))).digest("hex")}`) : []);

test("a look writes nothing of its own: a second package leaves every byte of the store and of the checkout as it was", () => {
  const shop = checkout("quiet");
  context(shop);
  const store = shop.env.ORBIT_STORE_DIR;
  const before = { store: snapshot(store), tree: git(shop.root, "status", "--porcelain", "--untracked-files=all") };
  context(shop, ["--with-refs"], withRefs([{ kind: "file", ref: "src/db/pool.mjs" }, { kind: "symbol", ref: "createOrder" }, { kind: "file", ref: "nope.mjs" }]));
  assert.deepEqual(snapshot(store), before.store, "the store");
  assert.equal(git(shop.root, "status", "--porcelain", "--untracked-files=all"), before.tree, "the checkout");
});

test("ASK is a goal's missing prerequisite, found where the goal keeps it and relayed with how a person settles it -- never a question made up", () => {
  const shop = checkout("goal");
  const goal = json(shop, "orbit", ["goal", "start", "--stdin", "--json"], "Make createOrder refuse an empty order.\nAC1: an empty order is refused with a clear error\n");
  const ref = (n) => `spec@${goal.specDigest}#L${n}`;
  const analysis = { objective: "Make createOrder refuse an empty order", intent: { category: "change", workKinds: ["change", "verify"], missing: [{ statement: "which error an empty order answers with", blocks: ["verify"] }] }, requirements: [{ statement: "createOrder refuses an empty order", kind: "explicit", sourceRef: ref(1) }], acceptance: [{ statement: "an empty order is refused with a clear error", sourceRef: ref(2) }], unknowns: [], conflicts: [] };
  json(shop, "orbit", ["goal", "analyze", goal.id, "--stdin", "--json"], JSON.stringify(analysis));
  json(shop, "orbit", ["goal", "plan", goal.id, "--json"]);
  const pkg = context(shop);
  assert.deepEqual([pkg.sufficiency.word, pkg.sufficiency.row], ["ASK", "blocking-question"]);
  assert.deepEqual({ ...pkg.sufficiency.question, answer: undefined }, { flow: "goal", goal: goal.id, asks: "which error an empty order answers with", blocks: ["verify"], answer: undefined });
  assert.match(pkg.sufficiency.question.answer, new RegExp(`goal analyze ${goal.id} --stdin`));
  assert.notEqual(context(shop, ["--for=rename the auth server module"]).sufficiency.word, "ASK", "a goal about other work asks nothing of this task");
  assert.notEqual(context(shop, ["--for=make the order list paginate"]).sufficiency.word, "ASK", "two words in common with the goal (make, order) is another task, never this goal's question");
});

test("ASK is a blocking question already open on the requirement the task's own work rests on", () => {
  const shop = checkout("requirement");
  const where = json(shop, "requirements", ["where", "--json"]);
  const identity = { provider: "azure-devops", organization: "acme", project: "Shop", id: "4312" };
  const record = sourceRecord({ identity, kind: "workitem", ref: "4312", revision: "7", text: workitemText({ title: "Empty orders", body: "An empty order must be refused" }), now: "2026-11-05T10:00:00.000Z" });
  createSources(where.store, realIo()).saveRecord(record);
  const root = rootId(identity);
  const port = createRequirements(where.store, realIo()).open(root);
  port.transact(() => port.setState({ sources: {}, position: 0, lastSnapshot: null, identity }));
  const asked = json(shop, "requirements", ["ask", root, "--json"], `${JSON.stringify({ slots: [{ subject: "order", aspect: "empty" }], asks: "What should an empty order answer with?", blocking: true, dependsOn: [`source:${record.id}@7`] })}\n`);
  json(shop, "work", ["start", "Make createOrder refuse an empty order", `--ref=${root}`, "--json"]);
  const pkg = context(shop);
  assert.deepEqual([pkg.sufficiency.word, pkg.sufficiency.question.flow, pkg.sufficiency.question.root, pkg.sufficiency.question.id], ["ASK", "requirements", root, asked.questions[0].id]);
  assert.equal(pkg.sufficiency.question.asks, "What should an empty order answer with?");
  assert.match(pkg.sufficiency.question.answer, new RegExp(`requirements answer ${root} --question=${asked.questions[0].id} --says="…" --human`));
  assert.equal(json(shop, "requirements", ["status", root, "--json"]).open.length, 1, "nothing here asked a question of its own");
  const near = context(shop, ["--for=make the order list paginate in pages of twenty"]);
  assert.notEqual(near.sufficiency.word, "ASK", "a task that shares two words (make, order) with the work's objective is another task: it never waits on that work's question");
  assert.equal(context(shop, [`--for=continue ${root}`]).sufficiency.word, "ASK", "a task that names the work's requirement is about it, whatever its words");
});

test("outside every checkout every proposed reference is refused and nothing is listed; a malformed envelope is refused whole", () => {
  const loose = { root: join(TEMP, "loose"), env: envOf("loose") };
  mkdirSync(loose.root, { recursive: true });
  const pkg = context(loose, ["--with-refs"], withRefs([{ kind: "file", ref: "src/db/pool.mjs" }]));
  assert.deepEqual([pkg.status.word, pkg.relevant, pkg.sufficiency.word, pkg.sufficiency.row], ["NOT_INITIALIZED", [], "DISCOVER", "no-tree"]);
  assert.match(pkg.relevance.refused[0].why, /could not be listed here/);
  const shop = checkout("usage");
  for (const [args, input, says] of [[["--with-refs"], "not json", /one JSON object on stdin/], [["--with-refs", "--for-stdin"], "{}", /both read stdin/], [["--with-refs"], withRefs([], ""), /usage:/]]) {
    const r = cli(shop, "context", args, input);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}`);
    assert.match(r.stderr, says);
  }
});

// 0.6.0, U3: the direct files' own relations, composed over a real checkout with the pack's adapters bound by the
// composition root -- read from the committed tree, one hop each way, and a file no adapter reads said as a gap.
test("a proposed file's relations are followed one hop over the committed tree, and a file no adapter reads is a gap with the host's way to fill it", () => {
  const app = loginApp();
  const login = checkout("login-app", {}, app.files);
  const page = "web/src/pages/LoginPage.jsx";
  const pkg = context(login, ["--with-refs"], withRefs([{ kind: "file", ref: page }, { kind: "file", ref: "web/src/pages/LoginPage.css" }], "fix the login bug"));
  const items = at(pkg);
  assert.deepEqual([items["file:web/src/api/sessionClient.js"]?.class, items["file:web/src/api/sessionClient.js"]?.evidence.map((e) => e.source)], ["dependency", ["imports"]]);
  assert.equal(items["file:web/src/pages/LoginPage.test.jsx"]?.class, "verification");
  assert.equal(items["file:web/src/legacy/theme.js"], undefined, "the decoy's import is never followed");
  assert.deepEqual(pkg.relevance.gaps.map((g) => [g.ref, g.target.run]), [["web/src/pages/LoginPage.css", "context --with-refs"]]);
  const text = cli(login, "context", ["--with-refs"], withRefs([{ kind: "file", ref: "web/src/pages/LoginPage.css" }], "fix the login bug")).stdout;
  assert.match(text, /gap\s+file web\/src\/pages\/LoginPage\.css -- no relation adapter here reads \*\.css file/);
});
