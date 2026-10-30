import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { switchOf } from "../src/project/env.mjs";
import { switchKey, switches } from "../src/lifecycle/subscribers/switches.mjs";
import * as claude from "../skills/orbit-learn/hosts/claude.mjs";
import { resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { lifecycleEvent } from "../src/lifecycle/event.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));

test("an exported ORBIT_ variable beats the plugin toggle, which beats the default", () => {
  assert.equal(switchOf({}, "ENGINEERING_OBSERVE", "engineering_observe", false), false);
  assert.equal(switchOf({ CLAUDE_PLUGIN_OPTION_ENGINEERING_OBSERVE: "true" }, "ENGINEERING_OBSERVE", "engineering_observe", false), true);
  assert.equal(switchOf({ CLAUDE_PLUGIN_OPTION_ENGINEERING_OBSERVE: "true", ORBIT_ENGINEERING_OBSERVE: "off" }, "ENGINEERING_OBSERVE", "engineering_observe", false), false);
  assert.equal(switchOf({ CLAUDE_PLUGIN_OPTION_WORKING_SET: "false" }, "WORKING_SET", "working_set", true), false);
});

test("on/off, true/false, 1/0 and yes/no all read; anything else falls through, never guessed", () => {
  for (const on of ["on", "TRUE", "1", "yes", " On "]) assert.equal(switchOf({ ORBIT_X: on }, "X", "x", false), true, on);
  for (const off of ["off", "False", "0", "no"]) assert.equal(switchOf({ ORBIT_X: off }, "X", "x", true), false, off);
  assert.equal(switchOf({ ORBIT_X: "maybe", CLAUDE_PLUGIN_OPTION_X: "on" }, "X", "x", false), true, "an unreadable override yields to the toggle");
  assert.equal(switchOf({ ORBIT_X: "maybe" }, "X", "x", true), true, "and to the default when there is no toggle");
});

// The session trail and host-memory hints: declared for the dialog, and read
// with the same defaults by every entry point that honours them.
test("the manifest declares the trail and host-memory toggles, and every reader falls back to the same default", () => {
  for (const key of ["trace", "host_memory"]) {
    const o = MANIFEST.userConfig[key];
    assert.deepEqual([o.type, o.default, Boolean(o.title && o.description)], ["boolean", true, true], key);
    assert.doesNotMatch(o.description, /[<>]/, "no angle brackets in anything a host parses");
  }
  for (const file of ["cli/learn-hook.mjs", "cli/router-hook.mjs", "cli/knowledge.mjs", "cli/trace.mjs"]) assert.match(readFileSync(join(ROOT, file), "utf8"), /"TRACE", "trace", true\)/, file);
  assert.match(readFileSync(join(ROOT, "cli", "knowledge.mjs"), "utf8"), /"HOST_MEMORY", "host_memory", true\)/);
});

// The default is declared twice -- once for the settings dialog, once for a
// host that never sends the option -- so the two are held together here.
test("the manifest declares both memory toggles, and their defaults are the ones the hook falls back to", () => {
  const opts = { working_set: MANIFEST.userConfig.working_set, engineering_observe: MANIFEST.userConfig.engineering_observe };
  for (const o of Object.values(opts)) {
    assert.equal(o.type, "boolean");
    assert.ok(o.title && o.description, "the dialog shows a title and a description");
  }
  assert.equal(opts.working_set.default, true);
  assert.equal(opts.engineering_observe.default, true, "autonomous learning is on by default (1.8.9); a person turns it off");
  const hook = readFileSync(join(ROOT, "cli", "learn-hook.mjs"), "utf8");
  assert.match(hook, /switchOf\(process\.env, "WORKING_SET", "working_set", true\)/);
  assert.match(hook, /switchOf\(process\.env, "ENGINEERING_OBSERVE", "engineering_observe", true\)/);
  assert.match(readFileSync(join(ROOT, "cli", "finalize.mjs"), "utf8"), /switchOf\(env, 'ENGINEERING_OBSERVE', 'engineering_observe', true\)/, "the drain falls back to the same default");
});

// ---- one switch per shipped skill and agent --------------------------------

const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const PLUGIN = MANIFEST.name;
const shippedSkills = () => readdirSync(join(ROOT, "skills")).filter((d) => readdirSync(join(ROOT, "skills", d)).includes("SKILL.md"));
const shippedAgents = () => readdirSync(join(ROOT, "agents")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
const componentKeys = () => [...shippedSkills().map((name) => switchKey({ kind: "skill", name }, PLUGIN)), ...shippedAgents().map((name) => switchKey({ kind: "agent", name }, PLUGIN))];

test("the skill namespace the hook assumes is the plugin's own name", () => {
  assert.equal(PACKAGE.name, MANIFEST.name, "engineName() reads package.json; the host namespaces by plugin.json");
});

// Declared by hand in the manifest, derived here from what actually ships: a
// skill added without its switch, or a switch left for a skill that went, fails.
test("every shipped skill and agent has exactly one switch, a boolean that defaults to on", () => {
  const declared = Object.keys(MANIFEST.userConfig).filter((k) => /^(skill|agent)_/.test(k));
  assert.deepEqual(declared.sort(), componentKeys().sort());
  for (const key of declared) {
    const o = MANIFEST.userConfig[key];
    assert.equal(o.type, "boolean", key);
    assert.equal(o.default, true, `${key}: unset is on, so the dialog must agree`);
    assert.ok(o.title && o.description, key);
  }
});

test("a key is the component's name inside its kind, and another plugin's namespace is never ours", () => {
  assert.equal(switchKey({ kind: "skill", name: "orbit:orbit-ui-map" }, "orbit"), "skill_map_ui");
  assert.equal(switchKey({ kind: "skill", name: "orbit-ui-map" }, "orbit"), "skill_map_ui", "a bare name too");
  assert.equal(switchKey({ kind: "agent", name: "orbit:orbit-map-healer" }, "orbit"), "agent_map_healer");
  assert.equal(switchKey({ kind: "skill", name: "other:orbit-ui-map" }, "orbit"), null);
  assert.equal(switchKey({ kind: "skill", name: "" }, "orbit"), null);
  assert.equal(switchKey(null, "orbit"), null);
});

const pre = (tool_name, tool_input) => lifecycleEvent(resolveHost({ hook_event_name: "PreToolUse" }), { hook_event_name: "PreToolUse", tool_name, tool_input });
const decide = (event, env) => switches.run(event, { host: claude, input: {}, env, plugin: "orbit" });

test("the Claude Code adapter names the skill or agent a tool call is about to start", () => {
  assert.deepEqual(pre("Skill", { skill: "orbit:orbit-help" }).invokes, { kind: "skill", name: "orbit:orbit-help" });
  assert.deepEqual(pre("Agent", { subagent_type: "orbit:orbit-map-healer" }).invokes, { kind: "agent", name: "orbit:orbit-map-healer" });
  assert.deepEqual(pre("Task", { subagent_type: "orbit:orbit-dsl-doctor" }).invokes, { kind: "agent", name: "orbit:orbit-dsl-doctor" });
  assert.equal(pre("Bash", { command: "ls" }).invokes, null);
});

test("unset runs, off refuses with the reason, and an exported ORBIT_ variable wins", () => {
  const skill = pre("Skill", { skill: "orbit:orbit-ui-map" });
  assert.equal(decide(skill, {}), null, "no setting at all: it runs");
  assert.equal(decide(skill, { CLAUDE_PLUGIN_OPTION_SKILL_MAP_UI: "true" }), null);
  const denied = decide(skill, { CLAUDE_PLUGIN_OPTION_SKILL_MAP_UI: "false" }).hookSpecificOutput;
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /skill_map_ui/);
  assert.equal(decide(skill, { CLAUDE_PLUGIN_OPTION_SKILL_MAP_UI: "false", ORBIT_SKILL_MAP_UI: "on" }), null);
  assert.equal(decide(pre("Skill", { skill: "other:orbit-ui-map" }), { CLAUDE_PLUGIN_OPTION_SKILL_MAP_UI: "false" }), null, "not ours");
  assert.equal(decide(pre("Agent", { subagent_type: "orbit:orbit-map-healer" }), { CLAUDE_PLUGIN_OPTION_AGENT_MAP_HEALER: "false" }).hookSpecificOutput.permissionDecision, "deny");
});

test("the hook is wired before a Skill or an Agent starts, and answers through the real CLI", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
  const matcher = new RegExp(`^(${hooks[0].matcher})$`);
  for (const tool of ["Skill", "Agent", "Task"]) assert.match(tool, matcher);
  assert.equal(hooks[0].hooks[0].async, undefined, "a refusal cannot arrive after the tool has started");
  const hook = (env) => spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs")], { encoding: "utf8", input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s", cwd: ROOT, tool_name: "Skill", tool_input: { skill: "orbit:orbit-help" } }), env: sealed(env) });
  const on = hook({});
  assert.equal(on.status, 0);
  assert.equal(on.stdout.trim(), "", "unset: nothing said, the host carries on");
  const off = hook({ CLAUDE_PLUGIN_OPTION_SKILL_HELP: "false" });
  assert.equal(off.status, 0);
  assert.equal(JSON.parse(off.stdout).hookSpecificOutput.permissionDecision, "deny");
});

// 0.2.2, ADR 0044: a subagent's start and stop reach the same hook, in the background, and the hook answers them with
// nothing -- a SubagentStop answered with a decision would keep a subagent from stopping.
test("SubagentStart and SubagentStop are wired to the hook in the background, and the hook says nothing to them", () => {
  const all = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  for (const name of ["SubagentStart", "SubagentStop"]) assert.deepEqual(all[name].map((m) => m.hooks.map((h) => [h.async, /cli\/learn-hook\.mjs"$/.test(h.command)])), [[[true, true]]], name);
  for (const name of ["SubagentStart", "SubagentStop"]) {
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs")], { encoding: "utf8", input: JSON.stringify({ hook_event_name: name, session_id: "s", cwd: ROOT, agent_id: "a-1", agent_type: "orbit:satellite-reader" }), env: sealed({}) });
    assert.deepEqual([r.status, r.stdout.trim()], [0, ""], name);
  }
});
