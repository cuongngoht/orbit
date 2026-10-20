// Which parts a report run executes: every rule on its own, and the order
// between the ones that could disagree. Pure, so no process and no store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compose } from "../src/project-report/compose.mjs";
import { standardParts, standardSections } from "../skills/orbit-report/pack.mjs";

const COMPUTE = ["transform", "metric", "section", "exporter", "workflow"];
const BASE = ["report.collection.pullRequests", "report.collection.workItems", "report.collection.builds"];

const facts = (over = {}) => ({ provider: "github", base: BASE, runtimes: { python: { version: "3.12.4" } }, extensions: { demo: { status: "active", fingerprint: "ok" }, other: { status: "active", fingerprint: "ok" } }, contested: [], settings: { parts: {} }, phases: COMPUTE, sections: standardSections(), ...over });

const part = (id, over = {}) => ({ id, version: "0.1.0", kind: "metric", contract: "orbit.report.part/v1", entry: "./m.py", runtime: "python", requires: ">=3.11", doc: "d", provides: [`report.metric.${id}`], needs: ["report.collection.pullRequests"], metrics: [{ id: `${id}.x`, version: "1", label: "x", unit: "n", definition: "d" }], source: "store", from: id.split(".")[0], ...over });

const ids = (plan) => plan.run.map((p) => p.id);
const why = (plan, id) => plan.skipped.find((s) => s.id === id)?.why ?? null;

test("the standard kit composes on its own: collectors for another phase stay quiet, metrics before the forecast", () => {
  const plan = compose(standardParts(), facts());
  assert.deepEqual(ids(plan), ["orbit.report.metrics", "orbit.report.forecast"]);
  assert.equal(plan.skipped.length, 0, "a collector outside this phase is not news");
  const collect = compose(standardParts(), facts({ phases: ["collector"], base: ["source.read"] }));
  assert.deepEqual(ids(collect), ["orbit.report.github"], "one provider: the other provider's collector is not a part of this project");
  assert.match(why(collect, "orbit.report.bmad"), /needs report\.docs/, "documents were not configured, so their collector says what it lacks");
});

test("an extension part runs BESIDE the standard ones, after what it needs", () => {
  const plan = compose([...standardParts(), part("demo.aging", { needs: ["report.model"] })], facts());
  assert.deepEqual(ids(plan), ["orbit.report.metrics", "demo.aging", "orbit.report.forecast"]);
});

test("admission: each reason on its own, in words a person can act on", () => {
  const cases = [
    [part("demo.a", { contract: "orbit.report.part/v2" }), {}, /written against orbit\.report\.part\/v2/],
    [part("demo.a"), { extensions: { demo: { status: "verified", fingerprint: "ok" } } }, /extension demo is verified; only an active/],
    [part("demo.a"), { extensions: { demo: { status: "active", fingerprint: "changed" } } }, /changed after it was registered/],
    [part("demo.a"), { extensions: { demo: { status: "active" } } }, /carries no registration record/],
    [part("demo.a"), { settings: { parts: { "demo.a": { enabled: false } } } }, /switched off/],
    [part("demo.a"), { runtimes: {} }, /needs python >=3\.11, and none is available/],
    [part("demo.a", { requires: ">=3.13" }), {}, /needs python >=3\.13; this machine resolved 3\.12\.4/],
    [part("demo.a"), { contested: [{ id: "demo.a", owners: ["demo", "other"] }] }, /declared by demo and other, so neither runs/],
    [part("demo.a", { kind: "workflow", entry: "./w.md" }), {}, /listed, never run/],
  ];
  for (const [p, over, says] of cases) {
    const plan = compose([...standardParts(), p], facts(over));
    assert.ok(!ids(plan).includes(p.id), `${says} leaves it out`);
    assert.match(why(plan, p.id), says);
    if (!over.runtimes) assert.deepEqual(ids(plan), ["orbit.report.metrics", "orbit.report.forecast"], "and the standard parts run regardless");
  }
});

test("replacement is explicit, same kind, complete, approved by a person -- and two cancel out", () => {
  const forecast = standardParts().find((p) => p.id === "orbit.report.forecast");
  const mine = part("demo.forecast", { replaces: forecast.id, provides: ["report.forecast"], needs: ["report.model"], metrics: [{ id: "demo.forecast.x", version: "1", label: "x", unit: "n", definition: "d" }] });
  const unapproved = compose([...standardParts(), mine], facts());
  assert.match(why(unapproved, "demo.forecast"), /only a person activates a replacement/);
  assert.ok(ids(unapproved).includes(forecast.id), "the standard forecast still runs");
  const approved = compose([...standardParts(), mine], facts({ settings: { parts: { "demo.forecast": { enabled: true, replace: true } } } }));
  assert.deepEqual(ids(approved), ["orbit.report.metrics", "demo.forecast"]);
  assert.match(why(approved, forecast.id), /replaced by demo\.forecast 0\.1\.0, as a person approved/);
  const rival = part("other.forecast", { replaces: forecast.id, provides: ["report.forecast"], needs: ["report.model"], metrics: [{ id: "other.forecast.x", version: "1", label: "x", unit: "n", definition: "d" }] });
  const both = compose([...standardParts(), mine, rival], facts({ settings: { parts: { "demo.forecast": { enabled: true, replace: true }, "other.forecast": { enabled: true, replace: true } } } }));
  assert.ok(ids(both).includes(forecast.id) && !ids(both).includes("demo.forecast") && !ids(both).includes("other.forecast"), "a conflict applies neither, and the standard part runs");
  assert.match(why(both, "demo.forecast"), /demo\.forecast and other\.forecast all replace orbit\.report\.forecast/);
  const partial = compose([...standardParts(), { ...mine, provides: [] }], facts({ settings: { parts: { "demo.forecast": { enabled: true, replace: true } } } }));
  assert.match(why(partial, "demo.forecast"), /does not provide all of what orbit\.report\.forecast does \(report\.forecast\)/);
  const kind = compose([...standardParts(), { ...mine, kind: "section", section: { id: "demo.s", title: "S" } }], facts({ settings: { parts: { "demo.forecast": { enabled: true, replace: true } } } }));
  assert.match(why(kind, "demo.forecast"), /replaces a metric with a section/);
});

test("a need nothing provides leaves its part out, and the parts that needed IT follow", () => {
  const a = part("demo.a", { provides: ["x.a"], needs: ["report.collection.documents"] });
  const b = part("demo.b", { provides: ["x.b"], needs: ["x.a"] });
  const plan = compose([...standardParts(), a, b], facts());
  assert.match(why(plan, "demo.a"), /needs report\.collection\.documents, which neither this snapshot nor a part that runs before it provides/);
  assert.match(why(plan, "demo.b"), /needs x\.a/);
});

test("a cycle leaves out every part on it and prints the cycle; a later phase cannot feed an earlier one", () => {
  const a = part("demo.a", { provides: ["x.a"], needs: ["x.b"] });
  const b = part("demo.b", { provides: ["x.b"], needs: ["x.a"] });
  const plan = compose([...standardParts(), a, b], facts());
  assert.equal(why(plan, "demo.a"), "is part of a cycle: demo.a -> demo.b -> demo.a");
  assert.equal(why(plan, "demo.b"), "is part of a cycle: demo.a -> demo.b -> demo.a");
  const section = part("demo.s", { kind: "section", provides: ["x.s"], needs: [], section: { id: "demo.s", title: "S" }, metrics: [] });
  const early = part("demo.m", { needs: ["x.s"] });
  assert.match(why(compose([...standardParts(), section, early], facts()), "demo.m"), /needs x\.s/);
});

test("order: phases in turn, a part after what it needs, ties by id -- the same answer every time", () => {
  const s = part("demo.s", { kind: "section", provides: ["report.section.demo.s"], needs: ["report.metric.demo.m"], section: { id: "demo.s", title: "S" }, metrics: [] });
  const m = part("demo.m", { needs: ["report.model"] });
  const t = part("demo.t", { kind: "transform", provides: ["report.derived.demo.t"], needs: [], metrics: [] });
  const e = part("demo.e", { kind: "exporter", provides: [], needs: [], metrics: [], formats: ["csv"] });
  const once = ids(compose([e, s, m, t, ...standardParts()], facts()));
  assert.deepEqual(once, ["demo.t", "orbit.report.metrics", "demo.m", "orbit.report.forecast", "demo.s", "demo.e"]);
  assert.deepEqual(ids(compose([...standardParts(), t, m, s, e].reverse(), facts())), once);
});

test("an extension section titled like a standard one is noted as shown beside it, not instead", () => {
  const s = part("demo.s", { kind: "section", provides: [], needs: [], section: { id: "demo.s", title: "Forecast" }, metrics: [] });
  const plan = compose([...standardParts(), s], facts());
  assert.ok(ids(plan).includes("demo.s") && ids(plan).includes("orbit.report.forecast"));
  assert.match(plan.notes[0], /demo\.s \(Forecast\) is an extension section shown beside the standard one of that name, not instead of it/);
});
