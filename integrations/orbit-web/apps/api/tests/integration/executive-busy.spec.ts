// CEO CHAT AND THE CEO'S OWN WORK (ADR 0062): one run of an employee at a time, both ways, through the same admission.
// An answer waits while the CEO's attempt runs (said why) and answers once it ends; an attempt of the CEO waits while an
// answer runs; their compute never overlaps. A mission given from a conversation tells it what happens to it (Orbit's
// words, never the CEO's). A CEO replaced while its answer waited does not answer for the new one (ceo_changed), and
// what the former CEO said stays the former CEO's.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AppointmentView, type AppointmentsView, type Department, type EmployeeDetail, type ExecutiveConversationDetail, type ExecutiveSent, type ExecutiveState, type MissionAccepted, type MissionDetail, type MissionTargetPreview, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { executiveAnswer, executiveRun } from "../../src/testing/executive-fixtures.js";
import { FakeProcessPort, program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, signedIn, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `ceo-busy-${Date.now()}-${(n += 1)}` });

// A gate a scripted run waits on, opened by the test.
function gate(): { wait: () => Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const p = new Promise<void>((r) => (open = r));
  return { wait: () => p, open };
}

describe("CEO Chat and the CEO's own work: one run of the CEO at a time, both ways", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  let attempt = gate();
  let answerGate: { wait: () => Promise<void>; open: () => void } | null = null;
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
  fake.on(executiveRun, { spawn: (c, call) => executiveAnswer(() => "Understood.", answerGate === null ? {} : { gate: answerGate.wait })(c, call) });

  const hire = async (name: string, departmentId: string | null): Promise<string> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title: "Staff", duties: "Work.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[name] = (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
    return ids[name] as string;
  };
  const detail = async (id: string): Promise<ExecutiveConversationDetail> => (await b.get(`/api/executive/conversations/${id}`)).body as ExecutiveConversationDetail;
  const anRuns = (state: string) => h.sql("SELECT count(*)::int AS n FROM workforce.runs WHERE account_id = $1 AND employee_id = $2 AND state = $3", [h.accountId as string, ids.An as string, state]);
  const giveCeo = async (goal: string): Promise<string> => {
    const p = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    const r = await b.send("POST", "/api/missions", { title: goal.slice(0, 40), goal, target: { kind: "ceo" }, expectedAssignee: { employeeId: p.responsible?.employeeId, appointmentId: p.responsible?.appointmentId, appointmentRevision: p.responsible?.appointmentRevision }, whenBusy: "enqueue", deliverables: [], acceptanceCriteria: [] }, key());
    assert.ok(r.status === 201 || r.status === 202, JSON.stringify(r.body));
    return (r.body as MissionAccepted).missionId;
  };
  const cancelRoot = async (missionId: string): Promise<void> => {
    await eventually(async () => {
      const r = ((await b.get(`/api/missions/${missionId}`)).body as MissionDetail).assignments.find((a) => a.parentId === null);
      if (r === undefined || r.state === "CANCELLED" || r.state === "CANCELLING") return true;
      return (await b.send("POST", `/api/assignments/${r.id}/cancel`, { reason: "enough" }, ifMatch(r.version))).status === 200;
    }, (ok) => ok, 30_000);
  };

  before(async () => {
    h = await startHarness({ fake, overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Busy Co" })).status, 200);
    const research = ((await b.send("POST", "/api/office/departments", { name: "Research" })).body as Department).id;
    // The CEO's attempt holds the slot until the test opens its gate.
    sandbox.cli.on(program("claude"), { spawn: scriptedEmployee(async (t: ToolCaller) => (t.prompt.includes("[hold]") ? attempt.wait() : undefined)) });
    await hire("An", null);
    await hire("Minh", research);
    await hire("Chi", null);
    for (const body of [{ role: "ceo", employeeId: ids.An }, { role: "manager", departmentId: research, employeeId: ids.Minh }]) assert.equal((await b.send("POST", "/api/office/appointments", { ...body, reason: "leadership" })).status, 201);
  });

  after(async () => {
    attempt.open();
    answerGate?.open();
    await h?.close();
  });

  test("an answer waits while the CEO's attempt runs, said why, and answers once it ends -- their compute never overlaps", async () => {
    const missionId = await giveCeo("[hold] Plan the quarter.");
    await eventually(() => anRuns("running"), (r) => Number(r[0]?.n) === 1, 30_000);
    const s = (await b.get("/api/executive")).body as ExecutiveState;
    assert.deepEqual([s.state, s.converse.ok, s.ceo?.holding?.running], ["busy", true, true]);
    const sent = (await b.send("POST", "/api/executive/conversations", { text: "Are we on track?" }, key())).body as ExecutiveSent;
    const id = sent.conversationId;
    const waiting = await eventually(() => detail(id), (d) => /An is working on a mission run now/.test(d.turns.at(-1)?.waitingReason ?? ""), 15_000);
    assert.equal(waiting.turns.at(-1)?.state, "waiting");
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.conversation_runs WHERE account_id = $1 AND state IN ('starting', 'running')", [h.accountId as string]))[0]?.n), 0, "nothing of the answer runs while the CEO's attempt does");
    attempt.open();
    await cancelRoot(missionId);
    const d = await eventually(() => detail(id), (x) => x.turns.at(-1)?.state === "completed", 30_000);
    assert.equal(d.messages.at(-1)?.text, "Understood.");
    const attemptHeld = await h.sql("SELECT c.released_at FROM workforce.compute_reservations c JOIN workforce.runs r ON r.account_id = c.account_id AND r.id = c.run_id WHERE r.account_id = $1 AND r.employee_id = $2", [h.accountId as string, ids.An as string]);
    const answerHeld = await h.sql("SELECT reserved_at FROM workforce.conversation_runs WHERE account_id = $1 AND employee_id = $2", [h.accountId as string, ids.An as string]);
    for (const a of attemptHeld) assert.ok(a.released_at !== null && new Date(String(a.released_at)) <= new Date(String(answerHeld[0]?.reserved_at)), "the answer reserved only after the attempt released");
  });

  test("an attempt of the CEO waits while its answer runs; a mission given from the conversation tells it how it ends", async () => {
    attempt = gate();
    answerGate = gate();
    const id = ((await b.get("/api/executive/conversations")).body as { conversations: { id: string }[] }).conversations[0]?.id as string;
    const sent = (await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "Think it over." }, key())).body as ExecutiveSent;
    await eventually(() => detail(id), (d) => d.turns.find((t) => t.id === sent.turn.id)?.state === "running", 15_000);
    // Given from the conversation, in the owner's own words: the CEO's attempt is requested -- and waits.
    const p = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    const given = await b.send("POST", `/api/executive/conversations/${id}/missions`, { proposalMessageId: null, mission: { title: "Second plan", goal: "[hold] Plan the next quarter.", deliverables: [], acceptanceCriteria: [], deadline: null, priority: 5 }, expectedAssignee: { employeeId: p.responsible?.employeeId, appointmentId: p.responsible?.appointmentId, appointmentRevision: p.responsible?.appointmentRevision } }, key());
    assert.ok(given.status === 201 || given.status === 202, JSON.stringify(given.body));
    const missionId = (given.body as MissionAccepted).missionId;
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(Number((await anRuns("running"))[0]?.n) + Number((await anRuns("starting"))[0]?.n), 0, "the CEO's attempt did not start while its answer ran");
    answerGate.open();
    answerGate = null;
    await eventually(() => detail(id), (d) => d.turns.find((t) => t.id === sent.turn.id)?.state === "completed", 15_000);
    await eventually(() => anRuns("running"), (r) => Number(r[0]?.n) === 1, 30_000);
    const linked = await detail(id);
    assert.deepEqual(linked.links.map((l) => l.missionId), [missionId]);
    assert.match(linked.messages.find((m) => m.id === linked.links[0]?.messageId)?.text ?? "", /^Work for the CEO: Second plan/);
    attempt.open();
    await cancelRoot(missionId);
    const told = await eventually(() => detail(id), (d) => d.messages.some((m) => m.role === "system" && /"Second plan" was cancelled/.test(m.text)), 30_000);
    const notice = told.messages.find((m) => m.role === "system" && /was cancelled/.test(m.text));
    assert.deepEqual([notice?.author.name, notice?.missionId], ["Orbit", missionId], "Orbit's words, never the CEO's");
  });

  test("a CEO replaced while its answer waited does not answer for the new one; what it said stays its own", async () => {
    attempt = gate();
    const missionId = await giveCeo("[hold] One more plan.");
    await eventually(() => anRuns("running"), (r) => Number(r[0]?.n) === 1, 30_000);
    const id = ((await b.get("/api/executive/conversations")).body as { conversations: { id: string }[] }).conversations[0]?.id as string;
    const sent = (await b.send("POST", `/api/executive/conversations/${id}/messages`, { text: "Who answers this?" }, key())).body as ExecutiveSent;
    await eventually(() => detail(id), (d) => d.turns.find((t) => t.id === sent.turn.id)?.state === "waiting", 15_000);
    const ceo = ((await b.get("/api/office/appointments")).body as AppointmentsView).ceo as AppointmentView;
    const replaced = await b.send("POST", `/api/office/appointments/${ceo.id}/replace`, { employeeId: ids.Chi, reason: "a new CEO" }, ifMatch(ceo.version));
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    attempt.open();
    await cancelRoot(missionId);
    const d = await eventually(() => detail(id), (x) => ["failed", "completed"].includes(x.turns.find((t) => t.id === sent.turn.id)?.state ?? ""), 30_000);
    const t = d.turns.find((x) => x.id === sent.turn.id);
    assert.deepEqual([t?.state, t?.code], ["failed", "ceo_changed"]);
    const former = d.messages.filter((m) => m.role === "ceo");
    assert.ok(former.length > 0 && former.every((m) => m.author.name === "An" && m.author.current === false), "the former CEO's answers stay An's");
    const s = (await b.get("/api/executive")).body as ExecutiveState;
    assert.equal(s.ceo?.name, "Chi");
    // Asked again, the new CEO answers -- explicitly.
    const again = await b.send("POST", `/api/executive/conversations/${id}/turns/${sent.turn.id}/retry`, {});
    assert.equal(again.status, 202, JSON.stringify(again.body));
    const answered = await eventually(() => detail(id), (x) => x.messages.at(-1)?.author.name === "Chi", 30_000);
    assert.equal(answered.messages.at(-1)?.author.current, true);
  });
});
