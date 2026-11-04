// What a QA case's engine is set up with, as a person sets it in Control: the investigation's own minutes are the
// case's runner minutes -- the time the host's brief promises (round.mjs) -- never the setting's 20-minute default,
// which stopped real hosts with most of their obligations open (ORBIT-QA-003, ship 11).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { settingsOf } from "../benchmark/lib/qa/engine.mjs";

const ROOT = join(import.meta.dirname, "..");
const caseOf = (id) => JSON.parse(readFileSync(join(ROOT, "benchmark", "suites", "orbit-qa", id, "case.json"), "utf8"));
const TARGET = { tenancy: { claim: "tid" } };

test("the investigation is given the case's runner minutes, within the setting's bound", () => {
  const set = new Map(settingsOf(TARGET, caseOf("orbit-qa-003").limits));
  assert.equal(set.get("limits.minutes"), String(caseOf("orbit-qa-003").limits.runner.minutes));
  assert.equal(new Map(settingsOf(TARGET, { runner: { minutes: 600 } })).get("limits.minutes"), "240", "never past the setting's own maximum");
  assert.equal(new Map(settingsOf(TARGET, {})).has("limits.minutes"), false, "a case that declares no runner minutes keeps the default");
  assert.equal(set.get("enabled"), "true");
});
