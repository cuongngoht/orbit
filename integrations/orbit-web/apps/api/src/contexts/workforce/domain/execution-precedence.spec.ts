import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecutionProfile } from "@orbit-web/contracts";
import { resolveExecution } from "./execution-precedence.js";

const profile = (over: Partial<ExecutionProfile> = {}): ExecutionProfile => ({ runtime: "claude", connectionId: "c-own", model: "sonnet", effort: "medium", webSearch: false, orbitPlugin: false, ...over });

test("a profile that names every field keeps exactly what it chose, whatever the defaults say -- every profile written before defaults existed", () => {
  const r = resolveExecution({ override: null, profile: profile(), department: { claude: { model: "opus", effort: "high", connectionId: "c-dept" } }, company: { claude: { model: "haiku" } } });
  assert.deepEqual([r.execution.connectionId, r.execution.model, r.execution.effort], ["c-own", "sonnet", "medium"]);
  assert.deepEqual(r.sources, { connection: "employee", model: "employee", effort: "employee" });
});

test("field by field: the mission's override, else the profile, else the department's default, else the company's", () => {
  const p = profile({ model: "", effort: null, connectionId: null, inherit: ["model", "effort", "connection"] });
  const r = resolveExecution({ override: { effort: "max" }, profile: p, department: { claude: { model: "opus" } }, company: { claude: { model: "haiku", effort: "low", connectionId: "c-co" } } });
  assert.deepEqual([r.execution.model, r.execution.effort, r.execution.connectionId], ["opus", "max", "c-co"]);
  assert.deepEqual(r.sources, { connection: "company", model: "department", effort: "mission" });
  assert.equal(r.execution.inherit, undefined, "what runs is concrete");
});

test("a default of another runtime never applies -- nothing switches an employee's provider -- and a model nobody names is said unresolved", () => {
  const p = profile({ model: "", inherit: ["model"] });
  const r = resolveExecution({ override: null, profile: p, department: { codex: { model: "gpt-6.1-sol" } }, company: null });
  assert.deepEqual(r.unresolved, ["model"]);
  assert.equal(r.execution.runtime, "claude");
  const none = resolveExecution({ override: null, profile: profile({ connectionId: null, effort: null, inherit: ["connection", "effort"] }), department: null, company: null });
  assert.deepEqual([none.execution.connectionId, none.sources.connection, none.sources.effort], [null, "runtime", "runtime"], "the runtime's default connection, as before");
});
