// A STOP BEFORE CLAUDE CODE STARTS. A chat or a research session reads as running from the moment its message is
// accepted -- before the account's policy has decided the run, and before any process exists -- so Stop can come in
// that moment. It is honoured: the run ends interrupted, never completed, and Claude Code is never started for it. A
// Stop when nothing runs is still refused.
//
// The moment is held open on purpose: deciding a run records the decision on the account's audit chain, so a test that
// holds the chain's head row keeps the run there -- accepted, still being decided -- until it lets go.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import type { ResearchSessionDetail, ResearchSourceSummary, SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeRun, eventually, researchRun, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";
import { newWorkspace, settledSource } from "../../src/testing/research-client.js";
import { researchAnswer } from "../../src/testing/research-fixtures.js";

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);

// A run that, if it were ever started, would go on until it is stopped.
function untilStopped(c: FakeChild, call: Call): void {
  c.onInputClosed(() => c.line({ type: "system", subtype: "init", cwd: call.cwd, session_id: after1(call.args, "--session-id"), claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] }));
  c.onSignal(() => c.exit(130, "SIGINT"));
}

// Holds the account's audit chain (its head row, FOR UPDATE) in a transaction of the test's own; the release lets go.
async function holdChain(url: string, accountId: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("BEGIN");
  const held = await client.query("SELECT id FROM governance.audit_chains WHERE id = $1 FOR UPDATE", [`account:${accountId}`]);
  assert.equal(held.rowCount, 1, "the account's chain is there to hold");
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await client.query("COMMIT");
    await client.end();
  };
}

describe("a Stop before Claude Code starts is honoured: the run is interrupted, and nothing is started", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: untilStopped }).on(researchRun, { spawn: researchAnswer(() => "never", { hang: true }) });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("a chat", async () => {
    const made = await h.send("POST", "/api/sessions", { model: "sonnet", mode: "plan" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const chat = made.body as SessionSummary;
    const detail = async () => (await h.get(`/api/sessions/${chat.id}`)).body as SessionDetail;
    await eventually(async () => (await detail()).status, (s) => s === "ready");
    const release = await holdChain(h.database.url, h.accountId as string);
    try {
      assert.equal((await h.send("POST", `/api/sessions/${chat.id}/messages`, { text: "Start." })).status, 202);
      assert.equal((await detail()).status, "running", "it reads as running from the moment its message was accepted");
      assert.equal((await h.send("POST", `/api/sessions/${chat.id}/stop`)).status, 202, "a Stop in that moment is taken");
    } finally {
      await release();
    }
    const ended = await eventually(detail, (d) => d.status !== "running");
    assert.equal(ended.status, "interrupted");
    assert.equal(fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).length, 0, "Claude Code was never started for it");
    const stopped = await h.send("POST", `/api/sessions/${chat.id}/stop`);
    assert.equal(stopped.status, 409, "nothing runs now: a Stop is refused");
    const { events } = await h.events(`/api/sessions/${chat.id}/events`, { until: (es) => es.some((e) => e.type === "session.interrupted"), timeoutMs: 3_000 });
    assert.deepEqual((events.find((e) => e.type === "session.interrupted") as { data: unknown }).data, { reason: "user_stop", exitCode: null, signal: null });
    const bindings = await h.sql("SELECT ended_at FROM governance.run_bindings WHERE resource_id = $1", [chat.id]);
    assert.ok(bindings.length === 1 && bindings[0]?.ended_at !== null, `the run's binding ended (${JSON.stringify(bindings)})`);
  });

  test("a research session", async () => {
    const workspace = await newWorkspace(h, "Stop early");
    const source = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/text`, { title: "Notes", text: "Some text to ask about." });
    await settledSource(h, (source.body as ResearchSourceSummary).id);
    const session = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet" })).body as ResearchSessionDetail;
    const detail = async () => (await h.get(`/api/research/sessions/${session.id}`)).body as ResearchSessionDetail;
    const release = await holdChain(h.database.url, h.accountId as string);
    try {
      const asked = await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "What does it say?" });
      assert.ok(asked.status >= 200 && asked.status < 300, JSON.stringify(asked.body));
      assert.equal((await detail()).status, "running", "it reads as running from the moment its question was accepted");
      assert.equal((await h.send("POST", `/api/research/sessions/${session.id}/stop`)).status, 202, "a Stop in that moment is taken");
    } finally {
      await release();
    }
    const ended = await eventually(detail, (d) => d.status !== "running");
    assert.deepEqual([ended.status, ended.lastRun?.status], ["interrupted", "interrupted"]);
    assert.equal(fake.children.filter((c) => researchRun(c.call.file, c.call.args)).length, 0, "Claude was never started for it");
    assert.equal((await h.send("POST", `/api/research/sessions/${session.id}/stop`)).status, 409, "nothing runs now: a Stop is refused");
  });
});
