// Advice from evidence (0.6.0, P2): after a FAILED tool call, at most one line naming a fact about the session's work,
// its subject, the component the real resolver chooses for it here and the call that brings it in -- and silence on
// every row of SILENCE, each held alone. Nothing is ever said on a call that succeeded, and what was said is kept on
// the trail (`advice.given`), so it is said once a session and at most once a prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as antigravity from "../skills/orbit-learn/hosts/antigravity.mjs";
import * as claude from "../skills/orbit-learn/hosts/claude.mjs";
import * as codex from "../skills/orbit-learn/hosts/codex.mjs";
import * as grok from "../skills/orbit-learn/hosts/grok.mjs";
import { resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { observedIn } from "../cli/session-facts.mjs";
import { MAX_PER_PROMPT, QUIET, SILENCE_ROWS, adviceLine, adviceRowOf } from "../src/lifecycle/advice.mjs";
import { learning } from "../src/lifecycle/subscribers/learning.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { reactingTo } from "../src/routing/resolve.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const registry = (env = {}) => getEffectiveResources({ env, plugin: "orbit", components: () => pluginComponents(REPO, io), builtins: () => pluginBuiltins(REPO, io), capabilities: () => [], mcp: () => [], tools: () => [] }, PROVIDERS);
const REGISTRY = registry();

const SESSION = "claude:0123456789abcdef";
const edit = { ev: "post-tool", tool: "edit", paths: ["src/orders.mjs"], tokens: [] };
const failed = { ev: "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: "test", exe: "npm", ok: false } };
const passed = { ev: "post-tool", tool: "command", paths: [], tokens: [], cmd: { class: "test", exe: "npm", ok: true } };
const prompt = (marks = []) => ({ type: "prompt.submitted", session: SESSION, at: "2026-11-12T10:00:00.000Z", data: { marks } });
const given = (fact, subject) => ({ type: "advice.given", session: SESSION, at: "2026-11-12T10:01:00.000Z", data: { fact, subject, provider: "orbit-develop", kind: "skill" } });

const EVENT = { event: "post-tool-failure", session: SESSION, command: "npm test" };

// A world as cli/learn-hook.mjs binds it, with each port replaceable: the facts from working-set lines, the trail, the
// governed work, the REAL resolver over the shipped catalog, and the one write.
function world(over = {}) {
  const kept = [];
  const port = { observed: () => observedIn(over.lines ?? [edit, failed]), session: () => ("trail" in over ? over.trail : [prompt()]), owner: () => over.owner ?? null, resolve: (o) => reactingTo(o, over.registry ?? REGISTRY), said: (data) => kept.push(data) };
  return { kept, host: over.host ?? claude, input: {}, plugin: "orbit", engine: "/plug", advice: () => ("port" in over ? over.port : port) };
}

test("a check that failed after the session's edits gets ONE line: the fact, its subject, the component the resolver chose and the call", () => {
  const w = world();
  const line = adviceLine(EVENT, w);
  assert.match(line, /^Orbit noticed check\.failed -- test \(npm\): .*\. orbit-develop handles it: Skill orbit:orbit-develop\.$/);
  assert.ok(Buffer.byteLength(line) <= 420);
  assert.deepEqual(w.kept, [{ fact: "check.failed", subject: "test (npm)", provider: "orbit-develop", kind: "skill" }], "and advice.given keeps the fact, the subject and the provider -- never the sentence");
  assert.equal(adviceRowOf(EVENT, world()).row, "speak");
});

test("the same check failing three times in a row with nothing changed is said as no progress, not as a retry", () => {
  const line = adviceLine(EVENT, world({ lines: [failed, failed, failed] }));
  assert.match(line, /^Orbit noticed check\.repeats -- test \(npm\): the same check failed 3 or more times in a row with nothing changed between: diagnose why before running it again/);
  assert.doesNotMatch(line, /\b(retry|run it again now)\b/i);
});

// Each row of SILENCE, alone: a world where only that row's condition is false-to-speak.
const SILENT = {
  "host-cannot-speak": { host: antigravity },
  unbound: { port: null },
  "trail-off": { trail: null },
  halted: { trail: [prompt(["halt"])] },
  "nothing-observed": { lines: [edit, failed, passed] },
  "said-already": { trail: [given("check.failed", "test (npm)"), prompt()] },
  "cap-spent": { lines: [edit, failed, failed, failed], trail: [prompt(), given("check.failed", "test (npm)")] },
  "work-quiet": { owner: { kind: "workflow", id: "tsk-1", state: "paused" } },
  unresolved: { registry: registry({ CLAUDE_PLUGIN_OPTION_SKILL_DEVELOPER: "false" }) },
};

test("every row of the silence table keeps quiet on its own, and the table ends in the one row that speaks", () => {
  assert.deepEqual(Object.keys(SILENT), SILENCE_ROWS.slice(0, -1), "one world per silent row, in order");
  assert.equal(SILENCE_ROWS.at(-1), "speak");
  for (const [row, over] of Object.entries(SILENT)) {
    const w = world(over);
    assert.equal(adviceRowOf(EVENT, world(over)).row, row, row);
    assert.equal(adviceLine(EVENT, w), null, `${row} says nothing`);
    assert.deepEqual(w.kept, [], `${row} keeps nothing`);
  }
});

test("a component a person switched off is never named: the resolver chooses nobody for the fact, and nothing is said", () => {
  const off = registry({ CLAUDE_PLUGIN_OPTION_SKILL_DEVELOPER: "false" });
  assert.equal(reactingTo({ fact: "check.failed", subject: "x" }, off), null);
  assert.deepEqual(reactingTo({ fact: "check.failed", subject: "x" }, REGISTRY), { kind: "skill", id: "orbit-develop", key: "orbit-develop", ownership: "plugin", requirement: "development.implementation", approval: false });
});

test("governed work a person paused, cancelled, keeps waiting or is blocked keeps advice quiet; running or ended work does not", () => {
  for (const state of QUIET) assert.equal(adviceLine(EVENT, world({ owner: { kind: "task", id: "tsk-1", state } })), null, state);
  for (const state of ["running", "ended"]) assert.ok(adviceLine(EVENT, world({ owner: { kind: "task", id: "tsk-1", state } })), state);
});

test("said once per session for one fact and subject, and at most once a prompt; a new fact later in the session is said", () => {
  assert.equal(MAX_PER_PROMPT, 1);
  assert.equal(adviceLine(EVENT, world({ trail: [given("check.failed", "test (npm)"), prompt()] })), null);
  assert.ok(adviceLine(EVENT, world({ trail: [given("check.failed", "lint (eslint)"), prompt()] })), "another subject is another fact");
  const later = adviceLine(EVENT, world({ lines: [edit, failed, failed, failed], trail: [given("check.failed", "test (npm)"), prompt()] }));
  assert.match(later, /^Orbit noticed check\.repeats/, "the same check failing again and again is new evidence");
});

test("a simple single-file change whose check passed gets nothing, and a successful call is never the advice path", () => {
  assert.equal(adviceLine(EVENT, world({ lines: [edit, passed] })), null);
  assert.equal(adviceLine(EVENT, world({ lines: [edit] })), null, "an edit nobody checked is P3's to hold at Stop, not this line's");
  assert.equal(learning.on.includes("post-tool-failure"), true);
  const ok = learning.run({ event: "post-tool" }, { host: { ...claude, isWatched: () => false }, input: {}, advice: () => { throw new Error("never asked"); } });
  assert.equal(ok, null);
});

test("joined into the one failure payload: after the diagnosis and the owner's row, never instead of them; a port that throws costs only the line", () => {
  const w = { ...world(), host: { ...claude, isWatched: () => false }, recovery: () => null };
  const payload = learning.run({ ...EVENT }, w);
  assert.match(payload.hookSpecificOutput.additionalContext, /^Orbit noticed check\.failed/);
  const broken = { ...w, advice: () => ({ observed: () => { throw new Error("x"); } }) };
  assert.equal(learning.run({ ...EVENT }, broken), null);
  const watched = learning.run({ ...EVENT }, { ...w, host: { ...claude, isWatched: () => true }, advice: () => ({ observed: () => { throw new Error("x"); } }) });
  assert.match(watched.hookSpecificOutput.additionalContext, /^A orbit command exited non-zero/, "the diagnosis survives a broken advice port");
});

test("hosts whose failure answer carries text speak; a host whose answer drops it stays silent", () => {
  for (const host of [claude, codex, grok]) assert.ok(adviceLine(EVENT, world({ host })), "a host that carries a line after a failure");
  for (const host of [antigravity, resolveHost({}, ["--host=nobody"])]) assert.equal(adviceLine(EVENT, world({ host })), null);
});

// Through the REAL hooks, as Claude Code runs them, in a seated checkout with the trail on: an edit, then `npm test`
// failing (PostToolUseFailure, as the host fires it for a Bash command that exits non-zero), gets the line once and
// keeps `advice.given`; the same failure again says nothing new; and the next prompt's decision names the component
// on that fact. Nothing of the command's output is read: the failed call is the fact.
test("through the real hooks: one line after the failed check, kept on the trail, said once -- and the next prompt is shaped by it", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-advice-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_LIVE: "off", ORBIT_ENGINEERING_OBSERVE: "off" });
  const run = (file, input, args = []) => spawnSync(process.execPath, [join(REPO, "cli", file), ...args], { cwd: repo, env, input: input && JSON.stringify({ session_id: "raw-advice", cwd: repo, ...input }), encoding: "utf8", timeout: 60000 });
  assert.equal(run("init.mjs", null, [repo]).status, 0);
  const contextOf = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null);
  run("router-hook.mjs", { hook_event_name: "UserPromptSubmit", prompt: "make the totals round half up" });
  run("learn-hook.mjs", { hook_event_name: "PostToolUse", tool_name: "Edit", tool_use_id: "toolu_e", tool_input: { file_path: join(repo, "src", "totals.mjs") }, tool_response: {} });
  const failure = { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, error: "Exit code 1\nSECRET-SENTINEL output" };
  const said = contextOf(run("learn-hook.mjs", { ...failure, tool_use_id: "toolu_f1" }));
  assert.match(said, /^Orbit noticed check\.failed -- test \(npm\): .* orbit-develop handles it: Skill orbit:orbit-develop\.$/);
  assert.doesNotMatch(said, /SECRET-SENTINEL/);
  const trail = () => readdirSync(join(dir, "store", "control", "activity", "trace")).filter((n) => n.endsWith(".jsonl")).flatMap((n) => readFileSync(join(dir, "store", "control", "activity", "trace", n), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  assert.deepEqual(trail().filter((e) => e.type === "advice.given").map((e) => e.data), [{ fact: "check.failed", subject: "test (npm)", provider: "orbit-develop", kind: "skill" }]);
  assert.doesNotMatch(JSON.stringify(trail()), /SECRET-SENTINEL/);
  assert.equal(run("learn-hook.mjs", { ...failure, tool_use_id: "toolu_f2" }).stdout, "", "said once: the same fact about the same check says nothing again");
  const next = contextOf(run("router-hook.mjs", { hook_event_name: "UserPromptSubmit", prompt: "ok, what now?" }));
  assert.match(next, /orbit-develop/, "the next prompt's decision is shaped by the fact found after the last one");
  assert.match(next, /after check\.failed/);
  const chain = spawnSync(process.execPath, [join(REPO, "cli", "trace.mjs"), "activation"], { cwd: repo, env, encoding: "utf8" });
  assert.match(chain.stdout, /suggested orbit-develop \(advice: check\.failed → orbit-develop\)/, "trace.mjs activation follows the advice as a suggestion");
});
