// A case that asks nothing of a screen runs with no browser at all.
//
// Only sql and call steps, no wait, no identity, no start screen, and every
// capability it calls DECLARED page: false (src/dsl/page.mjs). Each test below
// drives the run through a browser port that THROWS on any call, so "no browser
// was touched" is proved rather than assumed. The conservative half is held
// too: a capability that declared nothing, and a case that looks at the
// screen, still need a page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "../src/dsl/validate.mjs";
import { needsPage, pageNeedOf, pagelessByVerbs } from "../src/dsl/page.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { UI_TESTS, fakeContext } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));

// A browser that is not there: anything that touches it fails the test.
const noBrowser = () => new Proxy({}, { get: (_, key) => (key === "then" ? undefined : () => { throw new Error(`the browser was asked for ${String(key)}`); }) });

const ROWS = { id: "orders.count", apiVersion: "orbit.capability/v1", doc: "count the orders a test created", page: false, invoke: (ext, input) => ({ rows: input.expect === "none" ? [] : [{ id: 1 }] }) };
const LEGACY = { ...ROWS, id: "legacy.count", page: undefined };
const PEEK = { ...ROWS, id: "peek.count", invoke: (ext) => ({ rows: [ext.browser.evaluate("1")] }) };

function contextWith(caps, browser = noBrowser()) {
  const ctx = fakeContext({ browser });
  caps.forEach((c) => ctx.capabilities.register(c, "headless.test"));
  return ctx;
}

const callStep = (capability, more = {}) => ({ do: "call", capability, input: {}, expect: "it.rows.length === 1", proves: "sql", ...more });

function ran(ctx, c) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-headless-"));
  writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(c));
  try { return runCase(ctx, [join(dir, `${c.id}.json`)]); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const pageless = (steps) => ({ id: "pageless-case", name: "a backend rule, verified with no browser", seen: "src", steps });

test("a case of calls to capabilities that declared page: false runs to PASS without a browser", () => {
  const o = ran(contextWith([ROWS]), pageless([callStep("orders.count")]));
  assert.equal(o.status, "PASS");
  const opened = o.run.log.records.find((r) => r.kind === "run");
  assert.equal(opened.page, false);
  assert.equal(opened.runDir, null, "no browser directory is looked up either");
});

test("its FAIL keeps the run's own log as evidence and asks no browser for a screenshot", () => {
  const o = ran(contextWith([ROWS]), pageless([callStep("orders.count", { input: { expect: "none" } })]));
  assert.equal(o.status, "FAIL");
});

test("a pageless case needs no final report step, and still needs a verdict", () => {
  assert.deepEqual(validate(pageless([callStep("orders.count")]), graph), []);
  const bare = validate(pageless([{ do: "call", capability: "orders.count", expect: "true", proves: "sql" }]), graph);
  assert.deepEqual(bare, []);
  const screen = validate({ ...pageless([callStep("orders.count")]), start: "home" }, graph);
  assert.ok(screen.some((f) => /does not end with a report step/.test(f)), "a case that starts on a screen still ends by recording it");
});

test("the conservative half: a capability that declared nothing, a wait, an identity or a start screen each need a page", () => {
  const byCase = (c) => pageNeedOf(c, CORE);
  assert.equal(byCase(pageless([callStep("orders.count")])), null);
  assert.match(byCase(pageless([callStep("orders.count", { wait: "true" })])), /waits on the page/);
  assert.match(byCase({ ...pageless([callStep("orders.count")]), identity: { as: "admin" } }), /identity/);
  assert.match(byCase({ ...pageless([callStep("orders.count")]), start: "home" }), /starts on screen home/);
  assert.match(byCase(pageless([{ do: "report", js: "1" }])), /reads or drives the page/);
  assert.equal(needsPage(pageless([callStep("legacy.count")]), CORE, () => undefined), true, "an unstated need is read as a need");
  assert.equal(pagelessByVerbs(pageless([callStep("legacy.count")]), CORE), true, "validation cannot see a capability; the run can");
});

test("a capability that declared nothing puts the run through the session gate as before", () => {
  const ctx = contextWith([LEGACY], { ...noBrowser(), settled: () => "NONE", dir: () => "/tmp/none" });
  assert.throws(() => ran(ctx, pageless([callStep("legacy.count")])), /no playwright-cli session/);
});

test("a pageless run that claims to prove the screen is refused before anything runs", () => {
  assert.throws(() => ran(contextWith([ROWS]), pageless([callStep("orders.count", { proves: "ui" })])), /needs no page, yet a step claims to prove ui/);
});

test("a capability that declared page: false and reaches for the browser anyway is refused in words", () => {
  const o = ran(contextWith([{ ...PEEK, page: false }]), pageless([callStep("peek.count")]));
  assert.equal(o.status, "REFUSED");
  assert.match(o.run.failure?.reason ?? JSON.stringify(o.run.log.records), /declared page: false, and this run has no page/);
});
