// The knowledge kernel's own words: the axes it shares with the other memories
// are the SAME words, its authority ladder agrees with engineering's routing,
// and the only relation names the engine ships are catalog data -- one per role.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as arch from "../src/architecture/vocab.mjs";
import * as eng from "../src/engineering/vocab.mjs";
import { CARDINALITY, ROLES } from "../src/extensions/knowledge-v1.mjs";
import * as know from "../src/knowledge/vocab.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every source knowledge shares with architecture has the same name and the same trust; one it alone has is never verified", () => {
  for (const s of know.SOURCES) {
    const theirs = arch.sourceRow(s.name);
    if (theirs) assert.equal(s.verified, theirs.verified, `${s.name} is trusted differently here`);
    if (!theirs) assert.equal(s.verified, false, `${s.name} exists only here and must not default to trusted`);
  }
  assert.equal(know.SOURCES.some((s) => /claude/.test(s.name)), false, "the kernel names no host");
});

test("a host's memory is never verified, never recordable, and can say at most observed", () => {
  const hosts = know.SOURCES.filter((s) => s.host);
  assert.ok(hosts.length >= 1);
  for (const s of hosts) assert.deepEqual([s.verified, s.recordable, s.strengths.includes("adopted")], [false, false, false], s.name);
});

test("strength, confidence and status are engineering's words, in engineering's order", () => {
  for (const table of ["STRENGTH", "CONFIDENCE", "STATUS"]) assert.deepEqual(know.names(know[table]), eng.names(eng[table]), table);
  for (const s of know.STRENGTH) assert.equal(s.claimableByObserver, eng.claimableByObserver(s.name), s.name);
});

// AUTHORITY is derived from the same axes engineering's ROUTING reads, so the
// two must never tell a reader different stories about one fact.
test("the authority ladder is consistent with engineering's routing, cell by cell", () => {
  for (const strength of know.STRENGTH_NAMES) for (const confidence of know.CONFIDENCE_NAMES) for (const status of know.STATUS_NAMES) {
    const route = eng.routeOf({ strength, confidence, status });
    const tier = know.authorityOf({ strength, confidence, status, source: "repository", layer: "project" });
    if (route.tier === "CONSTRAINT") assert.equal(tier.tier, "rule", `${strength}/${confidence}/${status}`);
    if (route.tier === "CONVENTION" || route.tier === "CLAIMED_GATE") assert.equal(tier.tier, "adopted", `${strength}/${confidence}/${status}`);
    if (route.tier === "ADVICE") assert.equal(tier.tier, "inference", `${strength}/${confidence}/${status}`);
    if (route.binding) assert.equal(tier.binding, true, `${strength}/${confidence}/${status} binds in engineering`);
  }
});

test("the ladder's order is the brief's: rule · adopted · source · confirmed · host-memory · inference", () => {
  assert.deepEqual(know.TIERS, ["rule", "adopted", "source", "confirmed", "host-memory", "inference"]);
  const tier = (c) => know.authorityOf({ layer: "project", status: "fresh", ...c }).tier;
  assert.equal(tier({ strength: "adopted", source: "human-declared-memory", layer: "organization", confidence: "possible" }), "rule", "an organisation's decision is a rule");
  assert.equal(tier({ strength: "adopted", source: "human-declared-memory", confidence: "possible" }), "adopted");
  assert.equal(tier({ strength: "observed", source: "repository", confidence: "possible" }), "source");
  assert.equal(tier({ strength: "observed", source: "repository", confidence: "certain", status: "stale" }), "confirmed", "a moved scope drops current-source authority, never certainty");
  assert.equal(tier({ strength: "observed", source: "host-memory", confidence: "possible" }), "host-memory");
  assert.equal(tier({ strength: "suggested", source: "repository", confidence: "possible" }), "inference");
  assert.equal(know.AUTHORITY.at(-1).when({}), true, "the last row always matches");
});

test("roles are columns, and every role a relation row may carry is one the walk reads", () => {
  assert.deepEqual(know.rolesWhere("follows"), ["consequence", "implementation", "observation"]);
  assert.deepEqual(know.rolesWhere("needs"), ["capability"]);
  assert.deepEqual(CARDINALITY.map((c) => [c.name, c.competes]), [["many", false], ["one", true]]);
  assert.equal(know.competes(undefined), false, "a relation nobody declared never competes");
});

test("Orbit ships exactly one generic relation per role, as catalog data -- a vocabulary, never an ontology", () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, "catalog", "knowledge.json"), "utf8"));
  assert.equal(catalog.schema, 1);
  assert.deepEqual(catalog.relations.map((r) => r.role).sort(), ROLES.map((r) => r.name).sort());
  assert.equal(new Set(catalog.relations.map((r) => r.id)).size, catalog.relations.length);
});

test("nothing under src/knowledge/ names a relation the catalog ships, a context dimension, or a product", () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, "catalog", "knowledge.json"), "utf8"));
  const dir = join(ROOT, "src", "knowledge");
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".mjs")).map((f) => join(dir, String(f)));
  for (const file of files) for (const id of catalog.relations.map((r) => r.id)) assert.equal(readFileSync(file, "utf8").includes(`"${id}"`), false, `${file} names the relation ${id}`);
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), /\b(claude|\.claude|transcript_path|MEMORY\.md|postgres|kafka|redis|azure|msgraph|sql server)\b/i, file);
});

test("a work receipt is a stamped source: never verified, never a host, and never above what an observation may be", () => {
  const row = know.sourceRow("work-receipt");
  assert.deepEqual([row.verified, row.stamped, row.host, row.recordable], [false, true, false, true]);
  assert.deepEqual(row.strengths, ["observed", "suggested"]);
  for (const strength of row.strengths) for (const confidence of know.CONFIDENCE_NAMES) assert.ok(!["source", "rule", "adopted"].includes(know.authorityOf({ source: row.name, strength, confidence, status: "fresh", layer: "project" }).tier));
});
