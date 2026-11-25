// AN EMPLOYEE ACTS AS ITSELF, end to end through HTTP on PostgreSQL with scripted employees (ADR 0061 §6): what its
// attempt asks through its tools -- a plan, a hand-in -- is decided and recorded as its OWN principal (employee:<id>),
// with the assignment, the mission and the department it runs in; never as a service standing in for it. An appointee in
// force -- a department's manager, the CEO -- may PROPOSE a policy for its own scope, as a draft its owner decides on; an
// employee without an appointment is offered no such tool, and a manager reaches no other department's. A model the
// policy leaves out of the employees' allow-list is refused at hire, never switched for another.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type PolicyOverview, type RevisionView, type RuntimeConnection } from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
let n = 0;
const key = () => ({ "idempotency-key": `principals-key-${Date.now()}-${(n += 1)}` });

describe("an employee acts as itself: decisions on its own principal, proposals by its appointment, models by the policy", () => {
  let h: Harness;
  let b: Browser;
  let accountId: string;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const said: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  const dept: Record<string, string> = {};

  const note = (who: string, what: string) => (said[who] ??= []).push(what);
  const hire = async (name: string, departmentId: string | null, over: { canDelegate?: boolean; model?: string } = {}) => {
    const model = over.model ?? connection.catalog.models[0]?.id;
    const option = connection.catalog.models.find((m) => m.id === model);
    return b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model, effort: option?.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: over.canDelegate === true, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
  };
  const hired = async (name: string, departmentId: string | null, canDelegate = false): Promise<EmployeeDetail> => {
    const r = await hire(name, departmentId, { canDelegate });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    ids[name] = d.id;
    return d;
  };
  const give = (employeeId: string, goal: string) => b.send("POST", "/api/missions", { title: goal.slice(0, 60), goal, targetEmployeeId: employeeId, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Correct"] }, key());
  const toolsOf = async (t: ToolCaller): Promise<string[]> => {
    const res = await fetch(`${t.bridge.url}/list`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-run-token": t.bridge.token, "x-orbit-web": "1" }, body: "{}" });
    return ((await res.json()) as { tools: { name: string }[] }).tools.map((x) => x.name);
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    accountId = h.accountId as string;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Principals Co" })).status, 200);
    for (const name of ["Research", "Finance"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        const who = /\[who:([A-Za-z]+)\]/.exec(p)?.[1] ?? "?";
        if (p.includes("[plan]") && !p.includes("The parts you gave your team")) {
          note(who, (await t.call("delegate", { parts: [{ key: "notes", employee: "Noa", title: "Notes", goal: "[part:notes] Take notes.", deliverables: ["notes.md"] }] })).text);
          return;
        }
        if (p.includes("[plan]")) {
          if (p.includes("awaiting acceptance")) await t.call("review_unit", { part: "notes", decision: "accept" });
          await t.call("write_file", { path: "/output/report.md", content: "# Report\n" });
          await t.call("submit_handoff", { summary: "Integrated the notes." });
          return;
        }
        if (p.includes("[part:notes]")) {
          await t.call("write_file", { path: "/output/notes.md", content: "Notes.\n" });
          await t.call("submit_handoff", { summary: "The notes." });
          return;
        }
        if (p.includes("[propose]")) {
          note(`${who}:tools`, (await toolsOf(t)).join(","));
          const draft = { apiVersion: "orbit.governance/v2", kind: "DepartmentPolicy", metadata: { accountId, departmentId: dept.Research, name: "Research, proposed" }, rules: [], employeeNetwork: { mode: "AUTONOMOUS" } };
          note(`${who}:own`, (await t.call("propose_policy", { scope: "department", department: "Research", document: draft })).text);
          note(`${who}:other`, (await t.call("propose_policy", { scope: "department", department: "Finance", document: { ...draft, metadata: { ...draft.metadata, departmentId: dept.Finance } } })).text);
          note(`${who}:company`, (await t.call("propose_policy", { scope: "company", document: { apiVersion: "orbit.governance/v2", kind: "AccountPolicy", metadata: { accountId, name: "Proposed" } } })).text);
          await t.call("write_file", { path: "/output/report.md", content: "Proposed.\n" });
          await t.call("submit_handoff", { summary: "Proposed." });
        }
      }),
    });
    await hired("Mia", dept.Research as string, true);
    await hired("Noa", dept.Research as string);
    await hired("Ana", null);
    const appoint = async (body: Record<string, unknown>) => {
      const r = await b.send("POST", "/api/office/appointments", body);
      assert.equal(r.status, 201, JSON.stringify(r.body));
    };
    await appoint({ role: "manager", departmentId: dept.Research, employeeId: ids.Mia, reason: "leads Research" });
    await appoint({ role: "ceo", employeeId: ids.Ana, reason: "runs the company" });
  });

  after(async () => {
    await h?.close();
  });

  test("a plan and a hand-in are decided as the employee's own principal, with its assignment, mission and department", async () => {
    const made = await give(ids.Mia as string, "[plan][who:Mia] notes, through the team");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const missionId = (made.body as MissionAccepted).missionId;
    await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as { assignments: { parentId: string | null; state: string }[] }, (m) => m.assignments.find((a) => a.parentId === null)?.state === "AWAITING_ACCEPTANCE", 45_000);
    const decisions = await h.sql(
      "SELECT principal_id, principal_type, agent_id, data->>'action' AS action, data->>'employeeId' AS employee, data->>'missionId' AS mission, data->>'departmentId' AS department FROM audit_events WHERE account_id = $1 AND event_type = 'policy.decision' AND data->>'action' IN ('work.delegate', 'artifact.publish') ORDER BY occurred_at",
      [accountId],
    );
    const delegate = decisions.find((d) => d.action === "work.delegate");
    assert.deepEqual([delegate?.principal_id, delegate?.principal_type, delegate?.agent_id, delegate?.employee, delegate?.mission, delegate?.department], [`employee:${ids.Mia}`, "agent", `employee:${ids.Mia}`, ids.Mia, missionId, dept.Research]);
    const publishers = new Set(decisions.filter((d) => d.action === "artifact.publish").map((d) => d.principal_id));
    assert.deepEqual([...publishers].sort(), [`employee:${ids.Mia}`, `employee:${ids.Noa}`].sort(), "each hand-in is decided as the one who hands it in");
    assert.ok(!decisions.some((d) => String(d.principal_id).startsWith("orbit-")), "never a service standing in for the employee");
    // The owner accepts: Mia is free again.
    const m = (await b.get(`/api/missions/${missionId}`)).body as MissionDetail;
    const root = m.assignments.find((a) => a.parentId === null) as AssignmentView;
    const handed = m.handoffs.find((x) => x.assignmentId === root.id);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` })).status, 200);
  });

  test("an appointee proposes for its own scope, as a draft the owner decides on; nobody else is offered the tool", async () => {
    const manager = await give(ids.Mia as string, "[propose][who:Mia] propose");
    const ceo = await give(ids.Ana as string, "[propose][who:Ana] propose");
    const plain = await give(ids.Noa as string, "[propose][who:Noa] propose");
    for (const r of [manager, ceo, plain]) assert.equal(r.status, 201, JSON.stringify(r.body));
    await eventually(() => said, (s) => ["Mia:company", "Ana:company", "Noa:company"].every((k) => (s[k] ?? []).length > 0), 45_000);
    assert.ok((said["Mia:tools"]?.[0] ?? "").split(",").includes("propose_policy"));
    assert.ok((said["Ana:tools"]?.[0] ?? "").split(",").includes("propose_policy"));
    assert.ok(!(said["Noa:tools"]?.[0] ?? "").split(",").includes("propose_policy"), "a title or a team-lead switch grants nothing");
    assert.match(said["Mia:own"]?.[0] ?? "", /^Proposed the department's policy as draft dpr-/);
    assert.match(said["Mia:other"]?.[0] ?? "", /only its own department/);
    assert.match(said["Mia:company"]?.[0] ?? "", /Only the CEO/);
    assert.match(said["Ana:other"]?.[0] ?? "", /^Proposed the department's policy as draft dpr-/, "the CEO proposes for any department");
    assert.match(said["Ana:company"]?.[0] ?? "", /^Proposed the company's policy as draft rev-/);
    assert.match(said["Noa:own"]?.[0] ?? "", /no tool named propose_policy|Only an appointee/);
    // Drafts only: nothing published, each naming who proposed it.
    const drafts = await h.sql("SELECT data->>'departmentId' AS department, data->>'proposedBy' AS by FROM audit_events WHERE account_id = $1 AND event_type = 'policy.draft.created' AND data->>'source' = 'agent' ORDER BY occurred_at", [accountId]);
    const expected = [[dept.Research, `agent:employee:${ids.Mia}`], [dept.Research, `agent:employee:${ids.Ana}`], [dept.Finance, `agent:employee:${ids.Ana}`], [null, `agent:employee:${ids.Ana}`]];
    assert.deepEqual(drafts.map((d) => [d.department, d.by]).sort(), expected.sort());
    const research = (await b.get(`/api/governance/departments/${dept.Research}/policy`)).body as { effective: unknown };
    assert.equal(research.effective, null, "a proposal publishes nothing");
  });

  test("a model the employees' allow-list leaves out is refused at hire, never switched", async () => {
    const models = connection.catalog.models;
    if (models.length < 2) return;
    const overview = (await b.get("/api/governance/policy")).body as PolicyOverview;
    const current = overview.effective as RevisionView;
    const allowed = `claude:${models[1]?.id}`;
    const draft = await b.send("POST", "/api/governance/revisions", { document: { ...(current.document as Constitution), employeeModels: { allow: [allowed] } } });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const d = draft.body as RevisionView;
    assert.equal((await b.send("POST", `/api/governance/revisions/${d.id}/validate`, {})).status, 200);
    const read = (await b.get(`/api/governance/revisions/${d.id}`)).body as RevisionView;
    const published = await b.send("POST", `/api/governance/revisions/${d.id}/publish`, { digest: read.digest, base: current.id, acknowledgedRisk: read.impact?.risk ?? "high" });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const refused = await hire("Zed", null, { model: models[0]?.id });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(code(refused), "model_not_allowed");
    assert.equal((await hire("Yan", null, { model: models[1]?.id })).status, 201);
  });
});
