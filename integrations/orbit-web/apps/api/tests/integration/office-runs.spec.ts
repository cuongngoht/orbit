// THE OFFICE'S RUNS UNDER STRESS, through HTTP on PostgreSQL: a pause and a cancel while an attempt runs, a question and
// its answer, a model plane that reports a tool it was not given (stopped before it acts), two people giving one idle
// employee work at the same instant, a worker that loses an attempt's lease (recovered, never run twice), a budget that
// cannot hold an attempt (unschedulable, said with the numbers, then admitted when it can), recurring work with its
// deliveries, and a research mission whose claims are checked against the sources it was given.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type DeliveryView, type EmployeeDetail, type Inbox, type MissionAccepted, type MissionDetail, type ResourceSummary, type RuntimeConnection, type ScheduleView } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { SchedulesService } from "../../src/contexts/work/application/schedules.service.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";
import { newWorkspace, settledSource, uploaded } from "../../src/testing/research-client.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `runs-key-${Date.now()}-${(n += 1)}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the office's runs, interrupted, raced, recovered and scheduled", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const prompts: string[] = [];
  const claimsSeen: unknown[] = [];

  const hire = async (name: string): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
  };
  const give = (employeeId: string, goal: string, extra: Record<string, unknown> = {}) => b.send("POST", "/api/missions", { title: goal.slice(0, 60), goal, targetEmployeeId: employeeId, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Correct"], ...extra }, key());
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const root = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId === null) as AssignmentView;
  const until = (id: string, ok: (m: MissionDetail) => boolean, ms = 15_000) => eventually(() => mission(id), ok, ms);

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Stress office" })).status, 200);
    // One scripted CLI; what it does is read off the goal it was given.
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(
        async (t: ToolCaller) => {
          prompts.push(t.prompt);
          if (t.prompt.includes("[slow]")) {
            for (let i = 0; i < 400 && t.child.signals.length === 0; i += 1) {
              await t.call("list_files", { path: "/work" });
              await sleep(25);
            }
            return;
          }
          if (t.prompt.includes("[ask]") && !t.prompt.includes("Answers you were given")) {
            await t.call("ask_question", { question: "Which quarter?" });
            return;
          }
          if (t.prompt.includes("[sources]")) {
            const listed = await t.call("list_files", { path: "/input" });
            const name = listed.text.split("\n").map((l) => l.split("\t")[1] ?? "").find((x) => x.endsWith(".txt")) ?? "";
            const text = await t.call("read_file", { path: `/input/${name}` });
            await t.call("write_file", { path: "/output/report.md", content: `Read ${name}: ${text.text.length} characters.` });
            const r = await t.call("submit_handoff", {
              summary: "Read the source.",
              claims: [
                { text: "Q3 invoices total 2,000,000 VND.", sources: ["S1"], quote: "invoice A 1,200,000 VND" },
                { text: "Something the source never says.", sources: ["S1"], quote: "a sentence that is nowhere in it" },
                { text: "A page on the web says so.", url: "https://example.com/rates" },
              ],
            });
            claimsSeen.push(r.text);
            return;
          }
          await t.call("write_file", { path: "/output/report.md", content: "Done.\n" });
          await t.call("submit_handoff", { summary: "Done." });
        },
        {
          init: (tools, prompt) =>
            prompt.includes("[foreign]")
              ? { type: "system", subtype: "init", session_id: "s", model: "m", tools: [...tools, "Bash"], mcp_servers: [{ name: "orbit_tools" }], plugins: [], claude_code_version: "2.1.330" }
              : prompt.includes("[no-bridge]")
                ? // What Claude Code 2.1.328 printed when the bridge's tool list was refused: the server connected, none of its tools.
                  { type: "system", subtype: "init", session_id: "s", model: "m", tools: tools.filter((t) => !t.startsWith("mcp__orbit_tools__")), mcp_servers: [{ name: "orbit_tools", status: "connected" }], plugins: [], claude_code_version: "2.1.328" }
                : undefined,
        },
      ),
    });
  });

  after(async () => {
    await h?.close();
  });

  test("a pause stops the running attempt and keeps the employee; a resume starts a new one; a cancel ends it and frees everyone", async () => {
    const e = await hire("Chi");
    const made = await give(e.id, "[slow] a long analysis");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    let m = await until(id, (x) => root(x).state === "RUNNING");
    const paused = await b.send("POST", `/api/assignments/${root(m).id}/pause`, { reason: "waiting for the books" }, ifMatch(root(m).version));
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    m = await until(id, (x) => root(x).state === "PAUSED" && x.assignments[0]?.lastRun?.state === "cancelled");
    assert.equal(root(m).employeeId, e.id);
    const resumed = await b.send("POST", `/api/assignments/${root(m).id}/resume`, {}, ifMatch(root(m).version));
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    m = await until(id, (x) => root(x).state === "RUNNING" && root(x).attempts === 2);
    const cancelled = await b.send("POST", `/api/assignments/${root(m).id}/cancel`, { reason: "not needed" }, ifMatch(root(m).version));
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    m = await until(id, (x) => root(x).state === "CANCELLED");
    assert.equal(m.state, "cancelled");
    const held = await h.sql("SELECT count(*) AS n FROM workforce.reservations WHERE account_id = $1 AND employee_id = $2", [h.accountId as string, e.id]);
    assert.equal(Number(held[0]?.n), 0, "the employee is free");
    const compute = await eventually(() => h.sql("SELECT count(*) AS n FROM workforce.compute_reservations c JOIN workforce.runs r ON r.account_id = c.account_id AND r.id = c.run_id WHERE r.employee_id = $1 AND c.released_at IS NULL", [e.id]), (rows) => Number(rows[0]?.n) === 0);
    assert.equal(Number(compute[0]?.n), 0, "no CPU or memory stays reserved");
  });

  test("a question blocks the work on information; the answer reaches a new attempt, which hands in", async () => {
    const e = await hire("Dung");
    const made = await give(e.id, "[ask] the quarterly report");
    const id = (made.body as MissionAccepted).missionId;
    let m = await until(id, (x) => root(x).state === "BLOCKED");
    assert.equal(root(m).waitingOn, "information");
    const inbox = (await b.get("/api/inbox?state=open")).body as Inbox;
    assert.ok(inbox.items.some((i) => i.kind === "information" && i.assignmentId === root(m).id && i.reason === "Which quarter?"));
    const answered = await b.send("POST", `/api/assignments/${root(m).id}/answer`, { answer: "Q3 2026" }, ifMatch(root(m).version));
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    m = await until(id, (x) => root(x).state === "AWAITING_ACCEPTANCE");
    assert.ok(prompts.some((p) => p.includes("Q: Which quarter?") && p.includes("A: Q3 2026")));
  });

  test("a model plane that reports a tool it was not given is stopped before it acts, and the work is blocked with why", async () => {
    const e = await hire("Em");
    const made = await give(e.id, "[foreign] anything");
    const id = (made.body as MissionAccepted).missionId;
    const m = await until(id, (x) => root(x).state === "BLOCKED");
    assert.match(root(m).reason ?? "", /Bash/);
    assert.match(root(m).reason ?? "", /isolation not established/);
    assert.equal(root(m).lastRun?.state, "failed");
    assert.equal(m.handoffs.length, 0, "it handed nothing in");
    assert.ok(sandbox.cli.children.some((c) => c.child.signals.includes("SIGKILL")));
  });

  test("a model plane whose bridge listed none of Orbit's tools is stopped as it starts: the work is blocked with why, never 'ended without a result'", async () => {
    const e = await hire("Ninh");
    const made = await give(e.id, "[no-bridge] anything");
    const id = (made.body as MissionAccepted).missionId;
    const m = await until(id, (x) => root(x).state === "BLOCKED");
    assert.match(root(m).reason ?? "", /Orbit's tools did not reach the model plane \(orbit_tools: connected, but none of its tools were listed/);
    assert.doesNotMatch(root(m).reason ?? "", /without handing in a result/);
    assert.equal(root(m).lastRun?.state, "failed");
    assert.equal(m.handoffs.length, 0, "it handed nothing in");
    const runs = await h.sql("SELECT observed FROM workforce.runs WHERE account_id = $1 AND employee_id = $2", [h.accountId as string, e.id]);
    const observed = runs[0]?.observed as { cli: { mcpServers: unknown } } | undefined;
    assert.deepEqual(observed?.cli.mcpServers, [{ name: "orbit_tools", status: "connected" }], "the run keeps the bridge's state as the CLI said it");
  });

  test("two people give one idle employee work at the same instant: exactly one claims it, the other is told who holds it", async () => {
    const e = await hire("Giang");
    const [one, two] = await Promise.all([give(e.id, "[slow] first"), give(e.id, "[slow] second")]);
    const statuses = [one.status, two.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const refused = one.status === 409 ? one : two;
    assert.equal(code(refused), "employee_busy");
    const missions = await h.sql("SELECT count(*) AS n FROM workforce.assignments WHERE account_id = $1 AND employee_id = $2", [h.accountId as string, e.id]);
    assert.equal(Number(missions[0]?.n), 1, "the refused request made nothing");
    const winner = (one.status === 201 ? one : two).body as MissionAccepted;
    const m = await until(winner.missionId, (x) => root(x).state === "RUNNING");
    await b.send("POST", `/api/assignments/${root(m).id}/cancel`, { reason: "done testing" }, ifMatch(root(m).version));
    await until(winner.missionId, (x) => root(x).state === "CANCELLED");
  });

  test("a worker that loses an attempt's lease stops it; the attempt is recovered once -- interrupted, never run twice -- and can be retried", async () => {
    const e = await hire("Hoa");
    const made = await give(e.id, "[slow] recover me");
    const id = (made.body as MissionAccepted).missionId;
    let m = await until(id, (x) => root(x).state === "RUNNING");
    const before = sandbox.cli.children.length;
    // Another worker took the lease (as if this one had been gone past it).
    await h.sql("UPDATE workforce.runs SET lease_owner = 'another-host:1:gone', lease_until = now() - interval '1 second' WHERE account_id = $1 AND assignment_id = $2 AND state = 'running'", [h.accountId as string, root(m).id]);
    m = await until(id, (x) => root(x).state === "BLOCKED");
    assert.match(root(m).reason ?? "", /stopped while this attempt ran/);
    assert.equal(root(m).lastRun?.state, "interrupted");
    assert.equal(sandbox.cli.children.length, before, "nothing was started again on a guess");
    const released = await eventually(() => h.sql("SELECT count(*) AS n FROM workforce.compute_reservations c JOIN workforce.runs r ON r.account_id = c.account_id AND r.id = c.run_id WHERE r.employee_id = $1 AND c.released_at IS NULL", [e.id]), (rows) => Number(rows[0]?.n) === 0);
    assert.equal(Number(released[0]?.n), 0);
    const retried = await b.send("POST", `/api/assignments/${root(m).id}/retry`, {}, ifMatch(root(m).version));
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    m = await until(id, (x) => root(x).state === "RUNNING" && root(x).attempts === 2);
    await b.send("POST", `/api/assignments/${root(m).id}/cancel`, { reason: "done" }, ifMatch(root(m).version));
    await until(id, (x) => root(x).state === "CANCELLED");
  });

  test("an attempt the account's budget can never hold is unschedulable, said with the numbers; restored, it is admitted", async () => {
    const e = await hire("Khanh");
    let r = (await b.get("/api/office/resources")).body as ResourceSummary;
    const lowered = await b.send("PATCH", "/api/office/resources/budget", { memoryMiB: 2048 }, ifMatch(r.budget.version));
    assert.equal(lowered.status, 200, JSON.stringify(lowered.body));
    const made = await give(e.id, "plain work");
    const id = (made.body as MissionAccepted).missionId;
    await eventually(async () => (await b.get("/api/inbox?state=open")).body as Inbox, (i) => i.items.some((x) => x.kind === "unschedulable" && x.missionId === id));
    const item = ((await b.get("/api/inbox?state=open")).body as Inbox).items.find((x) => x.kind === "unschedulable" && x.missionId === id);
    assert.match(item?.reason ?? "", /MiB/);
    assert.equal(root(await mission(id)).state, "ASSIGNED", "the work keeps its employee while it waits");
    r = (await b.get("/api/office/resources")).body as ResourceSummary;
    const above = await b.send("PATCH", "/api/office/resources/budget", { memoryMiB: r.budget.authorized.memoryMiB + 1 }, ifMatch(r.budget.version));
    assert.equal(above.status, 403);
    assert.equal(code(above), "above_authorization");
    const restored = await b.send("PATCH", "/api/office/resources/budget", { memoryMiB: r.budget.authorized.memoryMiB }, ifMatch(r.budget.version));
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    await until(id, (x) => root(x).state === "AWAITING_ACCEPTANCE");
    const open = ((await b.get("/api/inbox?state=open")).body as Inbox).items.some((x) => x.kind === "unschedulable" && x.missionId === id);
    assert.equal(open, false, "the unschedulable item was withdrawn when it was admitted");
  });

  test("a hire above a per-employee limit, or past the account's storage budget, is refused with the numbers -- and nothing is made", async () => {
    const count = async () => Number((await h.sql("SELECT count(*) AS n FROM workforce.employees WHERE account_id = $1", [h.accountId as string]))[0]?.n);
    const before = await count();
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const body = (name: string, resources: unknown) => ({
      name,
      profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources,
      skipProbation: true,
      skipReason: "a test employee",
    });
    let r = (await b.get("/api/office/resources")).body as ResourceSummary;
    const preset = DEFAULT_PRESETS[0]?.profile;
    assert.ok(preset !== undefined);
    const tooBig = await b.send("POST", "/api/employees", body("Too big", { ...preset, presetId: null, cpuMillis: r.budget.perEmployee.cpuMillis + 1000 }));
    assert.equal(tooBig.status, 422, JSON.stringify(tooBig.body));
    assert.equal(code(tooBig), "resource_limit_exceeded");
    assert.match((tooBig.body as { error: { message: string } }).error.message, /per-employee/);
    // The storage budget lowered to what is committed now: a new desk does not fit.
    const lowered = await b.send("PATCH", "/api/office/resources/budget", { storageMiB: Math.max(1, r.storage.committedMiB) }, ifMatch(r.budget.version));
    assert.equal(lowered.status, 200, JSON.stringify(lowered.body));
    const noRoom = await b.send("POST", "/api/employees", body("No room", preset));
    assert.equal(noRoom.status, 422, JSON.stringify(noRoom.body));
    assert.equal(code(noRoom), "storage_budget_exceeded");
    assert.match((noRoom.body as { error: { message: string } }).error.message, /MiB/);
    assert.equal(await count(), before, "neither refused hire made an employee");
    r = (await b.get("/api/office/resources")).body as ResourceSummary;
    const restored = await b.send("PATCH", "/api/office/resources/budget", { storageMiB: r.budget.authorized.storageMiB }, ifMatch(r.budget.version));
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
  });

  test("a schedule makes one mission per period, whoever asks; an accepted result is delivered with a receipt, or waits for a channel", async () => {
    const e = await hire("Lan");
    const made = await b.send("POST", "/api/schedules", {
      name: "Quarterly invoices",
      rule: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", dayOfMonth: 1, period: "previous" },
      employeeId: e.id,
      mission: { goal: "Total the invoices of the period.", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["The total is right"] },
      recipients: [{ address: "octo@example.com", channel: "inbox" }, { address: "cfo@outside.example", channel: "external" }],
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const s = made.body as ScheduleView;
    assert.equal(s.next[0]?.periodKey.endsWith("-Q4") || s.next[0]?.periodKey.endsWith("-Q1"), true);
    const due = Date.parse(s.next[0]?.dueAt ?? "") + 60_000;
    const schedules = h.app.get(SchedulesService);
    const made1 = await Promise.all([schedules.tick(due), schedules.tick(due)]);
    assert.equal(made1[0] + made1[1], 1, "two schedulers make the period once");
    assert.equal(await schedules.tick(due), 0, "and a third finds it made");
    const occ = (await b.get(`/api/schedules/${s.id}/occurrences`)).body as { missionId: string | null; periodKey: string; state: string }[];
    assert.equal(occ.length, 1);
    assert.equal(occ[0]?.state, "created");
    const id = occ[0]?.missionId as string;
    let m = await until(id, (x) => root(x).state === "AWAITING_ACCEPTANCE");
    assert.match(m.goal, new RegExp(`Period: ${occ[0]?.periodKey}`));
    const h1 = m.handoffs[0];
    const ok = await b.send("POST", `/api/assignments/${root(m).id}/accept`, { handoffDigest: h1?.digest }, ifMatch(root(m).version));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    m = await eventually(() => mission(id), (x) => x.deliveries.length === 2);
    const inboxDelivery = m.deliveries.find((d) => d.recipient.channel === "inbox") as DeliveryView;
    const external = m.deliveries.find((d) => d.recipient.channel === "external") as DeliveryView;
    assert.equal(inboxDelivery.state, "SENT");
    assert.match(inboxDelivery.receipt ?? "", /^inbox:/);
    assert.equal(external.state, "PENDING_CHANNEL", "never sent on a guess");
    const resolved = await b.send("POST", `/api/deliveries/${external.id}/resolve`, { outcome: "delivered", reason: "Sent by hand on 2026-01-02" });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal((resolved.body as DeliveryView).state, "SENT");
    assert.match((resolved.body as DeliveryView).receipt ?? "", /Sent by hand/);
  });

  test("a research mission: its sources reach the attempt read-only, and a claim is supported only by a quote the source holds", async () => {
    const e = await hire("Minh");
    const ws = await newWorkspace(b, "Invoices");
    const src = await uploaded(h, ws.id, "invoices-q3.txt", Buffer.from("Invoices of Q3 2026.\ninvoice A 1,200,000 VND on 2026-07-10.\ninvoice B 800,000 VND on 2026-08-02.\ninvoice C 500,000 VND on 2026-10-03 (Q4).\n"), b);
    const ready = await settledSource(b, src.id);
    assert.equal(ready.state, "ready");
    const made = await give(e.id, "[sources] total Q3", { workspaceId: ws.id, sourceRevisionIds: [ready.revision?.id] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const m = await until((made.body as MissionAccepted).missionId, (x) => root(x).state === "AWAITING_ACCEPTANCE");
    const claims = m.handoffs[0]?.claims ?? [];
    assert.equal(claims.length, 3);
    assert.equal(claims[0]?.supported, true);
    assert.equal(claims[0]?.sources[0]?.label, "S1");
    assert.equal(claims[0]?.sources[0]?.revisionId, ready.revision?.id);
    assert.equal(claims[1]?.supported, false, "a quote the source does not hold supports nothing");
    assert.equal(claims[2]?.supported, false);
    assert.equal((claims[2] as { web?: { url: string } }).web?.url, "https://example.com/rates");
    assert.ok(prompts.some((p) => p.includes("S1-invoices-q3")), "inputs are named as the sandbox accepts: [A-Za-z0-9._-]");
  });

  // Last: it disconnects the connection every employee here runs on.
  test("an AI connection disconnected while its employee works: the attempt is stopped, the work blocked with why, and the employee not ready", async () => {
    const e = await hire("Vu");
    const made = await give(e.id, "[slow] work on a connection that goes away");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await until(id, (x) => root(x).state === "RUNNING");
    const gone = await b.send("POST", `/api/connections/${connection.id}/disconnect`, {});
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    const m = await until(id, (x) => root(x).state === "BLOCKED");
    assert.match(root(m).reason ?? "", /the AI connection it ran on was disconnected/);
    assert.equal(root(m).lastRun?.state, "failed");
    const inbox = (await b.get("/api/inbox?state=open")).body as Inbox;
    assert.ok(inbox.items.some((i) => i.assignmentId === root(m).id && i.kind === "blocked"), "the owner is told");
    const runs = await h.sql("SELECT stop_requested FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2", [h.accountId as string, root(m).id]);
    assert.deepEqual(runs.map((r) => r.stop_requested), ["disconnected"]);
    const compute = await eventually(() => h.sql("SELECT count(*) AS n FROM workforce.compute_reservations c JOIN workforce.runs r ON r.account_id = c.account_id AND r.id = c.run_id WHERE r.employee_id = $1 AND c.released_at IS NULL", [e.id]), (rows) => Number(rows[0]?.n) === 0);
    assert.equal(Number(compute[0]?.n), 0, "its resources went back");
    // A retry while it is disconnected runs nothing -- never on another provider -- and says why.
    const ran = prompts.filter((p) => p.includes("a connection that goes away")).length;
    const retried = await b.send("POST", `/api/assignments/${root(m).id}/retry`, {}, ifMatch(root(m).version));
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    const again = await until(id, (x) => root(x).state === "BLOCKED" && root(x).attempts === 2);
    assert.match(root(again).reason ?? "", /not connected|disconnected/i);
    assert.equal(prompts.filter((p) => p.includes("a connection that goes away")).length, ran, "no CLI was started");
  });
});
