// Moving test data between the machine store and a checkout (1.8.9, src/store/publish.mjs, cli/storage.mjs): an
// import brings a checkout's committed ui-tests/ into the store; an export writes the store's copy into the checkout
// only for a PERSON, previews by default, refuses a file that is somebody's, keeps the store's originals, and
// records every copy. Real temporary repositories and real files throughout.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../src/project/index.mjs";
import { repositoryPaths } from "../src/project/repository.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { AUTHORIZE, authorized, exportApply, exportPlan, selectionOf } from "../src/store/publish.mjs";
import { Refused } from "../src/errors.mjs";
import { sealed } from "./home.mjs";

const engine = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(engine, "test", "fixtures", "ui-tests");
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-storage-publish-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const env = Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: join(temp, "store") })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));

function repo(name) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "README.md"), "a product\n");
  committed(root);
  return root;
}

function committed(root) {
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture", "--allow-empty"]);
}

const cli = (root, args, extra = {}) => spawnSync(process.execPath, [join(engine, "cli", "storage.mjs"), ...args], { cwd: root, env, encoding: "utf8", ...extra });
const porcelain = (root) => execFileSync("git", ["-C", root, "status", "--porcelain", "--ignored"], { encoding: "utf8" });
const read = (file) => readFileSync(file, "utf8");
const listed = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => !f.endsWith(".lock")).sort() : []);

// A checkout whose test data lives in the store, seated and holding the fixture's cases and plans.
function seated(name) {
  const root = repo(name);
  assert.equal(spawnSync(process.execPath, [join(engine, "cli", "help.mjs")], { cwd: root, env }).status, 0);
  const p = loadProject(env, root);
  for (const dir of ["graph", "screens"]) cpSync(join(fixture, dir), join(p.dataRoot, dir), { recursive: true });
  return { root, p };
}

const control = (p) => { const machine = machineContext({ project: p, config: {} }, env); return { io: realIo(), storeIo: machine.io, prepare: machine.prepare, now: () => new Date().toISOString(), host: "test", command: "node storage.mjs export --apply --human" }; };

test("import brings a checkout's committed tree into the store, keeps the checkout's copy, records it, and a second import changes nothing", () => {
  const root = repo("legacy");
  cpSync(fixture, join(root, "ui-tests"), { recursive: true });
  mkdirSync(join(root, "ui-tests", "reports"), { recursive: true });
  writeFileSync(join(root, "ui-tests", "reports", "old.html"), "<html>");
  committed(root);
  const before = porcelain(root);
  const preview = cli(root, ["import", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const p = repositoryPaths(root, env);
  assert.ok(!existsSync(join(p.storeRoot, "ui-tests")), "a preview writes nothing");
  const applied = cli(root, ["import", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  for (const rel of listed(fixture).filter((f) => f.includes("."))) assert.equal(read(join(p.storeRoot, "ui-tests", rel)), read(join(root, "ui-tests", rel)), rel);
  assert.ok(!existsSync(join(p.storeRoot, "ui-tests", "reports")), "reports are never test data");
  const records = readdirSync(join(p.storeRoot, "imports"));
  assert.equal(records.length, 1);
  const record = JSON.parse(read(join(p.storeRoot, "imports", records[0])));
  assert.ok(record.files.every((f) => /^[a-f0-9]{64}$/.test(f.digest)), "every file keeps its digest");
  assert.ok(!JSON.stringify(record).includes(temp), "and the record names rooms, never a path on this machine");
  assert.equal(JSON.parse(read(join(p.storeRoot, "store.json"))).dataHome, "store");
  assert.equal(loadProject(env, root).dataRoot, join(p.storeRoot, "ui-tests"), "the store is read from now on");
  assert.equal(porcelain(root), before, "the checkout's copy is exactly as it was");
  assert.match(cli(root, ["import", "--apply"]).stdout, /UNCHANGED/);
  assert.equal(readdirSync(join(p.storeRoot, "imports")).length, 1, "a second import of the same tree keeps no second record");
});

test("re-importing: a store file Orbit wrote is replaced, one somebody changed is a conflict unless --replace", () => {
  const root = repo("reimport");
  cpSync(fixture, join(root, "ui-tests"), { recursive: true });
  committed(root);
  assert.equal(cli(root, ["import", "--apply"]).status, 0);
  const p = loadProject(env, root);
  writeFileSync(join(root, "ui-tests", "graph", "meta.json"), '{"changed":"in the checkout"}\n');
  const modify = cli(root, ["import", "--apply"]);
  assert.equal(modify.status, 0, modify.stderr);
  assert.match(modify.stdout, /MODIFY\s+graph\/meta\.json/);
  writeFileSync(join(p.dataRoot, "graph", "meta.json"), '{"changed":"in the store"}\n');
  writeFileSync(join(root, "ui-tests", "graph", "meta.json"), '{"changed":"in the checkout again"}\n');
  const conflict = cli(root, ["import", "--apply"]);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /somebody's: graph\/meta\.json/);
  assert.equal(read(join(p.dataRoot, "graph", "meta.json")), '{"changed":"in the store"}\n', "a refused import wrote nothing");
  const replaced = cli(root, ["import", "--apply", "--replace"]);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(read(join(p.dataRoot, "graph", "meta.json")), '{"changed":"in the checkout again"}\n');
});

test("an export is a preview by default and writes nothing; applied from an agent's shell it is refused with the command a person runs", () => {
  const { root, p } = seated("preview");
  const before = porcelain(root);
  const preview = cli(root, ["export", "--all"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /EXPORT exp-[a-f0-9]{8}/);
  assert.match(preview.stdout, /CREATE\s+screens\/home\/cases\/create-thing\.json/);
  assert.match(preview.stdout, /nothing written — this is a preview/);
  for (const args of [["export", "--all", "--apply"], ["export", "--all", "--apply", "--human"]]) {
    const refused = cli(root, args);
    assert.equal(refused.status, 2, args.join(" "));
    assert.match(refused.stderr, /storage\.mjs" export --all --apply --human/, "the refusal names the command a person runs");
  }
  assert.equal(porcelain(root), before, "nothing reached the checkout");
  assert.ok(!existsSync(join(root, "ui-tests")));
  assert.ok(!existsSync(join(p.storeRoot, "exports")), "and nothing was recorded");
});

test("an export a person authorized writes the files byte for byte, keeps the store's originals, records it, and is unchanged when repeated", () => {
  const { root, p } = seated("authorized");
  const storeBefore = listed(p.dataRoot).map((f) => [f, existsSync(join(p.dataRoot, f)) && f.includes(".") ? read(join(p.dataRoot, f)) : null]);
  const plan = exportPlan(p, selectionOf({ all: true }), "copy");
  const result = exportApply(plan, { door: "control" }, control(p));
  assert.equal(result.status, "applied");
  assert.equal(result.door, "control");
  for (const f of plan.files) assert.equal(read(join(root, "ui-tests", f.rel)), read(join(p.dataRoot, f.rel)), f.rel);
  assert.deepEqual(listed(p.dataRoot).map((f) => [f, existsSync(join(p.dataRoot, f)) && f.includes(".") ? read(join(p.dataRoot, f)) : null]), storeBefore, "the store's originals are untouched");
  assert.equal(readdirSync(join(p.storeRoot, "exports")).length, 1);
  const stamped = loadProject(env, root);
  assert.equal(stamped.dataHome, "store", "a copy keeps the store as the home, though the checkout now holds a project.json");
  const again = exportApply(exportPlan(stamped, selectionOf({ all: true }), "copy"), { door: "control" }, control(stamped));
  assert.equal(again.status, "unchanged");
  assert.equal(readdirSync(join(p.storeRoot, "exports")).length, 1);
});

test("an export takes exactly what was chosen: one screen, one case, one plan with its page", () => {
  const { root, p } = seated("selections");
  const rels = (named) => exportPlan(p, selectionOf(named), "copy").files.map((f) => f.rel).sort();
  assert.ok(rels({ screen: "home" }).every((r) => r.startsWith("screens/home/")));
  assert.ok(rels({ screen: "home" }).length > 3);
  assert.deepEqual(rels({ case: "create-thing" }), ["screens/home/cases/create-thing.json"]);
  assert.deepEqual(rels({ plan: "things" }), ["screens/home/things.md", "screens/home/things.plan.json"]);
  exportApply(exportPlan(p, selectionOf({ case: "archive-thing" }), "copy"), { door: "control" }, control(p));
  assert.deepEqual(listed(join(root, "ui-tests")), ["screens", join("screens", "detail"), join("screens", "detail", "cases"), join("screens", "detail", "cases", "archive-thing.json")]);
  assert.throws(() => selectionOf({}), Refused);
  assert.throws(() => selectionOf({ all: true, case: "x" }), Refused);
  assert.throws(() => selectionOf({ case: "../escape" }), Refused);
  assert.throws(() => exportPlan(p, selectionOf({ case: "nothing-like-this" }), "copy"), /matches --case=nothing-like-this/);
  assert.throws(() => exportPlan(p, selectionOf({ screen: "home" }), "move"), /--move takes the whole tree/);
});

test("a checkout file changed since the last export is a conflict; one Orbit wrote and nobody touched is replaced", () => {
  const { root, p } = seated("conflicts");
  exportApply(exportPlan(p, selectionOf({ all: true }), "copy"), { door: "control" }, control(p));
  const q = loadProject(env, root);
  const target = join(root, "ui-tests", "graph", "meta.json");
  writeFileSync(target, '{"edited":"by a person in the checkout"}\n');
  const conflicted = exportPlan(q, selectionOf({ all: true }), "copy");
  assert.equal(conflicted.files.find((f) => f.rel === "graph/meta.json").state, "CONFLICT");
  assert.throws(() => exportApply(conflicted, { door: "control" }, control(q)), /somebody's: graph\/meta\.json/);
  assert.equal(read(target), '{"edited":"by a person in the checkout"}\n', "a refused export wrote nothing");
  writeFileSync(target, read(join(q.dataRoot, "graph", "meta.json")));
  writeFileSync(join(q.dataRoot, "graph", "meta.json"), '{"changed":"in the store"}\n');
  const modified = exportPlan(q, selectionOf({ all: true }), "copy");
  assert.equal(modified.files.find((f) => f.rel === "graph/meta.json").state, "MODIFY");
  exportApply(modified, { door: "control" }, control(q));
  assert.equal(read(target), '{"changed":"in the store"}\n');
});

test("an interrupted export leaves files the next preview calls SAME, and no record of a copy that did not finish", () => {
  const { root, p } = seated("interrupted");
  mkdirSync(join(root, "ui-tests", "graph"), { recursive: true });
  writeFileSync(join(root, "ui-tests", "graph", "screens.json"), read(join(p.dataRoot, "graph", "screens.json")));
  const plan = exportPlan(p, selectionOf({ all: true }), "copy");
  assert.equal(plan.files.find((f) => f.rel === "graph/screens.json").state, "SAME");
  assert.ok(!existsSync(join(p.storeRoot, "exports")));
  exportApply(plan, { door: "control" }, control(p));
  assert.ok(existsSync(join(root, "ui-tests", "project.json")));
});

test("nothing is written through a link, and nothing escapes the checkout", () => {
  const { root, p } = seated("links");
  const outside = join(temp, "outside-links");
  mkdirSync(outside);
  mkdirSync(join(root, "ui-tests"));
  symlinkSync(outside, join(root, "ui-tests", "screens"), "dir");
  assert.throws(() => exportPlan(p, selectionOf({ all: true }), "copy"), Refused);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(join(root, "ui-tests", "screens"));
  symlinkSync(join(temp, "outside-file.json"), join(root, "ui-tests", "project.json"));
  writeFileSync(join(temp, "outside-file.json"), "{}");
  assert.throws(() => exportPlan(p, selectionOf({ all: true }), "copy"), /link/);
  assert.equal(read(join(temp, "outside-file.json")), "{}");
});

test("--move makes the checkout the home: the store keeps its copy, the mirror follows, and the checkout is read from then on", () => {
  const { root, p } = seated("move");
  const result = exportApply(exportPlan(p, selectionOf({ all: true }), "move"), { door: "control" }, control(p));
  assert.equal(result.home, "checkout");
  const moved = loadProject(env, root);
  assert.equal(moved.dataHome, "checkout");
  assert.equal(moved.dataRoot, join(root, "ui-tests"));
  assert.ok(existsSync(join(p.dataRoot, "project.json")), "the store's copy is never deleted");
  assert.throws(() => exportPlan(moved, selectionOf({ all: true }), "copy"), /lives in the checkout/, "nothing left in the store to export");
});

test("who may write the checkout is a table: Control's door, else a person typing at a terminal who types back the preview's id", () => {
  const plan = { id: "exp-12345678" };
  const verdict = (actor) => authorized(actor, plan, "the command");
  assert.equal(verdict({ door: "control" }).allowed, true);
  assert.match(verdict({ door: "terminal", human: false }).says, /a person's.*the command/s);
  assert.match(verdict({ door: "terminal", human: true, tty: false }).says, /terminal a person is typing in.*the command/s);
  assert.match(verdict({ door: "terminal", human: true, tty: true, confirmed: "exp-other" }).says, /what was typed is not exp-12345678/);
  assert.equal(verdict({ door: "terminal", human: true, tty: true, confirmed: "exp-12345678" }).allowed, true);
  assert.equal(AUTHORIZE.at(-1).when({}, plan), true, "the last row always answers");
  assert.equal(AUTHORIZE.filter((r) => r.allowed).length, 2, "exactly two ways in");
});
