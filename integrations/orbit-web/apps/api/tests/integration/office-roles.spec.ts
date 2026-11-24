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
import { DEFAULT_PRESETS, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type MissionMessages, type RuntimeConnection } from "@orbit-web/contracts";
import { CONNECTOR_TOOLS, type ConnectorTools } from "../../src/contexts/execution/application/connector-tools.port.js";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
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

const unitLines = (p: string, keys: string[]): string[] => p.split("\n").filter((l) => new RegExp(`^- (${keys.join("|")}): `).test(l));
const digestOf = (line: string): string | undefined => /digest ([0-9a-f]{64})/.exec(line)?.[1];
// What a department hands in, written in Vietnamese: the CEO's review reads it back from /input byte for byte. The
// CEO asks for a revision (REVISE); the department reworks it from the draft it kept, and hands in v2.
const KE_HOACH = "# Kế hoạch tuyển dụng\n\n- Tóm tắt điều hành: Phòng FX cần một trưởng phòng có kinh nghiệm.\n";
const REVISE = "Thêm phần ngân sách tuyển dụng.";
const KE_HOACH_2 = `${KE_HOACH}- Ngân sách: 40 triệu đồng mỗi tháng.\n`;

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
    // What an attempt is handed in /input is read from the store by the real reader, as in a sandbox.
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
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
        if (p.includes("[ceo-review]")) {
          const lines = unitLines(p, ["kh"]);
          if (lines.length === 0) {
            note("review:plan", (await t.call("delegate", { parts: [{ key: "kh", department: "Finance", title: "Kế hoạch tuyển dụng", goal: "[alone-plan] Viết kế hoạch tuyển dụng.", deliverables: ["ke-hoach.md"] }] })).text);
            return;
          }
          const awaiting = lines.find((l) => l.includes("awaiting acceptance"));
          if (awaiting === undefined) return;
          const round = said["review:revise"] === undefined ? 1 : 2;
          note(`review:list${round}`, JSON.stringify(await t.call("list_files", { path: "/input" })));
          note(`review:read${round}`, JSON.stringify(await t.call("read_file", { path: "/input/unit-kh-ke-hoach.md" })));
          if (round === 1) {
            note("review:write", JSON.stringify(await t.call("write_file", { path: "/input/unit-kh-ke-hoach.md", content: "đã sửa" })));
            note("review:revise", (await t.call("review_unit", { part: "kh", decision: "revise", digest: digestOf(awaiting), criteria: REVISE })).text);
            return;
          }
          note("review:accept", (await t.call("review_unit", { part: "kh", decision: "accept", digest: digestOf(awaiting) })).text);
          return;
        }
        if (p.includes("[alone-plan]")) {
          if (!p.includes(REVISE)) {
            await t.call("write_file", { path: "/work/ke-hoach.md", content: KE_HOACH });
            await t.call("write_file", { path: "/output/ke-hoach.md", content: KE_HOACH });
            note("plan:handin", JSON.stringify(await t.call("submit_handoff", { summary: "Kế hoạch tuyển dụng, bản 1." })));
            return;
          }
          // Asked to revise: the department kept its draft, and works on from it.
          note("plan:kept", JSON.stringify(await t.call("read_file", { path: "/work/ke-hoach.md" })));
          await t.call("write_file", { path: "/output/ke-hoach.md", content: KE_HOACH_2 });
          note("plan:handin2", JSON.stringify(await t.call("submit_handoff", { summary: "Kế hoạch tuyển dụng, bản 2: thêm ngân sách." })));
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

  test("the CEO, with no shell, reads what its department handed in from /input -- the Vietnamese text as written -- cannot change it; a version it sends back leaves its tray while the department keeps it and works on", async () => {
    // What the scenarios before left open is ended first: a mission waiting for the owner still holds its employee.
    for (const open of ((await b.get("/api/missions?state=open")).body as { missions: { id: string }[] }).missions) await cancel(open.id);
    const made = await b.send("POST", "/api/missions", { title: "Tuyển dụng", goal: "[ceo-review] Lập kế hoạch tuyển dụng.", target: { kind: "ceo" }, whenBusy: "enqueue", deliverables: [{ name: "plan.md", required: true }], acceptanceCriteria: ["Có kế hoạch"] }, key());
    assert.ok(made.status === 201 || made.status === 202, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await eventually(async () => said["review:accept"]?.[0] ?? null, (x) => x !== null, 90_000).catch(async () => {
      const m = await mission(id);
      const steps = Object.entries(said).filter(([k]) => k.startsWith("review:") || k.startsWith("plan:")).flatMap(([k, v]) => v.map((x, i) => `${k}[${i}]=${x.slice(-1400)}`));
      throw new Error(`the review never finished.\nnoted: ${steps.join("\n")}\nassignments: ${JSON.stringify(m.assignments.map((a) => ({ title: a.title, employee: a.employeeName, state: a.state, reason: (a as { reason?: unknown }).reason ?? null })))}`);
    });
    const toolText = (raw: string | undefined) => JSON.parse(raw ?? "{}") as { text?: string; isError?: boolean };
    assert.match(said["review:plan"]?.[0] ?? "", /Gave 1 part/);
    answered(said["plan:handin"]?.[0], false);
    // First review: what was handed in, read from /input as written; /input cannot be changed, said in words the CEO
    // can act on (never "The request body is not valid JSON").
    answered(said["review:list1"]?.[0], false, /unit-kh-ke-hoach\.md/);
    assert.deepEqual([toolText(said["review:read1"]?.[0]).isError, toolText(said["review:read1"]?.[0]).text], [false, KE_HOACH], said["review:read1"]?.[0]);
    answered(said["review:write"]?.[0], true, /\/input is read-only/);
    assert.doesNotMatch(said["review:write"]?.[0] ?? "", /not valid JSON/);
    // Sent back: the department still has its draft, and hands in v2 from it.
    assert.deepEqual([toolText(said["plan:kept"]?.[0]).isError, toolText(said["plan:kept"]?.[0]).text], [false, KE_HOACH], said["plan:kept"]?.[0]);
    answered(said["plan:handin2"]?.[0], false);
    // Second review: the CEO's tray holds the new version only.
    const list2 = toolText(said["review:list2"]?.[0]).text ?? "";
    assert.equal(list2.split("\n").filter((l) => l.includes("unit-kh")).length, 1, list2);
    assert.equal(toolText(said["review:read2"]?.[0]).text, KE_HOACH_2);
    const m = await eventually(() => mission(id), (x) => x.assignments.find((a) => a.parentId !== null)?.state === "COMPLETED", 30_000);
    const part = m.assignments.find((a) => a.parentId !== null);
    // Nothing is lost: both versions stay in the mission's record, the first one sent back with what to change.
    assert.deepEqual(m.handoffs.filter((x) => x.assignmentId === part?.id).map((x) => [x.revision, x.status]).sort(), [[1, "revision_requested"], [2, "accepted"]]);
    // The owner reads how they talked: the work given down the tree, each hand-in with its file, the review sent back
    // with what to change -- named people, the words as written.
    const thread = (await b.get(`/api/missions/${id}/messages`)).body as MissionMessages;
    const said2 = thread.messages.filter((x) => x.kind !== "notice").map((x) => [x.kind, x.from.name, x.to?.name ?? null]);
    assert.deepEqual(said2, [
      ["given", "Owner", "An"],
      ["given", "An", "Hoa"],
      ["handed_in", "Hoa", "An"],
      ["revision", "An", "Hoa"],
      ["handed_in", "Hoa", "An"],
      ["accepted", "An", "Hoa"],
    ]);
    const handins = thread.messages.filter((x) => x.kind === "handed_in");
    assert.deepEqual(handins.map((x) => x.attachments.map((f) => f.name)), [["ke-hoach.md"], ["ke-hoach.md"]]);
    assert.equal(thread.messages.find((x) => x.kind === "revision")?.body, REVISE);
    assert.equal(thread.messages.find((x) => x.kind === "given" && x.from.name === "An")?.to?.departmentName, "Finance");
    const file = await fetch(`${h.url}/api/artifacts/${handins[1]?.attachments[0]?.artifactId}/content`, { headers: { cookie: b.cookie } });
    assert.equal(await file.text(), KE_HOACH_2);
    await cancel(id);
  });
});
