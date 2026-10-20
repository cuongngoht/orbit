// The sources room: records that never hold text, bindings a person outranks the
// engine on, and every rule the other rooms keep -- reading creates nothing, a newer
// schema is refused, a corrupt document is set aside, a symlink cannot lead out.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { Blocked, Refused } from "../src/errors.mjs";
import { loadProject } from "../src/project/index.mjs";
import { sourceRecord, sourceId, unavailableRecord, workitemText } from "../src/sources/model.mjs";
import { STALE_REVISION, createSources, sourcePaths } from "../src/sources/store.mjs";
import { sourcesContext } from "../src/sources/context.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";

// Absolute on every platform: the store resolves its paths, so a bare "/store" would be `D:\store` on Windows.
const ROOT = resolve("/store/acme");
const NOW = "2026-09-30T10:00:00.000Z";
const IDENTITY = { provider: "tracker-a", organization: "acme", project: "web", id: "4312" };
const TARGET = { provider: "tracker-a", organization: "acme", project: "web" };

const room = (opts) => {
  const io = fakeIo(opts);
  return { io, sources: createSources(ROOT, io), paths: sourcePaths(ROOT) };
};

const record = (over = {}) => sourceRecord({ identity: IDENTITY, kind: "workitem", revision: "7", text: workitemText({ title: "t" }), now: NOW, ...over });

test("reading an empty store creates nothing at all", () => {
  const { io, sources } = room();
  assert.deepEqual(sources.records(), []);
  assert.equal(sources.record(sourceId(IDENTITY, "workitem")), null);
  assert.deepEqual(sources.findings(), []);
  assert.deepEqual(sources.bindings(), { exists: false, doc: { default: null, refs: {} }, by: null, revision: undefined, unreadable: null });
  assert.deepEqual([io.files.size, io.dirs.size], [0, 0]);
});

test("a record round-trips, and only what a record may hold reaches the disk", () => {
  const { io, sources } = room();
  const rec = { ...record(), body: "SENTINEL-BODY refund more", text: "SENTINEL-TEXT", extra: { deep: "SENTINEL-EXTRA" } };
  sources.saveRecord(rec);
  const kept = sources.record(rec.id);
  assert.equal(kept.revision, "7");
  assert.equal(kept.state, "read");
  assert.doesNotMatch([...io.files.values()].join("\n"), /SENTINEL/, "a field nobody declared never reaches the disk");
  assert.deepEqual(sources.records().map((r) => r.id), [rec.id]);
});

test("a source that could not be read keeps its reason, masked, under the same id a later read replaces", () => {
  const { sources } = room();
  const down = unavailableRecord(IDENTITY, "workitem", "4312", "answered 401 for password=hunter2hunter2", NOW);
  sources.saveRecord(down);
  assert.doesNotMatch(sources.record(down.id).why, /hunter2/);
  sources.saveRecord(record());
  assert.equal(sources.record(down.id).state, "read");
  assert.equal(sources.records().length, 1);
});

test("a record id is checked before it becomes a path", () => {
  const { io, sources } = room();
  assert.throws(() => sources.record("../../escape"), Refused);
  assert.throws(() => sources.saveRecord({ ...record(), id: "src-../x" }), Refused);
  assert.equal(io.files.size, 0);
});

test("an unreadable record is reported and left exactly as it is; a newer one is never overwritten", () => {
  const { io, sources, paths } = room();
  const file = join(paths.records, "src-aaaaaaaaaaaa.json");
  io.write(file, "{ torn");
  assert.throws(() => sources.records(), /corrupt Orbit state/);
  assert.equal(io.read(file), "{ torn");
  const newer = join(paths.records, `${sourceId(IDENTITY, "workitem")}.json`);
  io.write(newer, JSON.stringify({ schema: 2, id: sourceId(IDENTITY, "workitem") }));
  assert.throws(() => sources.saveRecord(record()), /newer Orbit/);
  assert.equal(JSON.parse(io.read(newer)).schema, 2);
});

test("bindings: nothing bound, then a person binds, and the revision moves with the content", () => {
  const { sources } = room();
  const first = sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "person", now: NOW });
  assert.equal(first.by, "person");
  assert.match(first.revision, /^[0-9a-f]{16}$/);
  const read = sources.bindings();
  assert.deepEqual([read.exists, read.doc.default, read.revision, read.by], [true, TARGET, first.revision, "person"]);
  const next = sources.setBinding((d) => ({ ...d, refs: { "^INC-": TARGET } }), { by: "person", revision: first.revision, now: NOW });
  assert.notEqual(next.revision, first.revision);
});

test("the engine's guess never replaces a person's binding, and a person may replace the engine's", () => {
  const { sources } = room();
  const guess = sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "engine", now: NOW });
  const person = sources.setBinding((d) => ({ ...d, default: { ...TARGET, project: "shop" } }), { by: "person", revision: guess.revision, now: NOW });
  assert.equal(person.by, "person");
  assert.throws(() => sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "engine", revision: person.revision, now: NOW }), /a person bound this project's source/);
  assert.equal(sources.bindings().doc.default.project, "shop");
});

test("a change made against a stale revision is refused rather than overwriting what is there now", () => {
  const { sources } = room();
  const first = sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "person", now: NOW });
  sources.setBinding((d) => ({ ...d, refs: { a: TARGET } }), { by: "person", revision: first.revision, now: NOW });
  const attempt = () => sources.setBinding((d) => ({ ...d, refs: { b: TARGET } }), { by: "person", revision: first.revision, now: NOW });
  assert.throws(attempt, (e) => e instanceof Refused && e.code === STALE_REVISION);
  assert.throws(() => sources.setBinding((d) => d, { by: "person", now: NOW }), (e) => e.code === STALE_REVISION, "an existing document must be read before it is changed");
  assert.deepEqual(Object.keys(sources.bindings().doc.refs), ["a"]);
});

test("a binding that does not hold is refused before anything is written", () => {
  const { io, sources } = room();
  const bad = (change) => assert.throws(() => sources.setBinding(change, { by: "person", now: NOW }), Refused);
  bad((d) => ({ ...d, default: { provider: "Not A Slug", organization: "acme" } }));
  bad((d) => ({ ...d, default: { ...TARGET, token: "x" } }));
  bad((d) => ({ ...d, default: { provider: "tracker-a", organization: "0123456789abcdef0123456789abcdef01234567" } }));
  bad((d) => ({ ...d, refs: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, TARGET])) }));
  bad((d) => ({ ...d, refs: { "": TARGET } }));
  bad((d) => ({ ...d, refs: { ok: "not an object" } }));
  assert.equal(io.files.has(sourcePaths(ROOT).bindings), false);
  assert.throws(() => sources.setBinding((d) => d, { by: "robot", now: NOW }), /person or engine/);
});

test("unsupported and corrupt bindings are refused without overwriting", () => {
  const { io, sources, paths } = room();
  for (const text of ['{"schema":2,"default":null,"refs":{}}', '{ not json']) {
    io.write(paths.bindings, text);
    assert.throws(() => sources.bindings(), /Orbit state/);
    assert.throws(() => sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "person", now: NOW }), /Orbit state/);
    assert.equal(io.read(paths.bindings), text);
  }
  assert.ok(![...io.files.keys()].some((k) => k.includes("bindings.json.corrupt-")));
});

test("a writer that cannot get the lock is told, in words about the bindings, that it is Blocked", () => {
  const { sources } = room({ mkdirFails: 99, backoff: [1, 1] });
  assert.throws(() => sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "person", now: NOW }), (e) => e instanceof Blocked && /source bindings/.test(e.message));
});

test("a finding is kept in this host's own file and read back as one list, masked", () => {
  const { io, sources } = room({ host: "laptop-a" });
  sources.addFinding({ kind: "source-anomaly", say: "the revision did not move but the content did, Bearer abcdefghijklmnopqrstuvwxyz0123456789" });
  sources.addFinding({ kind: "source-anomaly", say: "again" });
  assert.equal(sources.findings().length, 2);
  assert.doesNotMatch(JSON.stringify(sources.findings()), /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.deepEqual([...io.files.keys()].map((f) => f.split(/[\\/]/).at(-1)), ["laptop-a.jsonl"]);
});

// ---- against a real repository store: the layout-3 guards -----------------------------

const engine = fileURLToPath(new URL("..", import.meta.url));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-sources-")));
after(() => rmSync(temp, { recursive: true, force: true }));
const env = sealed({ ORBIT_STORE_DIR: join(temp, "store") });

function initialized(name) {
  const root = join(temp, name);
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", `https://example.test/team/${name}.git`]);
  const done = spawnSync(process.execPath, [join(engine, "cli", "init.mjs"), root, "--origin=https://app.example.test"], { cwd: root, env, encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
  return loadProject(env, root);
}

test("bound to a repository's store, reading creates no room and the room lands beside the other memories", () => {
  const p = initialized("plain");
  const ctx = sourcesContext({ project: p, config: p.config }, env);
  assert.deepEqual([ctx.sources.records(), ctx.sources.bindings().exists], [[], false]);
  assert.equal(existsSync(join(p.storeRoot, "sources")), false, "a project nobody bound anything for leaves nothing behind");
  ctx.sources.saveRecord(record());
  assert.ok(existsSync(join(p.storeRoot, "sources", "records", `${sourceId(IDENTITY, "workitem")}.json`)));
  assert.equal(JSON.parse(readFileSync(join(p.storeRoot, "store.json"), "utf8")).layout, 3, "no layout change: the room is additive");
});

test("a symlink where the room should be cannot lead a write out of the store", () => {
  const p = initialized("guarded");
  const outside = join(temp, "escape");
  mkdirSync(outside);
  symlinkSync(outside, join(p.storeRoot, "sources"), "dir");
  const ctx = sourcesContext({ project: p, config: p.config }, env);
  assert.throws(() => ctx.sources.saveRecord(record()), Refused);
  assert.throws(() => ctx.sources.setBinding((d) => ({ ...d, default: TARGET }), { by: "person", now: NOW }), Refused);
  assert.deepEqual(readdirSync(outside), []);
});
