// The plan document's three example cases (§8.1 invoice-search, §8.2 invoice-owner-read and invoice-other-tenant-read),
// kept VERBATIM in acceptance/projects/_shared/expected-cases/, pass the DSL validator with zero findings: grammar and the
// core rules, on an empty fixture graph, a capability looked up as the API test pack declares it (the pack a project opts
// into, skills/orbit-api-test) beside the engine's own families. That is all it shows -- never that a provider is
// registered (query check and the capability pipeline hold that) or that a test passed; the generated cases acceptance/run.mjs runs are held to
// the same steps and layers by the engine, not by this file.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import API_PACK from "../skills/orbit-api-test/capabilities.mjs";

const DIR = join(import.meta.dirname, "..", "acceptance", "projects", "_shared", "expected-cases");
const caps = new Map([...familyCapabilities(), ...API_PACK].map((c) => [c.id, c]));
const cases = () => readdirSync(DIR).filter((n) => n.endsWith(".json")).sort().map((n) => JSON.parse(readFileSync(join(DIR, n), "utf8")));

function emptyGraph() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-doc-graph-"));
  return { graph: loadGraph(dir), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the document's example cases are kept, all three, under their own ids", () => {
  assert.deepEqual(cases().map((c) => c.id), ["invoice-other-tenant-read", "invoice-owner-read", "invoice-search"]);
});

test("each example case passes the DSL validator with zero findings", () => {
  const g = emptyGraph();
  for (const c of cases()) assert.deepEqual(validate(c, g.graph, CORE, undefined, (id) => caps.get(id) ?? null), [], c.id);
  g.done();
});

test("zero findings means something: the same validator finds a verb and a field the grammar does not have", () => {
  const g = emptyGraph();
  const search = cases().find((c) => c.id === "invoice-search");
  assert.ok(validate({ ...search, steps: [{ ...search.steps[0], do: "teleport" }, ...search.steps.slice(1)] }, g.graph, CORE, undefined, (id) => caps.get(id) ?? null).length > 0, "an unknown verb");
  assert.ok(validate({ ...search, steps: [{ ...search.steps[0], hover: true }, ...search.steps.slice(1)] }, g.graph, CORE, undefined, (id) => caps.get(id) ?? null).length > 0, "an unknown field");
  g.done();
});

test("the backend examples are pageless through the API pack's capability; the frontend one rules on all three layers", () => {
  const byId = Object.fromEntries(cases().map((c) => [c.id, c]));
  for (const id of ["invoice-owner-read", "invoice-other-tenant-read"]) assert.equal(caps.get(byId[id].steps[0].capability)?.page, false, id);
  assert.deepEqual([...new Set(byId["invoice-search"].steps.map((s) => CORE.provedBy(s)).filter(Boolean))].sort(), ["api", "sql", "ui"]);
});
