// A CHAT'S OR A RESEARCH SESSION'S RUN IN A SANDBOX OF ITS OWN, through the real API: each run asks for its sandbox --
// its own chat's places, its own connection, nothing else -- before its CLI starts; the CLI starts there, told how to
// reach Orbit Web from it, with its own account's Orbit store; and the sandbox is given back when the run ends, however
// it ends. With every sandbox in use a run waits and says so; one whose sandbox cannot be made never starts, and says
// why. (The sandbox itself -- the container, its mounts -- is the allocator's: its own tests and the real-Docker lab.)
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { RuntimeConnection, SessionSummary } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { SESSION_SANDBOXES } from "../../src/modules/session-sandbox/session-sandboxes.js";
import { fakeCodexControl } from "../../src/testing/fake-codex.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { FakeSessionSandboxes } from "../../src/testing/fake-session-sandboxes.js";
import { claudeRun, eventually, researchRun, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";
import { answered, newWorkspace, settledSource } from "../../src/testing/research-client.js";
import { researchAnswer } from "../../src/testing/research-fixtures.js";

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const init = (call: Call) => ({ type: "system", subtype: "init", cwd: call.cwd, session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), model: "claude-haiku-5-5", permissionMode: after1(call.args, "--permission-mode"), claude_code_version: "2.1.328", plugins: [] });
const result = (text: string) => ({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.01, num_turns: 1, duration_ms: 900, permission_denials: [] });

// Claude answers and ends.
function quickRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line(init(call));
    c.line(result("Done."));
    c.exit(0);
  });
}

// Claude works until it is let go (or signalled).
const held: FakeChild[] = [];
function heldRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line(init(call));
    held.push(c);
  });
  c.onSignal((s) => c.exit(null, s));
}

// What `codex exec --json` prints for one message.
function codexRun(c: FakeChild): void {
  c.onSignal((s) => c.exit(null, s));
  c.onInputClosed(() => {
    c.line({ type: "thread.started", thread_id: "th_box" });
    c.line({ type: "turn.started" });
    c.line({ type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Hello from the sandbox." } });
    c.line({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
    c.exit(0);
  });
}
const isCodexChatRun = (file: string, args: string[]): boolean => program("codex", "exec")(file, args) && !args.some((a) => a.startsWith("model_providers.orbit_observation"));

const statusOf = async (h: Harness, id: string): Promise<string> => ((await h.get(`/api/sessions/${id}`)).body as { status: string }).status;
const ended = (h: Harness, id: string) => eventually(() => statusOf(h, id), (s) => s === "completed" || s === "failed" || s === "interrupted");

describe("a chat's run in a sandbox of its own", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let sandboxes: FakeSessionSandboxes;
  let codex: RuntimeConnection;

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(claudeRun, { spawn: quickRun });
    sandboxes = new FakeSessionSandboxes(fake);
    h = await startHarness({ fake, overrides: [[SESSION_SANDBOXES, sandboxes]] });
    fakeCodexControl(h.fake);
    fake.on(isCodexChatRun, { spawn: codexRun });
    codex = (await h.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" })).body as RuntimeConnection;
  });
  after(() => h.close());

  test("its sandbox holds its own chat and connection; the CLI runs there, told Orbit Web's name and its own account's Orbit store; the sandbox is given back", async () => {
    const session = (await h.send("POST", "/api/sessions", { model: "haiku", prompt: "Say done." })).body as SessionSummary;
    assert.equal(await ended(h, session.id), "completed");
    const asked = sandboxes.acquired.find((s) => s.sessionId === session.id);
    assert.ok(asked, "the run asked for a sandbox");
    assert.deepEqual({ ...asked, runId: "-", connectionId: "-" }, { accountId: h.accountId, sessionId: session.id, connectionId: "-", runId: "-", kind: "chat", workspace: "rw", switches: { github: false, azure: false } });
    const call = fake.children.find((c) => claudeRun(c.call.file, c.call.args) && c.call.cwd.includes(session.id))?.call as Call;
    assert.equal(call.env.ORBIT_AGENT_GATEWAY, `http://orbit-web:${h.config.port}/api/agent`, "the gateway by the name Orbit Web has on the run's network");
    assert.equal(call.env.ORBIT_STORE_DIR, join(h.config.data.orbit, "accounts", h.accountId as string), "its own account's Orbit store");
    assert.ok(sandboxes.spawned.some((s) => s.runId === asked.runId && s.file === h.config.binaries.claude), "Claude Code started through its sandbox");
    await eventually(async () => sandboxes.released, (r) => r.includes(asked.runId));
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "session.completed") });
    assert.equal((events.find((e) => e.type === "session.started")?.data as { sandboxed?: boolean }).sandboxed, true, "the run says it had a sandbox of its own");
  });

  test("on OpenAI Codex its commands run, held by the sandbox -- and a Plan run reads its workspace and writes nothing there", async () => {
    const session = (await h.send("POST", "/api/sessions", { repository: null, connectionId: codex.id, model: "gpt-6.1-sol", mode: "plan", prompt: "Look around." })).body as SessionSummary;
    assert.equal(await ended(h, session.id), "completed");
    assert.equal(sandboxes.acquired.find((s) => s.sessionId === session.id)?.workspace, "ro");
    const run = fake.children.find((c) => isCodexChatRun(c.call.file, c.call.args) && c.call.cwd.includes(session.id))?.call as Call;
    assert.deepEqual(run.args.slice(0, 3), ["exec", "--sandbox", "danger-full-access"], "the sandbox holds it: Codex's own is not needed");
    assert.ok(sandboxes.spawned.some((s) => s.file === h.config.binaries.codex && s.args[0] === "exec"), "Codex started through its sandbox");
    assert.equal(run.args.some((a) => a.startsWith("permissions=")), false);
    const off = run.args.flatMap((a, i) => (a === "--disable" ? [run.args[i + 1]] : []));
    assert.equal(off.includes("shell_tool"), false, "its commands run");
    assert.deepEqual(fake.callsOf(program("codex", "sandbox")), [], "nobody asks whether Codex's own sandbox starts");
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "session.completed") });
    assert.equal(events.some((e) => e.type === "run.notice" && /sandbox cannot start/.test((e.data as { message: string }).message)), false);
  });

  test("with every sandbox in use a run waits, and says so; it starts when one is given back", async () => {
    const one = new FakeSessionSandboxes(fake, 1);
    const h2 = await startHarness({ fake, overrides: [[SESSION_SANDBOXES, one]] });
    try {
      fake.on(claudeRun, { spawn: heldRun });
      const first = (await h2.send("POST", "/api/sessions", { model: "haiku", prompt: "Work long." })).body as SessionSummary;
      await eventually(async () => held.length, (n) => n === 1);
      fake.on(claudeRun, { spawn: quickRun });
      const second = (await h2.send("POST", "/api/sessions", { model: "haiku", prompt: "Then me." })).body as SessionSummary;
      const { events } = await h2.events(`/api/sessions/${second.id}/events`, { until: (es) => es.some((e) => e.type === "run.notice") });
      assert.match((events.find((e) => e.type === "run.notice")?.data as { message: string }).message, /Waiting for a sandbox/);
      assert.equal(one.acquired.some((s) => s.sessionId === second.id), false, "it has none yet");
      const first1 = held.shift() as FakeChild;
      first1.line(result("Done long."));
      first1.exit(0);
      assert.equal(await ended(h2, second.id), "completed");
      assert.equal(await ended(h2, first.id), "completed");
    } finally {
      await h2.close();
    }
  });

  test("a run whose sandbox cannot be made never starts, and says why", async () => {
    sandboxes.refuse = "the allocator could not be reached";
    try {
      const before = fake.children.length;
      const session = (await h.send("POST", "/api/sessions", { model: "haiku", prompt: "Say done." })).body as SessionSummary;
      assert.equal(await ended(h, session.id), "failed");
      const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "session.failed") });
      assert.match((events.find((e) => e.type === "session.failed")?.data as { message: string }).message, /the allocator could not be reached/);
      assert.equal(fake.children.slice(before).some((c) => claudeRun(c.call.file, c.call.args)), false, "no CLI started");
    } finally {
      sandboxes.refuse = null;
    }
  });
});

describe("a research run in a sandbox of its own", () => {
  let h: Harness;
  let sandboxes: FakeSessionSandboxes;

  before(async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(researchRun, { spawn: researchAnswer(() => "Isolated [S1].") });
    sandboxes = new FakeSessionSandboxes(fake);
    h = await startHarness({ fake, overrides: [[SESSION_SANDBOXES, sandboxes]] });
  });
  after(() => h.close());

  test("its sandbox holds its connection's home alone -- no workspace, no sign-in -- and is given back when it is answered", async () => {
    const workspace = await newWorkspace(h, "Sandbox");
    const made = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/text`, { title: "notes", text: "Runs are isolated." });
    await settledSource(h, (made.body as { id: string }).id);
    const session = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet" })).body as { id: string };
    await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "Are runs isolated?" });
    await answered(h, session.id);
    const asked = sandboxes.acquired.find((s) => s.sessionId === session.id);
    assert.deepEqual([asked?.kind, asked?.workspace, asked?.switches], ["research", "none", { github: false, azure: false }]);
    assert.ok(sandboxes.spawned.some((s) => s.runId === asked?.runId && s.args.includes("--no-session-persistence")), "the research run started through its sandbox");
    await eventually(async () => sandboxes.released, (r) => r.includes(asked?.runId as string));
  });
});
