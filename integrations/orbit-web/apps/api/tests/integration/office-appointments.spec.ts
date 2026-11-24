// THE COMPANY'S AUTHORITY, through HTTP as a browser does it, on PostgreSQL (ADR 0061 §8): a CEO and a manager per
// department, each an existing employee, appointed, replaced, suspended, reinstated and revoked against the version read
// and recorded; at most one incumbent per slot and per employee, a manager a member of its department -- held by the
// database too, whatever path a write takes. A title, instructions or canDelegate grant nothing. Delegation grants give a
// regular employee the right to give work. Execution defaults fill what a profile leaves to its department or company;
// a provider change keeps the employee; open work moves to another employee only by a handover. No real AI account: the
// Claude Code CLI is the harness's fake, and the sandbox the in-memory provider.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AppointmentView, type AppointmentsView, type AssignmentView, type DelegationGrantView, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type Roster, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let keys = 0;
const key = () => ({ "idempotency-key": `appointments-${Date.now()}-${(keys += 1)}` });

describe("the company's authority: appointments, delegation grants, execution defaults, handover", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  const models: string[] = [];

  const hire = async (name: string, departmentId: string | null, over: Record<string, unknown> = {}): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: {
        title: "Analyst",
        duties: "Do the work given.",
        instructions: "Be exact.",
        skills: [],
        languages: ["en"],
        knowledge: [],
        execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false },
        handoffStandard: "",
        reportingRule: "",
        canDelegate: false,
        maxAssistants: 0,
        canHirePermanent: false,
        ...over,
      },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const e = r.body as EmployeeDetail;
    return eventually(async () => (await b.get(`/api/employees/${e.id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
  };
  const appoint = (body: Record<string, unknown>) => b.send("POST", "/api/office/appointments", body);
  const appointments = async () => (await b.get("/api/office/appointments")).body as AppointmentsView;
  const employee = async (id: string) => (await b.get(`/api/employees/${id}`)).body as EmployeeDetail;
  const mission = async (id: string) => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const root = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId === null) as AssignmentView;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.auth === "connected") as RuntimeConnection;
    models.push(...connection.catalog.models.map((m) => m.id));
    // An attempt asks when its goal says [ask], and hands a report in otherwise.
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t) => {
        if (t.prompt.includes("[ask]") && !t.prompt.includes("Answers you were given")) {
          await t.call("ask_question", { question: "Which region?" });
          return;
        }
        await t.call("write_file", { path: "/output/report.md", content: "# Report\n" });
        await t.call("submit_handoff", { summary: "Done.", claims: [] });
      }),
    });
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Authority Co" })).status, 200);
    for (const name of ["Research", "Finance"]) {
      const d = await b.send("POST", "/api/office/departments", { name });
      assert.equal(d.status, 201, JSON.stringify(d.body));
      ids[name] = (d.body as Department).id;
    }
    ids.an = (await hire("An", null, { canDelegate: true, title: "Chief Executive Officer", instructions: "You run the company." })).id;
    ids.minh = (await hire("Minh", ids.Research as string)).id;
    ids.lan = (await hire("Lan", ids.Research as string)).id;
    ids.hoa = (await hire("Hoa", ids.Finance as string)).id;
    ids.binh = (await hire("Binh", ids.Finance as string)).id;
  });

  after(async () => {
    await h?.close();
  });

  test("a title, instructions and canDelegate grant no authority: nobody holds an appointment until a person makes one", async () => {
    const roster = (await b.get("/api/office/roster")).body as Roster;
    assert.equal(roster.ceo, null, "a company works without a CEO");
    assert.ok(roster.departments.every((d) => d.manager === null), "and departments without managers");
    assert.equal(roster.employees.find((e) => e.id === ids.an)?.role, null, "An's title and canDelegate make nobody a CEO");
    assert.equal((await appointments()).history.length, 0);
  });

  test("one CEO, appointed by a person and recorded; a second is refused; a manager is a member of its department", async () => {
    const ceo = await appoint({ role: "ceo", employeeId: ids.an, reason: "founder" });
    assert.equal(ceo.status, 201, JSON.stringify(ceo.body));
    const a = ceo.body as AppointmentView;
    assert.deepEqual([a.role, a.employeeName, a.state, a.slotRevision, a.departmentId], ["ceo", "An", "active", 1, null]);
    assert.equal(code(await appoint({ role: "ceo", employeeId: ids.minh })), "appointment_conflict", "one incumbent CEO");
    const outsider = await appoint({ role: "manager", departmentId: ids.Finance, employeeId: ids.lan });
    assert.equal(code(outsider), "manager_not_member", "Lan is a member of Research, not Finance");
    const manager = await appoint({ role: "manager", departmentId: ids.Research, employeeId: ids.minh });
    assert.equal(manager.status, 201, JSON.stringify(manager.body));
    const roster = (await b.get("/api/office/roster")).body as Roster;
    assert.equal(roster.ceo?.employeeId, ids.an);
    assert.equal(roster.departments.find((d) => d.id === ids.Research)?.manager?.name, "Minh");
    assert.equal(roster.employees.find((e) => e.id === ids.minh)?.role, "manager");
    const audit = await h.sql("SELECT data->>'command' AS command FROM audit_events WHERE account_id = $1 AND event_type = 'office.command' AND data->>'command' LIKE 'appointment.%' ORDER BY seq", [h.accountId as string]);
    assert.deepEqual(audit.map((r) => r.command), ["appointment.appoint", "appointment.appoint"]);
    const events = await h.sql("SELECT payload->>'change' AS change FROM workforce.events WHERE account_id = $1 AND type = 'AppointmentChanged' ORDER BY occurred_at", [h.accountId as string]);
    assert.deepEqual(events.map((r) => r.change), ["appointed", "appointed"]);
  });

  test("an employee holds one appointment; the database refuses a second incumbent whatever path writes it", async () => {
    assert.equal(code(await appoint({ role: "manager", departmentId: ids.Research, employeeId: ids.lan })), "appointment_conflict", "Research has its manager");
    await assert.rejects(
      h.sql("INSERT INTO workforce.appointments (id, account_id, role, department_id, employee_id, state, slot_revision, appointed_by, appointed_at, updated_at) VALUES (gen_random_uuid(), $1, 'ceo', NULL, $2, 'active', 99, 'test', now(), now())", [h.accountId as string, ids.binh]),
      /one_incumbent_ceo/,
    );
  });

  test("replace keeps the slot filled and numbered, the replaced one kept as history; a stale version is refused; suspend, reinstate and revoke move the incumbent", async () => {
    const before = (await appointments()).managers.find((m) => m.departmentId === ids.Research) as AppointmentView;
    const stale = await b.send("POST", `/api/office/appointments/${before.id}/replace`, { employeeId: ids.lan }, ifMatch(before.version + 5));
    assert.equal(stale.status, 412, JSON.stringify(stale.body));
    const replaced = await b.send("POST", `/api/office/appointments/${before.id}/replace`, { employeeId: ids.lan, reason: "Minh leads the field team" }, ifMatch(before.version));
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    const next = replaced.body as AppointmentView;
    assert.deepEqual([next.employeeName, next.slotRevision, next.replaces, next.state], ["Lan", 2, before.id, "active"]);
    const history = (await appointments()).history.filter((h) => h.departmentId === ids.Research);
    assert.deepEqual(history.map((x) => [x.employeeName, x.state]).sort(), [["Lan", "active"], ["Minh", "replaced"]]);
    const suspended = await b.send("POST", `/api/office/appointments/${next.id}/suspend`, {}, ifMatch(next.version));
    assert.equal((suspended.body as AppointmentView).state, "suspended");
    assert.equal(code(await appoint({ role: "manager", departmentId: ids.Research, employeeId: ids.minh })), "appointment_conflict", "a suspended incumbent still holds the slot");
    const reinstated = await b.send("POST", `/api/office/appointments/${next.id}/reinstate`, {}, ifMatch((suspended.body as AppointmentView).version));
    assert.equal((reinstated.body as AppointmentView).state, "active");
    const revoked = await b.send("POST", `/api/office/appointments/${next.id}/revoke`, { reason: "reorganised" }, ifMatch((reinstated.body as AppointmentView).version));
    assert.equal((revoked.body as AppointmentView).state, "revoked");
    assert.equal(code(await b.send("POST", `/api/office/appointments/${next.id}/reinstate`, {}, ifMatch((revoked.body as AppointmentView).version))), "invalid_transition", "an ended appointment stays ended");
    const again = await appoint({ role: "manager", departmentId: ids.Research, employeeId: ids.minh });
    assert.equal((again.body as AppointmentView).slotRevision, 3, "the slot's next appointment is numbered after every one before");
  });

  test("two people appoint the same slot at the same instant: exactly one wins", async () => {
    const [one, two] = await Promise.all([appoint({ role: "manager", departmentId: ids.Finance, employeeId: ids.hoa }), appoint({ role: "manager", departmentId: ids.Finance, employeeId: ids.binh })]);
    assert.deepEqual([one.status, two.status].sort(), [201, 409], JSON.stringify([one.body, two.body]));
    assert.equal((await appointments()).managers.filter((m) => m.departmentId === ids.Finance).length, 1);
  });

  test("an appointee is not moved out, archived, nor its department archived from under it", async () => {
    const minh = await employee(ids.minh as string);
    assert.equal(code(await b.send("POST", `/api/employees/${ids.minh}/department`, { departmentId: null }, ifMatch(minh.version))), "appointed_manager");
    assert.equal(code(await b.send("POST", `/api/employees/${ids.minh}/employment`, { command: "archive", reason: "left" }, ifMatch(minh.version))), "employee_appointed");
    const research = ((await b.get("/api/office/roster")).body as Roster).departments.find((d) => d.id === ids.Research) as Department;
    assert.equal(code(await b.send("POST", `/api/office/departments/${ids.Research}/archive`, { moveTo: null }, ifMatch(research.version))), "department_has_manager");
    // Whatever path a write takes, the database holds it at commit.
    await assert.rejects(h.sql("UPDATE workforce.employees SET department_id = NULL, version = version + 1 WHERE account_id = $1 AND id = $2", [h.accountId as string, ids.minh]), /no longer matches/);
  });

  test("a delegation grant lets a regular employee give work: given, refused twice, revoked against the version read", async () => {
    const given = await b.send("POST", `/api/employees/${ids.binh}/delegation-grants`, { target: { kind: "employee", employeeId: ids.lan }, note: "pairs on the forecast" });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const g = given.body as DelegationGrantView;
    assert.deepEqual([g.target.kind, g.target.name, g.state], ["employee", "Lan", "active"]);
    assert.equal(code(await b.send("POST", `/api/employees/${ids.binh}/delegation-grants`, { target: { kind: "employee", employeeId: ids.lan } })), "delegation_exists");
    assert.equal(code(await b.send("POST", `/api/employees/${ids.binh}/delegation-grants`, { target: { kind: "employee", employeeId: ids.binh } })), "delegation_to_self");
    assert.equal((await b.send("POST", `/api/delegation-grants/${g.id}/revoke`, {}, ifMatch(g.version + 1))).status, 412);
    assert.equal((await b.send("POST", `/api/delegation-grants/${g.id}/revoke`, {}, ifMatch(g.version))).status, 200);
    const detail = await employee(ids.binh as string);
    assert.deepEqual(detail.delegationGrants.map((x) => x.state), ["revoked"]);
  });

  test("execution precedence: a model left to the department runs on its default; a mission's override beats it; each field's source is pinned", async () => {
    assert.ok(models.length >= 2, "the catalog has two models to choose between");
    const research = ((await b.get("/api/office/roster")).body as Roster).departments.find((d) => d.id === ids.Research) as Department;
    const departmentModel = models[1] as string;
    const departmentEffort = connection.catalog.models.find((m) => m.id === departmentModel)?.efforts.at(-1) ?? null;
    const set = await b.send("PATCH", `/api/office/departments/${ids.Research}`, { defaults: { claude: { model: departmentModel, effort: departmentEffort } } }, ifMatch(research.version));
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual((set.body as Department).defaults, { claude: { model: departmentModel, effort: departmentEffort } });
    const wrong = ((await b.get("/api/office/roster")).body as Roster).office;
    assert.equal(code(await b.send("PATCH", "/api/office/defaults", { defaults: { codex: { connectionId: connection.id } } }, ifMatch(wrong?.version ?? 0))), "default_connection", "a default never switches an employee's provider");
    // A profile that leaves its model but not its effort is refused when the model needs one: what would run is checked.
    const half = await b.send("POST", "/api/employees", { name: "Half", departmentId: ids.Research, profile: { ...(await employee(ids.lan as string)).profile, execution: { runtime: "claude", connectionId: connection.id, model: "", effort: null, webSearch: false, orbitPlugin: false, inherit: ["model"] } }, resources: DEFAULT_PRESETS[0]?.profile, skipProbation: true, skipReason: "test" });
    assert.equal(code(half), "effort_not_offered", JSON.stringify(half.body));
    const tam = await hire("Tam", ids.Research as string, { execution: { runtime: "claude", connectionId: connection.id, model: "", effort: null, webSearch: false, orbitPlugin: false, inherit: ["model", "effort"] } });
    assert.deepEqual(tam.profile.execution.inherit, ["model", "effort"], "kept as written: a later default applies to later work");
    const made = await b.send("POST", "/api/missions", { title: "Inherited", goal: "Write the report.", targetEmployeeId: tam.id, deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const pinned = await h.sql("SELECT pinned FROM workforce.assignments WHERE account_id = $1 AND id = $2", [h.accountId as string, (made.body as MissionAccepted).assignmentId]);
    const p = pinned[0]?.pinned as { execution: { model: string }; sources: Record<string, string> };
    assert.equal(p.execution.model, departmentModel);
    assert.deepEqual(p.sources, { connection: "employee", model: "department", effort: "department" });
    await eventually(() => mission((made.body as MissionAccepted).missionId), (m) => root(m).state === "AWAITING_ACCEPTANCE");
    const overridden = await b.send("POST", "/api/missions", { title: "Overridden", goal: "Write the report.", targetEmployeeId: ids.hoa, deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [], execution: { model: models[0] } }, key());
    assert.equal(overridden.status, 201, JSON.stringify(overridden.body));
    const p2 = (await h.sql("SELECT pinned FROM workforce.assignments WHERE account_id = $1 AND id = $2", [h.accountId as string, (overridden.body as MissionAccepted).assignmentId]))[0]?.pinned as { sources: Record<string, string> };
    assert.equal(p2.sources.model, "mission");
  });

  test("a provider change is a new profile revision of the SAME employee: its id, appointment and history kept", async () => {
    const minh = await employee(ids.minh as string);
    const model = models.find((m) => m !== minh.profile.execution.model) as string;
    const changed = await b.send("PATCH", `/api/employees/${ids.minh}`, { profile: { ...minh.profile, execution: { ...minh.profile.execution, model } }, note: "another model" }, ifMatch(minh.version));
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const after = await employee(ids.minh as string);
    assert.equal(after.id, minh.id);
    assert.equal(after.profileRevision, minh.profileRevision + 1);
    assert.equal(after.profile.execution.model, model);
    assert.equal(after.appointment?.role, "manager", "the appointment is the employee's, whatever it runs on");
    assert.equal(after.revisions.length, minh.revisions.length + 1);
  });

  test("a handover moves blocked work to another employee with a new fence; the old holder is free; a hand-in awaiting review is refused", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Region", goal: "[ask] Size the market.", targetEmployeeId: ids.binh, deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const blocked = root(await eventually(() => mission(id), (m) => root(m).state === "BLOCKED"));
    await eventually(() => h.sql("SELECT count(*) AS n FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2 AND state IN ('starting', 'running', 'requested')", [h.accountId as string, blocked.id]), (r) => Number(r[0]?.n) === 0);
    const fence = Number((await h.sql("SELECT fence FROM workforce.assignments WHERE id = $1", [blocked.id]))[0]?.fence);
    // Hoa holds the work given above (awaiting review): handing more to her is refused, as giving it would be.
    assert.equal(code(await b.send("POST", `/api/assignments/${blocked.id}/hand-over`, { employeeId: ids.hoa }, ifMatch(blocked.version))), "employee_busy");
    const moved = await b.send("POST", `/api/assignments/${blocked.id}/hand-over`, { employeeId: ids.lan, reason: "Lan knows the region" }, ifMatch(blocked.version));
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const row = (await h.sql("SELECT employee_id, fence, pinned FROM workforce.assignments WHERE id = $1", [blocked.id]))[0];
    assert.equal(row?.employee_id, ids.lan);
    assert.equal(Number(row?.fence), fence + 1, "a new fence: the old holder's late result is refused");
    assert.equal((await h.sql("SELECT employee_id FROM workforce.reservations WHERE assignment_id = $1", [blocked.id]))[0]?.employee_id, ids.lan, "the reservation moved with it");
    assert.equal(Number((await h.sql("SELECT count(*) AS n FROM workforce.reservations WHERE employee_id = $1", [ids.binh]))[0]?.n), 0, "Binh is free");
    const audit = await h.sql("SELECT data->>'detail' AS detail FROM audit_events WHERE account_id = $1 AND event_type = 'office.command' AND data->>'command' = 'assignment.hand_over'", [h.accountId as string]);
    assert.match(String(audit[0]?.detail), /Lan knows the region/);
    const after = root(await mission(id));
    const answered = await b.send("POST", `/api/assignments/${after.id}/answer`, { answer: "Southeast Asia" }, ifMatch(after.version));
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    const handed = root(await eventually(() => mission(id), (m) => root(m).state === "AWAITING_ACCEPTANCE"));
    assert.equal(handed.employeeId, ids.lan, "the new holder handed it in");
    assert.equal(code(await b.send("POST", `/api/assignments/${handed.id}/hand-over`, { employeeId: ids.binh }, ifMatch(handed.version))), "invalid_transition", "a hand-in awaiting review is reviewed, not handed over");
  });
});
