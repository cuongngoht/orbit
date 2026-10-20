// A whole RENDER over a frozen snapshot, with the real kit, the real renderer and
// a real interpreter: what lands where, what the record says, and that nothing
// asks a source. Plus the two promises a project extension depends on -- a
// failing one leaves the standard report exactly as it was, and a run pins the
// files it executed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Blocked } from "../src/errors.mjs";
import { registerTool, setStatus } from "../src/extensions/lifecycle.mjs";
import { reportExtensions } from "../src/project-report/context.mjs";
import { renderRun, runReport } from "../src/project-report/index.mjs";
import { readRun } from "../src/project-report/runs.mjs";
import { calendarBetween, periodOf } from "../src/project-report/window.mjs";
import { secretSource } from "../src/secrets.mjs";
import { realIo } from "../src/store/io.mjs";
import { githubSource } from "../skills/orbit-report/sources/github.mjs";
import { fakeGitHub } from "./project-report/fake-github.mjs";
import { pythonOr, testPython } from "./project-report/python.mjs";
import { deps, frozen, rctxOf, tempBase } from "./project-report/rctx.mjs";
import { TZ, githubSnapshot } from "./project-report/snapshots.mjs";

const RUN = "20260925T030000Z-0001";
const pythonFor = (t) => (pythonOr(t) ? { file: testPython().path, version: testPython().version === "given" ? "3.12.0" : testPython().version } : null);

test("a render runs the standard kit over the snapshot, publishes one page, and records what ran -- asking no source", async (t) => {
  const python = pythonFor(t);
  if (!python) return;
  const base = tempBase(t);
  const rctx = rctxOf(base, python);
  frozen(rctx, githubSnapshot(), RUN);
  const out = await renderRun(rctx, RUN, deps());
  assert.equal(out.status, "ok", JSON.stringify(out.parts.filter((p) => p.status !== "ok")));
  assert.ok(out.report.startsWith(join(base, "reports", "project-reports")), out.report);
  const page = readFileSync(out.report, "utf8");
  assert.match(page, /Content-Security-Policy/);
  const record = readRun(rctx.room, rctx.io, RUN);
  const metrics = record.renders[0].parts.find((p) => p.id === "orbit.report.metrics");
  assert.equal(metrics.status, "ok");
  assert.match(metrics.sha256, /^[a-f0-9]{64}$/, "the kit file a part ran from is hashed into the record");
  assert.match(record.renders[0].kitDigest, /^[a-f0-9]{64}$/);
  assert.ok(record.renders[0].metrics.some((m) => m.id === "orbit.report.kpi.prs-merged" && m.version === "1"), "metric values and versions are kept for a later baseline");
  const again = await renderRun(rctx, RUN, deps());
  assert.equal(again.n, 2, "a second render is a new render of the same snapshot");
  assert.match(again.report, /-r2\.html$/);
  assert.ok(existsSync(out.report), "and the first page is still there");
});

test("without an interpreter a render is BLOCKED and says where to get one", async (t) => {
  const base = tempBase(t);
  const rctx = rctxOf(base, null);
  frozen(rctx, githubSnapshot(), RUN);
  await assert.rejects(renderRun(rctx, RUN, deps()), (e) => e instanceof Blocked && /Orbit Control → Tools → Python/.test(e.message) && /ORBIT_PYTHON/.test(e.message));
});

// An extension made the way a session makes one: files in a scratch directory,
// then the real lifecycle -- register (verify inside), then active.
async function extension(base, id, files) {
  const dir = join(base, "scratch", id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`);
  const ctx = { store: () => join(base, "store") };
  await registerTool(ctx, dir, realIo());
  setStatus(ctx, id, "active", realIo());
  return dir;
}

const manifest = (id) => ({ id, version: "0.1.0", apiVersion: "orbit.extension/v2", engine: ">=0.0.1 <1", status: "draft", createdFor: "PO asked for it", reporting: "./reporting.json" });
const metricPart = (id, name, entry) => ({ id: `${id}.${name}`, version: "0.1.0", kind: "metric", contract: "orbit.report.part/v1", runtime: "python", requires: ">=3.11", entry, doc: `${name} for a test`, provides: [`report.metric.${id}.${name}`], needs: ["report.collection.pullRequests"], metrics: [{ id: `${id}.${name}.value`, version: "1", label: `The ${name}`, unit: "count", definition: "a test metric" }], section: { id: `${id}.${name}`, title: `The ${name}` } });

test("a failing extension part is reported in its own section, and every standard part's output is byte-for-byte what it was without it", async (t) => {
  const python = pythonFor(t);
  if (!python) return;
  const base = tempBase(t);
  const plain = rctxOf(base, python);
  frozen(plain, githubSnapshot(), RUN);
  const before = await renderRun(plain, RUN, deps());
  await extension(base, "demo", { "extension.json": manifest("demo"), "reporting.json": { parts: [metricPart("demo", "boom", "./boom.py")] }, "boom.py": "def run(envelope, sdk):\n    raise RuntimeError('boom, on purpose')\n" });
  const withExt = rctxOf(base, python, { extensions: await reportExtensions(join(base, "store"), realIo()) });
  const after = await renderRun(withExt, RUN, deps());
  assert.equal(after.status, "degraded");
  const boom = after.parts.find((p) => p.id === "demo.boom");
  assert.equal(boom.status, "failed");
  assert.equal(boom.errorKind, "extension", "an extension's crash is the extension's, never a data gap");
  assert.match(boom.error, /RuntimeError: boom, on purpose/);
  const model = (n) => readFileSync(join(plain.room.render(RUN, n), "parts", "orbit.report.metrics", "model.json"), "utf8");
  assert.equal(model(after.n), model(before.n), "the standard model is untouched by an extension beside it");
  assert.match(readFileSync(after.report, "utf8"), /boom, on purpose/, "the failure is on the page, in that section");
});

test("a store extension's files are pinned: the run executes a hashed COPY, and a hand edit after registration keeps the part from running", async (t) => {
  const python = pythonFor(t);
  if (!python) return;
  const base = tempBase(t);
  const code = "def run(envelope, sdk):\n    prs = sdk.collection('pullRequests')\n    sdk.metric('demo.count.value', value=len(prs), basis={'samples': len(prs)})\n    return {}\n";
  await extension(base, "demo", { "extension.json": manifest("demo"), "reporting.json": { parts: [metricPart("demo", "count", "./count.py")] }, "count.py": code });
  const rctx = rctxOf(base, python, { extensions: await reportExtensions(join(base, "store"), realIo()) });
  frozen(rctx, githubSnapshot(), RUN);
  const first = await renderRun(rctx, RUN, deps());
  const ran = first.parts.find((p) => p.id === "demo.count");
  assert.equal(ran.status, "ok");
  assert.ok(existsSync(join(rctx.room.render(RUN, first.n), "stage", "demo", "count.py")), "the part ran from the run's own copy");
  assert.match(ran.sha256, /^[a-f0-9]{64}$/);
  writeFileSync(join(base, "store", "qc-tools", "demo", "count.py"), `${code}# edited by hand\n`);
  const second = await renderRun({ ...rctx, extensions: await reportExtensions(join(base, "store"), realIo()) }, RUN, deps());
  assert.ok(!second.parts.some((p) => p.id === "demo.count"), "the edited part did not run");
  assert.match(second.skipped.find((s) => s.id === "demo.count").why, /changed after it was registered/);
  assert.throws(() => setStatus({ store: () => join(base, "store") }, "demo", "active", realIo()), /files changed after it was registered \(count\.py\)/);
});

test("a baseline compares only with an earlier run of the same source, scope and window length", async (t) => {
  const python = pythonFor(t);
  if (!python) return;
  const base = tempBase(t);
  const rctx = rctxOf(base, python);
  const july = periodOf({}, { now: Date.parse("2026-08-25T03:00:00Z"), tz: TZ });
  const older = { ...githubSnapshot(), window: july, calendar: calendarBetween(july.from, july.to, TZ) };
  frozen(rctx, older, "20260825T030000Z-0001");
  await renderRun(rctx, "20260825T030000Z-0001", deps());
  frozen(rctx, githubSnapshot(), RUN);
  const now = await renderRun(rctx, RUN, deps());
  assert.equal(now.baseline, "20260825T030000Z-0001");
  const page = readFileSync(now.report, "utf8");
  assert.match(page, /"status":"compared"/);
  const other = { ...githubSnapshot(), source: { ...githubSnapshot().source, scope: { repositories: ["orbit-demo/portal-web"] } } };
  frozen(rctx, other, "20260925T040000Z-0002");
  const narrower = await renderRun(rctx, "20260925T040000Z-0002", deps());
  assert.equal(narrower.baseline, null, "a different scope is never compared");
  assert.match(readFileSync(narrower.report, "utf8"), /read a different source or scope/);
});

// ---- a whole RUN, against a GitHub in memory -------------------------------------


const PAT = "github_pat_11CANARYCANARYCANARYCANARY0123456789abcdefghijklmnopqrstuvwxyz";

function everyFile(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? everyFile(join(dir, n)) : [join(dir, n)]));
}

const spellings = (value) => [value, Buffer.from(value).toString("base64"), Buffer.from(`:${value}`).toString("base64"), encodeURIComponent(value)];

test("a run end to end: one collection, frozen with its raw pages, rendered -- and the credential in no file it left, in any spelling", async (t) => {
  const python = pythonFor(t);
  if (!python) return;
  const base = tempBase(t);
  const prs = Array.from({ length: 30 }, (_, i) => ({ number: 1 + i, state: "MERGED", createdAt: `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T02:00:00Z`, updatedAt: `2026-07-${String(2 + (i % 27)).padStart(2, "0")}T02:00:00Z`, mergedAt: `2026-07-${String(2 + (i % 27)).padStart(2, "0")}T02:00:00Z` }));
  const fake = fakeGitHub({ repos: { "acme/web": { prs, issues: [] } } });
  const rctx = rctxOf(base, python, { connection: { id: "github-acme", provider: "github", host: "https://api.github.com", organization: "acme", credential: "REPORT_GH_PAT" }, settings: { provider: "github", connection: "github-acme", timezone: TZ, scope: { repositories: ["acme/web"], actions: false, deployments: false } } });
  const out = await runReport(rctx, {}, deps({ sources: { github: githubSource({ sleep: async () => {} }) }, fetch: fake.fetch, secrets: secretSource({ env: { REPORT_GH_PAT: PAT } }) }));
  assert.equal(out.window.from, "2026-07-01");
  assert.equal(out.window.to, "2026-08-31", "the last two complete months");
  assert.ok(out.report && existsSync(out.report));
  const files = [...everyFile(join(base, "store")), out.report];
  assert.ok(files.some((f) => f.includes(`${join("snapshot", "raw")}`)), "the source's pages are kept beside the snapshot");
  for (const f of files) for (const s of spellings(PAT)) assert.ok(!readFileSync(f, "latin1").includes(s), `${f} holds the credential`);
  const asked = fake.calls.length;
  await renderRun(rctx, out.runId, deps({ fetch: () => { throw new Error("no source may be asked"); } }));
  assert.equal(fake.calls.length, asked, "rendering again asked nothing");
});

test("a collector that leaks the credential into its data freezes NOTHING", async (t) => {
  const base = tempBase(t);
  const leaky = { collect: async () => ({ source: { provider: "github", host: "https://api.github.com", organization: "acme", scope: {} }, completeness: { pullRequests: { status: "complete" } }, collections: { pullRequests: [{ id: "x", title: `oops ${PAT}` }] }, raw: [], earliest: null }) };
  const rctx = rctxOf(base, { file: "/unused", version: "3.12.0" }, { connection: { id: "github-acme", provider: "github", host: "https://api.github.com", organization: "acme", credential: "REPORT_GH_PAT" }, settings: { provider: "github", connection: "github-acme", timezone: TZ } });
  await assert.rejects(runReport(rctx, {}, deps({ sources: { github: leaky }, secrets: secretSource({ env: { REPORT_GH_PAT: PAT } }) })), (e) => e instanceof Blocked && /carried the credential/.test(e.message));
  const kept = existsSync(join(base, "store")) ? everyFile(join(base, "store")) : [];
  assert.ok(!kept.some((f) => f.endsWith("snapshot.json")), "no snapshot was written");
  for (const f of kept) assert.ok(!readFileSync(f, "latin1").includes(PAT), `${f} holds the credential`);
});
