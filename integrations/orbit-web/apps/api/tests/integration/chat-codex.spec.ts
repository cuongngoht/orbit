// A CHAT ON OPENAI CODEX, through the real API: a chat names the account's Codex connection, its model is one of that
// connection's own catalog, and its codex (a stand-in speaking `exec --json`) runs in the chat's workspace, in that
// connection's home, with the message on stdin; its events become the chat's, and the next message resumes its thread.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { RuntimeConnection, SessionSummary } from "@orbit-web/contracts";
import { fakeCodexControl } from "../../src/testing/fake-codex.js";
import { program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { startHarness, type Harness } from "../../src/testing/harness.js";

// A chat's codex run (never the control plane's observation, `exec --json …` with Orbit's stand-in provider).
const isChatRun = (file: string, args: string[]): boolean => program("codex", "exec")(file, args) && !args.some((a) => a.startsWith("model_providers.orbit_observation"));

// What `codex exec --json` prints for one message: its thread, its answer, the turn's end.
function chatRun(c: FakeChild): void {
  c.onSignal((s) => c.exit(null, s));
  c.onInputClosed(() => {
    c.line({ type: "thread.started", thread_id: "th_chat" });
    c.line({ type: "turn.started" });
    c.line({ type: "item.started", item: { id: "cmd_1", type: "command_execution", command: "ls", aggregated_output: "", exit_code: null, status: "in_progress" } });
    c.line({ type: "item.completed", item: { id: "cmd_1", type: "command_execution", command: "ls", aggregated_output: "README.md\n", exit_code: 0, status: "completed" } });
    c.line({ type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Hello from Codex." } });
    c.line({ type: "turn.completed", usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 4 } });
    c.exit(0);
  });
}

describe("a chat on OpenAI Codex", () => {
  let h: Harness;
  let codex: RuntimeConnection;
  let session: SessionSummary;

  before(async () => {
    h = await startHarness();
    fakeCodexControl(h.fake);
    // Codex's own sandbox runs on this host (`codex sandbox -- true` succeeds).
    h.fake.on(program("codex", "sandbox"), { run: { code: 0 } });
    h.fake.on(isChatRun, { spawn: chatRun });
    const made = await h.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    codex = made.body as RuntimeConnection;
  });
  after(() => h.close());

  test("a chat names its connection: Codex, with a model of that connection's own catalog -- another is refused", async () => {
    assert.equal((await h.send("POST", "/api/sessions", { repository: null, connectionId: codex.id, model: "sonnet" })).status, 400, "Claude's model is not this connection's");
    assert.equal((await h.send("POST", "/api/sessions", { repository: null, connectionId: "00000000-0000-4000-8000-000000000000", model: "gpt-6.1-sol" })).status, 404, "a connection of nobody's");
    const created = await h.send("POST", "/api/sessions", { repository: null, connectionId: codex.id, model: "gpt-6.1-sol", prompt: "Say hello." });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    session = created.body as SessionSummary;
    assert.deepEqual([session.runtime, session.connectionId, session.model], ["codex", codex.id, "gpt-6.1-sol"]);
  });

  test("its codex runs in the chat's workspace, in that connection's home, with the message on stdin; its events are the chat's", async () => {
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "session.status" && (e.data as { status: string }).status === "completed") });
    const answer = events.find((e) => e.type === "message.completed" && (e.data as { role: string }).role === "assistant")?.data as { text: string };
    assert.equal(answer.text, "Hello from Codex.");
    assert.ok(events.some((e) => e.type === "tool.completed"), "its command is a tool of the chat");
    const started = events.find((e) => e.type === "session.started")?.data as { claudeSessionId: string; requestedModel: string };
    assert.deepEqual([started.claudeSessionId, started.requestedModel], ["th_chat", "gpt-6.1-sol"]);
    const run = h.fake.children.find((c) => isChatRun(c.call.file, c.call.args)) as { call: Call; child: FakeChild };
    assert.equal(run.call.args[0], "exec");
    assert.equal(run.call.args.includes("--sandbox"), false, "confined by its profile alone: an explicit sandbox mode would take its place");
    assert.equal(run.call.args[run.call.args.indexOf("--model") + 1], "gpt-6.1-sol");
    assert.equal(run.call.env.CODEX_HOME, join(h.config.data.connections, h.accountId as string, codex.id, "codex"));
    assert.equal(run.call.cwd, join(h.config.data.workspaces, session.id, "repository"));
    assert.deepEqual(run.child.written, ["Say hello."]);
    assert.deepEqual(Object.keys(run.call.env).filter((k) => /^(ANTHROPIC_|CLAUDE_)/.test(k)), [], "nothing of Claude's reaches Codex");
    // Its commands are confined: nothing of Orbit Web's data -- no account's sign-ins, keys or workspaces -- but the chat's own room.
    const profile = run.call.args.find((a) => a.startsWith("permissions=")) ?? "";
    assert.ok(profile.includes(`${JSON.stringify(h.config.data.root)}="none"`), profile);
    assert.ok(profile.includes(`${JSON.stringify(join(h.config.data.workspaces, session.id))}="write"`), profile);
    assert.ok(run.call.args.includes('default_permissions="orbit_chat"'));
  });

  test("the next message resumes the thread Codex named", async () => {
    const sent = await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "And again." });
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.filter((e) => e.type === "session.status" && (e.data as { status: string }).status === "completed").length >= 2 });
    const second = h.fake.children.filter((c) => isChatRun(c.call.file, c.call.args)).at(-1) as { call: Call };
    assert.deepEqual(second.call.args.slice(0, 2), ["exec", "resume"]);
    assert.deepEqual(second.call.args.slice(-2), ["th_chat", "-"]);
  });
});

describe("a chat on OpenAI Codex where its sandbox cannot run here", () => {
  let h: Harness;
  let codex: RuntimeConnection;

  before(async () => {
    h = await startHarness();
    fakeCodexControl(h.fake);
    h.fake.on(program("codex", "sandbox"), { run: { code: 1, stderr: "bwrap: No permissions to create a new namespace" } });
    h.fake.on(isChatRun, { spawn: chatRun });
    codex = (await h.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" })).body as RuntimeConnection;
  });
  after(() => h.close());

  test("it still answers, its commands cannot run at all -- and the chat is told so", async () => {
    const created = (await h.send("POST", "/api/sessions", { repository: null, connectionId: codex.id, model: "gpt-6.1-sol", prompt: "Say hello." })).body as SessionSummary;
    const { events } = await h.events(`/api/sessions/${created.id}/events`, { until: (es) => es.some((e) => e.type === "session.status" && (e.data as { status: string }).status === "completed") });
    const notice = events.find((e) => e.type === "run.notice" && /sandbox/.test((e.data as { message: string }).message))?.data as { message: string } | undefined;
    assert.match(notice?.message ?? "", /OpenAI Codex's sandbox cannot start on this server: its commands cannot run here/);
    const run = h.fake.children.find((c) => isChatRun(c.call.file, c.call.args)) as { call: Call };
    assert.equal(run.call.args.some((a) => a.startsWith("permissions=")), false, "no profile it could not start with");
    assert.deepEqual(run.call.args.slice(0, 3), ["exec", "--sandbox", "read-only"], "unconfined, it runs nothing");
    const off = run.call.args.flatMap((a, i) => (a === "--disable" ? [run.call.args[i + 1]] : []));
    assert.ok(off.includes("shell_tool") && off.includes("unified_exec"), "no shell");
  });
});

describe("a chat on OpenAI Codex where a spending cap is set", () => {
  let h: Harness;
  let codex: RuntimeConnection;

  before(async () => {
    h = await startHarness({ env: { ORBIT_WEB_MAX_BUDGET_USD: "5" } });
    fakeCodexControl(h.fake);
    h.fake.on(program("codex", "sandbox"), { run: { code: 0 } });
    h.fake.on(isChatRun, { spawn: chatRun });
    codex = (await h.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" })).body as RuntimeConnection;
  });
  after(() => h.close());

  test("a cap Codex cannot be held to refuses its run, saying so -- nothing is started", async () => {
    const created = (await h.send("POST", "/api/sessions", { repository: null, connectionId: codex.id, model: "gpt-6.1-sol", prompt: "Say hello." })).body as SessionSummary;
    const { events } = await h.events(`/api/sessions/${created.id}/events`, { until: (es) => es.some((e) => e.type === "session.status" && (e.data as { status: string }).status === "failed") });
    const failed = events.find((e) => e.type === "session.failed")?.data as { message: string };
    assert.match(failed.message, /spending cap.*OpenAI Codex cannot be held to it/);
    assert.equal(h.fake.children.filter((c) => isChatRun(c.call.file, c.call.args)).length, 0);
  });
});
