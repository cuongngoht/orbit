import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MIN_WRAPPED, proposals } from "../src/intelligence/bridge.mjs";
import { admitted } from "../src/engineering/observe/index.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { factId } from "../src/engineering/model.mjs";
import { routeOf } from "../src/engineering/vocab.mjs";
import { dotnetRegistry } from "./fakes/dotnet.mjs";
import { ensured, world } from "./fakes/intelligence.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { SHAREPOINT } from "./fixtures/intelligence/sharepoint.mjs";

// Project intelligence may TELL engineering memory what it saw -- as an
// observed candidate, through engineering's own untrusted door -- and may
// never make anything adopted or enforced. Reconciliation stays the only road.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function intelligence(files = SHAREPOINT) {
  const ctx = world(files, dotnetRegistry());
  ensured(ctx);
  return ctx;
}

// Engineering over the SAME in-memory tree, so a candidate's evidence is
// checked against what that tree actually tracks.
const engineering = (source) => ({ eng: createEngineering("/store/eng", fakeIo()), source, now: () => "2026-09-23T10:00:00.000Z" });

const session = (host, at) => ({ seenBy: { host, at } });

test("repeated technology-behind-abstraction registrations become ONE observed candidate", () => {
  const { candidates } = proposals(intelligence().intel.all());
  assert.equal(candidates.length, 1);
  const [c] = candidates;
  assert.deepEqual([c.kind, c.key, c.strength, c.source], ["pattern", "technology-behind-abstraction", "observed", "repository"]);
  assert.match(c.statement, /^4 registration\(s\) put a technology behind one of this project's own abstractions \(azure-service-bus, microsoft-graph, redis, sharepoint-csom\)/);
  for (const field of ["id", "confidence", "support", "at", "commit", "fingerprint"]) assert.equal(c[field], undefined, `a candidate may not carry ${field}`);
});

test("one registration is a fact, not a habit: nothing is proposed", () => {
  const files = { ...SHAREPOINT, "src/Infrastructure/DependencyInjection.cs": "class D { void F(IServiceCollection s) { s.AddScoped<IGraphDriveService, GraphDriveService>(); } }" };
  const out = proposals(intelligence(files).intel.all());
  assert.deepEqual(out.candidates, []);
  assert.match(out.unknowns[0], new RegExp(`${MIN_WRAPPED} or more`));
});

test("through engineering's door it lands as observed and possible — one session is one session", () => {
  const intel = intelligence();
  const eng = engineering(intel.source);
  const [d] = admitted(eng, proposals(intel.intel.all()).candidates, session("laptop-a", "2026-09-23T01:00:00Z"));
  assert.equal(d.outcome, "new");
  assert.deepEqual([d.fact.strength, d.fact.confidence], ["observed", "possible"]);
  assert.equal(routeOf(d.fact).binding, false, "an observed pattern never binds anybody");
});

test("a second independent session makes it certain, and STILL only observed", () => {
  const intel = intelligence();
  const eng = engineering(intel.source);
  const { candidates } = proposals(intel.intel.all());
  admitted(eng, candidates, session("laptop-a", "2026-09-23T01:00:00Z"));
  const [d] = admitted(eng, candidates, session("laptop-b", "2026-09-24T01:00:00Z"));
  assert.deepEqual([d.fact.strength, d.fact.confidence], ["observed", "certain"]);
  assert.equal(routeOf(d.fact).binding, false);
});

test("a proposal claiming adopted or enforced is refused at the door, and nothing is stored", () => {
  const intel = intelligence();
  const eng = engineering(intel.source);
  const [c] = proposals(intel.intel.all()).candidates;
  const decisions = admitted(eng, [{ ...c, strength: "adopted" }, { ...c, key: "x", strength: "enforced", enforcedBy: [c.evidence[0]] }], session("a", "2026-09-23T01:00:00Z"));
  assert.deepEqual(decisions, []);
  assert.deepEqual(eng.eng.all(), []);
  assert.equal(eng.eng.findings().filter((f) => f.kind === "observer-candidate-refused").length, 2);
});

test("a person's adopted fact is never demoted by an intelligence proposal", () => {
  const intel = intelligence();
  const eng = engineering(intel.source);
  const [c] = proposals(intel.intel.all()).candidates;
  const id = factId(c);
  eng.eng.transact(() => eng.eng.save({ ...c, id, strength: "adopted", confidence: "certain", status: "fresh", unknowns: [], support: { examples: 1, sessions: 2, against: 0, seen: ["x", "y"], contested: [] } }));
  admitted(eng, [c], session("a", "2026-09-23T01:00:00Z"));
  assert.equal(eng.eng.find(id).strength, "adopted", "an observer's candidate must not overwrite a person's decision");
});

test("nothing under src/intelligence/ imports engineering or can save an engineering fact", () => {
  const all = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(dir, e.name)) : all.push(join(dir, e.name))));
  walk(join(ROOT, "src", "intelligence"));
  for (const f of all) assert.doesNotMatch(readFileSync(f, "utf8"), /from "[^"]*engineering\/|eng\.save\(/, `${f} reaches into engineering`);
});
