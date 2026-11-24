// ROLES IN THE AI WORKFORCE, through HTTP on PostgreSQL with scripted CLIs (ADR 0061 §8, work/domain/roles.ts): what an
// attempt is offered and what its tool door and its hand-in take, from the appointment its employee holds in force.
//
//   - the CEO is offered no shell and no connector tool, and both are refused at the door saying why (the connector is
//     never asked); its hand-in before it gave the work to its departments is refused (ceo_delegates_only);
//   - a manager with a team is offered neither ask_question nor escalate_question (it decides), both are refused at the
//     door, and its hand-in before it gave the work to its team is refused (manager_delegates_to_team); it keeps its
//     shell and its connectors;
//   - a manager alone in its department does the work itself and hands it in.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { CONNECTOR_TOOLS, type ConnectorTools } from "../../src/contexts/execution/application/connector-tools.port.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `roles-key-${Date.now()}-${(n += 1)}` });

// A company system every employee here was let use: who asked it is recorded.
class CompanySystem implements ConnectorTools {
  calls: string[] = [];
  tools() {
    return Promise.resolve([{ name: "crm_lookup", description: "Look a customer up in the CRM.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }]);
  }
  owns(name: string): boolean {
    return name === "crm_lookup";
  }
  call(_ctx: unknown, _orbitId: string, employeeId: string) {
    this.calls.push(employeeId);
    return Promise.resolve({ text: "customer: ACME", isError: false });
  }
}

// A tool's answer as the scripted CLI noted it: refused (isError) with a text that says why, or taken.
function answered(raw: string | undefined, isError: boolean, says: RegExp | null = null): void {
  const a = JSON.parse(raw ?? "{}") as { text?: string; isError?: boolean };
  assert.equal(a.isError, isError, raw);
  if (says !== null) assert.match(a.text ?? "", says);
}

async function toolNames(t: ToolCaller): Promise<string[]> {
  const res = await fetch(`${t.bridge.url}/list`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-run-token": t.bridge.token, "x-orbit-web": "1" }, body: "{}" });
  return ((await res.json()) as { tools: { name: string }[] }).tools.map((x) => x.name).sort();
}

describe("roles: the CEO plans, a manager with a team delegates and decides, a manager alone does the work", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const crm = new CompanySystem();
  const ids: Record<string, string> = {};
  const dept: Record<string, string> = {};
  const said: Record<string, string[]> = {};
  const note = (k: string, v: string) => (said[k] ??= []).push(v);

  const hire = async (name: string, departmentId: string | null): Promise<void> => {
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
  };
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const cancel = async (id: string): Promise<void> => {
    await eventually(async () => {
      const r = (await mission(id)).assignments.find((a) => a.parentId === null);
      if (r === undefined || r.state === "CANCELLED" || r.state === "CANCELLING") return true;
      return (await b.send("POST", `/api/assignments/${r.id}/cancel`, { reason: "probed" }, ifMatch(r.version))).status === 200;
    }, (ok) => ok, 30_000);
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox], [CONNECTOR_TOOLS, crm]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Roles Co" })).status, 200);
    for (const name of ["Research", "Finance"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        if (p.includes("[ceo-probe]")) {
          if (p.includes("The parts you gave your team")) return;
          note("ceo:tools", (await toolNames(t)).join(","));
          note("ceo:prompt", p);
          note("ceo:shell", JSON.stringify(await t.call("shell", { command: "ls" })));
          note("ceo:crm", JSON.stringify(await t.call("crm_lookup", {})));
          await t.call("write_file", { path: "/output/plan.md", content: "Done by myself.\n" });
          note("ceo:handin", JSON.stringify(await t.call("submit_handoff", { summary: "Done by myself." })));
          note("ceo:delegate", (await t.call("delegate", { parts: [{ key: "probe", department: "Research", title: "Probe", goal: "[manager-probe] Look into it.", deliverables: ["probe.md"] }] })).text);
          return;
        }
        if (p.includes("[manager-probe]")) {
          if (p.includes("The parts you gave your team")) return;
          note("manager:tools", (await toolNames(t)).join(","));
          note("manager:prompt", p);
          note("manager:ask", JSON.stringify(await t.call("ask_question", { question: "Which region?" })));
          note("manager:escalate", JSON.stringify(await t.call("escalate_question", { question_id: "00000000-0000-0000-0000-000000000000", why: "human_decision" })));
          note("manager:crm", JSON.stringify(await t.call("crm_lookup", {})));
          await t.call("write_file", { path: "/output/probe.md", content: "Done by myself.\n" });
          note("manager:handin", JSON.stringify(await t.call("submit_handoff", { summary: "Done by myself." })));
          return;
        }
        if (p.includes("[alone]")) {
          note("alone:tools", (await toolNames(t)).join(","));
          note("alone:prompt", p);
          await t.call("write_file", { path: "/output/report.md", content: "# Done\n" });
          note("alone:handin", JSON.stringify(await t.call("submit_handoff", { summary: "Done myself: nobody else in Finance." })));
        }
      }),
    });
    await hire("An", null);
    await hire("Minh", dept.Research as string);
    await hire("Lan", dept.Research as string);
    await hire("Hoa", dept.Finance as string);
    for (const body of [{ role: "ceo", employeeId: ids.An }, { role: "manager", departmentId: dept.Research, employeeId: ids.Minh }, { role: "manager", departmentId: dept.Finance, employeeId: ids.Hoa }]) {
      const r = await b.send("POST", "/api/office/appointments", { ...body, reason: "the roles under test" });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
  });

  after(async () => {
    await h?.close();
  });

  test("the CEO: no shell, no company system, no hand-in before the departments; a manager with a team: no asking up, no hand-in before its team", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Probe", goal: "[ceo-probe] Plan the probe.", target: { kind: "ceo" }, whenBusy: "reject", deliverables: [{ name: "plan.md", required: true }], acceptanceCriteria: ["Done"] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await eventually(() => said["manager:handin"] ?? [], (x) => x.length > 0, 60_000);

    // The CEO.
    const ceoTools = (said["ceo:tools"]?.[0] ?? "").split(",");
    assert.ok(!ceoTools.includes("shell"), ceoTools.join(","));
    assert.ok(!ceoTools.includes("crm_lookup"), "no company system is offered to the CEO");
    assert.ok(!ceoTools.includes("escalate_question"));
    for (const kept of ["delegate", "read_file", "write_file", "submit_handoff", "ask_question"]) assert.ok(ceoTools.includes(kept), `${kept}: ${ceoTools.join(",")}`);
    assert.match(said["ceo:prompt"]?.[0] ?? "", /You are the CEO\. You plan and synthesize; you never do the work yourself\./);
    for (const k of ["ceo:shell", "ceo:crm"]) answered(said[k]?.[0], true, /The CEO does not run commands or read the company's systems/);
    assert.ok(!crm.calls.includes(ids.An as string), "the CEO's call never reached the company system");
    answered(said["ceo:handin"]?.[0], true, /The CEO does not do the work itself/);
    assert.match(said["ceo:delegate"]?.[0] ?? "", /Gave 1 part\(s\) to your team/);

    // Research's manager, with Lan in its department.
    const managerTools = (said["manager:tools"]?.[0] ?? "").split(",");
    assert.ok(!managerTools.includes("ask_question") && !managerTools.includes("escalate_question"), managerTools.join(","));
    assert.ok(managerTools.includes("shell") && managerTools.includes("crm_lookup") && managerTools.includes("delegate"), managerTools.join(","));
    assert.match(said["manager:prompt"]?.[0] ?? "", /You manage your department\. Give the work to your team with delegate/);
    for (const k of ["manager:ask", "manager:escalate"]) answered(said[k]?.[0], true, /You decide: questions do not leave your department/);
    answered(said["manager:crm"]?.[0], false);
    answered(said["manager:handin"]?.[0], true, /give the work to your team first/);

    // Nothing was handed in, and nothing reached the person: no hand-in, no question.
    const m = await mission(id);
    assert.deepEqual(m.handoffs, []);
    assert.deepEqual(m.clarifications, []);
    await cancel(id);
  });

  test("a manager alone in its department does the work itself and hands it in", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Alone", goal: "[alone] Close the books.", target: { kind: "department", departmentId: dept.Finance }, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Done"] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const m = await eventually(() => mission(id), (x) => x.assignments.find((a) => a.parentId === null)?.state === "AWAITING_ACCEPTANCE", 60_000);
    answered(said["alone:handin"]?.[0], false);
    assert.match(said["alone:prompt"]?.[0] ?? "", /nobody else in it works now: do the work yourself/);
    const tools = (said["alone:tools"]?.[0] ?? "").split(",");
    assert.ok(tools.includes("shell") && !tools.includes("ask_question"), tools.join(","));
    assert.equal(m.handoffs.length, 1);
  });
});
