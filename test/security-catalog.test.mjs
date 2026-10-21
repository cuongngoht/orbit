// Security catalogs are a person's sources (ADR 0040): the shipped default holds to the contract and
// keeps ids, links and Orbit's own summaries only; catalogs are read in layers -- shipped, adopted on
// this machine, a project's enablement and marks; adopting, enabling and marking go through Orbit
// Control's door alone and name the revision they read; a document of a schema this engine does not
// hold is refused and left byte for byte; and a catalog that changes makes what was derived from the
// old one STALE.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assessmentFreshness, assessmentOf, obligationFreshness, obligationsInEffect } from "../src/qa/security/assessment.mjs";
import { CATALOG_API, catalogDigest, catalogFindings, catalogSchema, effectiveCatalogs, previewOf } from "../src/qa/security/catalog.mjs";
import { SECURITY_DOOR, SECURITY_INVALID, adoptCatalog, enableCatalogs, layersFrom, markControl, readIndex, readProjectSecurity, securityRooms } from "../src/qa/security/store.mjs";
import { STALE_REVISION } from "../src/store/revisioned.mjs";
import { realIo } from "../src/store/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED_DIR = join(ROOT, "skills", "orbit-security-audit", "catalogs");
const SHIPPED = JSON.parse(readFileSync(join(SHIPPED_DIR, "asvs-5.0.0-l1.json"), "utf8"));

const DOOR = { door: "control", revision: null, at: "2026-10-22T10:00:00.000Z" };

function world(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-security-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = securityRooms(join(base, "store"), join(base, "store", "projects", "p1"));
  const io = realIo();
  return { base, rooms, io, layers: () => layersFrom(io, rooms, SHIPPED_DIR) };
}

const own = (over = {}) => ({
  apiVersion: CATALOG_API,
  catalog: "acme-policy",
  title: "The team's own policy",
  version: "1",
  controls: [
    { id: "acme-1", group: "access", level: 1, summary: "Only the owner reads an invoice.", methods: ["runtime-test"], minimumEvidence: ["positive", "negative"], applies: { all: [{ role: "interface" }, { relation: "permission" }] }, shapes: ["permission-enforced"] },
    { id: "acme-2", group: "docs", level: 2, summary: "Access rules are written down.", methods: ["design-review"] },
  ],
  ...over,
});

test("the shipped default holds to the contract, keeps a summary per control, and is what its published schema describes", () => {
  assert.deepEqual(catalogFindings(SHIPPED), []);
  assert.equal(SHIPPED.default, true);
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, "skills", "orbit-security-audit", "formats", "control-catalog.schema.json"), "utf8")), catalogSchema(), "the published schema is generated — run the generator, never edit it");
  for (const c of SHIPPED.controls) {
    assert.match(c.id, /^v5\.0\.0-\d+\.\d+\.\d+$/, "a versioned id, as the standard asks it be cited");
    assert.equal(c.level, 1);
    assert.ok(c.summary.length <= 200, `${c.id}: a one-line summary in Orbit's words`);
  }
  assert.ok(SHIPPED.labels["top10-2025"].items.A01 && SHIPPED.labels["api-top10-2023"].items.API1);
});

test("what a catalog may not say", () => {
  const says = (doc) => catalogFindings(doc).join("\n");
  assert.match(says(own({ apiVersion: "orbit.control-catalog/v0" })), /apiVersion must be/);
  assert.match(says(own({ severity: "high" })), /unknown field "severity"/);
  assert.match(says(own({ controls: [own().controls[0], own().controls[0]] })), /acme-1 is declared twice/);
  assert.match(says(own({ controls: [{ ...own().controls[0], labels: ["top10-2025:A01"] }] })), /label "top10-2025:A01" is not one the catalog declares/);
  assert.match(says(own({ controls: [{ ...own().controls[0], shapes: ["be-secure"] }] })), /shape "be-secure" is not an obligation shape/);
  assert.match(says(own({ controls: [{ ...own().controls[0], applies: { role: "kafka-topic" } }] })), /role "kafka-topic" is not a node role/);
  assert.match(says(own({ controls: [{ ...own().controls[0], shapes: [] }] })), /a runtime test needs a shape, or an unsupported reason/);
  assert.match(says(own({ controls: [{ ...own().controls[0], methods: ["guess"] }] })), /method "guess" is not one of/);
  assert.match(says(own({ controls: [{ ...own().controls[0], minimumEvidence: ["vibes"] }] })), /evidence "vibes" is not one of/);
  assert.match(says(own({ source: { url: "http://example.test/catalog" } })), /url does not look like/);
  assert.match(says(own({ source: { url: "https://user:secret@example.test/catalog" } })), /url does not look like/);
  assert.match(says(own({ controls: [{ ...own().controls[0], summary: "x".repeat(401) }] })), /longer than 400 characters — a catalog keeps a summary/);
  assert.deepEqual(catalogFindings(own()), []);
});

test("layers: the shipped default is in effect until a project enables a catalog, and an enabled one is pinned by digest and filtered", async (t) => {
  const w = world(t);
  const byDefault = effectiveCatalogs(w.layers(), {});
  assert.equal(byDefault.by, "default");
  assert.deepEqual(byDefault.catalogs.map((c) => [c.catalog, c.digest]), [["asvs-5.0.0-l1", catalogDigest(SHIPPED)]]);
  adoptCatalog(w.io, w.rooms, w.layers(), { doc: own(), source: { kind: "file", name: "acme.json" } }, DOOR);
  const project = { enabled: [{ catalog: "acme-policy", digest: catalogDigest(own()), levels: [1] }] };
  const enabled = effectiveCatalogs(w.layers(), project);
  assert.equal(enabled.by, "project");
  assert.deepEqual(enabled.catalogs[0].controls.map((c) => c.id), ["acme-1"], "filtered by level");
  assert.deepEqual(effectiveCatalogs(w.layers(), { enabled: [{ catalog: "acme-policy", digest: "0".repeat(64) }] }).missing.map((m) => m.catalog), ["acme-policy"], "an enabled catalog this machine does not hold is MISSING, never replaced");
});

test("a preview says what adopting would do, and writes nothing", (t) => {
  const w = world(t);
  const next = { ...SHIPPED, default: undefined, catalog: "asvs-5.0.0-l1", version: "5.0.0", controls: [...SHIPPED.controls.slice(1), { ...SHIPPED.controls[0], summary: "Input is held to what the business expects." }, { id: "v5.0.0-99.9.9", summary: "new", methods: ["design-review"] }] };
  delete next.default;
  const p = previewOf(next, w.layers());
  assert.equal(p.ok, true);
  assert.deepEqual([p.diff.added, p.diff.removed, p.diff.changed], [["v5.0.0-99.9.9"], [], ["v5.0.0-2.2.1"]]);
  assert.equal(p.against.layer, "shipped");
  assert.match(previewOf({ ...own(), default: true }, w.layers()).problems.join(), /only a catalog Orbit ships is a default/);
  assert.equal(w.io.read(w.rooms.index), null, "nothing was written");
});

test("adopting is a person's, through Control's door alone, and names the revision it read", (t) => {
  const w = world(t);
  assert.throws(() => adoptCatalog(w.io, w.rooms, w.layers(), { doc: own(), source: { kind: "file" } }, { ...DOOR, door: null }), (e) => e.code === SECURITY_DOOR && /Orbit Control/.test(e.message));
  assert.throws(() => adoptCatalog(w.io, w.rooms, w.layers(), { doc: own({ controls: [] }), source: { kind: "file" } }, DOOR), (e) => e.code === SECURITY_INVALID);
  const first = adoptCatalog(w.io, w.rooms, w.layers(), { doc: own(), source: { kind: "url", url: "https://example.test/acme.json" } }, DOOR);
  assert.deepEqual(first.adopted.map((a) => [a.catalog, a.digest, a.source.kind]), [["acme-policy", catalogDigest(own()), "url"]]);
  assert.ok(w.io.read(join(w.rooms.adopted, `${catalogDigest(own())}.json`)), "kept once, by its digest");
  assert.throws(() => adoptCatalog(w.io, w.rooms, w.layers(), { doc: own({ version: "2" }), source: { kind: "editor" } }, { ...DOOR, revision: "stale" }), (e) => e.code === STALE_REVISION);
  const second = adoptCatalog(w.io, w.rooms, w.layers(), { doc: own({ version: "2" }), source: { kind: "editor" } }, { ...DOOR, revision: first.revision });
  assert.equal(second.adopted.length, 2, "another version is another digest, kept beside the first");
});

test("an adopted catalog changed after adoption is refused and left exactly as it is", (t) => {
  const w = world(t);
  adoptCatalog(w.io, w.rooms, w.layers(), { doc: own(), source: { kind: "file" } }, DOOR);
  const file = join(w.rooms.adopted, `${catalogDigest(own())}.json`);
  const edited = readFileSync(file, "utf8").replace("Only the owner reads an invoice.", "Anyone reads an invoice.");
  writeFileSync(file, edited);
  const layers = w.layers();
  assert.equal(layers.catalogs.some((c) => c.catalog === "acme-policy"), false);
  assert.match(layers.refused.map((r) => r.problems.join()).join(), /changed after adoption, left as it is/);
  assert.equal(readFileSync(file, "utf8"), edited, "byte for byte");
});

test("a document of a schema this engine does not hold is refused, reported, and preserved byte for byte", (t) => {
  const w = world(t);
  mkdirSync(w.rooms.adopted, { recursive: true });
  const newer = `${JSON.stringify({ schema: 9, adopted: [{ catalog: "x" }] })}\n`;
  writeFileSync(w.rooms.index, newer);
  assert.match(w.layers().refused.map((r) => r.problems.join()).join(), /expected schema 1; file unchanged/);
  assert.throws(() => adoptCatalog(w.io, w.rooms, w.layers(), { doc: own(), source: { kind: "file" } }, DOOR), /expected schema 1/);
  assert.equal(readFileSync(w.rooms.index, "utf8"), newer);
});

test("enabling and marking are a person's too: through the door, on the revision read, with a reason", (t) => {
  const w = world(t);
  const enabled = [{ catalog: "asvs-5.0.0-l1", digest: catalogDigest(SHIPPED), groups: ["V8 Authorization"] }];
  assert.throws(() => enableCatalogs(w.io, w.rooms, w.layers(), { enabled }, { ...DOOR, door: undefined }), (e) => e.code === SECURITY_DOOR);
  assert.throws(() => enableCatalogs(w.io, w.rooms, w.layers(), { enabled: [{ catalog: "asvs-5.0.0-l1", digest: "1".repeat(64) }] }, DOOR), /no catalog asvs-5.0.0-l1 at that digest/);
  const saved = enableCatalogs(w.io, w.rooms, w.layers(), { enabled }, DOOR);
  assert.deepEqual(effectiveCatalogs(w.layers(), saved.settings).catalogs[0].controls.every((c) => c.group === "V8 Authorization"), true);
  assert.throws(() => markControl(w.io, w.rooms, w.layers(), { catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.1.1", why: "" }, { ...DOOR, revision: saved.revision }), /why is the reason/);
  assert.throws(() => markControl(w.io, w.rooms, w.layers(), { catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.1.1", why: "documented elsewhere" }, { ...DOOR, revision: "stale" }), (e) => e.code === STALE_REVISION);
  const marked = markControl(w.io, w.rooms, w.layers(), { catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.1.1", why: "the access rules live in the platform team's handbook" }, { ...DOOR, revision: saved.revision });
  assert.deepEqual(marked.settings.notApplicable.map((m) => [m.control, m.why]), [["v5.0.0-8.1.1", "the access rules live in the platform team's handbook"]]);
  const cleared = markControl(w.io, w.rooms, w.layers(), { catalog: "asvs-5.0.0-l1", control: "v5.0.0-8.1.1", clear: true }, { ...DOOR, revision: marked.revision });
  assert.deepEqual(cleared.settings.notApplicable, []);
  assert.equal(readProjectSecurity(w.io, w.rooms).revision, cleared.revision);
});

const GRAPH = { nodes: [{ id: "invoices-api", role: "interface" }, { id: "user", role: "principal" }, { id: "invoices", role: "data-resource" }], relations: [{ id: "may-read", role: "permission", from: "user", to: "invoices-api" }, { id: "signs-in", role: "identity", from: "invoices-api", to: "user" }], complete: true };

test("a catalog that changes makes the assessment and the obligations derived from the old one STALE", (t) => {
  const w = world(t);
  adoptCatalog(w.io, w.rooms, w.layers(), { doc: own(), source: { kind: "file" } }, DOOR);
  const before = effectiveCatalogs(w.layers(), { enabled: [{ catalog: "acme-policy", digest: catalogDigest(own()) }] });
  const snapshot = assessmentOf({ effective: before, graph: GRAPH, scopeDigest: "g1" });
  const obligation = obligationsInEffect({ effective: before, graph: GRAPH })[0];
  assert.equal(assessmentFreshness(snapshot, before, "g1").state, "current");
  const changed = own({ version: "2", controls: [{ ...own().controls[0], minimumEvidence: ["positive", "negative", "state"] }] });
  adoptCatalog(w.io, w.rooms, w.layers(), { doc: changed, source: { kind: "editor" } }, { ...DOOR, revision: readIndex(w.io, w.rooms).revision });
  const after = effectiveCatalogs(w.layers(), { enabled: [{ catalog: "acme-policy", digest: catalogDigest(changed) }] });
  const fresh = assessmentFreshness(snapshot, after, "g1");
  assert.equal(fresh.state, "stale");
  assert.match(fresh.why.join(), /acme-policy 1 \(.{12}\) is no longer the catalog in effect/);
  assert.equal(obligationFreshness(obligation, after), "stale");
  assert.equal(assessmentFreshness(snapshot, before, "g2").state, "stale", "a moved graph makes it stale too");
});

test("the terminal can read the catalogs and is refused adopting, enabling or marking one", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-security-cli-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q"], { cwd: repo });
  const env = { PATH: process.env.PATH ?? "", HOME: base, ORBIT_STORE_DIR: join(base, "store") };
  const run = (...a) => spawnSync(process.execPath, [join(ROOT, "cli", "security-audit.mjs"), ...a], { cwd: repo, env, encoding: "utf8" });
  const listed = run("catalogs", "--json");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).project.effective.catalogs.map((c) => c.catalog), ["asvs-5.0.0-l1"]);
  for (const cmd of ["adopt", "enable", "mark"]) {
    const refused = run(cmd, "--revision=x");
    assert.equal(refused.status, 2, `${cmd}: ${refused.stderr}`);
    assert.match(refused.stderr, /Orbit Control/);
  }
  const source = readFileSync(join(ROOT, "cli", "security-audit.mjs"), "utf8");
  assert.doesNotMatch(source, /from "\.\.\/src\/(goal|automation)\//, "a standalone audit starts no goal and no coordinated workflow");
  assert.doesNotMatch(source, /fetch\(/, "the terminal never fetches a catalog");
});
