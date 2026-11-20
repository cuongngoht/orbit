// A chat needs no repository: its workspace is an empty repository (one empty commit as the base every change is read
// against, a branch of its own, the Claude account's identity). The model, effort and mode a chat prefers reach Claude
// Code as its own flags; plan mode's proposal is shown as a plan; and every page hears of a chat's life on the app
// stream.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ChangesReport, SessionDetail, SessionSummary, Settings } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeRun, eventually, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const sessionIdIn = (call: Call) => after1(call.args, "--session-id") ?? after1(call.args, "--resume");
const init = (call: Call) => ({ type: "system", subtype: "init", cwd: call.cwd, session_id: sessionIdIn(call), model: "claude-haiku-5-5", permissionMode: after1(call.args, "--permission-mode"), claude_code_version: "2.1.328", plugins: [{ name: "orbit", version: "0.6.0" }] });
const result = (text: string, denials: unknown[] = []) => ({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.01, num_turns: 1, duration_ms: 900, permission_denials: denials });

// Claude writes a file, says so, and ends.
function writingRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line(init(call));
    writeFileSync(join(call.cwd, "hello.txt"), "hello\n");
    c.line({ type: "assistant", message: { id: "msg_w", content: [{ type: "text", text: "Wrote hello.txt." }] }, parent_tool_use_id: null });
    c.line(result("Wrote hello.txt."));
    c.exit(0);
  });
}

const PLAN = "## Plan\n1. Add a README that says what this is.\n2. Nothing else.";

// Plan mode: Claude proposes a plan with ExitPlanMode, which -p denies (no one to approve it), and ends.
function planningRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line(init(call));
    c.line({ type: "assistant", message: { id: "msg_p", content: [{ type: "tool_use", id: "toolu_plan", name: "ExitPlanMode", input: { plan: PLAN } }] }, parent_tool_use_id: null });
    c.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_plan", content: "Permission to use ExitPlanMode has been denied.", is_error: true }] }, parent_tool_use_id: null });
    c.line(result("Here is the plan.", [{ tool_name: "ExitPlanMode", tool_use_id: "toolu_plan", tool_input: { plan: PLAN } }]));
    c.exit(0);
  });
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();

describe("a chat with no repository", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let session: SessionSummary;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: writingRun });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("starts from nothing: an empty repository whose one empty commit is the base, a branch of its own, the Claude account's identity", async () => {
    const created = await h.send("POST", "/api/sessions", { model: "haiku", prompt: "Write hello.txt" });
    assert.equal(created.status, 201);
    session = created.body as SessionSummary;
    assert.deepEqual([session.source, session.repository, session.branch, session.model, session.effort, session.mode], [null, null, null, "haiku", "medium", "autonomous"]);
    assert.equal(session.title, "Write hello.txt");
    const detail = await eventually(async () => (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail, (d) => d.status === "completed");
    const workspace = join(h.config.data.workspaces, session.id, "repository");
    assert.equal(git(workspace, "log", "--format=%s"), "Orbit Web: the start of this workspace");
    assert.equal(git(workspace, "rev-parse", "HEAD"), detail.baseCommit);
    assert.equal(git(workspace, "branch", "--show-current"), `orbit-web/${session.id.slice(0, 8)}`);
    assert.equal(git(workspace, "config", "--local", "user.email"), "octo@example.com");
    assert.deepEqual(fake.callsOf(program("gh", "repo", "clone")), [], "nothing is cloned");
  });

  test("its steps are the workspace's own (init, not clone), and it is read and run like any chat", async () => {
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "session.completed") });
    const steps = events.filter((e) => e.type === "workspace.preparing").map((e) => (e.data as { step: string }).step);
    assert.deepEqual(steps, ["init", "branch", "identity", "orbit", "project"]);
    const ready = events.find((e) => e.type === "workspace.ready")?.data as { repository: string | null; branch: string | null };
    assert.deepEqual([ready.repository, ready.branch], [null, null]);
    const call = fake.children.find((c) => claudeRun(c.call.file, c.call.args))?.call as Call;
    assert.deepEqual([after1(call.args, "--model"), after1(call.args, "--effort"), after1(call.args, "--permission-mode")], ["haiku", "medium", "auto"]);
    const changes = (await h.get(`/api/sessions/${session.id}/changes`)).body as ChangesReport;
    assert.deepEqual([changes.repository, changes.baseBranch], [null, null]);
    assert.deepEqual(changes.files.map((f) => f.path), ["hello.txt"]);
    const detail = (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail;
    assert.deepEqual(detail.messages.map((m) => [m.role, m.text]), [["user", "Write hello.txt"], ["assistant", "Wrote hello.txt."]], "the transcript subscriber kept both");
  });

  test("Settings choose the effort and the mode a new chat starts with", async () => {
    const saved = await h.send("PATCH", "/api/settings", { defaultEffort: "high", defaultMode: "plan" });
    assert.deepEqual([(saved.body as Settings).defaultEffort, (saved.body as Settings).defaultMode], ["high", "plan"]);
    const created = (await h.send("POST", "/api/sessions", { model: "opus" })).body as SessionSummary;
    assert.deepEqual([created.effort, created.mode], ["high", "plan"]);
    const chosen = (await h.send("POST", "/api/sessions", { model: "opus", effort: "low", mode: "autonomous" })).body as SessionSummary;
    assert.deepEqual([chosen.effort, chosen.mode], ["low", "autonomous"], "a chat's own choice wins");
    await h.send("PATCH", "/api/settings", { defaultEffort: "medium", defaultMode: "autonomous" });
    for (const s of [created, chosen]) await eventually(async () => ((await h.get(`/api/sessions/${s.id}`)).body as SessionDetail).status, (status) => status === "ready");
  });

  test("plan mode proposes a plan, shown as one; switched to Autonomous, the same conversation carries it out", async () => {
    fake.on(claudeRun, { spawn: planningRun });
    assert.equal((await h.send("PATCH", `/api/sessions/${session.id}`, { mode: "plan" })).status, 200);
    const before = fake.children.length;
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Plan a README." })).status, 202);
    const { events } = await h.events(`/api/sessions/${session.id}/events`, { until: (es) => es.filter((e) => e.type === "session.completed").length >= 2 });
    const proposed = events.find((e) => e.type === "plan.proposed");
    assert.deepEqual(proposed?.data, { toolUseId: "toolu_plan", plan: PLAN, truncated: false });
    const planCall = fake.children.slice(before).find((c) => claudeRun(c.call.file, c.call.args))?.call as Call;
    assert.equal(after1(planCall.args, "--permission-mode"), "plan");
    fake.on(claudeRun, { spawn: writingRun });
    await h.send("PATCH", `/api/sessions/${session.id}`, { mode: "autonomous" });
    const next = fake.children.length;
    await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Carry out the plan above." });
    await eventually(async () => fake.children.slice(next).find((c) => claudeRun(c.call.file, c.call.args)), (c) => c !== undefined);
    const runCall = fake.children.slice(next).find((c) => claudeRun(c.call.file, c.call.args))?.call as Call;
    assert.equal(after1(runCall.args, "--permission-mode"), "auto");
    assert.equal(after1(runCall.args, "--resume"), after1(planCall.args, "--resume") ?? sessionIdIn(planCall), "the same conversation");
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "completed");
  });
});

describe("the app stream: every page hears of a chat's life", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ fake: signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: writingRun }) })));
  after(() => h.close());

  test("created, prepared, run, renamed and deleted -- each as the chat is now", async () => {
    const app = await h.stream("/api/events");
    const created = (await h.send("POST", "/api/sessions", { model: "sonnet", prompt: "Write hello.txt" })).body as SessionSummary;
    const summaries = () => app.events.filter((e) => e.type === "session.summary").map((e) => (e.data as { session: SessionSummary }).session);
    await app.until(() => summaries().some((s) => s.id === created.id && s.status === "completed"));
    const statuses = summaries().filter((s) => s.id === created.id).map((s) => s.status);
    assert.deepEqual(statuses, ["preparing", "ready", "running", "completed"]);
    for (const e of app.events) {
      assert.equal(e.stream, "app");
      assert.equal(e.sessionId, null);
      assert.equal(e.seq, null, "the app stream keeps nothing");
      assert.match(String(e.id), /^[0-9a-f-]{36}$/);
    }
    await h.send("PATCH", `/api/sessions/${created.id}`, { title: "Hello", effort: "max" });
    await app.until(() => summaries().some((s) => s.title === "Hello" && s.effort === "max"));
    assert.equal((await h.send("DELETE", `/api/sessions/${created.id}`)).status, 204);
    const removed = await app.until((es) => es.some((e) => e.type === "session.removed"));
    assert.deepEqual(removed.find((e) => e.type === "session.removed")?.data, { sessionId: created.id });
    assert.equal(app.events.some((e) => String(e.type).startsWith("message.") || String(e.type).startsWith("tool.")), false, "a chat's own events stay on its own stream");
    app.close();
  });
});
