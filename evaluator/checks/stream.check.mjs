// The stream parser on hand-written stream-json: what a host said it spent and did, how it stopped, the status its
// last message ended with, and how much of a plugin it used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { askedOf, statusOf, summaryOf } from "../lib/core/stream.mjs";

const fixture = (name) => readFileSync(join(import.meta.dirname, "fixtures", "streams", name), "utf8");

test("a finished run: cost, tokens, turns, denials, status DONE, and the plugin's use counted", () => {
  const s = summaryOf(fixture("done.jsonl"), { pluginDir: "/opt/orbit-plugin" });
  assert.equal(s.started, true);
  assert.equal(s.version, "2.1.322");
  assert.deepEqual(s.plugins, ["orbit"]);
  assert.equal(s.costUsd, 0.4321);
  assert.deepEqual(s.tokens, { input: 1200, output: 3400, cacheRead: 50000, cacheWrite: 7000 });
  assert.equal(s.turns, 9);
  assert.equal(s.denials, 1);
  assert.equal(s.status, "DONE");
  assert.equal(s.asked, false);
  assert.equal(s.stoppedOn, null);
  assert.equal(s.apiError, null);
  assert.deepEqual(s.tools.byName, { Skill: 1, Bash: 2, Agent: 1, Edit: 1 });
  assert.deepEqual(s.tools.skills, { "orbit-help": 1 });
  assert.deepEqual(s.tools.agents, { Explore: 1 });
  assert.deepEqual(s.orbit, { commands: 1, byCli: { context: 1 } });
});

test("a plain arm has no plugin dir: no plugin command is counted, whatever it ran", () => {
  assert.deepEqual(summaryOf(fixture("done.jsonl")).orbit, { commands: 0, byCli: {} });
});

test("BLOCKED with a question is an intervention needed", () => {
  const s = summaryOf(fixture("blocked-question.jsonl"));
  assert.equal(s.status, "BLOCKED");
  assert.equal(s.statusWhy, "the rule for a loyal customer is not given");
  assert.equal(s.asked, true);
});

test("a budget stop is said by the result's subtype", () => {
  const s = summaryOf(fixture("budget.jsonl"));
  assert.equal(s.stoppedOn, "budget");
  assert.equal(s.apiError, null);
  assert.equal(s.costUsd, 1.0123);
  assert.equal(s.status, null);
});

test("an API or credential error is told apart from the agent's work", () => {
  const s = summaryOf(fixture("api-error.jsonl"));
  assert.match(s.apiError, /authentication_error/);
});

test("a stream cut mid-line: what came before is still read, and there is no result", () => {
  const s = summaryOf(fixture("cut.jsonl"));
  assert.equal(s.started, true);
  assert.equal(s.result, false);
  assert.equal(s.costUsd, null);
  assert.equal(s.tools.calls, 1);
});

test("the status is the LAST EVAL_STATUS line, and a question is read from the text before it", () => {
  assert.deepEqual(statusOf("EVAL_STATUS: BLOCKED x\nmore\nEVAL_STATUS: DONE"), { status: "DONE", why: null });
  assert.deepEqual(statusOf("**EVAL_STATUS: DONE**"), { status: "DONE", why: null });
  assert.deepEqual(statusOf("all done"), { status: null, why: null });
  assert.equal(askedOf("Shall I also update the docs?\n\nEVAL_STATUS: DONE", "DONE"), true);
  assert.equal(askedOf("Fixed it.\n\nEVAL_STATUS: DONE", "DONE"), false);
});

test("nothing parses from garbage, and nothing throws", () => {
  const s = summaryOf("not json\n{\"broken\":\n");
  assert.equal(s.started, false);
  assert.equal(s.result, false);
  assert.equal(s.lastText, null);
  assert.equal(s.asked, null);
});

test("a plugin is named with its version, and the hooks it ran are counted with their failures", () => {
  const text = [{ type: "system", subtype: "hook_response", outcome: "success" }, { type: "system", subtype: "hook_response", outcome: "error" }, { type: "system", subtype: "init", plugins: [{ name: "orbit", version: "0.5.0", path: "/opt/orbit-plugin" }, { name: "builtin-x", path: "builtin" }] }].map((e) => JSON.stringify(e)).join("\n");
  const s = summaryOf(text);
  assert.deepEqual(s.plugins, ["orbit@0.5.0", "builtin-x"]);
  assert.deepEqual(s.hooks, { ran: 2, failed: 1 });
});
