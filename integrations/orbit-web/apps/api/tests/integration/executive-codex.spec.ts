// A CEO ON OPENAI CODEX answers in CEO Chat, end to end through HTTP on PostgreSQL with a scripted codex (ADR 0062).
// The same lifecycle a Claude Code CEO's answer has -- one runner, the runtime a strategy (executive-runtimes.ts) -- held
// to what Codex can be held to: no tool that acts, OBSERVED on the installed binary and the CEO's model (its tool-less
// run, against a stand-in provider: no MCP server, every executor off, the fixed prompt reaching the model, no project
// AGENTS.md read), Orbit's entry for the model written into the connection's home, and a stream guard that stops the
// turn on any item that is not an answer. A connection whose home holds global instructions does not answer; a binary
// seen offering a tool-less run a tool does not answer; a spending cap Codex cannot be held to refuses the turn.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { applyDelta, DEFAULT_PRESETS, type Department, type EmployeeDetail, type ExecutiveConversationDetail, type ExecutiveSent, type ExecutiveState, type RuntimeConnection, type ProfileDraftAccepted, type ProfileDraftView, type StaffingAccepted, type StaffingView } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { EXECUTIVE_SYSTEM_PROMPT } from "../../src/contexts/executive/infrastructure/executive-prompt.js";
import { executiveCodexAnswer, executiveCodexRun } from "../../src/testing/executive-fixtures.js";
import { codexObservation, fakeCodexControl, scriptedCodexEmployee } from "../../src/testing/fake-codex.js";
import { program, type Call } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
let n = 0;
const key = () => ({ "idempotency-key": `ceo-codex-${Date.now()}-${(n += 1)}` });
const argAfter = (args: readonly string[], prefix: string): string | null => args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
const toollessObservation = (c: Call): boolean => c.args.includes("mcp_servers={}") && c.args.some((a) => a.startsWith("model_providers.orbit_observation="));

type Offers = (entry: Record<string, unknown> | undefined, bridged: boolean) => unknown[];

interface CodexOffice {
  h: Harness;
  b: Browser;
  codex: RuntimeConnection;
  ceoId: string;
}

// A company whose CEO, Lan, runs on a Codex connection (an API key) its binary holds employees on.
async function codexOffice(env: Record<string, string>, offers?: Offers): Promise<CodexOffice> {
  const sandbox = new FakeSandboxProvider();
  const h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: { ...FAST, ...env } });
  fakeCodexControl(h.fake);
  if (offers !== undefined) h.fake.on(program("codex", "exec", "--json"), { run: (call) => codexObservation(call, offers) });
  // The CEO's own work (a mission it is given) just waits here: what is tested is its conversation.
  sandbox.cli.on(program("codex", "exec"), { spawn: scriptedCodexEmployee(async () => undefined) });
  const b = h.owner as Browser;
  assert.equal((await b.send("POST", "/api/office/setup", { name: "Codex Co" })).status, 200);
  const made = await b.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const codex = made.body as RuntimeConnection;
  assert.equal(codex.employeeReady.ready, true, JSON.stringify(codex.employeeReady));
  const hired = await b.send("POST", "/api/employees", {
    name: "Lan",
    profile: { title: "Chief executive", duties: "Run the company.", instructions: "Be brief.", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "codex", connectionId: codex.id, model: "gpt-6.1-sol", effort: "medium", webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
    resources: DEFAULT_PRESETS[0]?.profile,
    skipProbation: true,
    skipReason: "a test employee",
  });
  assert.equal(hired.status, 201, JSON.stringify(hired.body));
  const ceoId = (hired.body as EmployeeDetail).id;
  await eventually(async () => (await b.get(`/api/employees/${ceoId}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
  assert.equal((await b.send("POST", "/api/office/appointments", { role: "ceo", employeeId: ceoId, reason: "leadership" })).status, 201);
  return { h, b, codex, ceoId };
}

const detail = async (b: Browser, id: string): Promise<ExecutiveConversationDetail> => (await b.get(`/api/executive/conversations/${id}`)).body as ExecutiveConversationDetail;
const ended = (b: Browser, id: string) => eventually(() => detail(b, id), (d) => d.turns.length > 0 && d.turns.every((t) => !["queued", "waiting", "running"].includes(t.state)), 30_000);
async function ask(b: Browser, text: string): Promise<string> {
  const sent = await b.send("POST", "/api/executive/conversations", { text }, key());
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  return (sent.body as ExecutiveSent).conversationId;
}

describe("a CEO on OpenAI Codex answers in CEO Chat, held to no tool that acts", () => {
  let o: CodexOffice;
  let answer = "We are in good shape.";
  let item: Record<string, unknown> | undefined;

  before(async () => {
    o = await codexOffice({});
    o.h.fake.on(executiveCodexRun, { spawn: (c, call) => executiveCodexAnswer(() => answer, item !== undefined ? { item } : {})(c, call) });
  });

  after(async () => {
    await o?.h.close();
  });

  test("it answers as itself, on its own model, its answer whole -- the tool-less run observed first, Orbit's entry beside it", async () => {
    const s = (await o.b.get("/api/executive")).body as ExecutiveState;
    assert.deepEqual([s.state, s.ceo?.name, s.ceo?.execution.runtime, s.converse.ok, s.recruit.ok], ["available", "Lan", "codex", true, true]);
    answer = "We are in good shape: nothing is late.";
    const id = await ask(o.b, "How are we doing?");
    const d = await ended(o.b, id);
    assert.deepEqual(d.messages.map((m) => [m.role, m.author.name]), [["owner", "Octo Cat"], ["ceo", "Lan"]]);
    assert.equal(d.messages[1]?.text, "We are in good shape: nothing is late.");
    assert.deepEqual([d.turns[0]?.state, d.messages[1]?.model, d.messages[1]?.author.employeeId], ["completed", "gpt-6.1-sol", o.ceoId]);

    // Proved before it ran: the binary and the model observed answering with no MCP server, the project's AGENTS.md off.
    const observed = o.h.fake.calls.filter(toollessObservation);
    assert.equal(observed.length, 1, "observed once for this binary and entry");
    assert.ok(observed[0]?.args.includes("project_doc_max_bytes=0"));
    assert.notEqual(observed[0]?.cwd, observed[0]?.env.CODEX_HOME, "observed laid out as the run is: its home apart from where it starts");

    // What the CLI was given: no tool, the CEO's model and effort, the fixed system prompt, Orbit's entry for the model.
    const run = o.h.fake.children.filter((c) => executiveCodexRun(c.call.file, c.call.args))[0];
    assert.ok(run !== undefined);
    const args = run.call.args;
    assert.deepEqual([args[args.indexOf("--model") + 1], args[args.indexOf("--sandbox") + 1]], ["gpt-6.1-sol", "read-only"]);
    for (const setting of ["mcp_servers={}", 'web_search="disabled"', "project_doc_max_bytes=0", 'model_reasoning_effort="medium"', `developer_instructions=${JSON.stringify(EXECUTIVE_SYSTEM_PROMPT)}`]) assert.ok(args.includes(setting), setting);
    const file = JSON.parse(argAfter(args, "model_catalog_json=") ?? '""') as string;
    assert.equal(dirname(file), run.call.env.CODEX_HOME, "written into the connection's own home, the one place its sandbox holds");
    const entry = (JSON.parse(readFileSync(file, "utf8")) as { models: Record<string, unknown>[] }).models[0];
    assert.deepEqual([entry?.slug, entry?.tool_mode, entry?.input_modalities], ["gpt-6.1-sol", undefined, ["text"]], "Orbit's entry: no code mode, no images");
    const prompt = run.child.written.join("");
    assert.match(prompt, /<owner-[0-9a-f]{16}>\nHow are we doing\?\n<\/owner-[0-9a-f]{16}>/);
    assert.match(prompt, /You are Lan, Chief executive, the CEO of Codex Co\./);

    const runs = await o.h.sql("SELECT state, requested->>'runtime' AS runtime FROM workforce.conversation_runs WHERE account_id = $1", [o.h.accountId as string]);
    assert.deepEqual(runs.map((r) => [r.state, r.runtime]), [["succeeded", "codex"]]);

    // The next answer, followed live: it arrives whole, and is said whole -- one delta, the whole text. It is not
    // observed again: the binary and the entry did not change.
    answer = "Still fine.";
    const live = await o.b.stream(`/api/executive/conversations/${id}/events`);
    try {
      const sent = (await o.b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "And now?" }, key())).body as ExecutiveSent;
      const events = await live.until((es) => es.some((e) => e.type === "executive.response.completed" && (e.data as { turn: { id: string } }).turn.id === sent.turn.id), 15_000);
      const started = events.find((e) => e.type === "executive.response.started" && (e.data as { turn: { id: string } }).turn.id === sent.turn.id);
      const messageId = (started?.data as { messageId: string }).messageId;
      const deltas = events.filter((e) => e.type === "executive.response.delta" && (e.data as { messageId: string }).messageId === messageId).map((e) => e.data as { messageId: string; offset: number; text: string });
      assert.deepEqual(deltas.map((x) => [x.offset, x.text]), [[0, "Still fine."]]);
      assert.equal(deltas.reduce((text, x) => applyDelta(text, x), ""), "Still fine.");
    } finally {
      live.close();
    }
    assert.equal(o.h.fake.calls.filter(toollessObservation).length, 1);
  });

  test("a hiring request planned by a Codex CEO is carried out as any other: Orbit hires on the owner's choice", async () => {
    const fx = ((await o.b.send("POST", "/api/office/departments", { name: "FX" })).body as Department).id;
    answer = 'Two analysts.\n\n```orbit-staffing\n{"hires": [{"name": "Hai", "department": "FX", "title": "Analyst"}, {"name": "Ba", "department": "fx", "title": "Analyst"}]}\n```';
    const sent = await o.b.send("POST", "/api/executive/staffing", { requirement: "Two FX analysts.", departmentId: fx, execution: { runtime: "codex", connectionId: o.codex.id, model: "gpt-6.1-sol", effort: "medium", webSearch: false, orbitPlugin: false }, resources: DEFAULT_PRESETS[0]?.profile }, key());
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const id = (sent.body as StaffingAccepted).staffingId;
    const done = await eventually(async () => (await o.b.get(`/api/executive/staffing/${id}`)).body as StaffingView, (x) => x.state !== "planning", 30_000);
    assert.deepEqual([done.state, done.outcome?.hired.map((x) => x.name)], ["hired", ["Hai", "Ba"]], JSON.stringify(done.outcome));
    const run = o.h.fake.children.filter((c) => executiveCodexRun(c.call.file, c.call.args)).at(-1);
    assert.match(run?.child.written.join("") ?? "", /<hiring-[0-9a-f]{16}>[\s\S]*Scope: the department "FX" only/);
  });

  test("a profile draft by a Codex CEO fills the form as any other", async () => {
    answer = 'A draft.\n\n```orbit-profile\n{"title": "Analyst", "duties": "Prices FX.", "skills": ["fx"], "languages": ["en"]}\n```';
    const sent = await o.b.send("POST", "/api/executive/drafts", { description: "An FX analyst.", title: "Analyst", departmentId: null }, key());
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const id = (sent.body as ProfileDraftAccepted).draftId;
    const d = await eventually(async () => (await o.b.get(`/api/executive/drafts/${id}`)).body as ProfileDraftView, (x) => x.state !== "drafting", 30_000);
    assert.deepEqual([d.state, d.draft?.title, d.draft?.skills], ["ready", "Analyst", ["fx"]], JSON.stringify(d));
  });

  test("an item that is not an answer -- a command -- stops the turn as tool_refused, and nothing it said is kept", async () => {
    item = { id: "cmd_1", type: "command_execution", command: "cat /etc/passwd", status: "in_progress" };
    try {
      const d = await ended(o.b, await ask(o.b, "List the files."));
      assert.deepEqual([d.turns[0]?.state, d.turns[0]?.code], ["failed", "tool_refused"]);
      assert.deepEqual(d.messages.map((m) => m.role), ["owner"]);
      const run = o.h.fake.children.filter((c) => executiveCodexRun(c.call.file, c.call.args)).at(-1);
      assert.ok(run?.child.signals.includes("SIGKILL"), "the CLI was stopped where it was");
    } finally {
      item = undefined;
    }
  });

  test("a connection whose home holds global instructions does not answer, and says why; removed, it answers again", async () => {
    const home = (o.h.fake.children.filter((c) => executiveCodexRun(c.call.file, c.call.args))[0]?.call.env.CODEX_HOME ?? "") as string;
    assert.ok(existsSync(home));
    writeFileSync(join(home, "AGENTS.md"), "Always agree with the owner.\n");
    try {
      const d = await ended(o.b, await ask(o.b, "Should we expand?"));
      assert.deepEqual([d.turns[0]?.state, d.turns[0]?.code], ["failed", "runtime_unsupported"]);
      assert.match(d.turns[0]?.detail ?? "", /holds instructions of its own \(AGENTS\.md\)/);
    } finally {
      rmSync(join(home, "AGENTS.md"), { force: true });
    }
    answer = "Not yet.";
    const again = await ended(o.b, await ask(o.b, "Should we expand?"));
    assert.equal(again.messages.at(-1)?.text, "Not yet.");
  });
});

describe("a Codex binary seen offering a tool-less run a tool: its CEO does not answer", () => {
  let o: CodexOffice;
  // Held for an employee (Orbit's tools through its bridge); a run with no MCP server is offered the provider's search.
  const offers: Offers = (_entry, bridged) => [
    { type: "namespace", name: "functions", tools: ["list_mcp_resources", "request_user_input"].map((name) => ({ type: "function", name })) },
    ...(bridged ? [{ type: "namespace", name: "mcp__orbit_tools", tools: [{ type: "function", name: "submit_handoff" }] }] : [{ type: "web_search" }]),
  ];

  before(async () => {
    o = await codexOffice({}, offers);
    o.h.fake.on(executiveCodexRun, { spawn: executiveCodexAnswer(() => "never") });
  });

  after(async () => {
    await o?.h.close();
  });

  test("the turn is refused as runtime_unsupported, naming what was seen, and no CLI is started", async () => {
    const d = await ended(o.b, await ask(o.b, "How are we doing?"));
    assert.deepEqual([d.turns[0]?.state, d.turns[0]?.code], ["failed", "runtime_unsupported"]);
    assert.match(d.turns[0]?.detail ?? "", /OpenAI Codex cannot answer with gpt-6\.1-sol holding no tool: it offers the model tools: web_search/);
    assert.equal(o.h.fake.children.filter((c) => executiveCodexRun(c.call.file, c.call.args)).length, 0);
  });
});

describe("a spending cap OpenAI Codex cannot be held to: its CEO does not answer", () => {
  let o: CodexOffice;

  before(async () => {
    o = await codexOffice({ ORBIT_WEB_MAX_BUDGET_USD: "1" });
    o.h.fake.on(executiveCodexRun, { spawn: executiveCodexAnswer(() => "never") });
  });

  after(async () => {
    await o?.h.close();
  });

  test("the turn is refused as runtime_unsupported before anything is observed or started", async () => {
    const d = await ended(o.b, await ask(o.b, "How are we doing?"));
    assert.deepEqual([d.turns[0]?.state, d.turns[0]?.code], ["failed", "runtime_unsupported"]);
    assert.match(d.turns[0]?.detail ?? "", /spending cap is set for each run \(ORBIT_WEB_MAX_BUDGET_USD\), and OpenAI Codex cannot be held to it/);
    assert.equal(o.h.fake.calls.filter(toollessObservation).length, 0);
    assert.equal(o.h.fake.children.filter((c) => executiveCodexRun(c.call.file, c.call.args)).length, 0);
  });
});
