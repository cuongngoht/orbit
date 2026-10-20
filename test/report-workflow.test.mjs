import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { sealed } from "./home.mjs";
import { test } from "node:test";
import { caseInPage } from "../src/case-block.mjs";
import { createDrafts } from "../src/draft/index.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { createMemory } from "../src/memory/index.mjs";
import { ACTIVE, reserveEvidence } from "../src/memory/reserve.mjs";
import { EXPORT_VERSION, meta } from "../src/report/export.mjs";
import { reportFile, reportHtml, reportReady, writeReport } from "../src/report/index.mjs";
import { journey } from "../src/report/journey.mjs";
import { model } from "../src/report/model.mjs";
import { pruneReports, publishRun } from "../src/report/publish.mjs";
import { readRun } from "../src/report/read.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { realIo } from "../src/store/io.mjs";
import { fakeContext, UI_TESTS } from "./fakes/context.mjs";
import { fakeBrowser, happy, savePost } from "./fakes/browser.mjs";
import { fakeFrontend } from "./fakes/frontend.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeMemory } from "./fakes/memory.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "orbit-report-workflow-"));
const source = JSON.parse(readFileSync(join(UI_TESTS, "screens/home/cases/create-thing.json"), "utf8"));
const go = (out = join(temp(), "run"), ctx = fakeContext()) => runCase(ctx, ["create-thing", "NAME=TC-1", `--out=${join(ctx.store(), "evidence", out.split(/[\\/]/).at(-1))}`, "--json"]);

test("replay survives removal of the original case and evidence, using a fresh parameter", () => {
  const dir = temp();
  const project = join(dir, "ui-tests");
  cpSync(UI_TESTS, project, { recursive: true });
  const ctx = fakeContext();
  ctx.project = { ...ctx.project, screensDir: join(project, "screens") };
  const first = go(join(dir, "first"), ctx);
  const file = writeReport(first.run.out, join(dir, "reports"));
  writeFileSync(join(project, "screens/home/cases/create-thing.json"), JSON.stringify({ ...source, name: "Changed afterwards" }));
  assert.equal(caseInPage(readFileSync(file, "utf8"), file).name, source.name);
  rmSync(join(project, "screens"), { recursive: true });
  rmSync(first.run.out, { recursive: true });
  const replay = fakeContext({ browser: fakeBrowser({ answers: happy().map(([k, v]) => [k instanceof RegExp ? new RegExp(k.source.replace('TC-1', 'TC-2')) : k, v]), requests: savePost() }) });
  replay.project = ctx.project;
  const next = runCase(replay, [file, "NAME=TC-2", `--out=${join(replay.store(), "evidence", "second")}`, "--json"]);
  assert.equal(next.status, "PASS");
  assert.deepEqual(next.run.proved, first.run.proved);
  assert.equal(next.run.given.NAME, "TC-2");
  assert.equal(next.c.steps[3].value, "${NAME}");
  assert.ok(existsSync(file));
});

test("replay still applies required params, identity, stale and destructive gates", () => {
  const dir = temp();
  const report = join(dir, "case.html");
  writeFileSync(report, reportHtml([{ kind: "run", case: source.id, source }]));
  const invoke = (ctx, params = []) => runCase(ctx, [report, ...params, `--out=${join(ctx.store(), "evidence", "run")}`, "--json"]);
  assert.throws(() => invoke(fakeContext()), /missing param/);
  assert.throws(() => invoke(fakeContext({ claims: { roles: [] } }), ["NAME=TC-1"]), /missing role/);
  assert.throws(() => invoke(fakeContext({ frontend: fakeFrontend({ commit: "changed" }) }), ["NAME=TC-1"]), /stale:/);
  writeFileSync(report, reportHtml([{ kind: "run", case: source.id, source: { ...source, destructive: true } }]));
  assert.throws(() => invoke(fakeContext(), ["NAME=TC-1"]), /DESTRUCTIVE/);
});

test("non-object case blocks cannot become a runnable object through spread", () => {
  for (const value of [null, [], "text", 42, true]) {
    const c = caseInPage(`<pre id="orbit-case">${JSON.stringify(value)}</pre>`, "bad.html");
    assert.match(c._broken, /not a JSON object/);
  }
});

test("journey distinguishes execution, verdicts, stopping, unrecorded steps and slices", () => {
  const plan = { steps: [{ do: "goto", screen: "home", why: "Open the page" }, { do: "assert", js: "true" }, { do: "assert", js: "false" }, { do: "assert", js: "true" }] };
  for (const status of ["FAIL", "BLOCKED", "REFUSED"]) {
    const m = model([{ kind: "run", source: plan }, { kind: "step", i: 1, do: "goto", ok: true }, { kind: "step", i: 2, do: "assert", ok: true }, { kind: "step", i: 3, do: "assert", ok: false }, { kind: "result", status }]);
    const rows = journey(m, []);
    assert.deepEqual(rows.map((r) => r.state), ["Executed", "Verification held", `Stopped: ${status}`, "No execution recorded"]);
    assert.equal(rows[3].tone, "flat");
  }
  const sliced = journey(model([{ kind: "run", source: plan }, { kind: "step", i: 2, do: "assert", ok: true }, { kind: "result", status: "PARTIAL", slice: { whole: false, from: 2, to: 3 } }]), []);
  assert.deepEqual(sliced.map((r) => r.state), ["Outside slice", "Verification held", "No execution recorded", "Outside slice"]);
  const skipped = journey(model([{ kind: "run", source: plan }, { kind: "result", status: "SKIP" }]), []);
  assert.ok(skipped.every((r) => r.state === "No execution recorded"));
});

test("full SQL rows, observation values and failure diagnostics survive rendering", () => {
  const long = "observed ".repeat(300) + "LAST_OBSERVATION";
  const html = reportHtml([
    { kind: "run", case: "data" },
    { kind: "step", i: 1, do: "sql", query: "SELECT n FROM Things", ok: true, rows: Array.from({ length: 65 }, (_, n) => ({ n: `ROW_${n}`, ...(n === 64 ? { extra: "LAST_COLUMN" } : {}) })) },
    { kind: "step", i: 2, do: "report", result: long, ok: true },
    { kind: "step", i: 3, do: "assert", ok: false, error: long, console: long },
    { kind: "result", status: "FAIL", done: 2 },
  ]);
  assert.match(html, /ROW_64/);
  assert.match(html, /LAST_COLUMN/);
  assert.match(html, /LAST_OBSERVATION/);
  assert.doesNotMatch(html, /more row\(s\) in/);
});

test("one screenshot appears once even when several sections refer to it", () => {
  const dir = temp();
  const shot = join(dir, "screen.png");
  writeFileSync(shot, Buffer.from("image fixture"));
  const html = reportHtml([{ kind: "run", case: "x" }, { kind: "step", i: 1, do: "assert", ok: false, screenshot: shot }, { kind: "step", i: 2, do: "screenshot", ok: true, screenshot: shot }, { kind: "result", status: "FAIL" }]);
  assert.equal((html.match(/src="data:image\/png;base64,/g) ?? []).length, 1);
  assert.ok((html.match(/href="#shot-1"/g) ?? []).length > 1);
  assert.doesNotMatch(html, new RegExp(shot));
});

test("retention requires complete metadata matching the run and a finished publication", () => {
  const dir = temp();
  const first = go(join(dir, "run"));
  const reports = join(dir, "reports");
  const file = writeReport(first.run.out, reports);
  const html = readFileSync(file, "utf8");
  assert.equal(meta(html, "export-version"), EXPORT_VERSION);
  assert.equal(reportReady(reports, first.run.out), true);
  writeFileSync(file, html.replace(/<meta name="orbit-export-version"[^>]+>/, ""));
  assert.equal(reportReady(reports, first.run.out), false, "old exports retain evidence");
  writeFileSync(file, html.slice(0, html.indexOf("<!-- orbit-report-end -->")));
  assert.equal(reportReady(reports, first.run.out), false, "partial writes are not exports");
  writeFileSync(file, html);
  const records = readRun(first.run.out);
  writeFileSync(join(first.run.out, "run-log.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + '\n{"kind":');
  assert.equal(reportReady(reports, first.run.out), false, "a damaged input log cannot qualify");
});

test("missing pictures and missing completion records cannot authorize pruning", () => {
  const dir = temp();
  const first = go(join(dir, "run"));
  const records = readRun(first.run.out);
  rmSync(records.find((r) => r.screenshot).screenshot);
  const file = writeReport(first.run.out, join(dir, "reports"));
  assert.equal(meta(readFileSync(file, "utf8"), "complete"), "false");
  assert.equal(reportReady(join(dir, "reports"), first.run.out), false);
  assert.equal(meta(reportHtml(records.filter((r) => r.kind !== "result")), "complete"), "false");
});

test("report publication cannot overwrite another run or leave a partial replacement", () => {
  const dir = temp();
  const first = go(join(dir, "a", "same-name"));
  const second = go(join(dir, "b", "same-name"));
  const reports = join(dir, "reports");
  const file = writeReport(first.run.out, reports);
  const original = readFileSync(file, "utf8");
  assert.throws(() => writeReport(second.run.out, reports), Refused);
  assert.equal(readFileSync(file, "utf8"), original);
  const io = fakeIo({ renameFails: 20 });
  io.files.set(file, original);
  assert.throws(() => writeReport(first.run.out, reports, io), Blocked);
  assert.equal(io.files.get(file), original);
  assert.ok(![...io.files.keys()].some((f) => f.includes(".tmp-")));
});

test("post-run report errors preserve the verdict and skip pruning", () => {
  const ctx = fakeContext();
  const outcome = go(join(temp(), "run"), ctx);
  const file = publishRun(ctx, outcome, () => { throw new Error("disk full"); });
  assert.equal(file, null);
  assert.equal(outcome.status, "PASS");
  assert.deepEqual(ctx.memory.pruned, []);
  assert.match(ctx.warnings.at(-1), /disk full.*evidence retained/);
});

test("pruning protects active runs even when a caller supplies rendered membership", () => {
  const dir = temp();
  const memory = createMemory(() => dir);
  const names = ["x-2026-01-01-00-00-00", "x-2026-01-02-00-00-00"];
  const release = reserveEvidence(join(memory.evidenceDir(), names[0]));
  mkdirSync(join(memory.evidenceDir(), names[1]));
  assert.deepEqual(memory.prune({ n: 1, rendered: new Set(names) }), []);
  assert.ok(existsSync(join(memory.evidenceDir(), names[0], ACTIVE)));
  release();
  assert.deepEqual(memory.prune({ n: 1, rendered: new Set(names) }), [names[0]]);
});

test("another process cannot acquire a reserved evidence directory", () => {
  const dir = join(temp(), "run");
  const release = reserveEvidence(dir);
  const script = `import { reserveEvidence } from ${JSON.stringify(new URL("../src/memory/reserve.mjs", import.meta.url).href)}; try { reserveEvidence(process.argv[1], true); } catch(e) { console.log(e.constructor.name); process.exit(3); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, dir], { encoding: "utf8" });
  assert.equal(child.status, 3);
  assert.match(child.stdout, /Blocked/);
  assert.ok(existsSync(join(dir, ACTIVE)), "the competing process did not remove the owner's marker");
  release();
  assert.throws(() => reserveEvidence(dir), Blocked, "automatic names never reuse even an empty directory");
});

test("occupied --out refuses before a browser call and empty --out remains usable", () => {
  const dir = temp();
  const ctx = fakeContext({ store: () => dir });
  const occupied = join(dir, "evidence", dir.split(/[\\/]/).at(-1));
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "old.txt"), "keep me");
  assert.throws(() => go(dir, ctx), Refused);
  assert.deepEqual(ctx.browser.calls, []);
  assert.equal(readFileSync(join(occupied, "old.txt"), "utf8"), "keep me");
  assert.equal(go(temp()).status, "PASS");
});

test("a successful draft stays in memory and its report is replayable without promotion", () => {
  const dir = temp();
  const ctx = fakeContext({ store: () => dir });
  const drafts = createDrafts(dir, realIo());
  const c = { ...source, id: "memory-only-case" };
  drafts.save(c);
  const outcome = runCase(ctx, [c.id, "--draft", "NAME=TC-1", `--out=${join(dir, "evidence", "run")}`, "--json"]);
  const report = writeReport(outcome.run.out, join(temp(), "reports"));
  assert.equal(outcome.status, "PASS");
  assert.ok(drafts.find(c.id));
  assert.ok(!existsSync(join(UI_TESTS, "cases", `${c.id}.json`)));
  assert.equal(caseInPage(readFileSync(report, "utf8"), report).id, c.id);
});

test("pruning receives only runs whose complete report matches their evidence", () => {
  const dir = temp();
  const first = go(join(dir, "first"));
  const second = go(join(dir, "second"));
  const reports = join(dir, "reports");
  writeReport(first.run.out, reports);
  mkdirSync(join(reports, "home", "create-thing"), { recursive: true });
  writeFileSync(reportFile(reports, { case: "create-thing", start: "home", evidence: second.run.out }), "old HTML without export metadata");
  const memory = fakeMemory({ runs: [{ status: "PASS", evidence: first.run.out }, { status: "PASS", evidence: second.run.out }] });
  pruneReports({ config: { reports, retention: 1 }, memory });
  assert.deepEqual([...memory.pruned[0].rendered], ["first"]);
});

test("the real CLI preserves a finished verdict and emits one JSON when report delivery fails", () => {
  const dir = temp();
  const cli = new URL('../cli/run-case.mjs', import.meta.url).href;
  const factory = new URL('./fakes/context.mjs', import.meta.url).href;
  const wrapper = join(dir, 'context.mjs');
  const loader = join(dir, 'loader.mjs');
  const blockedPath = join(dir, 'reports-file');
  writeFileSync(blockedPath, 'not a directory');
  const wrapperUrl = new URL('context.mjs', pathToFileURL(loader)).href;
  writeFileSync(loader, `export function resolve(s,c,next) { if(c.parentURL === ${JSON.stringify(cli)} && s.endsWith('/run/context.mjs')) return {url:${JSON.stringify(wrapperUrl)},shortCircuit:true}; return next(s,c); }`);
  for (const [status, code, db] of [['PASS', 0, 'null'], ['BLOCKED', 3, '{ query: () => ({ok:false, error:"offline"}) }']]) {
    writeFileSync(wrapper, `import { fakeContext } from ${JSON.stringify(factory)}; export function createContext() { const c=fakeContext({db:${db},store:()=>${JSON.stringify(dir)}}); c.config={...c.config,reports:${JSON.stringify(blockedPath)}}; c.warn=(message)=>console.error(message); return c; }`);
    const r = spawnSync(process.execPath, ['--experimental-loader', pathToFileURL(loader).href, fileURLToPath(cli), 'create-thing', 'NAME=TC-1', '--json', '--report', `--out=${join(dir, 'evidence', status)}`], { encoding: 'utf8', env: sealed() });
    assert.equal(r.status, code, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, status);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stderr, /report not written:/);
    assert.ok(existsSync(join(dir, 'evidence', status, 'run-log.jsonl')));
  }
});
