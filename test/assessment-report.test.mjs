// An assessment (doc §10; PBI 18): what the generated tests came to per obligation, read off the
// journal and deciding nothing new; coverage counts only SATISFIED over every obligation that
// applies; every gap says why; it is FROZEN, a later one supersedes it, and its report is rendered
// from the snapshot alone -- the same page every time, escaped, and nothing called compliant.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assessed, assessmentOf } from "../src/investigation/assessments.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { renderAssessment } from "../src/report/assessment.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-100000-abcd";

function world(objective = "tenant isolation for invoices") {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective, revision: "rev-1" });
  const roles = new Map();
  const put = (kind, rec) => store.appendOnce(ID, kind, { eventId: eventIdOf(kind, rec.id, 0, JSON.stringify(rec)), ...rec });
  const design = (design, role) => {
    const obligation = obligationOfDesign(design);
    const artifact = store.putArtifact(ID, "designs", { id: design, controls: [{ role }] });
    roles.set(artifact.digest, { controls: [{ role }] });
    put("designed", { id: `dsg-${design}`, obligation, design, digest: artifact.digest, state: "designed" });
    put("version", { id: `ver-${design}`, design, case: `gen-${design}`, version: `gen-${design}@0000000000000000`, digest: "0".repeat(64) });
  };
  const ran = (design, n, outcome) => {
    put("run", { id: `run-${design}-${n}`, case: `gen-${design}`, status: outcome === "SATISFIED" ? "PASS" : "FAIL", version: `gen-${design}@0000000000000000`, execution: `exe-${design}-${n}` });
    put("evaluated", { id: `evl-${design}-${n}`, execution: `exe-${design}-${n}`, obligation: obligationOfDesign(design), result: `res-${design}${n}`, outcome });
  };
  const obligationOfDesign = (d) => (d.startsWith("own") || d.startsWith("other") ? "tob-perm001" : "tob-once001");
  put("obligation", { id: "obr-1", obligation: "tob-perm001", revision: "r1", shape: "permission-enforced" });
  put("obligation", { id: "obr-2", obligation: "tob-once001", revision: "r1", shape: "occurrence-one-execution" });
  put("obligation", { id: "obr-3", obligation: "tob-lost001", revision: "r1", shape: "no-foreign-effect", missing: "the tenant scope" });
  return { w: { id: ID, store, io }, design, ran, reads: { designOf: (d) => roles.get(d) ?? null }, model: () => modelOf(store.read(ID)) };
}

test("each obligation comes to the word its controls' latest results give; coverage counts only SATISFIED, over every obligation", () => {
  const t = world();
  t.design("own1", "positive");
  t.design("other1", "negative");
  t.ran("own1", 1, "SATISFIED");
  t.ran("other1", 1, "CONTRADICTED");
  const a = assessmentOf(t.model(), t.reads);
  const byId = Object.fromEntries(a.obligations.map((o) => [o.obligation, o]));
  assert.equal(byId["tob-perm001"].outcome, "CONTRADICTED", "the other tenant read what it must not");
  assert.deepEqual(byId["tob-perm001"].controls, { positive: "SATISFIED", negative: "CONTRADICTED" });
  assert.equal(byId["tob-once001"].outcome, "INCONCLUSIVE");
  assert.deepEqual(byId["tob-once001"].gaps, ["no design holds for it yet"]);
  assert.deepEqual(byId["tob-lost001"].gaps, ["no design holds for it yet", "no accepted source says the tenant scope"]);
  assert.deepEqual(a.coverage, { counted: 0, of: 3, shown: "0/3" });
});

test("a negative proves nothing while its positive failed -- inconclusive, never satisfied", () => {
  const t = world();
  t.design("own1", "positive");
  t.design("other1", "negative");
  t.ran("own1", 1, "ENVIRONMENT_BLOCKED");
  t.ran("other1", 1, "SATISFIED");
  assert.equal(assessmentOf(t.model(), t.reads).obligations[0].outcome, "INCONCLUSIVE");
});

test("frozen once, and a later result makes a NEW assessment that names the one it supersedes", () => {
  const t = world();
  t.design("own1", "positive");
  t.design("other1", "negative");
  t.ran("own1", 1, "SATISFIED");
  t.ran("other1", 1, "SATISFIED");
  const first = assessed(t.w, t.reads);
  assert.equal(first.snapshot.obligations[0].outcome, "SATISFIED");
  assert.equal(assessed(t.w, t.reads).snapshot.id, first.snapshot.id, "the same snapshot again is nothing new");
  assert.equal(t.model().assessments.length, 1);
  t.ran("other1", 2, "CONTRADICTED");
  const second = assessed(t.w, t.reads);
  assert.notEqual(second.snapshot.id, first.snapshot.id);
  assert.equal(t.model().assessments.at(-1).supersedes, first.snapshot.id);
  assert.deepEqual(t.w.store.readArtifact(ID, "assessments", first.artifact.digest), first.snapshot, "the first is kept as it was");
});

test("the report is rendered from the snapshot alone: the same page every time, escaped, and nothing called compliant", () => {
  const t = world("<script>alert(1)</script> tenants");
  const snapshot = assessmentOf(t.model(), t.reads);
  const page = renderAssessment(snapshot, { project: "invoice-a" });
  assert.equal(renderAssessment(snapshot, { project: "invoice-a" }), page);
  assert.equal(page.includes("<script>alert(1)"), false);
  assert.match(page, /Nothing here is called compliant/);
  assert.match(page, /Coverage 0\/3/);
  assert.match(page, /no accepted source says the tenant scope/);
});
