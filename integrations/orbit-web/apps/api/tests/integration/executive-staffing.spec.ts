// THE OWNER'S HIRING REQUEST, end to end through HTTP on PostgreSQL with a scripted CEO (ADR 0062, staffing). The owner
// asks once; the CEO plans it in a turn of its own (a hiring section in its prompt: the departments, their managers, the
// bounds); Orbit carries the plan out at once on the owner's authority -- a department made, everyone hired on
// probation on the model and resources the owner chose, the managers appointed -- and reports it in the conversation.
// A plan that breaks a rule creates nothing; a policy that refuses a hire rolls back the whole plan; a plan written in an
// ordinary answer hires nobody; a request the company cannot take is refused before the CEO spends anything; a request
// is carried out once, whatever is delivered twice; another account sees nothing of it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Constitution } from "@orbit-web/governance-core";
import { DEFAULT_PRESETS, type Department, type EmployeeDetail, type ExecutiveConversationDetail, type ExecutiveSent, type ExecutiveState, type PolicyOverview, type RevisionView, type RuntimeConnection, type StaffingAccepted, type StaffingView } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { StaffingRunner } from "../../src/contexts/executive/application/staffing.js";
import { ExecutiveRepository } from "../../src/contexts/executive/infrastructure/executive.repository.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { executiveAnswer, executiveRun } from "../../src/testing/executive-fixtures.js";
import { FakeProcessPort, program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee } from "../../src/testing/fake-sandbox.js";
import { eventually, signedIn, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
let n = 0;
const key = () => ({ "idempotency-key": `staffing-${Date.now()}-${(n += 1)}` });
const block = (plan: unknown): string => `Here is the team I propose.\n\n\`\`\`orbit-staffing\n${JSON.stringify(plan)}\n\`\`\``;
const person = (name: string, department: string, role: "member" | "manager" = "member") => ({ name, department, role, title: role === "manager" ? "Trưởng phòng" : "Chuyên viên", duties: `${name} lo việc của phòng.`, instructions: "Đọc yêu cầu trước, hỏi khi chưa rõ.", skills: ["tuyển dụng"], languages: ["vi"] });

describe("a hiring request: the CEO plans it, Orbit hires at once on the owner's authority", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  const dept: Record<string, string> = {};
  // What the CEO answers next, from what it was asked.
  let answer: (prompt: string) => string = () => "Noted.";
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
  fake.on(executiveRun, { spawn: (c, call) => executiveAnswer((p) => answer(p))(c, call) });
  const ceoPrompts = (): string[] => fake.children.filter((c) => executiveRun(c.call.file, c.call.args)).map((c) => c.child.written.join(""));

  const execution = () => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    return { runtime: "claude" as const, connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false };
  };
  const hire = async (name: string, departmentId: string | null, title: string): Promise<string> => {
    const r = await b.send("POST", "/api/employees", { name, ...(departmentId !== null ? { departmentId } : {}), profile: { title, duties: "Lead.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: execution(), handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false }, resources: DEFAULT_PRESETS[0]?.profile, skipProbation: true, skipReason: "a test employee" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[name] = (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
    return ids[name] as string;
  };
  const request = (requirement: string, departmentId: string | null, over: Record<string, unknown> = {}) => ({ requirement, departmentId, execution: execution(), resources: DEFAULT_PRESETS[0]?.profile, ...over });
  const staffing = async (id: string): Promise<StaffingView> => (await b.get(`/api/executive/staffing/${id}`)).body as StaffingView;
  const ended = (id: string) => eventually(() => staffing(id), (s) => s.state !== "planning", 30_000);
  const employees = async () => h.sql("SELECT e.name, e.employment, d.name AS department FROM workforce.employees e LEFT JOIN workforce.departments d ON d.account_id = e.account_id AND d.id = e.department_id WHERE e.account_id = $1 ORDER BY e.created_at", [h.accountId as string]);

  before(async () => {
    h = await startHarness({ fake, overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    sandbox.cli.on(program("claude"), { spawn: scriptedEmployee(async () => undefined) });
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Staffing Co" })).status, 200);
  });

  after(async () => {
    await h?.close();
  });

  test("with no CEO, a request is refused before anything is made", async () => {
    const r = await b.send("POST", "/api/executive/staffing", request("Two analysts.", null), key());
    assert.deepEqual([r.status, code(r)], [409, "no_ceo"]);
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM executive.staffing_requests"))[0]?.n), 0);
  });

  test("one request: a department made with its manager, members hired there and into a department that exists -- on probation, on the owner's choice", async () => {
    for (const name of ["Research", "Phòng FX"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    await hire("An", null, "Chief executive");
    await hire("Minh", dept.Research as string, "Research manager");
    for (const body of [{ role: "ceo", employeeId: ids.An }, { role: "manager", departmentId: dept.Research, employeeId: ids.Minh }]) assert.equal((await b.send("POST", "/api/office/appointments", { ...body, reason: "leadership" })).status, 201);
    const s = (await b.get("/api/executive")).body as ExecutiveState;
    assert.deepEqual([s.recruit.ok, s.recruit.code], [true, null]);

    answer = (p) => (p.includes("<hiring-") ? block({ departments: [{ name: "Phòng Nhân sự" }], hires: [person("Lan", "Phòng Nhân sự", "manager"), person("Hoa", "phòng nhân sự"), person("Binh", "Phòng FX"), person("Tú", "Phòng FX")] }) : "Noted.");
    const k = key();
    const sent = await b.send("POST", "/api/executive/staffing", request("Cần một phòng Nhân sự có trưởng phòng và một chuyên viên, và hai người cho Phòng FX.", null), k);
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const accepted = sent.body as StaffingAccepted;
    assert.equal(accepted.turn.kind, "staffing");
    const again = await b.send("POST", "/api/executive/staffing", request("Cần một phòng Nhân sự có trưởng phòng và một chuyên viên, và hai người cho Phòng FX.", null), k);
    assert.deepEqual([again.status, (again.body as StaffingAccepted).staffingId], [202, accepted.staffingId], "one key is one request");

    const done = await ended(accepted.staffingId);
    assert.equal(done.state, "hired", JSON.stringify(done.outcome));
    assert.deepEqual(done.outcome?.departmentsCreated.map((d) => d.name), ["Phòng Nhân sự"]);
    assert.deepEqual(done.outcome?.hired.map((x) => [x.name, x.departmentName, x.role]), [["Lan", "Phòng Nhân sự", "manager"], ["Hoa", "Phòng Nhân sự", "member"], ["Binh", "Phòng FX", "member"], ["Tú", "Phòng FX", "member"]]);
    assert.deepEqual(done.outcome?.appointed.map((x) => [x.name, x.departmentName]), [["Lan", "Phòng Nhân sự"]]);
    const rows = await employees();
    assert.deepEqual(rows.slice(-4).map((r) => [r.name, r.employment, r.department]), [["Lan", "probation", "Phòng Nhân sự"], ["Hoa", "probation", "Phòng Nhân sự"], ["Binh", "probation", "Phòng FX"], ["Tú", "probation", "Phòng FX"]]);
    // Each runs on the owner's choice, with the preset, and the CEO's words for what it does.
    const lan = (await b.get(`/api/employees/${done.outcome?.hired[0]?.employeeId}`)).body as EmployeeDetail;
    assert.deepEqual([lan.profile.execution.model, lan.profile.execution.effort, lan.profile.title, lan.profile.canDelegate, lan.profile.maxAssistants], [execution().model, execution().effort, "Trưởng phòng", true, 2]);
    assert.deepEqual(lan.resourceRevisions.at(-1)?.profile, DEFAULT_PRESETS[0]?.profile);
    // The CEO was asked with the company's departments, their managers and the bounds; nothing else chose a model.
    const prompt = ceoPrompts().at(-1) ?? "";
    assert.match(prompt, /<hiring-[0-9a-f]{16}>[\s\S]*- Research: manager Minh[\s\S]*- Phòng FX: no manager[\s\S]*at most 10 hire\(s\)[\s\S]*<\/hiring-[0-9a-f]{16}>/);
    // Orbit's report in the conversation, beside the CEO's answer (whose block is not shown).
    const d = (await b.get(`/api/executive/conversations/${accepted.conversationId}`)).body as ExecutiveConversationDetail;
    assert.deepEqual(d.messages.map((m) => m.role), ["owner", "ceo", "system"]);
    assert.ok(!(d.messages[1]?.text ?? "").includes("orbit-staffing"));
    const report = d.messages[2]?.report;
    assert.deepEqual([report?.kind, report?.title], ["staffing", "Hired 4 employees on your hiring request"]);
    assert.deepEqual(report?.items.map((i) => [i.title, i.href?.startsWith("#/office/employee/")]), [["Lan", true], ["Hoa", true], ["Binh", true], ["Tú", true]]);
    // Recorded as the owner's own commands, correlated to the request.
    const audit = await h.sql("SELECT principal_type, data->>'command' AS command FROM governance.audit_events WHERE account_id = $1 AND correlation_id = $2 AND event_type = 'office.command' ORDER BY seq", [h.accountId as string, `staffing:${accepted.staffingId}`]);
    assert.deepEqual(audit.map((r) => r.command), ["department.create", "employee.hire", "employee.hire", "employee.hire", "employee.hire", "appointment.appoint", "executive.staffing"]);
    assert.ok(audit.every((r) => r.principal_type !== "agent" && r.principal_type !== "system"), JSON.stringify(audit));

    // Delivered twice, carried out once.
    const turn = await h.app.get(ExecutiveRepository).turn(h.accountId as string, accepted.turn.id);
    assert.ok(turn !== null);
    await h.app.get(StaffingRunner).settled(turn, JSON.stringify({ hires: [person("Lan", "Phòng FX")] }), { completed: true, detail: null });
    assert.equal((await employees()).length, rows.length, "nobody hired twice");
    // A hiring request's turn is sent again, never asked again.
    const retried = await b.send("POST", `/api/executive/conversations/${accepted.conversationId}/turns/${accepted.turn.id}/retry`, {});
    assert.ok([409].includes(retried.status), JSON.stringify(retried.body));
  });

  test("a plan that breaks a rule creates nothing, and every problem is listed", async () => {
    const before = (await employees()).length;
    answer = (p) => (p.includes("<hiring-") ? block({ departments: [{ name: "Research" }], hires: [person("Quang", "Research", "manager"), person("Vy", "Nowhere")] }) : "Noted.");
    const sent = await b.send("POST", "/api/executive/staffing", request("Two more for Research.", null), key());
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const done = await ended((sent.body as StaffingAccepted).staffingId);
    assert.equal(done.state, "refused");
    const problems = done.outcome?.problems.join("\n") ?? "";
    assert.match(problems, /"Research" is a department already/);
    assert.match(problems, /"Nowhere" is neither a department/);
    assert.match(problems, /Research has a manager in office \(Minh\)/);
    assert.equal((await employees()).length, before, "nobody hired");
    const d = (await b.get(`/api/executive/conversations/${(sent.body as StaffingAccepted).conversationId}`)).body as ExecutiveConversationDetail;
    assert.equal(d.messages.at(-1)?.report?.title, "Your hiring request was not carried out");
  });

  test("a request for one department keeps every hire in it; the CEO is told so", async () => {
    answer = (p) => (p.includes("<hiring-") ? block({ hires: [person("Khoa", "Phòng FX")] }) : "Noted.");
    const sent = await b.send("POST", "/api/executive/staffing", request("Một người nữa.", dept["Phòng FX"] as string), key());
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const done = await ended((sent.body as StaffingAccepted).staffingId);
    assert.deepEqual([done.state, done.departmentName, done.outcome?.hired.map((x) => x.departmentName)], ["hired", "Phòng FX", ["Phòng FX"]]);
    assert.match(ceoPrompts().at(-1) ?? "", /Scope: the department "Phòng FX" only/);
  });

  test("a staffing plan written in an ordinary answer hires nobody, and says so", async () => {
    const before = (await employees()).length;
    answer = () => block({ hires: [person("Sneaky", "Phòng FX")] });
    const sent = await b.send("POST", "/api/executive/conversations", { text: "Hire Sneaky into FX." }, key());
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const id = (sent.body as ExecutiveSent).conversationId;
    const d = await eventually(async () => (await b.get(`/api/executive/conversations/${id}`)).body as ExecutiveConversationDetail, (x) => x.turns.every((t) => !["queued", "waiting", "running"].includes(t.state)), 30_000);
    assert.equal(d.turns[0]?.kind, "answer");
    assert.match(d.messages.at(-1)?.proposalNote ?? "", /Orbit hires only on a hiring request \(Recruit\), so nobody was hired/);
    assert.equal((await employees()).length, before);
    assert.ok(!(ceoPrompts().at(-1) ?? "").includes("<hiring-"), "an ordinary answer has no hiring section");
  });

  test("refused before the CEO spends anything: a model the connection does not offer, a department that is not live, a field no request has", async () => {
    const turns = Number((await h.sql("SELECT count(*) AS n FROM executive.turns WHERE account_id = $1", [h.accountId as string]))[0]?.n);
    const model = await b.send("POST", "/api/executive/staffing", request("Two analysts.", null, { execution: { ...execution(), model: "no-such-model" } }), key());
    assert.deepEqual([model.status, code(model)], [422, "model_not_offered"]);
    const gone = await b.send("POST", "/api/executive/staffing", request("Two analysts.", "d1000000-0000-4000-8000-00000000dead"), key());
    assert.equal(gone.status, 404);
    const extra = await b.send("POST", "/api/executive/staffing", { ...request("Two analysts.", null), approve: true }, key());
    assert.equal(extra.status, 400);
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM executive.turns WHERE account_id = $1", [h.accountId as string]))[0]?.n), turns, "no turn was asked");
  });

  test("a policy that refuses a hire refuses the whole plan: the department it made is rolled back too", async () => {
    const company = async (): Promise<RevisionView> => ((await b.get("/api/governance/policy")).body as PolicyOverview).effective as RevisionView;
    const current = await company();
    const doc = current.document as Constitution;
    const draft = await b.send("POST", "/api/governance/revisions", { document: { ...doc, rules: [...doc.rules, { id: "no-hiring", action: "employee.hire", effect: "deny" }] } });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const r = draft.body as RevisionView;
    assert.equal((await b.send("POST", `/api/governance/revisions/${r.id}/validate`, {})).status, 200);
    assert.equal((await b.send("POST", `/api/governance/revisions/${r.id}/publish`, { digest: r.digest, base: current.id, acknowledgedRisk: "high" })).status, 200);
    const before = { people: (await employees()).length, departments: Number((await h.sql("SELECT count(*) AS n FROM workforce.departments WHERE account_id = $1", [h.accountId as string]))[0]?.n) };
    answer = (p) => (p.includes("<hiring-") ? block({ departments: [{ name: "Legal" }], hires: [person("Tâm", "Legal", "manager")] }) : "Noted.");
    const sent = await b.send("POST", "/api/executive/staffing", request("A legal team.", null), key());
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const done = await ended((sent.body as StaffingAccepted).staffingId);
    assert.equal(done.state, "refused");
    assert.match(done.outcome?.problems[0] ?? "", /policy .*employee\.hire.*Nothing was hired/);
    assert.equal((await employees()).length, before.people);
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.departments WHERE account_id = $1", [h.accountId as string]))[0]?.n), before.departments, "Legal was not left behind");
  });

  test("another account sees nothing of a hiring request", async () => {
    const [mine] = await h.sql("SELECT id FROM executive.staffing_requests WHERE account_id = $1 LIMIT 1", [h.accountId as string]);
    const other = await h.as("staffing-other");
    const r = await other.get(`/api/executive/staffing/${String(mine?.id)}`);
    assert.ok([404, 409].includes(r.status), JSON.stringify(r.body));
  });
});
