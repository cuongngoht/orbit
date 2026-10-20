// One Strategy per verb, looked up by name, and the checks that stop a
// behaviour and a vocabulary from drifting apart.
//
// The last test is the one that matters most: a verb the ENGINE has never heard
// of, registered by a project, driven all the way through the real runner to a
// PASS that says which layer it proved. Everything above it is the contract that
// makes that safe.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CORE, createDslRegistry } from "../src/dsl/registry.mjs";
import { CORE_EXECUTORS, EXECUTORS, agree, coreExecutors, createExecutorRegistry } from "../src/run/verbs/index.mjs";
import { Refused } from "../src/errors.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { resultJson } from "../src/run/result.mjs";
import { verdict } from "../src/run/verdict.mjs";
import { fakeBrowser, happy } from "./fakes/browser.mjs";
import { fakeContext } from "./fakes/context.mjs";

const FIELD = { type: "string", esc: "sql", doc: "probe: the read-only statement to send." };
const VERB = { name: "probe", kind: "verdict", verdict: "always", proves: "sql", doc: "ask the store underneath and rule on the answer", needs: ["statement", "expect"], fields: ["statement", "expect"] };

// A project's own Strategy. It reaches the outside world through a port on ctx,
// exactly as sql.mjs reaches ctx.db -- it does not spawn anything itself.
const PROBE = {
  name: "probe",
  label: (s) => s.statement,
  act(ctx, run, s) {
    const rows = ctx.probe(s.statement);
    verdict(s, rows);
    return rows;
  },
  logged: (r) => ({ rows: r.result }),
};

function extendedDsl(from = "acme-probe") {
  const dsl = createDslRegistry();
  dsl.registerField("statement", FIELD, from);
  dsl.registerVerb(VERB, from);
  return dsl;
}

const refusal = (fn) => {
  try { fn(); } catch (e) { return e; }
  return null;
};

test("the engine's own registry holds exactly the engine's own verbs", () => {
  assert.deepEqual([...EXECUTORS.names()].sort(), CORE_EXECUTORS.map((e) => e.name).sort());
  assert.deepEqual([...EXECUTORS.names()].sort(), [...CORE.verbNames()].sort());
  assert.equal(EXECUTORS.sourceOf("sql"), "core");
});

test("resolving a verb nothing can run is a sentence, not a TypeError on .act", () => {
  const e = refusal(() => EXECUTORS.resolve("probe"));
  assert.ok(e instanceof Refused, String(e));
  assert.match(e.message, /no behaviour is registered for "probe"/);
});

test("a behaviour whose verb nobody declared is REFUSED at registration", () => {
  const registry = coreExecutors(createDslRegistry());
  const e = refusal(() => registry.register(PROBE, "acme-probe"));
  assert.match(e.message, /no verb row declares it/);
});

test("a duplicate behaviour is REFUSED and names who already owns the verb", () => {
  const registry = coreExecutors(extendedDsl());
  registry.register(PROBE, "acme-probe");
  assert.match(refusal(() => registry.register(PROBE, "someone-else")).message, /already registered by acme-probe/);
  assert.match(refusal(() => registry.register({ ...PROBE, name: "sql" }, "acme")).message, /already registered by core/);
});

// The promise a row makes, held to the behaviour that has to keep it.
test("a verb offering into must be able to capture, or the case could declare a binding nothing can make", () => {
  const dsl = createDslRegistry();
  dsl.registerField("statement", FIELD, "acme");
  dsl.registerVerb({ ...VERB, fields: [...VERB.fields, "into"] }, "acme");
  const registry = coreExecutors(dsl);
  assert.match(refusal(() => registry.register(PROBE, "acme")).message, /offers "into" but it has no capture\(\)/);
  assert.doesNotThrow(() => registry.register({ ...PROBE, capture: (s, rows) => rows[0] }, "acme"));
});

test("a malformed executor is refused before it can be resolved", () => {
  const registry = coreExecutors(extendedDsl());
  assert.match(refusal(() => registry.register({ name: "probe" }, "acme")).message, /has no act\(ctx, run, step\)/);
  assert.match(refusal(() => registry.register("probe", "acme")).message, /an executor is an object with a name/);
});

// The other direction, and the reason it is a separate call: while extensions
// are still loading, a verb with no behaviour yet is normal.
test("agree() refuses a vocabulary with a verb nothing can run, and names it", () => {
  const dsl = extendedDsl();
  const e = refusal(() => agree(dsl, coreExecutors(dsl)));
  assert.match(e.message, /verb registry drift — probe is a verb nothing can run/);
  const whole = coreExecutors(dsl);
  whole.register(PROBE, "acme-probe");
  assert.doesNotThrow(() => agree(dsl, whole));
});

test("two registries cannot see each other — project A's behaviour never reaches project B", () => {
  const a = coreExecutors(extendedDsl("project-a"));
  a.register(PROBE, "project-a");
  const b = coreExecutors(createDslRegistry());
  assert.ok(a.has("probe"));
  assert.ok(!b.has("probe"));
  assert.ok(!EXECUTORS.has("probe"), "and the engine's own registry is untouched");
});

test("an empty registry over the core vocabulary registers nothing by accident", () => {
  const registry = createExecutorRegistry(CORE);
  assert.deepEqual(registry.names(), []);
  assert.equal(registry.sourceOf("sql"), null);
});

// The whole point, end to end: a verb the engine has never heard of, driven by
// the real runner, through the real gates, to a PASS that says which layer it
// proved -- and nothing in src/ was edited to allow it.
test("a project's own verb runs through the real runner and is counted as the layer it proves", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-exec-"));
  writeFileSync(join(dir, "probe-case.json"), JSON.stringify(theCase()));
  const o = runCase(extendedContext(dir), ["probe-case"]);
  assert.equal(o.status, "PASS");
  assert.deepEqual(resultJson(o).proved, { ui: 1, sql: 1, api: 0 }, "the extension verb tallied against the layer its row names");
  rmSync(dir, { recursive: true, force: true });
});

test("the extension's own field is logged, escaped and interpolated like every core one", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-exec-"));
  const asked = [];
  writeFileSync(join(dir, "probe-case.json"), JSON.stringify(theCase("WHERE n = '${NAME}'")));
  const o = runCase(extendedContext(dir, asked), ["probe-case", "NAME=O'Brien"]);
  assert.equal(o.status, "PASS");
  assert.deepEqual(asked, ["WHERE n = 'O''Brien'"], "escaped by the esc its row declared, not spliced raw");
  rmSync(dir, { recursive: true, force: true });
});

function theCase(statement = "SELECT 1") {
  return {
    id: "probe-case",
    name: "a project's own verb",
    seen: "src",
    params: [{ n: "NAME", default: "x" }],
    steps: [
      { do: "probe", statement, expect: "it.length === 1", why: "the store underneath agrees" },
      { do: "report", js: "1", expect: "it === 1" },
    ],
  };
}

function extendedContext(screensDir, asked = []) {
  const base = fakeContext({ browser: fakeBrowser({ answers: [["1", 1], ...happy()] }) });
  const dsl = extendedDsl();
  const executors = coreExecutors(dsl);
  executors.register(PROBE, "acme-probe");
  return { ...base, dsl, executors: agree(dsl, executors), project: { ...base.project, screensDir }, probe: (s) => { asked.push(s); return [{ n: "1" }]; } };
}
