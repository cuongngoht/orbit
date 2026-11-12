import assert from "node:assert/strict";
import { test } from "node:test";
import * as claude from "../skills/orbit-learn/hosts/claude.mjs";
import { resolveHookHost, resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { dispatch } from "../src/lifecycle/dispatch.mjs";
import { EVENT_NAMES, lifecycleEvent } from "../src/lifecycle/event.mjs";
import { CAPABILITY_BYTES, OWNERS, OWNER_KINDS, capabilityLine, recoveryRow, returnLine } from "../src/lifecycle/owners.mjs";
import { learning } from "../src/lifecycle/subscribers/learning.mjs";
import { returned } from "../src/lifecycle/subscribers/returned.mjs";
import { hostSession, knownIn, sessionMarks } from "../src/memory/session.mjs";
import { fakeIo } from "./fakes/io.mjs";

const event = (input, argv = []) => lifecycleEvent(resolveHost(input, argv), input, argv);

test("a Claude Code payload becomes one normalized event, and its session id is never kept raw", () => {
  const e = event({ hook_event_name: "PostToolUse", session_id: "raw-session-123", cwd: "/repo", tool_name: "Edit", tool_input: { file_path: "/repo/src/a.mjs" }, tool_response: { secret: "x" } });
  assert.equal(e.event, "post-tool");
  assert.equal(e.host, "claude");
  assert.equal(e.tool.kind, "edit");
  assert.deepEqual(e.paths, ["/repo/src/a.mjs"]);
  assert.equal(e.ok, true);
  assert.match(e.session, /^claude:[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(e), /raw-session-123|secret/, "neither the raw id nor the tool's output travels on");
});

// 0.2.2, ADR 0044: which subagent a hook speaks for, and which one an Agent call launched -- hashed like a session, so
// the host's own id never travels; the prompt an Agent call carried, the subagent's last message and its transcript
// never travel either, and a main-session event carries no agent at all.
test("a subagent's id is hashed, and nothing it said or wrote travels with it", () => {
  const raw = { session_id: "raw-session-9", cwd: "/repo", agent_id: "raw-agent-77", agent_type: "orbit:satellite-reader" };
  const tool = event({ ...raw, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/repo/a.md" }, tool_response: { file: { content: "SECRET-SENTINEL" } } });
  const stop = event({ ...raw, hook_event_name: "SubagentStop", last_assistant_message: "SECRET-SENTINEL", agent_transcript_path: "/home/p/.claude/projects/x/s/subagents/agent-raw-agent-77.jsonl" });
  assert.deepEqual([tool.agent.type, stop.event, event({ ...raw, hook_event_name: "SubagentStart" }).event], ["orbit:satellite-reader", "agent-end", "agent-start"]);
  assert.match(tool.agent.id, /^claude:[0-9a-f]{16}$/);
  assert.equal(stop.agent.id, tool.agent.id, "the same agent, the same id, from its tool calls and its stop");
  assert.doesNotMatch(JSON.stringify([tool, stop]), /raw-agent-77|raw-session-9|SECRET-SENTINEL|subagents/);
  assert.equal("agent" in event({ hook_event_name: "PostToolUse", session_id: "s", tool_name: "Read", tool_input: {} }), false, "a main-session call names no agent");
});

test("an Agent call's launched id is hashed, and an envelope's two ids are all that is read of its prompt", () => {
  const envelope = JSON.stringify({ api: "orbit.satellite.envelope/v1", missionId: "msn-0123456789ab", agentRunId: "arn-4", instruction: { text: "SECRET-SENTINEL" } });
  const pre = event({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Agent", tool_use_id: "toolu_9", tool_input: { subagent_type: "orbit:satellite-reader", prompt: envelope } });
  const post = event({ hook_event_name: "PostToolUse", session_id: "s", tool_name: "Agent", tool_use_id: "toolu_9", tool_input: { subagent_type: "Explore", prompt: envelope }, tool_response: { agentId: "raw-launched-1", content: "SECRET-SENTINEL" } });
  assert.equal(pre.dispatched, "msn-0123456789ab/arn-4");
  assert.match(post.launched, /^claude:[0-9a-f]{16}$/);
  assert.equal(pre.delivery, post.delivery, "the pre and the post of one Agent call share its key");
  assert.doesNotMatch(JSON.stringify([pre, post]), /SECRET-SENTINEL|raw-launched-1|toolu_9/);
  assert.equal("dispatched" in post, false, "an Agent call to an agent that is not one of this plugin's Satellite agents is never read for an envelope");
  assert.equal("dispatched" in event({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: envelope } }), false, "only this plugin's Satellite agents are read for an envelope");
});

test("a failure is a failure event with ok false; a background launch says so", () => {
  assert.equal(event({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "x" } }).ok, false);
  assert.equal(event({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "x", run_in_background: true } }).background, true);
});

test("an Antigravity protocol-2 payload becomes the same lifecycle shape", async () => {
  const host = await resolveHookHost(null, ["--host=antigravity", "--protocol=2"]);
  const e = lifecycleEvent(host, { conversationId: "conv-1", workspacePaths: ["/repo"], toolCall: { name: "run_command", args: { CommandLine: "node x.mjs", Cwd: "/repo" } } }, ["--event=PostToolUse"]);
  assert.equal(e.event, "post-tool");
  assert.equal(e.host, "antigravity");
  assert.equal(e.tool.kind, "command");
  assert.equal(e.command, "node x.mjs");
  assert.match(e.session, /^antigravity:/);
});

// Grok Build (1.8.9, measured on 1.0.62): a Claude-shaped envelope with its own tool names, so it is chosen by the
// identity its hooks file names, never by shape -- and what it carries of a command's end is used, not guessed.
test("a Grok Build payload becomes the same shape, and its raw session id never travels", async () => {
  const host = await resolveHookHost(null, ["--host=grok", "--protocol=2"]);
  const e = lifecycleEvent(host, { hook_event_name: "PostToolUse", session_id: "raw-grok-session", cwd: "/repo", tool_name: "search_replace", tool_use_id: "call-1", tool_input: { file_path: "/repo/src/a.mjs", old_string: "a", new_string: "b" }, tool_response: { type: "SearchReplace", EditsApplied: { absolute_path: "/repo/src/a.mjs" } } });
  assert.equal(e.event, "post-tool");
  assert.equal(e.host, "grok");
  assert.equal(e.tool.kind, "edit");
  assert.deepEqual(e.paths, ["/repo/src/a.mjs"]);
  assert.equal(e.ok, true);
  assert.match(e.session, /^grok:[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(e), /raw-grok-session|"b"/, "neither the raw id nor the edit's text travels on");
  const failed = lifecycleEvent(host, { hook_event_name: "PostToolUse", session_id: "s", cwd: "/repo", tool_name: "run_terminal_command", tool_input: { command: "node --test" }, tool_response: { type: "Bash", exit_code: 1 } });
  assert.deepEqual([failed.event, failed.ok, failed.command], ["post-tool-failure", false, "node --test"]);
});

test("an unknown host or an unheard event is no event at all", () => {
  assert.equal(event({ something: "else" }), null);
  assert.equal(event({ hook_event_name: "Unheard" }), null);
  assert.equal(event(null), null);
  assert.equal(dispatch(null, {}, [{ name: "x", on: EVENT_NAMES, run: () => ({ spoke: true }) }]), null);
});

test("one subscriber throwing costs nobody else, and only a recording one reports it", () => {
  const failures = [];
  const world = { failed: (name) => failures.push(name) };
  const subs = [
    { name: "boom", on: ["post-tool"], records: true, run: () => { throw new Error("x"); } },
    { name: "quiet-boom", on: ["post-tool"], records: false, run: () => { throw new Error("y"); } },
    { name: "speaks", on: ["post-tool"], run: () => ({ said: 1 }) },
    { name: "later", on: ["post-tool"], run: () => ({ said: 2 }) },
  ];
  assert.deepEqual(dispatch({ event: "post-tool" }, world, subs), { said: 1 }, "the first payload in table order is what the host hears");
  assert.deepEqual(failures, ["boom"]);
});

test("a failing failure report is swallowed too", () => {
  const subs = [{ name: "boom", on: ["post-tool"], records: true, run: () => { throw new Error("x"); } }];
  assert.equal(dispatch({ event: "post-tool" }, { failed: () => { throw new Error("again"); } }, subs), null);
});

// src/memory/session.mjs's independence table, row by row.
test("real sessions are independent by id; a synthetic one is not independent of a real one that day", () => {
  const a = { host: "laptop", at: "2026-09-23T01:00:00Z", session: hostSession("claude", "one") };
  const b = { host: "laptop", at: "2026-09-23T02:00:00Z", session: hostSession("claude", "two") };
  const typed = { host: "laptop", at: "2026-09-23T03:00:00Z" };
  const otherDay = { host: "laptop", at: "2026-09-24T03:00:00Z" };
  assert.equal(knownIn(sessionMarks(a), b), false, "two sessions on one laptop are two");
  assert.equal(knownIn(sessionMarks(a), a), true);
  assert.equal(knownIn(sessionMarks(a), typed), true, "a hand-typed record the same day is the same sitting");
  assert.equal(knownIn(sessionMarks(typed), b), true, "and in the other order");
  assert.equal(knownIn(sessionMarks(a), otherDay), false);
});

// ---- 0.5.0 (B22 M3, ADR 0050): the follow-through a plugin has -------------------------------------------------------

test("a Stop a hook already kept going is `held`, a resumed or compacted start is `resumed` -- each on its own event, and absent otherwise", () => {
  const base = { session_id: "s", cwd: "/repo" };
  assert.equal(event({ ...base, hook_event_name: "Stop", stop_hook_active: true }).held, true);
  assert.equal("held" in event({ ...base, hook_event_name: "Stop", stop_hook_active: false }), false);
  assert.equal("held" in event({ ...base, hook_event_name: "SubagentStop", stop_hook_active: true, agent_id: "a", agent_type: "orbit:satellite-reader" }), false, "a subagent's own stop is never this session's turn");
  for (const source of ["resume", "compact"]) assert.equal(event({ ...base, hook_event_name: "SessionStart", source }).resumed, true, source);
  for (const source of ["startup", "clear", undefined]) assert.equal("resumed" in event({ ...base, hook_event_name: "SessionStart", source }), false, String(source));
  const forged = lifecycleEvent({ name: "claude", normalize: () => ({ hostEvent: "PostToolUse", session: "s", held: true, resumed: true, synthetic: true }) }, {});
  assert.deepEqual(["held", "resumed", "synthetic"].filter((k) => k in forged), [], "a mark an adapter puts on the wrong event never travels");
});

test("Claude's adapter answers after a tool ONLY for an Agent call with something to say, and holds a turn as Claude Code reads a Stop hook's block", () => {
  const agent = { hook_event_name: "PostToolUse", tool_name: "Agent", tool_input: { subagent_type: "orbit:orbit-qa-agent" } };
  assert.deepEqual(claude.formatPostTool("a line", agent), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "a line" } });
  assert.equal(claude.formatPostTool("a line", { ...agent, tool_name: "Bash" }), null, "no other tool's return is followed");
  assert.equal(claude.formatPostTool(null, agent), null);
  assert.equal(claude.formatPostTool(null, { tool_name: "Bash" }), null, "the learning fold's own call says nothing, as before");
  assert.deepEqual(claude.formatHold("the reason"), { decision: "block", reason: "the reason" });
  assert.equal(claude.formatHold(""), null);
});

const WORKFLOW = { kind: "workflow", id: "tsk-0123456789ab", lifecycle: "EXECUTING", state: "running", ready: ["qa"], open: ["engineering"] };

const quietHost = { isWatched: (input, list) => list.some((w) => String(input?.tool_input?.command ?? "").includes(w)), formatSessionStart: (text) => (text ? { context: text } : null), formatFailure: (text) => ({ failure: text }), formatPostTool: claude.formatPostTool };

test("ONE payload a failed Orbit command gets: the diagnosis a watched command gets, then the governing owner's recovery row", () => {
  const world = (owner, command) => ({ host: quietHost, input: { tool_input: { command } }, engine: "/plug", recovery: () => owner });
  const watched = learning.run({ event: "post-tool-failure" }, world(WORKFLOW, "node /p/cli/run-case.mjs x"));
  assert.match(watched.failure, /^A orbit command exited non-zero/);
  assert.match(watched.failure, /\nOrbit: this command ran under workflow tsk-0123456789ab \(EXECUTING\)\. An action that did not settle is read back with node \/plug\/cli\/automation\.mjs reconcile tsk-0123456789ab -- never sent again\.$/);
  assert.match(learning.run({ event: "post-tool-failure" }, world(WORKFLOW, "node /p/cli/automation.mjs step tsk-0123456789ab")).failure, /^Orbit: this command ran under workflow/, "an Orbit command no diagnosis watches gets its owner's row alone");
  assert.equal(learning.run({ event: "post-tool-failure" }, world(null, "node /p/cli/automation.mjs step x")), null, "no governed work: nothing, as before");
  assert.match(learning.run({ event: "post-tool-failure" }, world(null, "node /p/cli/run-case.mjs x")).failure, /^A orbit command exited non-zero[^\n]*$/, "a watched command with no governed work: the diagnosis alone, as before");
});

test("ONE payload a session's start gets: the capability line first, the open work of a resumed session next, the recall after", () => {
  const ctx = { learn: { all: () => [] }, config: { name: "x" }, store: { root: "/nowhere" }, io: fakeIo(), project: { graphDir: "/nowhere/graph" } };
  const digest = { capabilities: { summary: [{ family: "skills", total: 25, available: 24 }], off: ["orbit-report"], status: "READY" }, owner: WORKFLOW };
  const world = { host: quietHost, input: {}, engine: "/plug", light: () => ctx, digest: () => digest };
  const fresh = learning.run({ event: "session-start" }, world).context.split("\n\n");
  assert.equal(fresh[0], "Orbit here: skills 24/25 usable; switched off: orbit-report; project STATUS READY.");
  assert.ok(!fresh.some((p) => p.includes("open work")), "a fresh session has no open work to say");
  const resumed = learning.run({ event: "session-start", resumed: true }, world).context.split("\n\n");
  assert.match(resumed[1], /^Orbit: this session's open work is workflow tsk-0123456789ab \(EXECUTING\), next: qa -- node \/plug\/cli\/automation\.mjs context tsk-0123456789ab says where it stands\.$/);
  assert.equal(learning.run({ event: "session-start" }, { ...world, light: () => null }), null, "an unknown checkout: nothing at all, digest or not");
  assert.equal(learning.run({ event: "session-start" }, { ...world, digest: () => null }), null, "no digest and nothing recalled: nothing, as before");
});

test("the capability line is at most 300 bytes, however much a person switched off, and every owner names its own commands", () => {
  const long = capabilityLine({ summary: [{ family: "skills", total: 25, available: 2 }, { family: "agents", total: 20, available: 0 }, { family: "mcp", total: 4, available: 1 }, { family: "tools", total: 24, available: 3 }, { family: "capabilities", total: 5, available: 5 }], off: Array.from({ length: 45 }, (_, i) => `orbit-component-number-${i}`), status: "NOT_INITIALIZED" });
  assert.ok(Buffer.byteLength(long) <= CAPABILITY_BYTES, `${Buffer.byteLength(long)} bytes`);
  assert.match(long, /switched off/);
  assert.deepEqual(OWNER_KINDS, ["workflow", "goal", "task", "investigation", "mission"]);
  for (const kind of OWNER_KINDS) assert.match(recoveryRow({ kind, id: "x-1", lifecycle: "L" }, "/plug"), /node \/plug\/(satellite\/)?cli\/[a-z-]+\.mjs .*(reconcile|resume)/, kind);
  assert.equal(recoveryRow({ kind: "release", id: "x" }, "/plug"), null, "an owner with no row says nothing");
  assert.match(OWNERS.mission.report("msn-0123456789ab", "arn-2"), /agent report msn-0123456789ab arn-2$/);
});

// 0.6.0 (P5): no loops. Every owner a hook names keeps a write door -- its own step, settle or report -- so an outcome
// it never heard back is READ BACK through the owner's own command, never resent: each row names its read and its
// reconcile, and neither is a command that would send anything again.
const SENDS = ["start", "step", "settle", "report", "approve", "push", "commit"];

test("every owner names its read-back and its reconcile, and neither one sends anything again", () => {
  for (const [kind, owner] of Object.entries(OWNERS)) {
    assert.equal(typeof owner.read, "function", `${kind} names no read`);
    assert.equal(typeof owner.reconcile, "function", `${kind} names no reconcile: an outcome nobody heard back could only be resent`);
    for (const how of ["read", "reconcile"]) {
      const words = owner[how]("x-0123456789ab").replace(/^node \S+ /, "").split(/\s+/).filter((w) => /^[a-z-]+$/.test(w));
      assert.deepEqual(words.filter((w) => SENDS.includes(w)), [], `${kind}.${how} sends: ${owner[how]("x-0123456789ab")}`);
    }
    assert.match(recoveryRow({ kind, id: "x-1", lifecycle: "L" }, "/plug"), /never sent again/, `${kind}: its recovery row says it is read back, never resent`);
  }
});

test("after one of Orbit's agents returns: one line naming the owner record that settles its work -- and nothing for another plugin's agent or a session with no governed work", () => {
  const asked = [];
  const world = (owner) => ({ host: claude, input: { tool_name: "Agent" }, plugin: "orbit", engine: "/plug", governedFor: (e) => (asked.push(e.invokes.name), owner) });
  const ours = { event: "post-tool", invokes: { kind: "agent", name: "orbit:orbit-qa-agent" } };
  const line = returned.run(ours, world(WORKFLOW)).hookSpecificOutput.additionalContext;
  assert.equal(line, "Orbit: orbit:orbit-qa-agent returned -- what it says is its report, not evidence. Its work is settled by workflow tsk-0123456789ab (EXECUTING): node /plug/cli/automation.mjs settle tsk-0123456789ab settles step engineering on the evidence its owner keeps.");
  assert.equal(returned.run(ours, world(null)), null, "no governed work: nothing");
  for (const name of ["Explore", "other:orbit-qa-agent", "general-purpose"]) assert.equal(returned.run({ event: "post-tool", invokes: { kind: "agent", name } }, world(WORKFLOW)), null, name);
  assert.equal(returned.run({ event: "post-tool", invokes: { kind: "skill", name: "orbit:orbit-help" } }, world(WORKFLOW)), null, "a skill is not an agent's return");
  assert.deepEqual(asked, ["orbit:orbit-qa-agent", "orbit:orbit-qa-agent"], "the owners were asked for this plugin's agents alone");
  const mission = { kind: "mission", id: "msn-0123456789ab", run: "arn-2", lifecycle: "RUNNING", state: "running", ready: [], open: [] };
  assert.match(returned.run({ ...ours, background: true, invokes: { kind: "agent", name: "orbit:satellite-reader" } }, world(mission)).hookSpecificOutput.additionalContext, /^Orbit: orbit:satellite-reader was launched -- .*agent report msn-0123456789ab arn-2 hands in run arn-2's report/);
});
