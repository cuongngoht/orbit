// No line a host sees carries a placeholder (0.6.0, Q3). A module names a command as `node <engine>/cli/x.mjs`; a CLI and
// a hook know where the plugin is, and read that placeholder as its path where each writes what a host reads
// (src/engined.mjs). Held from the declarations, never a list of lines: every hook hooks/hooks.json registers, fed every
// recorded host payload of its event (test/fixtures/hooks/claude/) inside a seated checkout with open governed work, and
// the CLIs a host runs for a workflow, a task, a goal, triage, doctor and improve -- their usage, their words and their
// `--json` -- say the plugin's own path, and never `<engine>` or `<plugin>`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACEHOLDERS, engined, enginedDeep, rootWord } from "../src/engined.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { UI_TESTS } from "./fakes/context.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test", "fixtures", "hooks", "claude");
const RAW = "session-raw-placeholder";
const SAID_ROOT = `node ${rootWord(ROOT)}/`;

const placeholderIn = (text) => PLACEHOLDERS.find((p) => String(text).includes(p)) ?? null;

function checkout(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-placeholder-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const p = { dir, repo, store: join(dir, "store") };
  assert.equal(run(p, ["cli/init.mjs", repo]).status, 0);
  return p;
}

const run = (p, argv, env = {}, input = undefined) => spawnSync(process.execPath, [join(ROOT, argv[0]), ...argv.slice(1)], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store, ORBIT_TRACE: "off", ORBIT_LIVE: "off", ORBIT_SESSION: hostSession("claude", RAW), ...env }), input, encoding: "utf8", timeout: 60000 });

// The hooks Claude Code runs, read off the plugin's own registration: [event, matcher, argv].
const HOOKS = Object.entries(JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks).flatMap(([event, rows]) => rows.flatMap((row) => row.hooks.map((h) => [event, row.matcher ?? "", argvOf(h.command)])));

function argvOf(command) {
  const words = command.replaceAll("${CLAUDE_PLUGIN_ROOT}/", "").split(" ").map((w) => w.replaceAll('"', ""));
  return words.slice(1);
}

const matches = (matcher, input) => !matcher || matcher === "*" || new RegExp(`^(${matcher})$`).test(input.tool_name ?? "");

const fixtures = () => readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(FIXTURES, f), "utf8")).input]);

// What each recorded payload is, inside this checkout and this session -- and, beside them, the ones that make a hook
// SAY a command: a prompt a workflow would take, and an Orbit command of this workflow that failed.
const payloadsOf = (p, task) => [...fixtures(), ["prompt", { hook_event_name: "UserPromptSubmit", prompt: "implement the refund approval rule and verify it" }], ["failed", { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "toolu_f", tool_input: { command: `node ${join(ROOT, "cli", "automation.mjs")} step ${task} --json` }, error: "Exit code 2" }], ["agent", { hook_event_name: "PostToolUse", tool_name: "Agent", tool_use_id: "toolu_a", tool_input: { subagent_type: "orbit:orbit-qa-agent" }, tool_response: { agentId: "a-1" } }], ["resumed", { hook_event_name: "SessionStart", source: "resume" }]].map(([name, input]) => [name, { ...input, session_id: RAW, cwd: p.repo }]);

function workflow(p) {
  const started = run(p, ["cli/automation.mjs", "start", "--for=implement the refund approval rule and verify it", "--json"]);
  assert.equal(started.status, 0, started.stderr);
  return JSON.parse(started.stdout).task;
}

test("the one leaf reads both placeholders, in a line and in every string of a value, with one separator", () => {
  assert.equal(engined("node <engine>/cli/a.mjs · node <plugin>/cli/b.mjs", "C:\\Users\\x\\orbit"), "node C:/Users/x/orbit/cli/a.mjs · node C:/Users/x/orbit/cli/b.mjs");
  assert.equal(engined("node <engine>/cli/a.mjs", null), "node <engine>/cli/a.mjs", "with no root, a module's own line is left as it was");
  const deep = enginedDeep({ a: ["node <engine>/cli/a.mjs"], b: { c: "<plugin>" }, n: 3, z: null }, "C:\\x");
  assert.deepEqual(deep, { a: ["node C:/x/cli/a.mjs"], b: { c: "C:/x" }, n: 3, z: null });
  assert.doesNotThrow(() => JSON.parse(engined(JSON.stringify({ a: "node <engine>/cli/a.mjs" }), "C:\\x")), "a line that is JSON stays JSON");
});

test("every hook Claude Code runs, fed every recorded payload of its event, says the plugin's own path and never a placeholder", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  const said = [];
  for (const [name, input] of payloadsOf(p, task)) {
    for (const [, matcher, argv] of HOOKS.filter(([event, matcher]) => event === input.hook_event_name && matches(matcher, input))) {
      const r = run(p, argv, {}, JSON.stringify(input));
      assert.equal(placeholderIn(r.stdout + r.stderr), null, `${argv.join(" ")} on ${name}: ${r.stdout}${r.stderr}`);
      said.push(r.stdout);
    }
  }
  assert.ok(said.filter((s) => s.includes(SAID_ROOT)).length >= 4, "the hooks did name Orbit commands -- so the test held lines that carry a path, not silence");
});

// The CLIs a host runs for a workflow, a task, a goal, triage, doctor and improve: their usage, then what they answer.
const usages = ["cli/automation.mjs", "cli/autonomous-engineering.mjs", "cli/task.mjs", "cli/orbit.mjs", "cli/query.mjs", "cli/improve.mjs", "cli/help.mjs"];

function triageDir() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-placeholder-triage-"));
  const records = [{ kind: "run", case: "create-thing", file: "cases/create-thing.json", fe_commit: "abc1234" }, { kind: "step", i: 3, do: "click", on: "home/Add", screen: "home", wait: "document.querySelector('[role=dialog]')", ok: false, error: "wait never held after 25 tries / 13s", url: "/home", networkCalls: 4, networkFailures: [] }, { kind: "result", status: "FAIL", done: 2, of: 8, steps: 8, slice: { from: 1, to: 8, whole: true }, verdicts: 0, proved: { ui: 0, api: 0, sql: 0 }, ms: 12000 }];
  writeFileSync(join(dir, "run-log.jsonl"), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return dir;
}

test("the CLIs a host runs for a workflow, a task, a goal, triage, doctor and improve say the plugin's own path, never a placeholder", (t) => {
  const p = checkout(t);
  const task = workflow(p);
  const goal = JSON.parse(run(p, ["cli/orbit.mjs", "goal", "start", "implement the refund approval rule", "--json"]).stdout).id;
  const asked = [...usages.map((cli) => [cli]), ...["start --for=implement-the-refund-rule", `context ${task}`, `resume ${task}`, "doctor", "status", `context ${task} --json`].map((a) => ["cli/automation.mjs", ...a.split(" ")]), ["cli/task.mjs", "show", task], ["cli/task.mjs", "list"], ["cli/orbit.mjs", "goal", "resume", goal], ["cli/orbit.mjs", "goal", "resume", goal, "--json"], ["cli/improve.mjs", "status"], ["cli/improve.mjs", "analyse", "--dry"], ["cli/query.mjs", "triage", triageDir()], ["cli/query.mjs", "doctor"], ["cli/help.mjs"], ["cli/help.mjs", "--json"]];
  const said = asked.map((argv) => [argv, run(p, argv, argv[0] === "cli/query.mjs" ? { ORBIT_UI_TESTS: UI_TESTS } : {})]);
  for (const [argv, r] of said) assert.equal(placeholderIn(r.stdout + r.stderr), null, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
  const named = said.filter(([, r]) => r.stdout.includes(SAID_ROOT)).map(([argv]) => argv.slice(0, 2).join(" "));
  for (const cli of ["cli/automation.mjs context", "cli/orbit.mjs goal", "cli/query.mjs triage", "cli/help.mjs"]) assert.ok(named.includes(cli), `${cli} named an Orbit command by the plugin's path (${named.join(", ")})`);
});
