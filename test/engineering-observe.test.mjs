import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MILESTONES, due } from "../src/engineering/observe/milestone.mjs";
import { observed } from "../src/engineering/observe/index.mjs";
import { boundary } from "../src/engineering/analyzers/boundary.mjs";
import { pattern, roleOf } from "../src/engineering/analyzers/pattern.mjs";
import { workflow } from "../src/engineering/analyzers/workflow.mjs";
import { ANALYZER_NAMES } from "../src/engineering/analyzers/index.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { ingest } from "../src/engineering/ingest.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-09-23T10:00:00Z");

const summary = (over = {}) => ({ observes: 0, lastObserve: null, ended: false, ...over, since: { changed: ["src/a.mjs"], scopes: ["src"], checked: false, committed: false, ...over.since } });

test("the milestone table, row by row — and it almost always says no", () => {
  const name = (s, o = { enabled: true, nowMs: NOW }) => due(s, o).name;
  assert.equal(name(summary({ since: { committed: true } }), { enabled: false }), "OFF");
  assert.equal(name(summary({ since: { changed: [], committed: true } })), "NOTHING_CHANGED");
  assert.equal(name(summary({ observes: 4, since: { committed: true } })), "BUDGET_SPENT");
  assert.equal(name(summary({ since: { committed: true }, lastObserve: "2026-09-23T09:59:00Z" })), "COMMITTED", "a commit is a boundary, debounced or not");
  assert.equal(name(summary({ ended: true })), "SESSION_END");
  assert.equal(name(summary({ lastObserve: "2026-09-23T09:59:00Z", since: { checked: true } })), "DEBOUNCED");
  assert.equal(name(summary({ since: { checked: true } })), "VERIFIED");
  assert.equal(name(summary({ since: { changed: Array.from({ length: 8 }, (_, i) => `f${i}`) } })), "BREADTH");
  assert.equal(name(summary()), "NOT_YET", "one edit is not a milestone");
  assert.equal(MILESTONES.at(-1).when(summary(), {}), true);
});

const FILES = ["src/Infrastructure/OrderRepository.cs", "src/Infrastructure/CustomerRepository.cs", "src/Infrastructure/InvoiceRepository.cs", "src/Domain/IRepository.cs", "src/Domain/repository.cs", "test/OrderRepositoryTests.cs", "src/Web/PaymentAdapter.cs", "src/Jobs/MailAdapter.cs", "README.md"];

test("a role is read off a name, never off a test of it or a bare role word", () => {
  assert.equal(roleOf("src/Infrastructure/OrderRepository.cs"), "repository");
  assert.equal(roleOf("test/OrderRepositoryTests.cs"), null);
  assert.equal(roleOf("src/Domain/repository.cs"), null, "the bare word is the abstraction's home, not a member");
  assert.equal(roleOf("README.md"), null);
});

test("pattern proposes families of two or more, observed and never stronger", () => {
  const { candidates } = pattern({ files: FILES, scopes: [] });
  assert.deepEqual(candidates.map((c) => c.key).sort(), ["adapter", "repository"]);
  for (const c of candidates) assert.equal(c.strength, "observed");
  assert.equal(candidates.find((c) => c.key === "repository").evidence.length, 4, "IRepository counts; the test and the bare word do not");
});

test("pattern speaks only about families the session touched", () => {
  assert.deepEqual(pattern({ files: FILES, scopes: ["src/Web"] }).candidates.map((c) => c.key), ["adapter"]);
});

test("boundary needs three members in ONE layer; a split family says nothing", () => {
  const files = ["src/Infrastructure/A Repository.cs", "src/Infrastructure/BRepository.cs", "src/Infrastructure/CRepository.cs", "src/Web/XAdapter.cs", "src/Jobs/YAdapter.cs", "src/Api/ZAdapter.cs"];
  const { candidates } = boundary({ files, scopes: [] });
  assert.deepEqual(candidates.map((c) => c.key), ["repository-layer"]);
  assert.deepEqual(candidates[0].scope, ["src/Infrastructure"]);
});

test("workflow needs both a passing check and a gate the project declares", () => {
  const commands = [{ class: "test", ok: true }, { class: "lint", ok: false }, { class: "other", ok: true }];
  assert.deepEqual(workflow({ commands, gates: new Set() }).candidates, []);
  assert.deepEqual(workflow({ commands, gates: new Set(["package.json"]) }).candidates.map((c) => c.key), ["check-with-test"]);
});

test("the analysers are a table, and none of them claims a kind architecture owns", () => {
  assert.deepEqual(ANALYZER_NAMES, ["pattern", "boundary", "workflow", "verified"], "verified (1.8.9) reads a finished task's declared checks, and claims a workflow, never a kind architecture owns");
});

// ── through reconciliation ─────────────────────────────────────────────────
function ctxOver(files) {
  const source = { files: () => files, commit: () => "abc1234", fingerprints: (scopes) => Object.fromEntries(scopes.map((s) => [s, { hash: `h-${s}`, files: 1, dirty: 0 }])) };
  return { eng: createEngineering("/store/acme", fakeIo()), source, now: () => "2026-09-23T10:00:00.000Z" };
}

const session = (host) => ({ host, at: "2026-09-23T01:00:00Z" });

test("the observer's candidates are reconciled: one session is possible, a rerun is not a second session", () => {
  const ctx = ctxOver(FILES);
  observed(ctx, { scopes: [] }, session("a"));
  observed(ctx, { scopes: [] }, session("a"));
  const repo = ctx.eng.all().find((f) => f.key === "repository");
  assert.equal(repo.confidence, "possible");
  assert.equal(repo.support.sessions, 1);
  observed(ctx, { scopes: [] }, session("b"));
  assert.equal(ctx.eng.all().find((f) => f.key === "repository").confidence, "certain");
});

test("the observer can never demote what a person adopted", () => {
  const ctx = ctxOver(FILES);
  const facts = observed(ctx, { scopes: [] }, session("a")).decisions.map((d) => d.fact);
  const repo = facts.find((f) => f.key === "repository");
  ingest(ctx, [{ kind: "pattern", key: "repository", statement: repo.statement, scope: repo.scope, evidence: repo.evidence, source: "repository", strength: "adopted" }], { seenBy: session("human"), human: true });
  observed(ctx, { scopes: [] }, session("b"));
  assert.equal(ctx.eng.all().find((f) => f.key === "repository").strength, "adopted");
});

// ── end to end: the hooks, in a real checkout ──────────────────────────────
function checkout() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-observe-"));
  const files = { ...Object.fromEntries(FILES.map((f) => [f, "//\n"])), "ui-tests/project.json": JSON.stringify({ name: "demo", origin: "https://demo.test" }), "ui-tests/graph/meta.json": JSON.stringify({ schema: 2 }), "ui-tests/graph/screens.json": "[]", "ui-tests/graph/edges.json": "[]", "ui-tests/graph/effects.json": "[]" };
  for (const [p, text] of Object.entries(files)) written(dir, p, text);
  for (const args of [["init", "-q", "."], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]]) spawnSync("git", args, { cwd: dir });
  return dir;
}

function written(dir, path, text) {
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

function session_(dir, env) {
  const store = mkdtempSync(join(tmpdir(), "orbit-obs-store-"));
  const tmp = mkdtempSync(join(tmpdir(), "orbit-obs-tmp-"));
  const hook = (input) => spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs")], { encoding: "utf8", input: JSON.stringify({ session_id: "sess-1", cwd: dir, ...input }), env: sealed({ ORBIT_UI_TESTS: join(dir, "ui-tests"), ORBIT_STORE_DIR: store, TMPDIR: tmp, TMP: tmp, TEMP: tmp, ...env }) });
  const facts = () => spawnSync(process.execPath, [join(ROOT, "cli", "engineering.mjs"), "facts"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: join(dir, "ui-tests"), ORBIT_STORE_DIR: store }) }).stdout;
  return { hook, facts };
}

const edit = (dir) => ({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(dir, "src/Infrastructure/OrderRepository.cs") } });
const commit = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git commit -am wip" } };

test("with the observer on, a commit after an edit is a milestone, and the fact arrives through reconciliation", () => {
  const dir = checkout();
  const s = session_(dir, { ORBIT_ENGINEERING_OBSERVE: "on" });
  assert.equal(s.hook(edit(dir)).status, 0);
  assert.match(s.facts(), /nothing has recorded/, "one edit is not a milestone");
  const r = s.hook(commit);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "", "the observer never speaks into the transcript");
  assert.match(s.facts(), /observed\s+fresh\s+possible\s+pattern\s+repository is a pattern/);
});

test("with nothing set -- the default since 1.8.9 -- the same session learns, bounded by the same milestone", () => {
  const dir = checkout();
  const s = session_(dir, {});
  s.hook(edit(dir));
  assert.match(s.facts(), /nothing has recorded/, "one edit is still not a milestone");
  s.hook(commit);
  assert.match(s.facts(), /observed\s+fresh\s+possible\s+pattern\s+repository is a pattern/, "and one session is only ever possible");
});

test("ORBIT_ENGINEERING_OBSERVE=off turns the observer off, and the same session learns nothing", () => {
  const dir = checkout();
  const s = session_(dir, { ORBIT_ENGINEERING_OBSERVE: "off" });
  s.hook(edit(dir));
  s.hook(commit);
  assert.match(s.facts(), /nothing has recorded/);
});

test("the plugin-settings toggle turns the observer off, and an exported ORBIT_ variable still overrides it", () => {
  const off = checkout();
  const viaToggle = session_(off, { CLAUDE_PLUGIN_OPTION_ENGINEERING_OBSERVE: "false" });
  viaToggle.hook(edit(off));
  viaToggle.hook(commit);
  assert.match(viaToggle.facts(), /nothing has recorded/);
  const on = checkout();
  const overridden = session_(on, { CLAUDE_PLUGIN_OPTION_ENGINEERING_OBSERVE: "false", ORBIT_ENGINEERING_OBSERVE: "on" });
  overridden.hook(edit(on));
  overridden.hook(commit);
  assert.match(overridden.facts(), /repository is a pattern/);
});

test("`engineering observe --all` runs it by hand, whatever the milestones say", () => {
  const dir = checkout();
  const store = mkdtempSync(join(tmpdir(), "orbit-obs-cli-"));
  const run = (args) => spawnSync(process.execPath, [join(ROOT, "cli", "engineering.mjs"), ...args], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: join(dir, "ui-tests"), ORBIT_STORE_DIR: store }) });
  const dry = run(["observe", "--all", "--dry"]);
  assert.match(dry.stdout, /would propose\s+pattern\s+repository/);
  assert.match(run(["facts"]).stdout, /nothing has recorded/, "--dry wrote nothing");
  const r = run(["observe", "--all"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new\s+possible\s+eng-pattern-/);
});
