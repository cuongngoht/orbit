// QUESTIONS UP THE TREE, the hard cases, through HTTP on PostgreSQL with scripted CLIs (ADR 0061 §8): a question asked of
// a lead is the lead's -- the person's answer is refused (asked_of_lead) until the lead moves it up, saying why; two
// answers at once resume the asker exactly once; a lead woken for a question it then leaves unanswered is woken again,
// and after the last wake the question moves up by itself; a lead cancelled takes its open parts with it and their
// questions are withdrawn.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type Department, type EmployeeDetail, type Inbox, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { ClarificationsService } from "../../src/contexts/work/application/clarifications.service.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `clarify-key-${Date.now()}-${(n += 1)}` });

describe("questions up the tree: escalation, one answer, unanswered wakes, a cancelled lead", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const ids: Record<string, string> = {};
  const said: Record<string, string[]> = {};
  const note = (k: string, v: string) => (said[k] ??= []).push(v);
  // Holds the escalating lead until the test has tried to answer in its place.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));

  const hire = async (name: string, departmentId: string | null): Promise<void> => {
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
    ids[name] = (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
  };
  const give = (employee: string, goal: string) => b.send("POST", "/api/missions", { title: goal.slice(0, 60), goal, target: { kind: "employee", employeeId: ids[employee] }, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Done"] }, key());
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const part = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId !== null) as AssignmentView;
  // Cancels a mission's root against the version read just before -- read again while its lead is still moving
  // (a review that ends, a wake), until the cancel is taken.
  const cancelRoot = async (missionId: string): Promise<void> => {
    await eventually(async () => {
      const r = root(await mission(missionId));
      if (r.state === "CANCELLED" || r.state === "CANCELLING") return true;
      return (await b.send("POST", `/api/assignments/${r.id}/cancel`, { reason: "done with it" }, ifMatch(r.version))).status === 200;
    }, (ok) => ok, 30_000);
  };
  const root = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId === null) as AssignmentView;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Questions Co" })).status, 200);
    const research = ((await b.send("POST", "/api/office/departments", { name: "Research" })).body as Department).id;
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        const q = /\[q:([0-9a-f-]{36})\]/.exec(p)?.[1];
        // Leads: give one part; then move the question up (escalate), or never answer it (silent), or wait.
        if (p.includes("[lead:") && q === undefined && !p.includes("The parts you gave your team")) {
          note("lead", (await t.call("delegate", { parts: [{ key: "ask", employee: "Lan", title: "Ask", goal: "[part:ask] Ask, then work.", deliverables: ["ask.md"] }] })).text);
          return;
        }
        if (p.includes("[lead:escalate]") && q !== undefined) {
          note("woken", q);
          await gate;
          note("escalate", (await t.call("escalate_question", { question_id: q, why: "human_decision", note: "Pricing is the owner's call." })).text);
          return;
        }
        if (p.includes("[lead:slow]") && q !== undefined) {
          note("slow", "woken, will answer later");
          for (let i = 0; i < 400 && t.child.signals.length === 0; i += 1) await new Promise((r) => setTimeout(r, 25));
          return;
        }
        if (p.includes("[lead:silent]") && q !== undefined) {
          note("silent", "woken, did not answer");
          return;
        }
        if (p.includes("[lead:")) return;
        if (p.includes("[part:ask]")) {
          if (!p.includes("Answers you were given")) {
            note("ask", (await t.call("ask_question", { question: "Which price point should we assume?" })).text);
            return;
          }
          note("resumed", p);
          await t.call("write_file", { path: "/output/ask.md", content: "done\n" });
          await t.call("submit_handoff", { summary: "Done with the answer." });
        }
      }),
    });
    await hire("Minh", research);
    await hire("Lan", research);
    const r = await b.send("POST", "/api/office/appointments", { role: "manager", departmentId: research, employeeId: ids.Minh });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });

  after(async () => {
    await h?.close();
  });

  test("asked of its lead: the person's answer is refused until the lead moves it up; then two answers at once resume the asker once", async () => {
    const made = await give("Minh", "[lead:escalate] Price the product.");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    // Lan asks; Minh is woken to answer. Before he moves it up, it is not the owner's to answer.
    await eventually(() => said.woken ?? [], (x) => x.length > 0, 30_000);
    let m = await mission(id);
    assert.deepEqual([m.clarifications[0]?.addressee, m.clarifications[0]?.addresseeName], ["lead", "Minh"]);
    assert.ok(!part(m).actions.includes("answer"), "a question asked of a lead offers the owner no answer");
    const early = part(m);
    const refused = await b.send("POST", `/api/assignments/${early.id}/answer`, { answer: "Premium." }, ifMatch(early.version));
    assert.equal(code(refused), "asked_of_lead", JSON.stringify(refused.body));
    release();
    m = await eventually(() => mission(id), (x) => x.clarifications[0]?.addressee === "owner", 30_000);
    assert.deepEqual(m.clarifications[0]?.route.map((r) => [r.addressee, r.why]), [["lead", "asked of its lead"], ["owner", "Pricing is the owner's call."]]);
    const inbox = ((await b.get("/api/inbox?state=open")).body as Inbox).items.filter((i) => i.missionId === id);
    assert.ok(inbox.some((i) => i.kind === "information" && i.assignmentId === part(m).id), JSON.stringify(inbox));
    const asker = part(m);
    assert.ok(asker.actions.includes("answer"), "moved up to the owner: now theirs to answer");
    const [one, two] = await Promise.all([b.send("POST", `/api/assignments/${asker.id}/answer`, { answer: "Premium." }, ifMatch(asker.version)), b.send("POST", `/api/assignments/${asker.id}/answer`, { answer: "Budget." }, ifMatch(asker.version))]);
    assert.equal([one.status, two.status].filter((s) => s === 200).length, 1, JSON.stringify([one.body, two.body]));
    m = await eventually(() => mission(id), (x) => part(x).state === "AWAITING_ACCEPTANCE" || part(x).state === "COMPLETED", 30_000);
    assert.equal(part(m).attempts, 2, "resumed exactly once");
    assert.equal(m.clarifications[0]?.state, "answered");
    assert.equal((said.resumed ?? []).length, 1);
    await cancelRoot(id);
  });

  test("a lead that leaves its team's question unanswered is woken again; after the last wake the question moves up by itself", async () => {
    await eventually(async () => (await b.get(`/api/employees/${ids.Minh}`)).body as EmployeeDetail, (e) => e.availability === "available", 30_000);
    const made = await give("Minh", "[lead:silent] Price it again.");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const m = await eventually(() => mission(id), (x) => x.clarifications[0]?.addressee === "owner", 60_000);
    const c = m.clarifications[0];
    assert.equal(c?.kind, "unanswered");
    assert.match(c?.route.at(-1)?.why ?? "", /woken 2 times and did not answer it/);
    assert.ok((said.silent ?? []).length >= 2);
  });

  test("a lead cancelled takes its open parts with it; their open questions are withdrawn", async () => {
    const m0 = await eventually(async () => ((await b.get("/api/missions?state=open")).body as { missions: { id: string; title: string }[] }).missions.find((x) => x.title.startsWith("[lead:silent]")), (x) => x !== undefined, 10_000);
    let m = await mission(m0?.id as string);
    const lead = root(m);
    const r = await b.send("POST", `/api/assignments/${lead.id}/cancel`, { reason: "not needed any more" }, ifMatch(lead.version));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    m = await eventually(() => mission(m0?.id as string), (x) => part(x).state === "CANCELLED", 30_000);
    assert.equal(m.clarifications[0]?.state, "withdrawn");
    const inbox = ((await b.get("/api/inbox?state=open")).body as Inbox).items.filter((i) => i.missionId === m.id);
    assert.deepEqual(inbox, [], "nothing of it waits for the person");
  });
  test("a question past its due time moves up by itself (the sweep): from a root lead, to the person, as a deadline", async () => {
    const lead = (await b.get(`/api/employees/${ids.Minh}`)).body as EmployeeDetail;
    if (lead.availability !== "available") await eventually(async () => (await b.get(`/api/employees/${ids.Minh}`)).body as EmployeeDetail, (e) => e.availability === "available", 30_000);
    const made = await b.send("POST", "/api/missions", { title: "[lead:slow] With a deadline", goal: "[lead:slow] Price it by Friday.", target: { kind: "employee", employeeId: ids.Minh }, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Done"], deadline: new Date(Date.now() + 3_600_000).toISOString() }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await eventually(() => said.slow ?? [], (x) => x.length > 0, 30_000);
    // The sweep, as if the deadline had passed: the question goes up -- here, from the root's lead, to the person.
    await h.app.get(ClarificationsService).sweep(new Date(Date.now() + 2 * 3_600_000).toISOString());
    const m = await eventually(() => mission(id), (x) => x.clarifications[0]?.addressee === "owner", 10_000);
    assert.deepEqual([m.clarifications[0]?.kind, m.clarifications[0]?.route.at(-1)?.why], ["deadline", "it was due and not answered"]);
    await cancelRoot(id);
  });
});
