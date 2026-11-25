// THE CLAUDE CONNECTORS a run may use: the account's own (its Claude Code connection's CLI's `mcp_status`, asked over the
// control protocol in that connection's home), each with where it may be used -- a chat, research -- as that account's
// person checked it. A chat is denied
// what is unchecked for chats; research (a conversation like a chat, its sources references) may use what is checked for
// research, by name, and is stopped the moment it reaches for anything else; a question needs no source to be asked.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ConnectorList, ResearchSessionDetail, ResearchWorkspaceSummary, SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeConnectorsProbe, claudeRun, connectorsProbe, eventually, homeOf, researchRun, signedIn, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";
import { answered, newWorkspace } from "../../src/testing/research-client.js";

const SERVERS = [
  { name: "claude.ai Claude Docs", status: "connected", tools: Array.from({ length: 8 }, () => ({})) },
  { name: "claude.ai Gmail", status: "connected", tools: [{}, {}] },
  { name: "plugin:design:figma", status: "needs-auth" },
];

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
// The values a variadic flag took: everything up to the next flag.
const valuesOf = (args: string[], flag: string): string[] => {
  const at = args.indexOf(flag);
  if (at === -1) return [];
  const rest = args.slice(at + 1);
  const end = rest.findIndex((a) => a.startsWith("--"));
  return end === -1 ? rest : rest.slice(0, end);
};

function quickChat(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0, num_turns: 1, duration_ms: 1 });
    c.exit(0);
  });
}

// A research run that calls `tool` and then answers: what a connector call looks like on the CLI's stream.
function researchUsing(tool: string, answer: string) {
  return (c: FakeChild) => {
    c.onSignal(() => c.exit(null, "SIGKILL"));
    c.onInputClosed(() => {
      c.line({ type: "system", subtype: "init", session_id: "r", tools: ["mcp__claude_ai_Claude_Docs__batch", "mcp__claude_ai_Gmail__send"], mcp_servers: [{ name: "claude.ai Claude Docs", status: "connected" }], model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [] });
      c.line({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: tool, input: { container: { kind: "project" } } }] }, parent_tool_use_id: null });
      c.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "created" }] }, parent_tool_use_id: null, tool_use_result: {} });
      c.line({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: answer }] }, parent_tool_use_id: null });
      c.line({ type: "result", subtype: "success", is_error: false, result: answer, total_cost_usd: 0.001, num_turns: 2, duration_ms: 900 });
      c.exit(0);
    });
  };
}

describe("the Claude connectors a run may use", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  // Alice's browser; Bob is another account, signed in at the same time.
  let me: Browser;
  const connectors = async (): Promise<ConnectorList> => (await me.get("/api/claude/connectors")).body as ConnectorList;

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()))
      .on(claudeConnectorsProbe, { spawn: connectorsProbe(() => SERVERS) })
      .on(claudeRun, { spawn: quickChat });
    h = await startHarness({ fake, user: "alice" });
    me = h.owner as Browser;
  });
  after(() => h.close());

  test("the account's own connectors are listed -- asked of its CLI, no model called -- each for chats and research until a person unchecks it", async () => {
    const list = (await me.send("POST", "/api/claude/connectors/refresh")).body as ConnectorList;
    assert.equal(list.source, "account");
    assert.deepEqual(
      list.connectors.map((c) => [c.label, c.kind, c.status, c.tools, c.chat, c.research]),
      [
        ["Claude Docs", "claude.ai", "connected", 8, true, true],
        ["Gmail", "claude.ai", "connected", 2, true, true],
        ["design · figma", "plugin", "needs-auth", null, true, true],
      ],
    );
    const probe = fake.calls.filter((c) => claudeConnectorsProbe(c.file, c.args)).at(-1);
    assert.ok(probe);
    assert.equal(after1(probe.args, "--tools"), "");
    assert.equal(after1(probe.args, "--permission-mode"), "dontAsk");
    assert.equal(homeOf(probe.env.CLAUDE_CONFIG_DIR)?.accountId, h.accountId, "asked in the account's own connection home");
  });

  test("a person's choices are kept for their own account alone", async () => {
    const r = await me.send("PUT", "/api/claude/connectors", { connectors: { "claude.ai Gmail": { chat: false, research: false } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const gmail = (r.body as ConnectorList).connectors.find((c) => c.label === "Gmail");
    assert.deepEqual([gmail?.chat, gmail?.research], [false, false]);
    assert.equal((await me.send("PUT", "/api/claude/connectors", { connectors: { "claude.ai Gmail": { write: true } } })).status, 400);
    const bob = await h.as("bob");
    const bobs = (await bob.send("POST", "/api/claude/connectors/refresh")).body as ConnectorList;
    assert.deepEqual(bobs.connectors.find((c) => c.label === "Gmail")?.chat, true, "Bob's choices are his own");
    assert.equal((await connectors()).connectors.find((c) => c.label === "Gmail")?.chat, false);
  });

  test("a chat is denied, by name, the connectors unchecked for chats", async () => {
    const before = fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).length;
    const made = (await me.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", prompt: "Say hello." })).body as SessionSummary;
    await eventually(() => fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).length, (n) => n > before);
    await eventually(async () => ((await me.get(`/api/sessions/${made.id}`)).body as SessionDetail).status, (s) => s === "completed");
    const run = fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).at(-1)?.call as Call;
    const denied = valuesOf(run.args, "--disallowedTools");
    assert.ok(denied.includes("mcp__claude_ai_Gmail"));
    assert.equal(denied.includes("mcp__claude_ai_Claude_Docs"), false);
  });

  test("research may use the connectors checked for research -- a doc made, its link in the answer -- with no source selected at all", async () => {
    const workspace: ResearchWorkspaceSummary = await newWorkspace(me, "No sources yet");
    const session = (await me.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet" })).body as ResearchSessionDetail;
    fake.on(researchRun, { spawn: researchUsing("mcp__claude_ai_Claude_Docs__batch", "I made the doc: https://claude.ai/artifact/AbC123") });
    const asked = await me.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "Make a Claude Doc of what AI governance is." });
    assert.equal(asked.status, 202, "a question needs no source: the sources are references");
    const done = await answered(me, session.id);
    assert.equal(done.status, "completed", done.statusReason ?? "");
    assert.match(done.messages.at(-1)?.text ?? "", /https:\/\/claude\.ai\/artifact\/AbC123/);
    const run = fake.children.filter((c) => researchRun(c.call.file, c.call.args)).at(-1)?.call as Call;
    assert.equal(after1(run.args, "--setting-sources"), "user");
    assert.deepEqual(valuesOf(run.args, "--allowedTools"), ["mcp__claude_ai_Claude_Docs", "mcp__plugin_design_figma"]);
    assert.deepEqual(valuesOf(run.args, "--disallowedTools"), ["mcp__claude_ai_Gmail"]);
    assert.equal(run.args.includes("--restricted"), false);
    assert.equal(run.env.ENABLE_CLAUDEAI_MCP_SERVERS, undefined);
    const notices = (await h.sql("SELECT data::text AS data FROM research_events WHERE session_id = $1 AND type = 'research.run.notice'", [session.id])).map((r) => String(r.data));
    assert.ok(notices.some((n) => n.includes("Using Claude Docs")), notices.join("\n"));

    fake.on(researchRun, { spawn: researchUsing("mcp__claude_ai_Gmail__send", "Sent.") });
    await me.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "Now email it to everyone." });
    const refused = await answered(me, session.id);
    assert.equal(refused.status, "failed");
    assert.match(refused.statusReason ?? "", /tried to use a tool research may not use \(mcp__claude_ai_Gmail__send/);
  });
});
