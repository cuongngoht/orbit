// The benchmark's EVIDENCE of what a host did (0.5.0, the activation benchmark §4): hostOf v2 keeps one row per tool
// call -- its name, the skill or agent it starts, the Agent call it answers to, a file tool's path, whether its result
// came back as an error -- and never a prompt or an output; a Bash command is kept only for a judge's patterns
// (commandsOf), never in what hostOf returns; and the AGREEMENT RULE holds the stream's Skill and Agent calls to the
// trail Orbit's hooks wrote: neither is believed alone, and a session longer than the turns view is counted, never
// waved through. HOST_DIVERGED is one more failure class, the model's own.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { STDOUT_CAP, teeSink } from "../benchmark/images/runner/entry.mjs";
import { sandboxesOf } from "../benchmark/images/runner/inspect.mjs";
import { agreementOf } from "../benchmark/lib/core/agreement.mjs";
import { commandsOf, hostOf, streamOf } from "../benchmark/lib/core/host.mjs";
import { FAILURE_CLASSES } from "../benchmark/lib/source/classify.mjs";
import { hostSession } from "../src/memory/session.mjs";

const ROOT = join(import.meta.dirname, "..");

const jsonl = (events) => events.map((e) => JSON.stringify(e)).join("\n");

const call = (id, name, input, o = {}) => ({ type: "assistant", ...(o.parent ? { parent_tool_use_id: o.parent } : {}), message: { id: o.message ?? `msg-${id}`, content: [{ type: "tool_use", id, name, input }], ...(o.usage ? { usage: o.usage } : {}) } });

const result = (id, isError, o = {}) => ({ type: "user", ...(o.parent ? { parent_tool_use_id: o.parent } : {}), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: o.says ?? "the tool's own output" }] } });

const SESSION = [
  { type: "system", subtype: "init", model: "claude-test", session_id: "sess-1", claude_code_version: "2.1.314" },
  call("t1", "Skill", { skill: "orbit:orbit-help", args: "the person's own words" }, { message: "m1", usage: { input_tokens: 100, output_tokens: 20 } }),
  call("t2", "Bash", { command: "node /work/orbit/cli/orbit.mjs goal start --stdin", description: "start" }, { message: "m1", usage: { input_tokens: 100, output_tokens: 20 } }),
  result("t1", false),
  result("t2", true, { says: "Exit code 2\nREFUSED: secret-looking output" }),
  call("t3", "Agent", { subagent_type: "orbit:orbit-failure-analyst", prompt: "a prompt nobody keeps" }, { message: "m2", usage: { input_tokens: 50, output_tokens: 10 } }),
  call("t4", "Read", { file_path: "/work/repo/src/money.mjs" }, { message: "m3", parent: "t3" }),
  result("t4", false, { parent: "t3" }),
  result("t3", false),
  { type: "result", subtype: "success", is_error: false, num_turns: 3, total_cost_usd: 0.42, result: "a final answer nobody keeps" },
];

test("hostOf v2 keeps one row per call: its name, the component it starts, its parent, a file's path, and how it came back", () => {
  const h = hostOf(jsonl(SESSION));
  assert.deepEqual([h.basis, h.model, h.toolCalls, h.failedCalls, h.costUsd], ["REPORTED", "claude-test", 4, 1, 0.42], "the existing fields stay what they were");
  assert.deepEqual(h.uses.map((u) => [u.id, u.name, u.skill ?? u.agent ?? u.path ?? null, u.parent, u.failed, u.turn]), [["t1", "Skill", "orbit:orbit-help", null, false, 0], ["t2", "Bash", null, null, true, 0], ["t3", "Agent", "orbit:orbit-failure-analyst", null, false, 1], ["t4", "Read", "/work/repo/src/money.mjs", "t3", false, 2]]);
  const kept = JSON.stringify(h);
  for (const never of ["the person's own words", "a prompt nobody keeps", "secret-looking output", "a final answer nobody keeps", "goal start"]) assert.ok(!kept.includes(never), `never kept: ${never}`);
});

test("a call whose result never came back is unknown, never a success; a stream read twice counts each call once", () => {
  const cut = hostOf(jsonl([...SESSION.slice(0, 3), SESSION[2]]));
  assert.deepEqual(cut.uses.map((u) => [u.id, u.failed]), [["t1", null], ["t2", null]], "no result, no verdict on the call");
  assert.equal(cut.toolCalls, 2, "the same call carried twice is one call");
  assert.deepEqual(streamOf(jsonl(SESSION)).turns, [{ turn: 0, thread: "main", tokens: 120 }, { turn: 1, thread: "main", tokens: 60 }, { turn: 2, thread: "t3", tokens: null }], "a message streamed as two events is one turn, and a subagent's turn is its own thread");
});

test("a Bash command is kept only for a judge's patterns: commandsOf names it with its call, and hostOf never does", () => {
  assert.deepEqual(commandsOf(jsonl(SESSION)), [{ id: "t2", parent: null, turn: 0, command: "node /work/orbit/cli/orbit.mjs goal start --stdin" }]);
  assert.ok(!JSON.stringify(hostOf(jsonl(SESSION))).includes("cli/orbit.mjs"));
});

// ---- the agreement rule --------------------------------------------------------------------------------------------------

const turnsDoc = (steps, o = {}) => ({ exit: 0, json: { version: 1, turns: [{ id: "trn-1", session: o.session ?? hostSession("claude", "sess-1"), steps }] } });

const step = (kind, label, o = {}) => ({ at: "2026-11-05T00:00:00.000Z", kind, label, ok: !o.refused, refused: o.refused === true });

const USES = hostOf(jsonl(SESSION)).uses;

const MATCHING = [step("skill", "orbit:orbit-help"), step("tool", "Bash"), step("agent", "orbit:orbit-failure-analyst"), step("tool", "Read")];

test("the stream and the trail agree when every Skill and Agent call has its trail line and every line its call", () => {
  const a = agreementOf(USES, { turns: turnsDoc(MATCHING) }, { session: "sess-1" });
  assert.deepEqual([a.verdict, a.by, a.stream, a.trail], ["AGREES", "turns", { skills: 1, agents: 1 }, { skills: 1, agents: 1 }]);
  assert.equal(agreementOf(USES, { turns: turnsDoc([step("skill", "orbit:orbit-help", { refused: true }), MATCHING[2]]) }).verdict, "AGREES", "a call its switch refused is still the call the trail names");
});

test("neither source is believed alone: a call with no trail line, or a trail line with no call, is CONFLICTING", () => {
  const unseen = agreementOf(USES, { turns: turnsDoc([MATCHING[0]]) }, { session: "sess-1" });
  assert.deepEqual([unseen.verdict, unseen.missing.trail], ["CONFLICTING", ["agent orbit:orbit-failure-analyst"]]);
  const forged = agreementOf(USES, { turns: turnsDoc([...MATCHING, step("skill", "orbit:orbit-engineer")]) }, { session: "sess-1" });
  assert.deepEqual([forged.verdict, forged.missing.stream], ["CONFLICTING", ["skill orbit:orbit-engineer"]]);
  assert.equal(agreementOf(USES, { turns: turnsDoc(MATCHING, { session: hostSession("claude", "another-session") }) }, { session: "sess-1" }).verdict, "CONFLICTING", "another session's trail is not this session's");
});

test("an arm with no Orbit has no trail and expects none: any trail line or orbit call there is CONFLICTING", () => {
  const plain = hostOf(jsonl([SESSION[0], call("x1", "Agent", { subagent_type: "general-purpose" }), result("x1", false)])).uses;
  assert.equal(agreementOf(plain, { turns: turnsDoc([]) }, { arm: "none" }).verdict, "AGREES");
  assert.equal(agreementOf(USES, { turns: turnsDoc([]) }, { arm: "none" }).verdict, "CONFLICTING", "an orbit call where no Orbit was loaded");
  assert.equal(agreementOf(plain, { turns: turnsDoc([step("skill", "orbit:orbit-help")]) }, { arm: "none" }).verdict, "CONFLICTING", "a trail where none can be");
});

test("past the turns view's cap the trail's uncapped counts decide, and with neither the answer is UNDETERMINED, never AGREES", () => {
  const long = [...MATCHING.slice(0, 1), ...Array.from({ length: 80 }, () => step("tool", "Read"))];
  const usage = (skills, agents) => ({ exit: 0, json: { version: 1, totals: { skills, agents } } });
  assert.deepEqual(((a) => [a.verdict, a.by])(agreementOf(USES, { turns: turnsDoc(long), usage: usage(1, 1) }, { session: "sess-1" })), ["AGREES", "usage"]);
  assert.equal(agreementOf(USES, { turns: turnsDoc(long), usage: usage(1, 0) }, { session: "sess-1" }).verdict, "CONFLICTING");
  assert.equal(agreementOf(USES, { turns: turnsDoc(long), usage: { exit: 1, json: null } }, { session: "sess-1" }).verdict, "UNDETERMINED");
  assert.equal(agreementOf(USES, { turns: { exit: 1, json: null } }).verdict, "UNDETERMINED", "a trail nobody could read settles nothing");
});

// Past the cap, counts alone would let either source be rewritten alone: a call renamed keeps every count. So the
// trail's uncapped usage is held to the stream by NAME wherever it keeps names -- each skill it lists, started or
// refused -- and every line the capped view does show must have its call.
const usageNamed = (skills, agents, rows) => ({ exit: 0, json: { version: 1, totals: { skills, agents }, skills: rows } });

const CAPPED = Array.from({ length: 80 }, () => step("tool", "Read"));

test("past the cap, a skill renamed in the trail alone, or in the stream alone, is CONFLICTING -- never AGREES on counts", () => {
  const help = [{ id: "orbit-help", invoked: 1, refused: 0 }];
  assert.equal(agreementOf(USES, { turns: turnsDoc(CAPPED), usage: usageNamed(1, 1, help) }, { session: "sess-1" }).verdict, "AGREES", "the trail names the very skill the stream started");
  const trailRenamed = agreementOf(USES, { turns: turnsDoc(CAPPED), usage: usageNamed(1, 1, [{ id: "orbit-engineer", invoked: 1, refused: 0 }]) }, { session: "sess-1" });
  assert.deepEqual([trailRenamed.verdict, trailRenamed.by], ["CONFLICTING", "usage"], "a trail rewritten alone: one skill each, never the same one");
  const streamRenamed = USES.map((u) => (u.skill ? { ...u, skill: "orbit:orbit-engineer" } : u));
  assert.equal(agreementOf(streamRenamed, { turns: turnsDoc(CAPPED), usage: usageNamed(1, 1, help) }, { session: "sess-1" }).verdict, "CONFLICTING", "a stream rewritten alone");
  assert.equal(agreementOf(USES, { turns: turnsDoc(CAPPED), usage: usageNamed(1, 1, [{ id: "orbit-help", invoked: 0, refused: 1 }]) }, { session: "sess-1" }).verdict, "AGREES", "a call its switch refused is still the call the trail names");
});

test("past the cap, a line the capped view does show must have its call: one with none is CONFLICTING whatever the counts say", () => {
  const shown = [step("agent", "orbit:orbit-engineering-agent"), ...CAPPED];
  const a = agreementOf(USES, { turns: turnsDoc(shown), usage: usageNamed(1, 1, [{ id: "orbit-help", invoked: 1, refused: 0 }]) }, { session: "sess-1" });
  assert.deepEqual([a.verdict, a.missing.stream], ["CONFLICTING", ["agent orbit:orbit-engineering-agent"]]);
});

// The captured stream can only be added to by what a container prints -- never cut -- so the one way a line could
// rewrite a call is to arrive LATER under the call's id. A call is what the stream first said it was.
test("a later line under a call's id never renames the call: each call is what the stream first said it was", () => {
  const appended = hostOf(jsonl([...SESSION, call("t1", "Skill", { skill: "orbit:orbit-engineer" }, { message: "m9" }), result("t1", true)]));
  assert.deepEqual(appended.uses.filter((u) => u.id === "t1").map((u) => [u.skill, u.turn]), [["orbit:orbit-help", 0]]);
  assert.equal(appended.toolCalls, 4, "still one call");
  assert.deepEqual(commandsOf(jsonl([...SESSION, call("t2", "Bash", { command: "echo a later line" }, { message: "m9" })])).map((c) => c.command), ["node /work/orbit/cli/orbit.mjs goal start --stdin"]);
});

test("HOST_DIVERGED is one more failure class, and the README and ADR 0048 say what it means", () => {
  assert.ok(FAILURE_CLASSES.includes("HOST_DIVERGED"));
  assert.equal(FAILURE_CLASSES.at(-1), "UNKNOWN", "the catch-all stays last");
  assert.match(readFileSync(join(ROOT, "benchmark", "README.md"), "utf8"), /`HOST_DIVERGED` \(0\.5\.0\) is the one class that is the model's behaviour/);
  assert.match(readFileSync(join(ROOT, "docs", "adr", "0048-the-benchmark-proves-orbits-self-healing-loop-and-measures-goals.md"), "utf8"), /## Amendment, 2026-11-05 \(0\.5\.0\) — HOST_DIVERGED/);
});

// ---- the host's stream, as the controller captures it ---------------------------------------------------------------------

test("the runner's entry prints the host's stream on its stdout too, bounded below what the controller reads, and closed with its tail when cut", () => {
  const printed = [];
  const out = { write: (b) => printed.push(Buffer.from(b)) };
  const tee = teeSink(10, out);
  tee.write(Buffer.from("0123456"));
  tee.write(Buffer.from("789abc"));
  tee.close(Buffer.from("TAIL"));
  assert.deepEqual([Buffer.concat(printed).toString(), tee.s.bytes, tee.s.cut], ["0123456789\nTAIL", 10, true]);
  const whole = [];
  const all = teeSink(100, { write: (b) => whole.push(Buffer.from(b)) });
  all.write(Buffer.from("{}\n"));
  all.close(Buffer.from("never"));
  assert.equal(Buffer.concat(whole).toString(), "{}\n", "a stream that was not cut is printed as it came, and nothing else");
  assert.ok(STDOUT_CAP < 16 * 1024 * 1024, "a stdout past the process port's 16 MiB would stop the round's container");
});

// ---- the sandboxes a round left, as the inspection reads them back ------------------------------------------------------

const written = (file, value) => (mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, JSON.stringify(value)));

test("the inspection reads every sandbox the runner store holds, with its operations journal -- as data, bounded, never through a link", (t) => {
  const store = mkdtempSync(join(tmpdir(), "orbit-bench-sandboxes-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  written(join(store, "repo-x", "checkouts", "co-1", "sandboxes", "env-1.json"), { schema: 1, id: "env-1", kind: "sandbox", owner: { kind: "task", id: "tsk-0000000000a1" }, state: "BLOCKED", blocked: { needs: "environment", because: "restoring node:. (npm ci) failed with exit 1", at: "x" }, endpoints: [{ port: 42001 }] });
  const ops = join(store, "repo-x", "runtime", "orbit-benchmark-runner", "checkouts", "co-1", "sandboxes", "env-1", "operations");
  written(join(ops, "op-000000000002.json"), { schema: 1, id: "op-000000000002", kind: "restore", state: "FAILED", at: "2026-11-05T00:00:02.000Z", settledAt: "2026-11-05T00:00:09.000Z", because: "restoring node:. (npm ci) failed with exit 1", fingerprint: "f" });
  written(join(ops, "op-000000000001.json"), { schema: 1, id: "op-000000000001", kind: "prepare", state: "FAILED", at: "2026-11-05T00:00:01.000Z", settledAt: "2026-11-05T00:00:10.000Z", because: "restoring node:. (npm ci) failed with exit 1" });
  writeFileSync(join(ops, "op-000000000001.log"), "a log is never read");
  const got = sandboxesOf(store).json.sandboxes;
  assert.deepEqual(got.map((s) => [s.id, s.task, s.state, s.blocked?.needs, s.operations.map((o) => `${o.kind}:${o.state}`)]), [["env-1", "tsk-0000000000a1", "BLOCKED", "environment", ["prepare:FAILED", "restore:FAILED"]]]);
  assert.ok(!JSON.stringify(got).includes("42001") && !JSON.stringify(got).includes("a log is never read"), "no endpoint, no log");
  assert.deepEqual(sandboxesOf(join(store, "nowhere")).json.sandboxes, [], "a store with no sandbox has none");
});
