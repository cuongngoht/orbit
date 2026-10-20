// Current extensions load directly, run through real registries and participate in reports.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { withExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { resultJson } from "../src/run/result.mjs";
import { fakeBrowser, happy } from "./fakes/browser.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";
import { loadExtensions } from "../src/extensions/loader.mjs";
import { emptyRegistries } from "../src/extensions/registries.mjs";
import { registerTool, setStatus } from "../src/extensions/lifecycle.mjs";
import { reportExtensions } from "../src/project-report/context.mjs";
import { renderRun } from "../src/project-report/index.mjs";
import { createProcess } from "../src/process/index.mjs";
import { realIo } from "../src/store/io.mjs";
import { checkReport } from "../skills/orbit-report/extend.mjs";
import { PACK_ROOT } from "../skills/orbit-report/pack.mjs";
import { pythonOr, testPython } from "./project-report/python.mjs";
import { deps, frozen, rctxOf, tempBase } from "./project-report/rctx.mjs";
import { githubSnapshot } from "./project-report/snapshots.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CURRENT = join(HERE, "fixtures", "extensions", "current-example");

const ROWS = JSON.stringify([{ id: "ord-1", name: "demo" }]);

// a project that generated it last year would have on disk.
function seeded(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "orbit-ext-"));
  const room = qcToolPaths(root);
  mkdirSync(room.root, { recursive: true });
  cpSync(CURRENT, join(room.root, "current-example"), { recursive: true });
  return { root, room, ...patched(join(room.root, "current-example"), extra) };
}

// A test that needs a DIFFERENT manifest writes its own copy rather than editing
function patched(dir, extra) {
  if (!Object.keys(extra).length) return {};
  const manifest = { ...JSON.parse(readFileSync(join(dir, "extension.json"), "utf8")), ...extra };
  writeFileSync(join(dir, "extension.json"), JSON.stringify(manifest, null, 2));
  return { patched: true };
}

function contextOver(root, deps = {}) {
  const proc = deps.process ?? fakeProcess({ "fake-probe": { ok: true, out: ROWS, err: "", status: 0 } });
  const tools = deps.tools ?? fakeTools({ "fake-probe": { ok: true, said: "1.0" }, "playwright-cli": { ok: true, said: "0.1.20" } });
  const base = fakeContext({ browser: fakeBrowser({ answers: [["1", 1], ...happy()] }) });
  return { ...base, store: () => root, process: proc, tools, proc };
}

const load = (root, deps) => withExtensions(contextOver(root, deps));

const caseWith = (steps, params) => ({ id: "ext-case", name: "through a project's own capability", seen: "src", params: params ?? [{ n: "NAME", default: "demo" }], steps });

function ran(ctx, dir, steps, { argv = [], params } = {}) {
  writeFileSync(join(dir, "ext-case.json"), JSON.stringify(caseWith(steps, params)));
  return runCase({ ...ctx, project: { ...ctx.project, screensDir: dir } }, ["ext-case", ...argv]);
}

test("a v1 extension from an older engine loads on the current runtime", async () => {
  const { root } = seeded();
  const ctx = await load(root);
  assert.deepEqual(ctx.extensions.refused, [], "nothing refused");
  assert.deepEqual(ctx.extensions.loaded.map((e) => e.id), ["current-example"]);
  assert.deepEqual(ctx.extensions.loaded[0].capabilities, ["example.rows"]);
  assert.ok(ctx.capabilities.has("example.rows"));
  assert.equal(ctx.capabilities.sourceOf("example.rows"), "current-example");
  rmSync(root, { recursive: true, force: true });
});

test("its capability is invoked through the normal runtime, and the run counts the layer the case named", async () => {
  const { root } = seeded();
  const ctx = await load(root);
  const dir = mkdtempSync(join(tmpdir(), "orbit-case-"));
  const o = ran(ctx, dir, [
    { do: "call", capability: "example.rows", input: { query: "SELECT id FROM orders WHERE name = '${NAME}'" }, proves: "sql", expect: "it.rows.length === 1", why: "the row really landed" },
    { do: "report", js: "1", expect: "it === 1" },
  ]);
  assert.equal(o.status, "PASS");
  assert.deepEqual(resultJson(o).proved, { ui: 1, api: 0, sql: 1 });
  assert.deepEqual(ctx.proc.calls[0].args, ["--query", "SELECT id FROM orders WHERE name = 'demo'"], "the ${PARAM} was filled and escaped by the capability's own declared language");
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("select binds one value out of the answer, and a path that runs out says so", async () => {
  const { root } = seeded();
  const ctx = await load(root);
  const dir = mkdtempSync(join(tmpdir(), "orbit-case-"));
  const o = ran(ctx, dir, [
    { do: "call", capability: "example.rows", input: { query: "SELECT id FROM orders" }, proves: "sql", expect: "it.rows.length === 1", select: "rows.0.id", into: "ORDER_ID" },
    { do: "report", js: "1", expect: "it === 1", why: "and a later step can use ${ORDER_ID}" },
  ]);
  assert.equal(o.status, "PASS");
  assert.deepEqual(o.run.captured, [{ at: 1, into: "ORDER_ID", value: "ord-1" }]);
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

// A value the run never bound must never reach a capability: it would ask a
// different question and get an answer that looks like a result.
//
// `check` already refuses a placeholder no param declares -- it reads the WHOLE
// step, `input` included -- so what is exercised here is the other half: a param
// that is declared, is optional, and was simply not given. That reaches the run,
// and the run is what has to stop.
test("an unfilled placeholder inside input stops the step instead of being sent", async () => {
  const { root } = seeded();
  const ctx = await load(root);
  const dir = mkdtempSync(join(tmpdir(), "orbit-case-"));
  const o = ran(ctx, dir, [
    { do: "call", capability: "example.rows", input: { query: "SELECT id FROM orders WHERE id = '${NEVER_BOUND}'" }, proves: "sql", expect: "true" },
    { do: "report", js: "1", expect: "it === 1" },
  ], { params: [{ n: "NEVER_BOUND", desc: "never given on the command line" }] });
  assert.equal(o.status, "FAIL");
  assert.match(o.run.failure.message, /unresolved placeholder\(s\) \$\{NEVER_BOUND\}/);
  assert.deepEqual(ctx.proc.calls, [], "nothing was spawned");
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

// The product is not broken because this laptop has no client for somebody's
// database. That is the same reasoning the sql verb already applies to a database
// behind a VPN, and it has to be the same answer or a team learns to ignore red.
test("a tool the capability declared and this machine lacks is BLOCKED, never FAIL", async () => {
  const { root } = seeded();
  const ctx = await load(root, { tools: fakeTools({ "playwright-cli": { ok: true, said: "0.1.20" } }) });
  const dir = mkdtempSync(join(tmpdir(), "orbit-case-"));
  const o = ran(ctx, dir, [
    { do: "call", capability: "example.rows", input: { query: "SELECT 1" }, proves: "sql", expect: "true" },
    { do: "report", js: "1", expect: "it === 1" },
  ]);
  assert.equal(o.status, "BLOCKED");
  assert.match(o.run.failure.message, /needs fake-probe \(not found on PATH\)/);
  assert.match(o.run.failure.message, /nothing about it was proved wrong/);
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("an input the capability cannot accept is REFUSED, and says what it does accept", async () => {
  const { root } = seeded();
  const ctx = await load(root);
  const dir = mkdtempSync(join(tmpdir(), "orbit-case-"));
  const o = ran(ctx, dir, [
    { do: "call", capability: "example.rows", input: { query: "SELECT 1", nonesuch: "x" }, proves: "sql", expect: "true" },
    { do: "report", js: "1", expect: "it === 1" },
  ]);
  assert.equal(o.status, "REFUSED");
  assert.match(o.run.failure.message, /unknown key "nonesuch" — it accepts query, limit/);
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a project with no QC tools at all loads cleanly and offers none", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-ext-"));
  const ctx = await load(root);
  assert.deepEqual(ctx.extensions.loaded, []);
  assert.deepEqual(ctx.extensions.refused, []);
  assert.deepEqual(ctx.capabilities.ids(), []);
  rmSync(root, { recursive: true, force: true });
});

// Project isolation, which the store gets for free by being keyed on the project
// — and which is asserted here anyway, because "for free" is how it stops being
// true when somebody moves a path.
test("one project's QC tools never reach another's", async () => {
  const { root: a } = seeded();
  const b = mkdtempSync(join(tmpdir(), "orbit-ext-"));
  const first = await load(a);
  const second = await load(b);
  assert.ok(first.capabilities.has("example.rows"));
  assert.ok(!second.capabilities.has("example.rows"));
  assert.ok(!first.dsl.has("nothing-here"));
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

//
// as the real workflow produced it (qc-tool new --report=metric, put, register,
// status active), without the registration record the store adds. A change
// that would need it edited is a breaking change to what a v1 report part is.

const CURRENT_REPORTING = join(HERE, "fixtures", "extensions", "current-reporting-example");

test("the current report extension loads on today's runtime -- as data, with nothing of it imported", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-ext-report-"));
  const room = qcToolPaths(root);
  cpSync(CURRENT_REPORTING, join(room.root, "pr-aging"), { recursive: true });
  for (const dataOnly of [true, false]) {
    const ctx = { ...emptyRegistries(), store: () => root };
    const out = await loadExtensions(ctx, { io: realIo(), dataOnly });
    assert.deepEqual(out.refused, [], JSON.stringify(out.refused));
    assert.deepEqual(ctx.reporting.parts().map((p) => p.id), ["pr-aging.metric"]);
  }
  rmSync(root, { recursive: true, force: true });
});

const python = (t) => (pythonOr(t) ? testPython().path : null);
const checks = (py) => (dir, verdict) => checkReport(dir, verdict.manifest, { python: py, process: createProcess(), env: process.env, io: realIo(), human: false, latest: null });

test("registered through today's lifecycle, it runs in a render beside the standard parts", async (t) => {
  const py = python(t);
  if (!py) return;
  const base = tempBase(t);
  const ctx = { store: () => join(base, "store") };
  await registerTool(ctx, CURRENT_REPORTING, realIo(), {}, { check: checks(py) });
  setStatus(ctx, "pr-aging", "active", realIo());
  const rctx = rctxOf(base, { file: py, version: "3.12.0" }, { extensions: await reportExtensions(join(base, "store"), realIo()) });
  frozen(rctx, githubSnapshot(), "20260925T030000Z-0001");
  const out = await renderRun(rctx, "20260925T030000Z-0001", deps());
  assert.deepEqual(out.parts.map((p) => `${p.id}:${p.status}`).sort(), ["orbit.report.forecast:ok", "orbit.report.metrics:ok", "pr-aging.metric:ok"]);
  assert.match(readFileSync(out.report, "utf8"), /"title":"Open PR aging"/);
});

// A plugin update replaces the plugin's directory and nothing else: what a
// project keeps -- settings, extensions, runs -- names no path inside it.
function everyFile(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? everyFile(join(dir, n)) : [join(dir, n)]));
}

test("an engine it was not written for stops choosing it, the standard report still renders, and the store names no plugin path", async (t) => {
  const py = python(t);
  if (!py) return;
  const base = tempBase(t);
  const store = join(base, "store");
  const room = qcToolPaths(store);
  cpSync(CURRENT_REPORTING, join(room.root, "pr-aging"), { recursive: true });
  writeFileSync(join(room.root, "pr-aging", "extension.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(CURRENT_REPORTING, "extension.json"), "utf8")), engine: ">=9.0.0" }));
  const rctx = rctxOf(base, { file: py, version: "3.12.0" }, { extensions: await reportExtensions(store, realIo()) });
  assert.match(rctx.extensions.refused[0].why, /written for >=9\.0\.0/);
  frozen(rctx, githubSnapshot(), "20260925T030000Z-0001");
  const out = await renderRun(rctx, "20260925T030000Z-0001", deps());
  assert.equal(out.status, "ok");
  assert.deepEqual(out.parts.map((p) => p.id).sort(), ["orbit.report.forecast", "orbit.report.metrics"]);
  const kept = everyFile(store).filter((f) => /settings\.json$|run\.json$|extension\.json$|reporting\.json$|\.registered\.json$/.test(f));
  for (const f of kept) assert.ok(!readFileSync(f, "utf8").includes(PACK_ROOT), `${f} names the plugin's own directory`);
});
