// CEO CHAT, end to end through HTTP on PostgreSQL with scripted CLIs (ADR 0062). It does not exist before a company
// (no company: 409 office_not_set_up everywhere but its state); a company without a CEO shows Orbit's records and
// refuses a message; the CEO in office answers -- as itself (its appointment and revision), with no tool, on its own
// model, given the company's records -- through a conversation run, streamed and replayed; a message sent twice under one
// key is one; a proposal the CEO writes is inert until the owner gives it (the existing mission creation, the
// responsible the owner saw), linked to the conversation; a stop cuts an answer where it is; a CLI that tries a tool is
// stopped; another account sees nothing of it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { applyDelta, DEFAULT_PRESETS, type Department, type EmployeeDetail, type ExecutiveConversationDetail, type ExecutiveSent, type ExecutiveState, type MissionAccepted, type MissionDetail, type MissionTargetPreview, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { executiveAnswer, executiveRun } from "../../src/testing/executive-fixtures.js";
import { FakeProcessPort, program, type FakeChild } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee } from "../../src/testing/fake-sandbox.js";
import { eventually, signedIn, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
let n = 0;
const key = () => ({ "idempotency-key": `ceo-chat-${Date.now()}-${(n += 1)}` });

const PROPOSAL = '```orbit-mission\n{"title": "AI agent market", "goal": "Research the AI agent market and size it.", "deliverables": ["market.md"], "acceptanceCriteria": ["Three segments sized"], "deadline": null, "priority": 6}\n```';

describe("CEO Chat: company-aware, the actual CEO answers with no tool, a proposal becomes a mission only when the owner gives it", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  // What the CEO's CLI answers next, and whether it waits (a stop is tested on one that waits).
  let answer: (prompt: string) => string = () => "We are in good shape.";
  let gate: (() => Promise<void>) | undefined;
  let init: Record<string, unknown> | undefined;
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
  fake.on(executiveRun, { spawn: (c, call) => executiveAnswer((p) => answer(p), { ...(gate !== undefined ? { gate } : {}), ...(init !== undefined ? { init } : {}) })(c, call) });
  const ceoRuns = (): FakeChild[] => fake.children.filter((c) => executiveRun(c.call.file, c.call.args)).map((c) => c.child);

  const hire = async (name: string, departmentId: string | null): Promise<string> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title: name === "An" ? "Chief executive" : "Manager", duties: "Run the company.", instructions: "Be brief.", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[name] = (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
    return ids[name] as string;
  };
  const state = async (): Promise<ExecutiveState> => (await b.get("/api/executive")).body as ExecutiveState;
  const detail = async (id: string): Promise<ExecutiveConversationDetail> => (await b.get(`/api/executive/conversations/${id}`)).body as ExecutiveConversationDetail;
  const answered = (id: string, count: number) => eventually(() => detail(id), (d) => d.messages.filter((m) => m.role === "ceo").length >= count && d.turns.every((t) => !["queued", "waiting", "running"].includes(t.state)), 30_000);

  before(async () => {
    h = await startHarness({ fake, overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    // The CEO's own work (a mission it is given) just waits here: what is tested is its conversation.
    sandbox.cli.on(program("claude"), { spawn: scriptedEmployee(async () => undefined) });
  });

  after(async () => {
    await h?.close();
  });

  test("no company: CEO Chat does not exist -- its state says so, every other route is refused, nothing is created", async () => {
    const s = await state();
    assert.deepEqual([s.company, s.state, s.ceo, s.converse.code], [null, "no_company", null, "office_not_set_up"]);
    assert.equal(code(await b.send("POST", "/api/executive/conversations", { text: "Hello" }, key())), "office_not_set_up");
    assert.equal(code(await b.get("/api/executive/conversations")), "office_not_set_up");
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.offices"))[0]?.n), 0, "opening CEO Chat made no company");
  });

  test("a company without a CEO: a message is refused (no_ceo), Orbit's records still answer", async () => {
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Chat Co" })).status, 200);
    const s = await state();
    assert.deepEqual([s.company?.name, s.state, s.converse.code], ["Chat Co", "no_ceo", "no_ceo"]);
    assert.equal(code(await b.send("POST", "/api/executive/conversations", { text: "Hello" }, key())), "no_ceo");
    const report = await b.send("POST", "/api/executive/conversations", { report: "status" }, key());
    assert.equal(report.status, 201, JSON.stringify(report.body));
    const d = await detail((report.body as { conversationId: string }).conversationId);
    assert.deepEqual(d.messages.map((m) => [m.role, m.author.name, m.report?.kind]), [["system", "Orbit", "status"]]);
    assert.ok(d.messages[0]?.report?.facts.some((f) => f.label === "CEO" && f.value === "none appointed"));
  });

  test("the CEO in office answers, as itself, with no tool, given the company's records; streamed and replayed; one key is one message", async () => {
    const research = ((await b.send("POST", "/api/office/departments", { name: "Research" })).body as Department).id;
    await hire("An", null);
    await hire("Minh", research);
    for (const body of [{ role: "ceo", employeeId: ids.An }, { role: "manager", departmentId: research, employeeId: ids.Minh }]) assert.equal((await b.send("POST", "/api/office/appointments", { ...body, reason: "leadership" })).status, 201);
    const s = await state();
    assert.deepEqual([s.state, s.ceo?.name, s.converse.ok, s.assign.ok, s.ceo?.appointment.revision], ["available", "An", true, true, 1]);

    answer = () => "We are in good shape: Research is led by Minh.";
    const k = key();
    const sent = await b.send("POST", "/api/executive/conversations", { text: "How are we doing?" }, k);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const id = (sent.body as ExecutiveSent).conversationId;
    const again = await b.send("POST", "/api/executive/conversations", { text: "How are we doing?" }, k);
    assert.equal((again.body as ExecutiveSent).conversationId, id, "the same key is the same conversation");
    const d = await answered(id, 1);
    assert.deepEqual(d.messages.map((m) => [m.role, m.author.name]), [["owner", "Octo Cat"], ["ceo", "An"]]);
    const ceo = d.messages[1];
    assert.equal(ceo?.text, "We are in good shape: Research is led by Minh.");
    assert.deepEqual([ceo?.author.employeeId, ceo?.author.appointmentRevision, ceo?.author.current], [ids.An, 1, true]);
    assert.equal(d.turns.at(-1)?.state, "completed");
    assert.ok((d.turns.at(-1)?.records ?? []).some((l) => /Department Research: manager Minh/.test(l)), "the answer stood on the records");

    // What the CLI was given: no tool, the CEO's own model, a fixed system prompt; the records and the question fenced.
    const run = fake.children.filter((c) => executiveRun(c.call.file, c.call.args))[0];
    assert.ok(run !== undefined);
    const args = run.call.args;
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.ok(args.includes("--restricted") && args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
    assert.equal(args[args.indexOf("--model") + 1], connection.catalog.models[0]?.id);
    const prompt = run.child.written.join("");
    assert.match(prompt, /<records-[0-9a-f]{16}>[\s\S]*Department Research: manager Minh[\s\S]*<\/records-[0-9a-f]{16}>/);
    assert.match(prompt, /<owner-[0-9a-f]{16}>\nHow are we doing\?\n<\/owner-[0-9a-f]{16}>/);
    assert.match(prompt, /You are An, Chief executive, the CEO of Chat Co\./);

    // The stream: the message, the wait, the answer -- in order, replayed after a reconnect from where it stopped.
    const { events } = await b.events(`/api/executive/conversations/${id}/events`, { until: (es) => es.some((e) => e.type === "executive.response.completed") });
    assert.deepEqual(events.map((e) => e.type).filter((t) => t !== "executive.response.delta"), ["executive.message.created", "executive.turn.waiting", "executive.response.started", "executive.response.completed"]);
    const replay = await b.events(`/api/executive/conversations/${id}/events`, { lastEventId: 2, until: (es) => es.some((e) => e.type === "executive.response.completed") });
    assert.equal(replay.events[0]?.type, "executive.response.started", "replayed after the last event seen");
    // The conversation run was admitted and released like any run of the CEO.
    const runs = await h.sql("SELECT state, reserved_at, released_at FROM workforce.conversation_runs WHERE account_id = $1", [h.accountId as string]);
    assert.deepEqual(runs.map((r) => [r.state, r.reserved_at !== null, r.released_at !== null]), [["succeeded", true, true]]);
    assert.equal((await h.sql("SELECT running FROM workforce.budgets WHERE account_id = $1", [h.accountId as string]))[0]?.running, 0);
    // A message sent twice under one key is one message.
    const k2 = key();
    const one = await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "And next quarter?" }, k2);
    const two = await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "And next quarter?" }, k2);
    assert.deepEqual([one.status, (two.body as ExecutiveSent).message.id], [202, (one.body as ExecutiveSent).message.id]);
    const after2 = await answered(id, 2);
    assert.equal(after2.messages.filter((m) => m.role === "owner").length, 2);
  });

  test("a proposal is inert until the owner gives it: then it is the CEO's mission, held to who the owner saw, linked, replayed under its key", async () => {
    const id = ((await b.get("/api/executive/conversations")).body as { conversations: { id: string }[] }).conversations[0]?.id as string;
    answer = () => `I propose we size the AI agent market first.\n\n${PROPOSAL}`;
    assert.equal((await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "Research the AI agent market." }, key())).status, 202);
    const d = await answered(id, 3);
    const proposed = d.messages.at(-1);
    assert.equal(proposed?.text, "I propose we size the AI agent market first.", "the block is taken out of the words shown");
    assert.deepEqual([proposed?.proposal?.title, proposed?.proposal?.deliverables, proposed?.proposalState], ["AI agent market", [{ name: "market.md", required: true }], "open"]);
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.missions WHERE account_id = $1", [h.accountId as string]))[0]?.n), 0, "a proposal made no mission");

    const preview = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    const seen = { employeeId: preview.responsible?.employeeId, appointmentId: preview.responsible?.appointmentId, appointmentRevision: preview.responsible?.appointmentRevision };
    const stale = await b.send("POST", `/api/executive/conversations/${id}/missions`, { proposalMessageId: proposed?.id, mission: proposed?.proposal, expectedAssignee: { ...seen, appointmentRevision: 7 } }, key());
    assert.equal(code(stale), "target_changed");
    const k = key();
    const given = await b.send("POST", `/api/executive/conversations/${id}/missions`, { proposalMessageId: proposed?.id, mission: proposed?.proposal, expectedAssignee: seen }, k);
    assert.ok(given.status === 201 || given.status === 202, JSON.stringify(given.body));
    const missionId = (given.body as MissionAccepted).missionId;
    const replay = await b.send("POST", `/api/executive/conversations/${id}/missions`, { proposalMessageId: proposed?.id, mission: proposed?.proposal, expectedAssignee: seen }, k);
    assert.equal((replay.body as MissionAccepted).missionId, missionId, "replayed under its key");
    const after = await detail(id);
    assert.deepEqual(after.links.map((l) => [l.missionId, l.messageId]), [[missionId, proposed?.id]]);
    assert.deepEqual([after.messages.find((m) => m.id === proposed?.id)?.proposalState, after.messages.find((m) => m.id === proposed?.id)?.missionId], ["given", missionId]);
    const m = (await b.get(`/api/missions/${missionId}`)).body as MissionDetail;
    assert.deepEqual([m.target?.kind, m.assignments.find((a) => a.parentId === null)?.employeeId], ["ceo", ids.An]);
    assert.ok(m.timeline.some((t) => /Given to the CEO from CEO Chat/.test(t.summary)), JSON.stringify(m.timeline.map((t) => t.summary)));
    assert.equal(code(await b.send("POST", `/api/executive/conversations/${id}/proposals/${proposed?.id}/dismiss`, {})), "proposal_not_open");
  });

  test("a stop cuts an answer where it is; a CLI that tries a tool is stopped; another account sees nothing", async () => {
    const id = ((await b.get("/api/executive/conversations")).body as { conversations: { id: string }[] }).conversations[0]?.id as string;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    gate = () => held;
    answer = () => "First half of a long answer, then the second half.";
    const before = ceoRuns().length;
    const sent = (await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "Tell me everything." }, key())).body as ExecutiveSent;
    await eventually(async () => (await detail(id)).turns.find((t) => t.id === sent.turn.id)?.state, (s) => s === "running", 15_000);
    await eventually(() => ceoRuns().length, (x) => x > before, 15_000);
    const stopped = await b.send("POST", `/api/executive/conversations/${id}/turns/${sent.turn.id}/stop`, {});
    assert.equal(stopped.status, 202, JSON.stringify(stopped.body));
    const d = await eventually(() => detail(id), (x) => x.turns.find((t) => t.id === sent.turn.id)?.state === "interrupted", 15_000);
    const cut = d.messages.find((m) => m.turnId === sent.turn.id);
    const whole = "First half of a long answer, then the second half.";
    assert.deepEqual([cut?.partial, cut?.text], [true, whole.slice(0, Math.ceil(whole.length / 2)).trim()], "kept where it was cut");
    release();
    gate = undefined;

    init = { tools: ["Bash"] };
    const tooled = (await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "Run ls for me." }, key())).body as ExecutiveSent;
    const refused = await eventually(() => detail(id), (x) => ["failed", "completed"].includes(x.turns.find((t) => t.id === tooled.turn.id)?.state ?? ""), 15_000);
    const t = refused.turns.find((x) => x.id === tooled.turn.id);
    assert.deepEqual([t?.state, t?.code], ["failed", "tool_refused"]);
    init = undefined;

    const other = await h.as("someone-else");
    assert.equal((await other.get(`/api/executive/conversations/${id}`)).status, 409, "no company of its own: CEO Chat does not exist for it");
    assert.equal((await other.send("POST", "/api/office/setup", { name: "Other Co" })).status, 200);
    assert.equal((await other.get(`/api/executive/conversations/${id}`)).status, 404, "another account's conversation is not found");
    assert.equal((await other.send("POST", `/api/executive/conversations/${id}/messages`, { text: "hi" }, key())).status, 404);
  });

  test("deltas carry the answer as it is written; the completed message is the answer whole", async () => {
    const id = ((await b.get("/api/executive/conversations")).body as { conversations: { id: string }[] }).conversations[0]?.id as string;
    answer = () => "Margins hold at 22%.";
    const live = await b.stream(`/api/executive/conversations/${id}/events`);
    try {
      const sent = (await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "Margins?" }, key())).body as ExecutiveSent;
      const events = await live.until((es) => es.some((e) => e.type === "executive.response.completed" && (e.data as { turn: { id: string } }).turn.id === sent.turn.id), 15_000);
      const started = events.find((e) => e.type === "executive.response.started" && (e.data as { turn: { id: string } }).turn.id === sent.turn.id);
      const messageId = (started?.data as { messageId: string }).messageId;
      let text = "";
      for (const e of events.filter((x) => x.type === "executive.response.delta" && (x.data as { messageId: string }).messageId === messageId)) text = applyDelta(text, e.data as { messageId: string; offset: number; text: string });
      // Deltas are what was written so far (the mapper holds a tail back until it cannot be part of a secret); the
      // completed message is the answer whole.
      assert.ok(text.length > 0 && "Margins hold at 22%.".startsWith(text), text);
      const done = events.find((e) => e.type === "executive.response.completed" && (e.data as { turn: { id: string } }).turn.id === sent.turn.id);
      assert.equal((done?.data as { message: { text: string } }).message.text, "Margins hold at 22%.");
    } finally {
      live.close();
    }
  });

  test("each answer was bound and decided as the CEO (governance run kind executive); work given in the owner's own words starts a conversation; a budget that allows no run refuses an answer, saying why", async () => {
    const bindings = await h.sql("SELECT kind, resource_kind, resource_id, agent_id, ended_at FROM governance.run_bindings WHERE account_id = $1 AND kind = 'executive'", [h.accountId as string]);
    assert.ok(bindings.length >= 3, JSON.stringify(bindings));
    assert.ok(bindings.every((r) => r.resource_kind === "employee" && r.resource_id === ids.An && r.agent_id === `employee:${ids.An}` && r.ended_at !== null), "bound to the CEO, and ended");

    const p = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    const started = await b.send("POST", "/api/executive/conversations", { mission: { title: "Close Q4", goal: "Close the quarter's books.", deliverables: [], acceptanceCriteria: [], deadline: null, priority: 5 }, expectedAssignee: { employeeId: p.responsible?.employeeId, appointmentId: p.responsible?.appointmentId, appointmentRevision: p.responsible?.appointmentRevision } }, key());
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const own = await detail((started.body as { conversationId: string }).conversationId);
    assert.deepEqual([own.conversation.title, own.messages.map((m) => m.role), own.links.length], ["Close Q4", ["owner"], 1]);
    assert.match(own.messages[0]?.text ?? "", /^Work for the CEO: Close Q4/);

    const r = await b.get("/api/office/resources");
    const version = (r.body as { budget: { version: number } }).budget.version;
    assert.equal((await b.send("PATCH", "/api/office/resources/budget", { maxConcurrent: 0 }, { "if-match": `"${version}"` })).status, 200);
    const sent = (await b.send("POST", `/api/executive/conversations/${own.conversation.id}/messages`, { text: "Status?" }, key())).body as ExecutiveSent;
    const d = await eventually(() => detail(own.conversation.id), (x) => x.turns.find((t) => t.id === sent.turn.id)?.state === "failed", 15_000);
    const t = d.turns.find((x) => x.id === sent.turn.id);
    assert.equal(t?.code, "unschedulable");
    assert.match(t?.detail ?? "", /allows no attempt to run at once/);
  });
});
