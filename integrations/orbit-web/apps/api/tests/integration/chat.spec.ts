// Mocked-process integration of a whole chat: a real workspace (git runs for real on a generated repository, Orbit's
// own CLIs seat and read it for real), with Claude Code scripted: it streams what a real run streams and really edits
// the file. This proves Orbit Web's plumbing -- the real Claude CLI is exercised only by the acceptance run.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ChangesReport, FileDiff, OrbitPanel, SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { claudeRun, eventually, REPOSITORY, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);

// What a real run streams (shapes from Claude Code 2.1.x), while the Edit really changes the file.
function fixingRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    const sid = after1(call.args, "--session-id") ?? after1(call.args, "--resume");
    c.line({ type: "system", subtype: "hook_started", hook_name: "SessionStart" });
    c.line({ type: "system", subtype: "init", cwd: call.cwd, session_id: sid, model: "claude-sonnet-5-5", permissionMode: "dontAsk", claude_code_version: "2.1.328", plugins: [{ name: "orbit", path: "/opt/orbit/plugin", source: "orbit@inline", version: "0.6.0" }] });
    c.line({ type: "stream_event", event: { type: "message_start", message: { id: "msg_a" } }, parent_tool_use_id: null });
    c.line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null });
    c.line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The addition " } }, parent_tool_use_id: null });
    c.line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "subtracts; fixing it.\n" } }, parent_tool_use_id: null });
    c.line({ type: "assistant", message: { id: "msg_a", content: [{ type: "text", text: "The addition subtracts; fixing it.\n" }] }, parent_tool_use_id: null });
    c.line({ type: "assistant", message: { id: "msg_a", content: [{ type: "tool_use", id: "toolu_e", name: "Edit", input: { file_path: join(call.cwd, "sum.mjs"), old_string: "a - b", new_string: "a + b" } }] }, parent_tool_use_id: null });
    writeFileSync(join(call.cwd, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
    c.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_e", content: "The file sum.mjs has been updated." }] }, parent_tool_use_id: null, tool_use_result: {} });
    c.line({ type: "assistant", message: { id: "msg_b", content: [{ type: "tool_use", id: "toolu_t", name: "Bash", input: { command: "node --test" } }] }, parent_tool_use_id: null });
    c.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_t", content: "✔ adds (0.5ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0" }] }, parent_tool_use_id: null, tool_use_result: { interrupted: false } });
    c.line({ type: "result", subtype: "success", is_error: false, result: "Fixed sum.mjs; the test passes.", total_cost_usd: 0.05, num_turns: 3, duration_ms: 4000, permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_p", tool_input: { command: "git push" } }] });
    c.exit(0);
  });
}

// A run that keeps working until it is signalled.
function longRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", cwd: call.cwd, session_id: after1(call.args, "--resume") ?? after1(call.args, "--session-id"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [{ name: "orbit", version: "0.6.0" }] });
    c.line({ type: "assistant", message: { id: "msg_l", content: [{ type: "tool_use", id: "toolu_l", name: "Bash", input: { command: "sleep 600" } }] }, parent_tool_use_id: null });
  });
  c.onSignal((s) => {
    if (s === "SIGINT") c.exit(null, "SIGINT");
  });
}

describe("a chat, end to end through the API", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let session: SessionSummary;

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(claudeRun, { spawn: fixingRun });
    h = await startHarness({ fake, env: { GH_TOKEN: "gho_000000000000000000000000000000000000", ANTHROPIC_API_KEY: "sk-ant-api03-never-reaches-claude-code-00000000", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-never-reaches-claude-code-00000000" } });
  });
  after(() => h.close());

  test("repositories and branches come from gh, and only a listed repository opens", async () => {
    const list = (await h.get("/api/repositories")).body as { repositories: { fullName: string }[] };
    assert.deepEqual(list.repositories.map((r) => r.fullName), ["octo/sum-fixture", "acme/tools"]);
    const branches = (await h.get(`/api/repositories/${REPOSITORY}/branches`)).body as { branches: { name: string; isDefault: boolean }[] };
    assert.deepEqual(branches.branches.map((b) => [b.name, b.isDefault]), [["main", true], ["dev", false]]);
    assert.equal((await h.get("/api/repositories/someone/else/branches")).status, 403);
    assert.equal((await h.send("POST", "/api/sessions", { repository: "someone/else", branch: "main", model: "sonnet" })).status, 403);
    assert.equal((await h.send("POST", "/api/sessions", { repository: REPOSITORY, branch: "nope", model: "sonnet" })).status, 400);
  });

  test("a new chat prepares its workspace, sends the first prompt, and streams the real run's events in order", async () => {
    const created = await h.send("POST", "/api/sessions", { repository: REPOSITORY, branch: "main", model: "sonnet", prompt: "Fix the incorrect addition in sum.mjs so the existing test passes. Do not modify the test." });
    assert.equal(created.status, 201);
    session = created.body as SessionSummary;
    assert.equal(session.status, "preparing");
    const { frames, events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "session.status" && (e.data as { status: string }).status === "completed") });
    const types = events.map((e) => e.type);
    const order = ["workspace.preparing", "workspace.ready", "message.completed", "session.started", "message.started", "message.delta", "message.completed", "tool.started", "tool.completed", "tool.started", "tool.completed", "permission.denied", "session.completed"];
    let at = -1;
    for (const t of order) {
      const next = types.indexOf(t, at + 1);
      assert.ok(next > at, `${t} after position ${at} in ${types.join(",")}`);
      at = next;
    }
    const durable = frames.filter((f) => f.data.seq !== null);
    assert.deepEqual(durable.map((f) => Number(f.id)), durable.map((f) => f.data.seq), "each durable event carries its seq as the SSE id");
    assert.deepEqual(durable.map((f) => f.data.seq), durable.map((_, i) => i + 1), "sequence numbers have no gaps");
    assert.ok(frames.filter((f) => f.data.type === "message.delta").every((f) => f.id === null), "a delta is transient: no SSE id");
    const started = events.find((e) => e.type === "session.started")?.data as { orbitLoaded: boolean; claudeCodeVersion: string };
    assert.equal(started.orbitLoaded, true);
    assert.equal(started.claudeCodeVersion, "2.1.328");
  });

  test("Claude Code ran headless in the workspace, with the Orbit plugin, the prompt on stdin, as the signed-in Claude account and with no other credential", () => {
    const { call, child } = fake.children.find((c) => claudeRun(c.call.file, c.call.args)) as { call: Call; child: FakeChild };
    const detail = call.args;
    assert.equal(after1(detail, "--plugin-dir"), h.config.pluginDir);
    assert.equal(after1(detail, "--model"), "sonnet");
    assert.equal(after1(detail, "--permission-mode"), "dontAsk");
    assert.ok(after1(detail, "--session-id"));
    assert.equal(call.cwd, join(h.config.data.workspaces, session.id, "repository"));
    assert.equal(call.env.CLAUDE_CONFIG_DIR, h.config.data.claude);
    assert.equal(call.env.ORBIT_STORE_DIR, h.config.data.orbit);
    assert.deepEqual(Object.keys(call.env).filter((k) => /^(GH_|GITHUB_)/.test(k)), []);
    // The container's own Claude credential variables would take the place of the account signed in here.
    assert.deepEqual(Object.keys(call.env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_OAUTH)/.test(k)), []);
    assert.deepEqual(child.written, ["Fix the incorrect addition in sum.mjs so the existing test passes. Do not modify the test."]);
    assert.equal(child.inputClosed, true);
  });

  test("the session keeps its history and outcome; the workspace is on its own branch with a commit identity", async () => {
    const detail = (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail;
    assert.equal(detail.status, "completed");
    assert.equal(detail.turns, 1);
    assert.equal(detail.workBranch, `orbit-web/${session.id.slice(0, 8)}`);
    assert.deepEqual(detail.messages.map((m) => m.role), ["user", "assistant"]);
    const config = readFileSync(join(h.config.data.workspaces, session.id, "repository", ".git", "config"), "utf8");
    assert.match(config, /email = 42\+octo@users\.noreply\.github\.com/);
    assert.doesNotMatch(config, /helper|token|oauth/i, "no credential helper or token is written to the repository");
  });

  test("the changes come from git in the workspace: the file, the counts, and the diff", async () => {
    const report = (await h.get(`/api/sessions/${session.id}/changes`)).body as ChangesReport;
    assert.equal(report.baseBranch, "main");
    assert.equal(report.currentBranch, `orbit-web/${session.id.slice(0, 8)}`);
    assert.deepEqual(report.files.map((f) => [f.path, f.kind, f.additions, f.deletions]), [["sum.mjs", "modified", 1, 1]]);
    const diff = (await h.get(`/api/sessions/${session.id}/changes/file?path=sum.mjs`)).body as FileDiff;
    assert.match(diff.diff ?? "", /^-export const sum = \(a, b\) => a - b;$/m);
    assert.match(diff.diff ?? "", /^\+export const sum = \(a, b\) => a \+ b;$/m);
    assert.equal(diff.language, "javascript");
    assert.equal((await h.get(`/api/sessions/${session.id}/changes/file?path=../../../etc/passwd`)).status, 404);
    assert.equal((await h.get(`/api/sessions/${session.id}/changes/file?path=sum.test.mjs`)).status, 404, "an unchanged file is not readable through the diff route");
  });

  test("the Orbit panel is read from Orbit itself and gives no verdict Orbit did not give", async () => {
    const panel = (await h.get(`/api/sessions/${session.id}/verification`)).body as OrbitPanel;
    assert.equal(panel.state, "available");
    assert.equal(panel.verdict.word, "unknown");
  });

  test("a reconnect with Last-Event-ID gets only what came after it", async () => {
    const detail = (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail;
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { lastEventId: detail.lastSeq - 2, until: (es) => es.length >= 2, timeoutMs: 2000 });
    assert.deepEqual(events.map((e) => e.seq), [detail.lastSeq - 1, detail.lastSeq]);
  });

  test("the next message continues the same Claude conversation, with the model the session now prefers", async () => {
    const before = fake.children.length;
    assert.equal((await h.send("PATCH", `/api/sessions/${session.id}`, { model: "opus", title: "Fix sum" })).status, 200);
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Also explain the fix." })).status, 202);
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "completed");
    const call = fake.children.slice(before).find((c) => claudeRun(c.call.file, c.call.args))?.call as Call;
    const first = fake.children.find((c) => claudeRun(c.call.file, c.call.args))?.call as Call;
    assert.equal(after1(call.args, "--resume"), after1(first.args, "--session-id"));
    assert.equal(after1(call.args, "--model"), "opus");
    const detail = (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail;
    assert.equal(detail.title, "Fix sum");
    assert.equal(detail.turns, 2);
  });

  test("stop interrupts the run's process group; an interrupted run is never completed", async () => {
    fake.on(claudeRun, { spawn: longRun });
    await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Run something long." });
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "running");
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "again" })).status, 409, "one run per session");
    assert.equal((await h.send("DELETE", `/api/sessions/${session.id}`)).status, 409, "a running chat is not deleted");
    const signOut = await h.send("POST", "/api/claude/logout");
    assert.equal(signOut.status, 409, "the account is not signed out while Claude Code works for it");
    assert.equal((signOut.body as { error: { code: string } }).error.code, "run_active");
    assert.deepEqual(fake.callsOf(program("claude", "auth", "logout")), []);
    await eventually(() => fake.children.at(-1)?.child.written.length ?? 0, (n) => n > 0);
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/stop`)).status, 202);
    const detail = await eventually(async () => (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail, (d) => d.status === "interrupted");
    assert.equal(detail.statusReason, "user_stop");
    assert.deepEqual(fake.children.at(-1)?.child.signals, ["SIGINT"]);
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { lastEventId: detail.lastSeq - 6, until: (es) => es.some((e) => e.type === "session.interrupted"), timeoutMs: 2000 });
    assert.ok(events.some((e) => e.type === "tool.failed" && (e.data as { interrupted: boolean }).interrupted), "the open tool is closed as interrupted");
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/stop`)).status, 409);
  });

  test("delete removes the chat and its workspace", async () => {
    const workspace = join(h.config.data.workspaces, session.id);
    assert.equal(existsSync(workspace), true);
    assert.equal((await h.send("DELETE", `/api/sessions/${session.id}`)).status, 204);
    assert.equal(existsSync(workspace), false);
    assert.equal((await h.get(`/api/sessions/${session.id}`)).status, 404);
  });
});
