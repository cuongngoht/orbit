// WHO A MISSION GOES TO, through HTTP on PostgreSQL (ADR 0061 §8): a department goes to its manager in office, the CEO to
// the CEO -- resolved in the transaction that makes the mission, and held to what the person saw before sending. Nobody in
// the slot (no_ceo, no_manager), a suspended holder (appointment_suspended), a slot that moved since the person looked
// (target_changed, with who is responsible now) are refused and make nothing; a refusal and a success are the answer to
// their Idempotency-Key, replayed as they were even after the slot moved. Two names for one target conflict (422). The
// CEO gives work only to departments: with no department that has a manager in office, work for it -- by its slot or by
// its name -- is refused before anything is made (ceo_needs_departments).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AppointmentView, type AppointmentsView, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type MissionTargetPreview, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `target-key-${Date.now()}-${(n += 1)}` });

describe("a mission given to a department or to the CEO: resolved now, held to what the person saw", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  const dept: Record<string, string> = {};

  const hire = async (name: string, departmentId: string | null): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title: "Analyst", duties: "Work.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    ids[name] = d.id;
    return d;
  };
  const give = (target: unknown, extra: Record<string, unknown> = {}, k = key()) => b.send("POST", "/api/missions", { title: "Targeted", goal: "[idle] Some work.", target, whenBusy: "enqueue", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Done"], ...extra }, k);
  const preview = async (q: string) => (await b.get(`/api/missions/target?${q}`)).body as MissionTargetPreview;
  const appointments = async () => (await b.get("/api/office/appointments")).body as AppointmentsView;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Targets Co" })).status, 200);
    for (const name of ["Research", "Legal"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    // Every employee here just waits (the work itself is not what is tested).
    sandbox.cli.on(program("claude"), { spawn: scriptedEmployee(async () => undefined) });
    await hire("An", null);
    await hire("Minh", dept.Research as string);
    await hire("Mai", dept.Research as string);
  });

  after(async () => {
    await h?.close();
  });

  test("nobody in the slot is refused with why (no_ceo, no_manager) -- and nothing is made", async () => {
    assert.equal((await preview("kind=ceo")).code, "no_ceo");
    assert.equal(code(await give({ kind: "ceo" })), "no_ceo");
    assert.equal((await preview(`kind=department&departmentId=${dept.Legal}`)).code, "no_manager");
    assert.equal(code(await give({ kind: "department", departmentId: dept.Legal })), "no_manager");
    const missions = await h.sql("SELECT count(*)::int AS n FROM workforce.missions WHERE account_id = $1", [h.accountId]);
    assert.equal(missions[0]?.n, 0);
  });

  test("a department goes to its manager in office, kept on the mission with the appointment that resolved it", async () => {
    const r = await b.send("POST", "/api/office/appointments", { role: "manager", departmentId: dept.Research, employeeId: ids.Minh });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const p = await preview(`kind=department&departmentId=${dept.Research}`);
    assert.deepEqual([p.responsible?.employeeId, p.responsible?.role, p.responsible?.departmentName, p.responsible?.appointmentRevision], [ids.Minh, "manager", "Research", 1]);
    const made = await give({ kind: "department", departmentId: dept.Research }, { expectedAssignee: { employeeId: ids.Minh, appointmentId: p.responsible?.appointmentId, appointmentRevision: 1 } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((made.body as MissionAccepted).employeeId, ids.Minh);
    const m = (await b.get(`/api/missions/${(made.body as MissionAccepted).missionId}`)).body as MissionDetail;
    assert.deepEqual(m.target, { kind: "department", departmentId: dept.Research, departmentName: "Research", appointmentId: p.responsible?.appointmentId ?? null, appointmentRevision: 1 });
  });

  test("the slot moved since the person looked: target_changed with who is responsible now; replayed under its key as it was, even later", async () => {
    const before = await preview(`kind=department&departmentId=${dept.Research}`);
    const manager = (await appointments()).managers.find((x) => x.departmentId === dept.Research) as AppointmentView;
    const replaced = await b.send("POST", `/api/office/appointments/${manager.id}/replace`, { employeeId: ids.Mai, reason: "Minh moves to strategy" }, ifMatch(manager.version));
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    const k = key();
    const seen = { employeeId: ids.Minh, appointmentId: before.responsible?.appointmentId, appointmentRevision: before.responsible?.appointmentRevision };
    const refused = await give({ kind: "department", departmentId: dept.Research }, { expectedAssignee: seen }, k);
    assert.equal(refused.status, 409);
    assert.equal(code(refused), "target_changed");
    assert.equal((refused.body as { error: { details: { current: { employeeId: string } } } }).error.details.current.employeeId, ids.Mai);
    // The same key and request again: the same refusal, without resolving again.
    const again = await give({ kind: "department", departmentId: dept.Research }, { expectedAssignee: seen }, k);
    assert.deepEqual([again.status, code(again)], [409, "target_changed"]);
    // A success is replayed as it was too, even after the slot moved again.
    const k2 = key();
    const now = await preview(`kind=department&departmentId=${dept.Research}`);
    const made = await give({ kind: "department", departmentId: dept.Research }, { expectedAssignee: { employeeId: ids.Mai, appointmentId: now.responsible?.appointmentId, appointmentRevision: now.responsible?.appointmentRevision } }, k2);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const mai = (await appointments()).managers.find((x) => x.departmentId === dept.Research) as AppointmentView;
    assert.equal((await b.send("POST", `/api/office/appointments/${mai.id}/suspend`, { reason: "on leave" }, ifMatch(mai.version))).status, 200);
    const replay = await give({ kind: "department", departmentId: dept.Research }, { expectedAssignee: { employeeId: ids.Mai, appointmentId: now.responsible?.appointmentId, appointmentRevision: now.responsible?.appointmentRevision } }, k2);
    assert.deepEqual([replay.status, (replay.body as MissionAccepted).missionId], [201, (made.body as MissionAccepted).missionId]);
    // A new request meets the suspended manager.
    assert.equal(code(await give({ kind: "department", departmentId: dept.Research })), "appointment_suspended");
  });

  test("the CEO takes work only while a department has a manager in office: refused before (ceo_needs_departments), by slot or by name, replayed under its key", async () => {
    assert.equal((await b.send("POST", "/api/office/appointments", { role: "ceo", employeeId: ids.An })).status, 201);
    // Research's manager is suspended and Legal has none: nobody the CEO could give the work to.
    const nobody = await preview("kind=ceo");
    assert.deepEqual([nobody.responsible, nobody.code], [null, "ceo_needs_departments"]);
    assert.match(nobody.reason ?? "", /create a department and appoint its manager, or give the work to an employee/);
    const k = key();
    const refused = await give({ kind: "ceo" }, {}, k);
    assert.deepEqual([refused.status, code(refused)], [409, "ceo_needs_departments"]);
    const again = await give({ kind: "ceo" }, {}, k);
    assert.deepEqual([again.status, code(again)], [409, "ceo_needs_departments"], "the refusal is the answer to its key");
    const byName = await b.send("POST", "/api/missions", { title: "x", goal: "[idle] x", targetEmployeeId: ids.An, whenBusy: "enqueue", deliverables: [], acceptanceCriteria: [] }, key());
    assert.deepEqual([byName.status, code(byName)], [409, "ceo_needs_departments"], "the CEO by name is the CEO");
    const made = await h.sql("SELECT count(*)::int AS n FROM workforce.missions m JOIN workforce.assignments a ON a.account_id = m.account_id AND a.mission_id = m.id WHERE m.account_id = $1 AND a.employee_id = $2", [h.accountId, ids.An]);
    assert.equal(made[0]?.n, 0, "nothing was made for the CEO");
  });

  test("the CEO: resolved to the CEO in office once a department has a manager; two names for one target conflict (422 target_conflict)", async () => {
    const mai = (await appointments()).managers.find((x) => x.departmentId === dept.Research) as AppointmentView;
    assert.equal((await b.send("POST", `/api/office/appointments/${mai.id}/reinstate`, { reason: "back" }, ifMatch(mai.version))).status, 200);
    const p = await preview("kind=ceo");
    assert.deepEqual([p.code, p.responsible?.employeeId, p.responsible?.role], [null, ids.An, "ceo"]);
    const made = await give({ kind: "ceo" });
    assert.ok(made.status === 201 || made.status === 202, JSON.stringify(made.body));
    assert.equal((made.body as MissionAccepted).employeeId, ids.An);
    const both = await b.send("POST", "/api/missions", { title: "x", goal: "x", target: { kind: "ceo" }, targetEmployeeId: ids.Mai, deliverables: [], acceptanceCriteria: [] }, key());
    assert.deepEqual([both.status, code(both)], [422, "target_conflict"]);
    const legacy = await b.send("POST", "/api/missions", { title: "x", goal: "[idle] x", targetEmployeeId: ids.An, whenBusy: "enqueue", deliverables: [], acceptanceCriteria: [] }, key());
    assert.equal(legacy.status, 202, "a mission given to an employee by name, as before");
  });
});
