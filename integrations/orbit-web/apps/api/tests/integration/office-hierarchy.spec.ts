// THE DECISIVE ACCEPTANCE (ADR 0061 §8-9), end to end through HTTP on PostgreSQL with scripted CLIs and ONE execution
// slot. An empty company is activated; Research and Finance are made; An is appointed CEO, Minh Research's manager, Hoa
// Finance's. The owner gives the CEO "research the game market, propose three business opportunities" (resolved to An,
// as the person saw). An gives the research to Research and the numbers to Finance -- each to its manager; Minh gives a
// scan to Lan; Lan asks "global or Southeast Asia?" -- her work ends there -- and Minh, woken to answer, answers; Lan goes
// on once and hands in; Minh reviews her revision by its digest and hands in; Hoa reads the ledger through the knowledge
// base granted to her alone and hands in only her summary; An -- refused the knowledge base -- reviews both, integrates and
// hands in v1. The owner asks on v1 for Vietnam, Thailand and Indonesia; An plans again (Research once more), hands in v2;
// v1 can no longer be accepted, v2 is, and the mission is complete. Every attempt that delegated, asked or answered ended
// by design (a success, its slot given back at once), nothing failed, and no two attempts ever held the slot together.
//
// The knowledge base stands in as a connector tool granted to Hoa only (the real connector broker and its grants are held
// by their own tests): what matters here is who may call it, and what of it reaches whom.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type Department, type EmployeeDetail, type Inbox, type MissionAccepted, type MissionDetail, type MissionTargetPreview, type ResourceSummary, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { CONNECTOR_TOOLS, type ConnectorTools } from "../../src/contexts/execution/application/connector-tools.port.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import type { GovernanceContext } from "../../src/modules/auth/principal.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
const LEDGER = "LEDGER 2026 -- revenue by title: Starfall 1,200,000 USD; Riverlands 800,000 USD; payroll 640,000 USD.";

// A knowledge base only Hoa was granted: its calls are recorded with who asked, as which principal.
class KnowledgeBase implements ConnectorTools {
  granted = new Set<string>();
  calls: { employeeId: string; agentId: string | null; allowed: boolean }[] = [];
  tools(_orbitId: string, employeeId: string) {
    return Promise.resolve(this.granted.has(employeeId) ? [{ name: "finance_ledger", description: "Read the company's finance ledger.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] : []);
  }
  owns(name: string): boolean {
    return name === "finance_ledger";
  }
  call(ctx: GovernanceContext, _orbitId: string, employeeId: string) {
    const allowed = this.granted.has(employeeId);
    this.calls.push({ employeeId, agentId: ctx.principal.kind === "agent" ? ctx.principal.binding.agentId : null, allowed });
    return Promise.resolve(allowed ? { text: LEDGER, isError: false } : { text: "The finance knowledge base was not granted to you: ask Finance for what you need.", isError: true });
  }
}

const unitLines = (p: string, keys: string[]): string[] => p.split("\n").filter((l) => new RegExp(`^- (${keys.join("|")}): `).test(l));
const digestOf = (line: string): string | undefined => /digest ([0-9a-f]{64})/.exec(line)?.[1];
const pending = (lines: string[]): boolean => lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed"));

describe("the company at work: a CEO, two departments, a question answered by its lead, a revision, one execution slot", () => {
  let h: Harness;
  let b: Browser;
  let accountId: string;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const kb = new KnowledgeBase();
  const seen: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  const dept: Record<string, string> = {};
  const note = (k: string, v: string) => (seen[k] ??= []).push(v);

  const hire = async (name: string, departmentId: string | null, title: string): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title, duties: "Work for the company.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    ids[name] = d.id;
    return d;
  };
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const byKey = (m: MissionDetail, key: string): AssignmentView => m.assignments.find((a) => a.unitKey === key) as AssignmentView;
  const root = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId === null) as AssignmentView;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox], [CONNECTOR_TOOLS, kb]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    accountId = h.accountId as string;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    // An EMPTY company, activated on a usable connection: no department, employee or mission comes with it.
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Game Studio Co" })).status, 200);
    for (const name of ["Research", "Finance"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        // ---- An, the CEO: plans, reviews, integrates; plans again on the owner's revision.
        if (p.includes("[market]")) {
          const lines = unitLines(p, ["research", "finance", "research-sea"]);
          const revised = p.includes("Add Vietnam, Thailand and Indonesia");
          if (lines.length === 0) {
            note("An:plan", (await t.call("delegate", { parts: [
              { key: "research", department: "Research", title: "Market research", goal: "[part:research] Size the game market and its segments.", deliverables: ["research.md"] },
              { key: "finance", department: "Finance", title: "Financial view", goal: "[part:finance] What each opportunity would earn and cost.", deliverables: ["finance-summary.md"] },
            ] })).text);
            return;
          }
          if (revised && !lines.some((l) => l.startsWith("- research-sea: "))) {
            note("An:replan", (await t.call("delegate", { parts: [{ key: "research-sea", department: "Research", title: "Southeast Asia", goal: "[part:research-sea] Size Vietnam, Thailand and Indonesia.", deliverables: ["sea.md"] }] })).text);
            return;
          }
          if (!revised) note("An:kb", JSON.stringify(await t.call("finance_ledger", {})));
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) note("An:review", (await t.call("review_unit", { part: (/^- ([a-z-]+):/.exec(l) as RegExpExecArray)[1], decision: "accept", digest: digestOf(l) })).text);
          if (pending(lines)) return;
          note("An:input", (await t.call("list_files", { path: "/input" })).text);
          await t.call("write_file", { path: "/output/opportunities.md", content: revised ? "# Three opportunities\n1. Mobile RPG for Vietnam, Thailand, Indonesia.\n" : "# Three opportunities\n1. Mobile RPG.\n" });
          note("An:handin", (await t.call("submit_handoff", { summary: revised ? "v2: with Vietnam, Thailand and Indonesia." : "v1: three opportunities." })).text);
          return;
        }
        // ---- Minh, Research's manager: gives the scan to Lan, answers her, reviews her revision by its digest.
        if (p.includes("[part:research]")) {
          const q = /\[q:([0-9a-f-]{36})\]/.exec(p)?.[1];
          if (q !== undefined) {
            note("Minh:answer", (await t.call("answer_question", { question_id: q, answer: "Global, with a Southeast Asia section." })).text);
            return;
          }
          const lines = unitLines(p, ["scan"]);
          if (lines.length === 0) {
            note("Minh:plan", (await t.call("delegate", { parts: [{ key: "scan", employee: "Lan", title: "Scan", goal: "[part:scan] Scan the market reports.", deliverables: ["scan.md"] }] })).text);
            return;
          }
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) note("Minh:review", (await t.call("review_unit", { part: "scan", decision: "accept", digest: digestOf(l) })).text);
          if (pending(lines)) return;
          note("Minh:input", (await t.call("list_files", { path: "/input" })).text);
          await t.call("write_file", { path: "/output/research.md", content: "The game market grew 9% in 2026; mobile leads.\n" });
          await t.call("submit_handoff", { summary: "Research: the market and its segments." });
          return;
        }
        if (p.includes("[part:research-sea]")) {
          note("Minh:sea-input", (await t.call("list_files", { path: "/input" })).text);
          await t.call("write_file", { path: "/output/sea.md", content: "Vietnam, Thailand, Indonesia: 210M players.\n" });
          await t.call("submit_handoff", { summary: "Southeast Asia sized." });
          return;
        }
        // ---- Lan, Research's analyst: asks her lead, and goes on once with the answer.
        if (p.includes("[part:scan]")) {
          note("Lan:prompt", p);
          if (!p.includes("Answers you were given")) {
            note("Lan:input", (await t.call("list_files", { path: "/input" })).text);
            note("Lan:ask", (await t.call("ask_question", { question: "Should the scan cover the global market or Southeast Asia?" })).text);
            note("Lan:after", JSON.stringify(await t.call("list_files", { path: "/work" })));
            return;
          }
          await t.call("write_file", { path: "/output/scan.md", content: "Global scan, with a Southeast Asia section.\n" });
          await t.call("submit_handoff", { summary: "The scan, global with Southeast Asia." });
          return;
        }
        // ---- Hoa, Finance's manager: reads the ledger she was granted, hands in only her summary.
        if (p.includes("[part:finance]")) {
          note("Hoa:kb", JSON.stringify(await t.call("finance_ledger", {})));
          note("Hoa:input", (await t.call("list_files", { path: "/input" })).text);
          await t.call("write_file", { path: "/output/finance-summary.md", content: "Margins near 22% on the leading titles.\n" });
          await t.call("submit_handoff", { summary: "Finance: margins near 22%." });
        }
      }),
    });
    await hire("An", null, "Chief executive");
    await hire("Minh", dept.Research as string, "Research manager");
    await hire("Lan", dept.Research as string, "Analyst");
    await hire("Hoa", dept.Finance as string, "Finance manager");
    await hire("Binh", dept.Finance as string, "Accountant");
    kb.granted.add(ids.Hoa as string);
    for (const body of [{ role: "ceo", employeeId: ids.An }, { role: "manager", departmentId: dept.Research, employeeId: ids.Minh }, { role: "manager", departmentId: dept.Finance, employeeId: ids.Hoa }]) {
      const r = await b.send("POST", "/api/office/appointments", { ...body, reason: "the company's leadership" });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    // ONE execution slot: a lead and its part never hold it together.
    const r = (await b.get("/api/office/resources")).body as ResourceSummary;
    assert.equal((await b.send("PATCH", "/api/office/resources/budget", { maxConcurrent: 1 }, ifMatch(r.budget.version))).status, 200);
  });

  after(async () => {
    await h?.close();
  });

  test("the CEO's mission goes down the tree and back up: a question answered by its lead, a revision planned again, v2 accepted", async () => {
    const preview = (await b.get("/api/missions/target?kind=ceo")).body as MissionTargetPreview;
    assert.equal(preview.responsible?.employeeId, ids.An);
    const expectedAssignee = { employeeId: ids.An, appointmentId: preview.responsible?.appointmentId, appointmentRevision: preview.responsible?.appointmentRevision };
    const made = await b.send("POST", "/api/missions", { title: "Game market", goal: "[market] Research the game market and propose three business opportunities.", target: { kind: "ceo" }, expectedAssignee, whenBusy: "reject", deliverables: [{ name: "opportunities.md", required: true }], acceptanceCriteria: ["Three opportunities"] }, { "idempotency-key": `hierarchy-${Date.now()}` });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;

    // v1, handed in to the owner.
    let m = await eventually(() => mission(id), (x) => root(x)?.state === "AWAITING_ACCEPTANCE", 120_000);
    const v1 = m.handoffs.find((x) => x.assignmentId === root(m).id && x.revision === 1);
    assert.ok(v1 !== undefined);
    // Needs me held only the root's acceptance: Lan's question went to her lead, never to the owner.
    const inbox = ((await b.get("/api/inbox?state=open")).body as Inbox).items.filter((i) => i.missionId === id);
    assert.deepEqual(inbox.map((i) => `${i.kind}:${i.assignmentId}`), [`acceptance:${root(m).id}`]);
    // A part's hand-in is its lead's to review, never the owner's.
    const scan = byKey(m, "scan");
    const scanHandoff = m.handoffs.find((x) => x.assignmentId === scan.id);
    const refused = await b.send("POST", `/api/assignments/${scan.id}/accept`, { handoffDigest: scanHandoff?.digest }, ifMatch(scan.version));
    assert.equal((refused.body as { error?: { code?: string } }).error?.code, "reviewed_by_lead");

    // The owner asks for a revision on v1; An plans again and hands in v2.
    const revise = await b.send("POST", `/api/assignments/${root(m).id}/request-revision`, { handoffDigest: v1.digest, criteria: "Add Vietnam, Thailand and Indonesia." }, ifMatch(root(m).version));
    assert.equal(revise.status, 200, JSON.stringify(revise.body));
    m = await eventually(() => mission(id), (x) => root(x)?.state === "AWAITING_ACCEPTANCE" && root(x).handoffRevision === 2, 120_000);
    const v2 = m.handoffs.find((x) => x.assignmentId === root(m).id && x.revision === 2);
    assert.ok(v2 !== undefined);
    const stale = await b.send("POST", `/api/assignments/${root(m).id}/accept`, { handoffDigest: v1.digest }, ifMatch(root(m).version));
    assert.equal(stale.status, 409, "v1 can no longer be accepted");
    const ok = await b.send("POST", `/api/assignments/${root(m).id}/accept`, { handoffDigest: v2.digest }, ifMatch(root(m).version));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    m = await mission(id);
    assert.equal(m.state, "completed");

    // ---- the tree, and who it was given to.
    assert.deepEqual(m.target, { kind: "ceo", departmentId: null, departmentName: null, appointmentId: preview.responsible?.appointmentId ?? null, appointmentRevision: preview.responsible?.appointmentRevision ?? null });
    const tree = m.assignments.map((a) => [a.unitKey, a.employeeName, a.target?.kind ?? null, a.target?.departmentName ?? null, a.parentId === null ? null : m.assignments.find((x) => x.id === a.parentId)?.unitKey]);
    assert.deepEqual(tree.sort(), [
      ["finance", "Hoa", "department", "Finance", "root"],
      ["research", "Minh", "department", "Research", "root"],
      ["research-sea", "Minh", "department", "Research", "root"],
      ["root", "An", "ceo", null, null],
      ["scan", "Lan", "employee", null, "research"],
    ].sort());
    assert.ok(m.assignments.every((a) => a.state === "COMPLETED"), JSON.stringify(m.assignments.map((a) => [a.unitKey, a.state])));
    assert.equal(root(m).planCount, 2);

    // ---- Lan: two attempts, one question, answered once by her lead; her tools closed once she asked.
    assert.equal(byKey(m, "scan").attempts, 2);
    assert.equal(m.clarifications.length, 1);
    const q = m.clarifications[0];
    assert.deepEqual([q?.askerName, q?.addressee, q?.addresseeName, q?.state, q?.answer], ["Lan", "lead", "Minh", "answered", "Global, with a Southeast Asia section."]);
    assert.match(seen["Lan:after"]?.[0] ?? "", /replaced|stopped|closed/, "an attempt that asked has ended its work");
    assert.match(seen["Lan:prompt"]?.at(-1) ?? "", /Global, with a Southeast Asia section\./);

    // ---- data: Research never held Finance's files; An held Finance's summary, never the ledger; only Hoa read it.
    for (const k of ["Lan:input", "Minh:input", "Minh:sea-input"]) assert.ok(!/finance|ledger/i.test((seen[k] ?? []).join("\n")), `${k}: ${(seen[k] ?? []).join("\n")}`);
    const anInput = (seen["An:input"] ?? []).join("\n");
    assert.match(anInput, /unit-finance-finance-summary\.md/);
    assert.match(anInput, /unit-research-research\.md/);
    assert.ok(!/ledger/i.test(anInput));
    assert.deepEqual(new Set(kb.calls.map((c) => `${c.employeeId}:${c.allowed}`)), new Set([`${ids.Hoa}:true`, `${ids.An}:false`]));
    assert.ok(kb.calls.every((c) => c.agentId === `employee:${c.employeeId}`), "each call was made as the employee itself");
    assert.ok(!(await h.sql("SELECT summary FROM workforce.handoffs WHERE account_id = $1", [accountId])).some((r) => String(r.summary).includes("1,200,000")), "the ledger reached no hand-in");

    // ---- versions: v1 asked to revise, v2 accepted -- both kept, neither changeable.
    assert.deepEqual(m.handoffs.filter((x) => x.assignmentId === root(m).id).map((x) => [x.revision, x.status]).sort(), [[1, "revision_requested"], [2, "accepted"]]);
    await assert.rejects(h.sql("UPDATE workforce.handoffs SET summary = 'rewritten' WHERE account_id = $1 AND id = $2", [accountId, v1.id]), /kept as it was handed in/);

    // ---- runs: every attempt that delegated, asked or answered ended by design (a success); nothing failed.
    const runs = await h.sql("SELECT r.state, r.detail, r.wake_reason, a.unit_key FROM workforce.runs r JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.assignment_id WHERE r.account_id = $1 AND a.mission_id = $2 ORDER BY r.created_at", [accountId, id]);
    assert.ok(!runs.some((r) => r.state === "failed"), JSON.stringify(runs));
    const byDesign = runs.filter((r) => String(r.detail ?? "").startsWith("Ended by design"));
    assert.ok(byDesign.length >= 5, JSON.stringify(runs));
    assert.ok(byDesign.every((r) => r.state === "succeeded"));
    assert.ok(runs.some((r) => r.unit_key === "research" && r.wake_reason === "its team asked: answer"), JSON.stringify(runs));
    // ---- one slot: no two attempts ever held compute at once; nothing holds it now.
    const held = await h.sql("SELECT reserved_at, released_at FROM workforce.compute_reservations WHERE account_id = $1 ORDER BY reserved_at", [accountId]);
    for (let i = 1; i < held.length; i += 1) assert.ok(held[i - 1]?.released_at !== null && new Date(String(held[i - 1]?.released_at)) <= new Date(String(held[i]?.reserved_at)), `reservations overlap: ${JSON.stringify(held)}`);
    await eventually(async () => (await h.sql("SELECT running FROM workforce.budgets WHERE account_id = $1", [accountId]))[0]?.running, (n) => Number(n) === 0, 30_000);
  });
});
