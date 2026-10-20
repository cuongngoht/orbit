// 1.8.9: the machine store is the home of a project's test data. A Git checkout is a project with nothing written
// into it; /orbit-help, init and a workflow's start seat it in the store; a checkout that commits ui-tests/ keeps it,
// read and mirrored as before; a loose ui-tests/graph below the checkout is the project it always was. Every proof
// here runs the real commands against real temporary repositories, and every one that touches a checkout says what
// `git status` was before and after.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../src/project/index.mjs";
import { knownCheckout, repositoryPaths } from "../src/project/repository.mjs";
import { DATA_HOME, dataHomeOf } from "../src/project/data-home.mjs";
import { restamp } from "../src/store/repository.mjs";
import { realIo } from "../src/store/io.mjs";
import { treeDigest, treeDigests, treeFiles } from "../src/store/tree.mjs";
import { GATES } from "../src/run/gates/index.mjs";
import { originGate } from "../src/run/gates/origin.mjs";
import { Refused } from "../src/errors.mjs";
import { sealed } from "./home.mjs";

const engine = fileURLToPath(new URL("..", import.meta.url));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-storage-home-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const store = join(temp, "store");
const envWith = (extra = {}) => Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: store, ...extra })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));
const env = envWith();

function repo(name, { remote = null } = {}) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  if (remote) execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
  writeFileSync(join(root, "README.md"), "a product\n");
  committed(root);
  return root;
}

function committed(root) {
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture"]);
}

const cli = (root, name, args = [], extra = {}) => spawnSync(process.execPath, [join(engine, "cli", `${name}.mjs`), ...args], { cwd: root, env, encoding: "utf8", ...extra });
const porcelain = (root) => execFileSync("git", ["-C", root, "status", "--porcelain", "--ignored"], { encoding: "utf8" });
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

test("a Git checkout with no ui-tests is a project whose test data lives in the store, and resolving or reading it writes nothing", () => {
  const root = repo("bare");
  const before = porcelain(root);
  const p = loadProject(env, root);
  assert.equal(p.layout, 3);
  assert.equal(p.dataHome, "store");
  assert.equal(p.dataHomeBy, "store");
  assert.equal(p.dataRoot, join(p.storeRoot, "ui-tests"));
  assert.equal(p.screensDir, join(p.storeRoot, "ui-tests", "screens"));
  assert.ok(!existsSync(p.storeRoot), "resolving it created nothing");
  const storage = cli(root, "query", ["storage", "--json"]);
  assert.equal(storage.status, 0, storage.stderr);
  assert.equal(JSON.parse(storage.stdout).dataHome, "store");
  assert.equal(JSON.parse(storage.stdout).dataRoot, p.dataRoot);
  const check = cli(root, "query", ["check"]);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.ok(!existsSync(p.storeRoot), "reading it created nothing either");
  assert.equal(porcelain(root), before, "and the checkout is exactly as it was");
});

test("only an explicit valid stamp selects the checkout; corrupt or unsupported stamps are refused", () => {
  const root = join(temp, "table-root");
  const room = join(temp, "table-store");
  mkdirSync(join(root, "ui-tests"), { recursive: true });
  mkdirSync(room);
  writeFileSync(join(root, "ui-tests", "project.json"), "{}");
  assert.deepEqual(dataHomeOf(root, room), { dataHome: "store", dataHomeBy: "store" });
  writeFileSync(join(room, "store.json"), JSON.stringify({ layout: 3, dataHome: "checkout" }));
  assert.deepEqual(dataHomeOf(root, room), { dataHome: "checkout", dataHomeBy: "stamped" });
  for (const text of ["not json", '{"layout":2}', '{"layout":3,"dataHome":"elsewhere"}']) {
    writeFileSync(join(room, "store.json"), text);
    assert.throws(() => dataHomeOf(root, room), Refused);
    assert.equal(readFileSync(join(room, "store.json"), "utf8"), text);
  }
});

test("a stamp naming the checkout is read from the checkout even with no tree there", () => {
  const root = repo("stamped-checkout");
  const p = repositoryPaths(root, env);
  mkdirSync(p.storeRoot, { recursive: true });
  writeFileSync(join(p.storeRoot, "store.json"), JSON.stringify({ layout: 3, key: p.storeKey, dataHome: "checkout" }));
  const stamped = loadProject(env, root);
  assert.equal(stamped.dataHome, "checkout");
  assert.equal(stamped.dataRoot, join(root, "ui-tests"));
});

test("a stamped store ignores the checkout's committed copy, and query check and storage say which copy is read", () => {
  const root = repo("imported", { remote: "https://example.test/team/imported.git" });
  cpSync(join(engine, "test", "fixtures", "ui-tests"), join(root, "ui-tests"), { recursive: true });
  committed(root);
  const p = repositoryPaths(root, env);
  mkdirSync(p.storeRoot, { recursive: true });
  writeFileSync(join(p.storeRoot, "store.json"), JSON.stringify({ layout: 3, key: p.storeKey, dataHome: "store" }));
  const read = loadProject(env, root);
  assert.equal(read.dataHome, "store");
  assert.equal(read.dataRoot, join(p.storeRoot, "ui-tests"));
});

test("a store typed into the checkout is refused, never quietly used", () => {
  const root = repo("inside");
  const inside = (name, args) => spawnSync(process.execPath, [join(engine, "cli", `${name}.mjs`), ...args], { cwd: root, env: envWith({ ORBIT_STORE_DIR: join(root, ".store") }), encoding: "utf8" });
  const storage = inside("query", ["storage", "--json"]);
  assert.equal(storage.status, 2);
  assert.match(storage.stderr, /inside the repository/);
  assert.equal(inside("init", [root]).status, 2);
  assert.ok(!existsSync(join(root, ".store")));
});

test("orbit-help seats the project in the store once: nothing in the checkout, nothing invented, and a repeat writes nothing", () => {
  const root = repo("seat");
  const before = porcelain(root);
  const help = cli(root, "help");
  assert.equal(help.status, 0, help.stderr);
  const p = loadProject(env, root);
  const data = p.dataRoot;
  assert.deepEqual(json(join(data, "project.json")), { $schema: "./project.schema.json", name: basename(root) });
  assert.ok(existsSync(join(data, "project.schema.json")));
  assert.equal(readFileSync(join(data, "schema", "case.schema.json"), "utf8"), cli(root, "schema").stdout, "the case schema is the one schema --write writes");
  assert.equal(readFileSync(join(data, "schema", "plan.schema.json"), "utf8"), cli(root, "schema", ["--plan"]).stdout);
  for (const absent of ["graph", "screens"]) assert.ok(!existsSync(join(data, absent)), `no ${absent}/: a seat invents nothing`);
  for (const absent of ["drafts", "reports", "evidence", "memory"]) assert.ok(!existsSync(join(p.storeRoot, absent)), `no ${absent}/ either`);
  assert.ok(existsSync(p.bindingFile), "the checkout is bound: the machine knows it now");
  assert.equal(json(join(p.storeRoot, "store.json")).dataHome, undefined, "a seat decides nothing about where data lives");
  assert.equal(porcelain(root), before);
  assert.deepEqual(readdirSync(root).sort(), [".git", "README.md"]);
  const stamps = readdirSync(join(data, "schema")).map((f) => statSync(join(data, "schema", f)).mtimeMs);
  assert.equal(cli(root, "help", ["--json"]).status, 0);
  assert.deepEqual(readdirSync(join(data, "schema")).map((f) => statSync(join(data, "schema", f)).mtimeMs), stamps, "a second invocation rewrote nothing");
});

test("init seats the store and says so; a person's edit survives a second init", () => {
  const root = repo("init-seat");
  const first = cli(root, "init", [root]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /home: store/);
  assert.match(first.stdout, /status: seated/);
  assert.match(first.stdout, /next: set origin in /, "no origin yet, so the next step asks for one");
  const p = loadProject(env, root);
  writeFileSync(join(p.dataRoot, "project.json"), JSON.stringify({ name: "kept", origin: "https://app.example.test" }));
  const second = cli(root, "init", [root, "--origin=https://other.example.test"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already seated, nothing overwritten/);
  assert.match(second.stdout, /next: record screens/, "an origin the project already names is not asked for again");
  assert.deepEqual(json(join(p.dataRoot, "project.json")), { name: "kept", origin: "https://app.example.test" });
  assert.deepEqual(readdirSync(root).sort(), [".git", "README.md"]);
});

test("two sessions seating one project at once both finish, and every file is written once and whole", async () => {
  const root = repo("concurrent");
  const run = () => new Promise((done) => { const child = spawn(process.execPath, [join(engine, "cli", "init.mjs"), root], { cwd: root, env }); child.on("close", done); });
  const codes = await Promise.all([run(), run(), run()]);
  assert.deepEqual(codes, [0, 0, 0]);
  const p = loadProject(env, root);
  for (const rel of ["project.json", "project.schema.json", join("schema", "case.schema.json"), join("schema", "plan.schema.json")]) assert.doesNotThrow(() => json(join(p.dataRoot, rel)), rel);
  assert.ok(!existsSync(join(p.storeRoot, ".lock")), "no lock left behind");
  assert.deepEqual(readdirSync(p.dataRoot).filter((f) => f.includes(".tmp-")), [], "no half-written file left behind");
});

test("a home store this machine cannot write is BLOCKED (exit 3): init stops, help says why and still answers, and nothing lands anywhere else", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const root = repo("readonly");
  const home = join(temp, "readonly-home");
  const projects = join(home, ".orbit", "projects");
  mkdirSync(projects, { recursive: true });
  chmodSync(projects, 0o500);
  try {
    const ro = Object.fromEntries(Object.entries(envWith({ HOME: home, USERPROFILE: home })).filter(([k]) => k !== "ORBIT_STORE_DIR"));
    const init = cli(root, "init", [root], { env: ro });
    assert.equal(init.status, 3, init.stderr);
    assert.match(init.stderr, /cannot be written/);
    const help = cli(root, "help", [], { env: ro });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /store — .*cannot be written.*nothing was seated/);
    assert.deepEqual(readdirSync(projects), []);
    assert.deepEqual(readdirSync(root).sort(), [".git", "README.md"]);
  } finally {
    chmodSync(projects, 0o700);
  }
});

test("every general command works in a seated checkout with no ui-tests, and none writes into the checkout", () => {
  const root = repo("general");
  assert.equal(cli(root, "help").status, 0);
  const before = porcelain(root);
  const commands = [["query", ["storage", "--json"]], ["query", ["check"]], ["help", ["--for=fix the login bug"]], ["qa-plan", ["plans"]], ["draft", ["list"]], ["schema", ["--write"]], ["knowledge", ["claims", "--for=login"]], ["work", ["list"]], ["intelligence", ["ensure", "--dry"]], ["engineering", ["recall", "--for=login"]], ["architecture", ["ensure", "--dry"]]];
  for (const [name, args] of commands) {
    const r = cli(root, name, args);
    assert.equal(r.status, 0, `${name} ${args.join(" ")}: ${r.stderr}${r.stdout}`);
  }
  const p = loadProject(env, root);
  assert.ok(existsSync(join(p.graphDir, "schema.json")), "schema --write wrote into the store");
  assert.equal(porcelain(root), before, "not one of them touched the checkout");
});

test("record-edge appends the first control of a map seated in the store", () => {
  const root = repo("first-edge");
  assert.equal(cli(root, "help").status, 0);
  const p = loadProject(env, root);
  mkdirSync(p.graphDir, { recursive: true });
  writeFileSync(join(p.graphDir, "screens.json"), JSON.stringify([{ id: "home", name: "Home", url: "/home", seen: "src" }]));
  const candidates = join(temp, "first-edge.jsonl");
  writeFileSync(candidates, `${JSON.stringify({ from: "home", via: "Add", kind: "button", selector: "getByRole('button',{name:'Add'})", opens: "none", to: null, seen: "src" })}\n`);
  const r = cli(root, "record-edge", [candidates]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(json(join(p.graphDir, "edges.json")).length, 1);
  assert.deepEqual(readdirSync(root).sort(), [".git", "README.md"]);
});

test("a ui-tests/graph below the checkout root is the loose project it always was; the root is the store's", () => {
  const root = repo("monorepo");
  const web = join(root, "apps", "web");
  mkdirSync(join(web, "ui-tests", "graph"), { recursive: true });
  writeFileSync(join(web, "ui-tests", "graph", "screens.json"), "[]");
  const nested = loadProject(env, web);
  assert.equal(nested.layout, 3);
  assert.equal(nested.dataRoot, loadProject(env, root).dataRoot);
  assert.equal(loadProject(env, root).dataHome, "store");
});

test("a page run with no origin is refused before any browser is asked, by a gate only page runs pass", () => {
  const rows = GATES.map((g) => g.gate);
  assert.ok(rows.indexOf(originGate) < rows.findIndex((g) => g.name === "sessionGate"), "the origin is asked before the session");
  assert.equal(GATES.find((g) => g.gate === originGate).page, true);
  const ctx = { config: { origin: null }, project: { dataRoot: join(temp, "store-data") } };
  assert.throws(() => originGate(ctx), (e) => e instanceof Refused && /set "origin" in .*project\.json/.test(e.message));
  assert.doesNotThrow(() => originGate({ config: { origin: "https://app.example.test" } }));
});


test("restamp keeps every key it does not name, and refuses a store nobody prepared", () => {
  const room = join(temp, "restamp");
  mkdirSync(room);
  assert.throws(() => restamp(room, { dataHome: "store" }, realIo()), Refused);
  writeFileSync(join(room, "store.json"), JSON.stringify({ layout: 3, key: "repo-x", at: "then" }));
  restamp(room, { dataHome: "store" }, realIo());
  const after = json(join(room, "store.json"));
  assert.equal(after.layout, 3);
  assert.equal(after.key, "repo-x");
  assert.equal(after.dataHome, "store");
  assert.notEqual(after.at, "then");
});

test("which checkouts the hooks observe: a loose tree and a committed one as they are, a store-home checkout once bound", () => {
  assert.equal(knownCheckout(null), false);
  assert.equal(knownCheckout({ layout: 3, dataHome: "explicit" }), true);
  assert.equal(knownCheckout({ layout: 3, dataHome: "checkout", bindingFile: join(temp, "nope.json") }), true);
  assert.equal(knownCheckout({ layout: 3, dataHome: "store", bindingFile: join(temp, "nope.json") }), false);
  const bound = join(temp, "bound.json");
  writeFileSync(bound, "{}");
  assert.equal(knownCheckout({ layout: 3, dataHome: "store", bindingFile: bound }), true);
});

test("a tree's digest is its files and their bytes, whatever order they were listed in", () => {
  const dir = join(temp, "tree");
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a", "one.json"), "1");
  writeFileSync(join(dir, "two.json"), "2");
  const files = treeFiles(dir);
  assert.deepEqual([...files].sort(), ["a/one.json", "two.json"], "relative, with / on every platform");
  const digests = treeDigests(dir, files, realIo());
  assert.equal(treeDigest(digests), treeDigest([...digests].reverse()));
  writeFileSync(join(dir, "two.json"), "3");
  assert.notEqual(treeDigest(treeDigests(dir, files, realIo())), treeDigest(digests));
});
