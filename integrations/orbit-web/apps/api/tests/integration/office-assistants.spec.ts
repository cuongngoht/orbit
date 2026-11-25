// TEMPORARY ASSISTANTS (ADR 0061 §8), end to end through HTTP on PostgreSQL with scripted CLIs: the CEO and a department's
// manager engage assistants for the mission at hand -- a part of their `delegate` plan that HIRES instead of naming
// someone -- up to the quota the owner set on each of them (profile.maxAssistants; 0 turns it off). Hiring a permanent
// employee stays a person's.
//
//   - a manager alone engages an assistant and gives it a part: the assistant joins its department for this mission, its
//     part runs once its Personal Sandbox is READY, and the manager -- now a manager with a team -- reviews and hands in;
//   - the quota holds: a plan that would engage one more is refused whole, decided as the lead through governance
//     (employee.hire_assistant, NO_GRANT, kept on the record), with the numbers; a policy that denies it refuses it too;
//   - the CEO staffs a managed department: the assistant joins that department for the mission and the part goes to the
//     department's manager, who gives it work; on another mission the same manager is alone (an assistant counts only on
//     its own mission), and an assistant takes no appointment, no grant and no mission of its own;
//   - an assistant is released when its mission ends (accepted, cancelled), when its engagement expires, or when its
//     sandbox cannot be made: its open work is cancelled (its lead woken), it is archived and its desk deleted, so its
//     storage is freed;
//   - a plan with one hire that cannot be made creates nothing.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type Department, type EmployeeDetail, type EmployeeProfile, type MissionAccepted, type MissionDetail, type ResourceProfile, type RevisionView, type RuntimeConnection } from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { AssistantReleases } from "../../src/contexts/workforce/application/assistant-releases.js";
import { SandboxProvisioner } from "../../src/contexts/workforce/application/sandbox-provisioner.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `assistants-key-${Date.now()}-${(n += 1)}` });
const codeOf = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const unitLines = (p: string, keys: string[]): string[] => p.split("\n").filter((l) => new RegExp(`^- (${keys.join("|")}): `).test(l));
const digestOf = (line: string): string | undefined => /digest ([0-9a-f]{64})/.exec(line)?.[1];
const pending = (lines: string[]): boolean => lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed") && !l.includes(", cancelled"));
const hireOf = (name: string, title = "Assistant") => ({ name, title, duties: `${name} helps with this mission.`, skills: ["writing"], languages: ["en"] });

async function toolNames(t: ToolCaller): Promise<string[]> {
  const res = await fetch(`${t.bridge.url}/list`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-run-token": t.bridge.token, "x-orbit-web": "1" }, body: "{}" });
  return ((await res.json()) as { tools: { name: string }[] }).tools.map((x) => x.name).sort();
}

// A revision of the account's policy, drafted from the one in effect, edited, validated and published as its owner does.
async function publish(b: Browser, edit: (c: Constitution) => Constitution): Promise<void> {
  const draft = (await b.send("POST", "/api/governance/revisions", {})).body as RevisionView;
  assert.equal((await b.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest })).status, 200);
  const read = (await b.send("POST", `/api/governance/revisions/${draft.id}/validate`)).body as RevisionView;
  const r = await b.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: read.impact?.risk ?? null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

const withAssistants = (effect: "allow" | "deny") => (c: Constitution): Constitution => ({ ...c, rules: c.rules.map((r) => (r.id === "office-assistants" ? { ...r, effect } : r)) });

interface AssistantRow {
  id: string;
  name: string;
  kind: string;
  department_id: string | null;
  manager_id: string | null;
  engaged_by: string | null;
  mission_scope: string | null;
  expires_at: string | null;
  employment: string;
  employment_reason: string | null;
  sandbox: string | null;
}

describe("temporary assistants: leads engage them for the mission at hand, within their quota, and they leave with it", () => {
  let h: Harness;
  let b: Browser;
  let accountId: string;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  const dept: Record<string, Department> = {};
  const said: Record<string, string[]> = {};
  const note = (k: string, v: string) => (said[k] ??= []).push(v);

  const hire = async (name: string, departmentId: string | null, maxAssistants: number): Promise<void> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const profile: EmployeeProfile = { title: "Lead", duties: "Leads.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants, canHirePermanent: false };
    const r = await b.send("POST", "/api/employees", { name, ...(departmentId !== null ? { departmentId } : {}), profile, resources: DEFAULT_PRESETS[0]?.profile, skipProbation: true, skipReason: "a test employee" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[name] = (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
  };
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const root = (m: MissionDetail) => m.assignments.find((a) => a.parentId === null) as MissionDetail["assignments"][number];
  const give = async (goal: string, target: Record<string, unknown>, deliverable = "report.md"): Promise<string> => {
    const r = await b.send("POST", "/api/missions", { title: goal.slice(0, 40), goal, target, whenBusy: "enqueue", deliverables: [{ name: deliverable, required: true }], acceptanceCriteria: ["Done"] }, key());
    assert.ok(r.status === 201 || r.status === 202, JSON.stringify(r.body));
    return (r.body as MissionAccepted).missionId;
  };
  const handedIn = (id: string) => eventually(() => mission(id), (m) => root(m)?.state === "AWAITING_ACCEPTANCE", 90_000);
  const accept = async (id: string): Promise<void> => {
    const m = await mission(id);
    const h1 = m.handoffs.find((x) => x.assignmentId === root(m).id && x.status === "submitted");
    const r = await b.send("POST", `/api/assignments/${root(m).id}/accept`, { handoffDigest: h1?.digest }, ifMatch(root(m).version));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const cancel = async (id: string): Promise<void> => {
    const m = await mission(id);
    const r = await b.send("POST", `/api/assignments/${root(m).id}/cancel`, { reason: "the owner ends it" }, ifMatch(root(m).version));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  // The assistants engaged for one mission, as the database keeps them.
  const assistantsOf = async (missionId: string): Promise<AssistantRow[]> =>
    (
      await h.sql(
        "SELECT e.id, e.name, e.kind, e.department_id, e.manager_id, e.engaged_by, e.mission_scope, e.expires_at, e.employment, e.employment_reason, s.state AS sandbox FROM workforce.employees e LEFT JOIN workforce.sandboxes s ON s.account_id = e.account_id AND s.employee_id = e.id WHERE e.account_id = $1 AND e.mission_scope = $2 ORDER BY e.name",
        [accountId, missionId],
      )
    ).map((r) => ({ ...(r as unknown as AssistantRow), expires_at: r.expires_at === null ? null : new Date(r.expires_at as string).toISOString() }));
  // Released: archived, its desk deleted (read back gone), the storage it committed freed.
  const released = async (missionId: string, count: number): Promise<void> => {
    const rows = await eventually(() => assistantsOf(missionId), (r) => r.length === count && r.every((x) => x.employment === "deleted" && x.sandbox === "DELETED"), 30_000);
    const storage = await h.sql("SELECT owner_ref, category, committed_mib FROM workforce.storage_usage WHERE account_id = $1 AND owner_ref = ANY($2) AND category IN ('desk', 'cache')", [accountId, rows.map((r) => String(r.id))]);
    assert.ok(storage.every((s) => Number(s.committed_mib) === 0), JSON.stringify(storage));
  };
  const decisions = (action: string) =>
    h.sql("SELECT principal_id, principal_type, outcome, reason_codes, data FROM governance.audit_events WHERE account_id = $1 AND event_type = 'policy.decision' AND data->>'action' = $2 ORDER BY seq", [accountId, action]);

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    accountId = h.accountId as string;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Assist Co" })).status, 200);
    for (const name of ["Research", "Finance", "Legal", "Ops"]) dept[name] = (await b.send("POST", "/api/office/departments", { name })).body as Department;
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        const reviewAndHandIn = async (prefix: string, keys: string[], file: string): Promise<void> => {
          const lines = unitLines(p, keys);
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) note(`${prefix}:review`, (await t.call("review_unit", { part: (/^- ([a-z-]+):/.exec(l) as RegExpExecArray)[1], decision: "accept", digest: digestOf(l) })).text);
          if (pending(lines)) return;
          await t.call("write_file", { path: `/output/${file}`, content: `# ${prefix}\n` });
          note(`${prefix}:handin`, JSON.stringify(await t.call("submit_handoff", { summary: `${prefix}: integrated.` })));
        };
        // ---- Minh, Research's manager, alone in it: engages an assistant and gives it the draft.
        if (p.includes("[solo]")) {
          if (!p.includes("The parts you gave your team")) {
            note("solo:tools", (await toolNames(t)).join(","));
            note("solo:prompt", p);
            note("solo:plan", (await t.call("delegate", { parts: [{ key: "draft", hire: hireOf("Tam", "Writer"), title: "Draft", goal: "[asst:draft] Write the draft.", deliverables: ["draft.md"] }] })).text);
            return;
          }
          note("solo:review-prompt", p);
          await reviewAndHandIn("solo", ["draft"], "report.md");
          return;
        }
        // ---- Minh again: one more than his quota is refused, whole; then two; a third while two are live, refused.
        if (p.includes("[quota]")) {
          if (!p.includes("The parts you gave your team")) {
            const part = (k: string, name: string) => ({ key: k, hire: hireOf(name), title: k.toUpperCase(), goal: `[asst:${k}] Do ${k}.`, deliverables: [`${k}.md`] });
            note("quota:three", (await t.call("delegate", { parts: [part("a", "Ai"), part("b", "Bao"), part("c", "Cuc")] })).text);
            note("quota:two", (await t.call("delegate", { parts: [part("a", "Ai"), part("b", "Bao")] })).text);
            return;
          }
          if (said["quota:third"] === undefined) note("quota:third", (await t.call("delegate", { parts: [{ key: "c", hire: hireOf("Cuc"), title: "C", goal: "[asst:c] Do c.", deliverables: ["c.md"] }] })).text);
          await reviewAndHandIn("quota", ["a", "b"], "report.md");
          return;
        }
        // ---- An, the CEO: staffs Finance with an assistant for this mission; Finance's manager takes the part.
        if (p.includes("[ceo-staff]")) {
          if (!p.includes("The parts you gave your team")) {
            note("ceo:prompt", p);
            note("ceo:plan", (await t.call("delegate", { parts: [{ key: "fin", department: "Finance", hire: hireOf("Khoa", "Analyst"), title: "Numbers", goal: "[part:fin] Work out the numbers.", deliverables: ["numbers.md"] }] })).text);
            return;
          }
          await reviewAndHandIn("ceo", ["fin"], "plan.md");
          return;
        }
        // ---- An again: two hires, one into a department whose defaults cannot run -- nothing is made.
        if (p.includes("[ceo-bad]")) {
          note("bad:plan", (await t.call("delegate", { parts: [{ key: "res", department: "Research", hire: hireOf("Duc"), title: "Res", goal: "[asst:res] Research.", deliverables: ["res.md"] }, { key: "leg", department: "Legal", hire: hireOf("Em"), title: "Leg", goal: "[asst:leg] Legal.", deliverables: ["leg.md"] }] })).text);
          return;
        }
        // ---- Hoa, Finance's manager (maxAssistants 0): on the CEO's mission her department has the CEO's assistant.
        if (p.includes("[part:fin]")) {
          if (!p.includes("The parts you gave your team")) {
            note("fin:prompt", p);
            note("fin:tools", (await toolNames(t)).join(","));
            note("fin:hire", (await t.call("delegate", { parts: [{ key: "more", hire: hireOf("Gia"), title: "More", goal: "[asst:more] More.", deliverables: ["more.md"] }] })).text);
            note("fin:plan", (await t.call("delegate", { parts: [{ key: "calc", employee: "Khoa", title: "Calc", goal: "[asst:calc] Calculate.", deliverables: ["calc.md"] }] })).text);
            return;
          }
          await reviewAndHandIn("fin", ["calc"], "numbers.md");
          return;
        }
        // ---- Hoa on another mission, while the CEO's assistant is still engaged in Finance: she is alone there.
        if (p.includes("[off]")) {
          note("off:tools", (await toolNames(t)).join(","));
          note("off:prompt", p);
          note("off:delegate", (await t.call("delegate", { parts: [{ key: "x", hire: hireOf("Hai"), title: "X", goal: "[asst:x] X.", deliverables: ["x.md"] }] })).text);
          await t.call("write_file", { path: "/output/report.md", content: "Done alone.\n" });
          note("off:handin", JSON.stringify(await t.call("submit_handoff", { summary: "Done alone." })));
          return;
        }
        // ---- Lien, Legal's manager (maxAssistants 1): a policy that denies assistants; an engagement that expires; a
        // sandbox that cannot be made.
        if (p.includes("[denied]")) {
          note("denied:hire", (await t.call("delegate", { parts: [{ key: "d", hire: hireOf("Dao"), title: "D", goal: "[asst:d] D.", deliverables: ["d.md"] }] })).text);
          await t.call("write_file", { path: "/output/report.md", content: "Done alone.\n" });
          await t.call("submit_handoff", { summary: "Done alone." });
          return;
        }
        for (const [mark, k, name] of [["[expire]", "slow", "Vy"], ["[sbfail]", "fail", "Quang"]] as const) {
          if (!p.includes(mark)) continue;
          if (!p.includes("The parts you gave your team")) {
            note(`${k}:plan`, (await t.call("delegate", { parts: [{ key: k, hire: hireOf(name), title: k, goal: `[asst:${k}] ${k}.`, deliverables: [`${k}.md`] }] })).text);
            return;
          }
          note(`${k}:review-prompt`, p);
          await t.call("write_file", { path: "/output/report.md", content: "Done without the assistant.\n" });
          note(`${k}:handin`, JSON.stringify(await t.call("submit_handoff", { summary: "Done without the assistant." })));
          return;
        }
        // ---- Every assistant: does its part and hands it in.
        const part = /\[asst:([a-z-]+)\]/.exec(p)?.[1];
        if (part !== undefined) {
          note(`asst:${part}:prompt`, p);
          await t.call("write_file", { path: `/output/${part}.md`, content: `# ${part}\n` });
          await t.call("submit_handoff", { summary: `${part}: done.` });
        }
      }),
    });
    await hire("An", null, 2);
    await hire("Minh", dept.Research?.id as string, 2);
    await hire("Hoa", dept.Finance?.id as string, 0);
    await hire("Lien", dept.Legal?.id as string, 1);
    for (const body of [{ role: "ceo", employeeId: ids.An }, { role: "manager", departmentId: dept.Research?.id, employeeId: ids.Minh }, { role: "manager", departmentId: dept.Finance?.id, employeeId: ids.Hoa }, { role: "manager", departmentId: dept.Legal?.id, employeeId: ids.Lien }]) {
      const r = await b.send("POST", "/api/office/appointments", { ...body, reason: "the leads under test" });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
  });

  after(async () => {
    await h?.close();
  });

  test("a manager alone engages an assistant and gives it a part: it runs once its sandbox is READY, the manager reviews as a manager with a team, hands in -- and once the mission is accepted, the assistant is released", async () => {
    // Its first provisioning fails: the part waits, QUEUED, until the sandbox is READY.
    sandbox.provisionFailures = 1;
    const id = await give("[solo] Write the department's report.", { kind: "department", departmentId: dept.Research?.id });
    await handedIn(id);
    assert.ok((said["solo:tools"]?.[0] ?? "").split(",").includes("delegate"), "alone, with room in its quota, it is offered delegate");
    assert.match(said["solo:prompt"]?.[0] ?? "", /nobody else in it works now/);
    assert.match(said["solo:prompt"]?.[0] ?? "", /you may engage 2 more/);
    assert.match(said["solo:plan"]?.[0] ?? "", /Gave 1 part\(s\) to your team.*Tam/s);
    assert.match(said["solo:review-prompt"]?.[0] ?? "", /You manage your department\. Give the work to your team/, "with its assistant, it reviews as a manager with a team");

    const [tam] = await assistantsOf(id);
    assert.ok(tam !== undefined);
    assert.deepEqual([tam.name, tam.kind, tam.department_id, tam.manager_id, tam.engaged_by, tam.mission_scope], ["Tam", "assistant", dept.Research?.id, ids.Minh, ids.Minh, id]);
    const days = (Date.parse(tam.expires_at ?? "") - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7, `engaged for at most 7 days: ${tam.expires_at}`);
    const profile = (await h.sql("SELECT profile FROM workforce.employee_profiles WHERE account_id = $1 AND employee_id = $2 AND revision = 1", [accountId, tam.id]))[0]?.profile as EmployeeProfile;
    assert.deepEqual([profile.title, profile.maxAssistants, profile.canDelegate, profile.canHirePermanent, profile.execution.runtime, profile.execution.connectionId, profile.execution.model], ["Writer", 0, false, false, "claude", connection.id, connection.catalog.models[0]?.id], "it runs as its lead does (no department default)");
    const resources = (await h.sql("SELECT profile FROM workforce.employee_resources WHERE account_id = $1 AND employee_id = $2 AND revision = 1", [accountId, tam.id]))[0]?.profile as ResourceProfile;
    assert.equal(resources.presetId, "lightweight");
    assert.deepEqual([tam.employment, tam.employment_reason], ["active", "a temporary assistant: active for its engagement"], "no trial, and not released before its mission ends");
    // The database holds it too: an assistant always names its lead and its mission, a permanent employee neither.
    await assert.rejects(h.sql("UPDATE workforce.employees SET engaged_by = NULL WHERE account_id = $1 AND id = $2", [accountId, tam.id]), /assistant_engagement/);
    await assert.rejects(h.sql("UPDATE workforce.employees SET mission_scope = $3 WHERE account_id = $1 AND id = $2", [accountId, ids.Minh ?? "", id]), /assistant_engagement/);

    // Its part ran only once its sandbox was READY: the first try failed, the claim came after READY.
    const m = await mission(id);
    const draft = m.assignments.find((a) => a.unitKey === "draft");
    assert.equal(draft?.employeeId, tam.id);
    assert.equal(sandbox.provisionFailures, 0);
    const order = await h.sql("SELECT type FROM workforce.events WHERE account_id = $1 AND ((type IN ('SandboxReady', 'SandboxFailed') AND payload->>'employeeId' = $2) OR (type = 'AssignmentClaimed' AND aggregate_id = $3)) ORDER BY seq", [accountId, tam.id, draft?.id ?? ""]);
    assert.deepEqual(order.map((r) => r.type), ["SandboxReady", "AssignmentClaimed"]);

    // Decided as the lead (an agent), as employee.hire_assistant with the grant its quota gave -- never employee.hire.
    const engaged = await decisions("employee.hire_assistant");
    assert.deepEqual(engaged.map((d) => [d.principal_id, d.principal_type, d.outcome, (d.data as { grant?: string }).grant]), [[`employee:${ids.Minh}`, "agent", "allow", "held"]]);
    assert.ok((await decisions("employee.hire")).every((d) => d.principal_type === "human"), "no agent was ever asked about a permanent hire");

    // The mission ends: the assistant is released, its desk deleted, its storage freed.
    await accept(id);
    await released(id, 1);
    const [gone] = await assistantsOf(id);
    assert.match(String(gone?.employment_reason), /mission was accepted/);
    assert.ok(sandbox.deleted.some((d) => d.employeeId === tam.id));
    // Orbit ends the engagement (a system act, recorded): no person's employment command, no policy to refuse it.
    const record = await h.sql("SELECT principal_type, data FROM governance.audit_events WHERE account_id = $1 AND event_type = 'office.command' AND data->>'command' = 'employee.release_assistant'", [accountId]);
    assert.deepEqual(record.map((r) => [(r.data as { aggregateId: string }).aggregateId, r.principal_type]), [[tam.id, "system"]], JSON.stringify(record));
  });

  test("the quota holds: one more than maxAssistants is refused whole -- recorded as NO_GRANT, with the numbers -- also against those still engaged; a cancelled mission releases its assistants", async () => {
    const id = await give("[quota] Three pieces of work.", { kind: "department", departmentId: dept.Research?.id });
    await handedIn(id);
    assert.match(said["quota:three"]?.[0] ?? "", /The plan was not given/);
    assert.match(said["quota:three"]?.[0] ?? "", /"c": 2 of 2 assistants engaged/);
    assert.match(said["quota:three"]?.[0] ?? "", /NO_GRANT/);
    assert.ok(!/"a":|"b":/.test(said["quota:three"]?.[0] ?? ""), said["quota:three"]?.[0]);
    assert.match(said["quota:two"]?.[0] ?? "", /Gave 2 part\(s\) to your team.*Ai.*Bao/s);
    assert.match(said["quota:third"]?.[0] ?? "", /"c": 2 of 2 assistants engaged/);
    assert.deepEqual((await assistantsOf(id)).map((r) => r.name), ["Ai", "Bao"], "the refused plans engaged nobody");
    // Each refusal is a decision kept on the record, though its plan was refused whole.
    const full = (await decisions("employee.hire_assistant")).filter((d) => d.outcome === "deny");
    assert.equal(full.length, 2, JSON.stringify(full));
    assert.ok(full.every((d) => (d.reason_codes as string[]).includes("NO_GRANT") && d.principal_id === `employee:${ids.Minh}`));

    await cancel(id);
    await released(id, 2);
    assert.ok((await assistantsOf(id)).every((r) => /mission was cancelled/.test(String(r.employment_reason))));
  });

  test("a policy that denies assistants refuses the hire, decided as the lead; the lead does the work itself", async () => {
    await publish(b, withAssistants("deny"));
    try {
      const id = await give("[denied] Do it.", { kind: "department", departmentId: dept.Legal?.id });
      await handedIn(id);
      assert.match(said["denied:hire"]?.[0] ?? "", /The plan was not given/);
      assert.match(said["denied:hire"]?.[0] ?? "", /not allowed \(RULE_MATCHED\): employee\.hire_assistant/);
      assert.deepEqual(await assistantsOf(id), []);
      await accept(id);
    } finally {
      await publish(b, withAssistants("allow"));
    }
  });

  test("the CEO staffs a managed department for its mission: the assistant joins it, the part goes to its manager, who gives it work -- on another mission that manager is alone, and an assistant takes no appointment, grant or mission of its own", async () => {
    const y = await give("[ceo-staff] Plan the quarter.", { kind: "ceo" }, "plan.md");
    await handedIn(y);
    assert.match(said["ceo:prompt"]?.[0] ?? "", /you may engage 2 more/);
    assert.match(said["ceo:prompt"]?.[0] ?? "", /the department it joins/);
    assert.match(said["ceo:plan"]?.[0] ?? "", /Gave 1 part\(s\) to your team.*Khoa/s);
    const [khoa] = await assistantsOf(y);
    assert.ok(khoa !== undefined);
    assert.deepEqual([khoa.name, khoa.department_id, khoa.manager_id, khoa.engaged_by], ["Khoa", dept.Finance?.id, ids.Hoa, ids.An]);
    const m = await mission(y);
    const fin = m.assignments.find((a) => a.unitKey === "fin");
    assert.deepEqual([fin?.employeeId, fin?.target?.kind, fin?.target?.departmentId], [ids.Hoa, "department", dept.Finance?.id], "the CEO gives work to departments: the part went to Finance's manager");
    assert.equal(m.assignments.find((a) => a.unitKey === "calc")?.employeeId, khoa.id, "and she gave work to the assistant");
    // Finance's manager, with the CEO's assistant on this mission, has a team -- and a quota of 0 engages none.
    assert.match(said["fin:prompt"]?.[0] ?? "", /You manage your department\. Give the work to your team/);
    assert.match(said["fin:hire"]?.[0] ?? "", /"more": 0 of 0 assistants engaged/);
    assert.match(said["fin:plan"]?.[0] ?? "", /Gave 1 part\(s\)/);

    // Mission X, while Y's assistant is still engaged in Finance: Hoa is alone there, and offered no delegate.
    const x = await give("[off] Close the books.", { kind: "department", departmentId: dept.Finance?.id });
    await handedIn(x);
    assert.ok(!(said["off:tools"]?.[0] ?? "").split(",").includes("delegate"), said["off:tools"]?.[0]);
    assert.match(said["off:prompt"]?.[0] ?? "", /nobody else in it works now/);
    assert.doesNotMatch(said["off:prompt"]?.[0] ?? "", /Khoa/);
    assert.match(said["off:delegate"]?.[0] ?? "", /hold no appointment or grant/);
    assert.deepEqual(await assistantsOf(x), []);

    // An assistant is its lead's for one mission: no mission of its own, no appointment, no grant -- either way.
    const direct = await b.send("POST", "/api/missions", { title: "Direct", goal: "Work for me.", target: { kind: "employee", employeeId: khoa.id }, whenBusy: "enqueue", deliverables: [], acceptanceCriteria: [] }, key());
    assert.deepEqual([direct.status, codeOf(direct)], [409, "assistant_not_assignable"]);
    const appointed = await b.send("POST", "/api/office/appointments", { role: "manager", departmentId: dept.Ops?.id, employeeId: khoa.id, reason: "try" });
    assert.deepEqual([appointed.status, codeOf(appointed)], [409, "assistant_not_appointable"]);
    const granted = await b.send("POST", `/api/employees/${khoa.id}/delegation-grants`, { target: { kind: "department", departmentId: dept.Finance?.id } });
    assert.deepEqual([granted.status, codeOf(granted)], [409, "assistant_no_grant"]);
    const toward = await b.send("POST", `/api/employees/${ids.Hoa}/delegation-grants`, { target: { kind: "employee", employeeId: khoa.id } });
    assert.deepEqual([toward.status, codeOf(toward)], [409, "assistant_no_grant"]);
    const xr = root(await mission(x));
    const handed = await b.send("POST", `/api/assignments/${xr.id}/hand-over`, { employeeId: khoa.id, reason: "try" }, ifMatch(xr.version));
    assert.deepEqual([handed.status, codeOf(handed)], [409, "assistant_not_assignable"], "nor another mission's work handed over to it");

    await accept(y);
    await released(y, 1);
    await accept(x);
  });

  test("an engagement that expires is released by the sweep: its queued part is cancelled and its lead woken, the assistant archived and its storage freed", async () => {
    sandbox.provisionFailures = 1000;
    try {
      const id = await give("[expire] Something slow.", { kind: "department", departmentId: dept.Legal?.id });
      const [vy] = await eventually(() => assistantsOf(id), (r) => r.length === 1);
      assert.ok(vy !== undefined);
      const part = await eventually(async () => (await mission(id)).assignments.find((a) => a.unitKey === "slow"), (a) => a?.state === "QUEUED");
      await h.sql("UPDATE workforce.employees SET expires_at = now() - interval '1 second' WHERE account_id = $1 AND id = $2", [accountId, vy.id]);
      await h.app.get(AssistantReleases).sweep();
      await handedIn(id);
      const m = await mission(id);
      const slow = m.assignments.find((a) => a.id === part?.id);
      assert.equal(slow?.state, "CANCELLED");
      assert.match(String(slow?.reason), /engagement expired/);
      assert.match(said["slow:review-prompt"]?.[0] ?? "", /- slow: Vy, cancelled/, "its lead was woken: every part had ended");
      await released(id, 1);
      await accept(id);
    } finally {
      sandbox.provisionFailures = 0;
    }
  });

  test("a sandbox that cannot be made releases its assistant: its queued part is cancelled, and the lead is never left waiting", async () => {
    sandbox.provisionFailures = 1000;
    try {
      const id = await give("[sbfail] Something that needs an assistant.", { kind: "department", departmentId: dept.Legal?.id });
      const [quang] = await eventually(() => assistantsOf(id), (r) => r.length === 1);
      assert.ok(quang !== undefined);
      // Its first try failed; the next one is made its last.
      await eventually(async () => (await h.sql("SELECT provision_attempts FROM workforce.sandboxes WHERE employee_id = $1", [quang.id]))[0]?.provision_attempts, (a) => Number(a) >= 1);
      await h.sql("UPDATE workforce.sandboxes SET provision_attempts = 5, updated_at = now() - interval '1 hour', version = version + 1 WHERE account_id = $1 AND employee_id = $2 AND state = 'PROVISIONING'", [accountId, quang.id]);
      h.app.get(SandboxProvisioner).kick();
      await handedIn(id);
      const failed = await h.sql("SELECT count(*) AS n FROM workforce.events WHERE account_id = $1 AND type = 'SandboxFailed' AND payload->>'employeeId' = $2", [accountId, quang.id]);
      assert.equal(Number(failed[0]?.n), 1);
      const m = await mission(id);
      assert.equal(m.assignments.find((a) => a.unitKey === "fail")?.state, "CANCELLED");
      await released(id, 1);
      assert.match(String((await assistantsOf(id))[0]?.employment_reason), /Personal Sandbox could not be made/);
      await accept(id);
    } finally {
      sandbox.provisionFailures = 0;
    }
  });

  test("a plan with one hire that cannot be made creates nothing: no assistant, no part, no storage -- the whole plan is refused with why", async () => {
    const legal = (await b.get("/api/office/roster")).body as { departments: Department[] };
    const current = legal.departments.find((d) => d.id === dept.Legal?.id) as Department;
    assert.equal((await b.send("PATCH", `/api/office/departments/${current.id}`, { defaults: { claude: { model: "no-such-model" } } }, ifMatch(current.version))).status, 200);
    const before = await h.sql("SELECT count(*) AS n FROM workforce.employees WHERE account_id = $1", [accountId]);
    const desks = "SELECT COALESCE(SUM(committed_mib), 0) AS n FROM workforce.storage_usage WHERE account_id = $1 AND category IN ('desk', 'cache')";
    const committed = await h.sql(desks, [accountId]);
    const id = await give("[ceo-bad] Staff two departments.", { kind: "ceo" }, "plan.md");
    await eventually(() => said["bad:plan"] ?? [], (x) => x.length > 0, 60_000);
    assert.match(said["bad:plan"]?.[0] ?? "", /The plan was not given/);
    assert.match(said["bad:plan"]?.[0] ?? "", /"leg": .*no-such-model is not a model this connection offers/);
    assert.ok(!/"res":/.test(said["bad:plan"]?.[0] ?? ""), "the good hire was not the problem");
    assert.deepEqual(await assistantsOf(id), [], "neither assistant was engaged");
    assert.deepEqual(await h.sql("SELECT count(*) AS n FROM workforce.employees WHERE account_id = $1", [accountId]), before);
    assert.deepEqual(await h.sql(desks, [accountId]), committed);
    const m = await eventually(() => mission(id), (x) => root(x)?.state === "BLOCKED", 30_000);
    assert.deepEqual(m.assignments.map((a) => a.unitKey), ["root"], "no part was made");
    await cancel(id);
  });
});
