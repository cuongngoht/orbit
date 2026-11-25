// A TEAM WORKS IN PARALLEL when the account's budget holds it, end to end through HTTP on PostgreSQL: a lead gives three
// independent parts to three colleagues, and all three run AT ONCE when the budget allows three attempts; when it allows
// two, the third waits and says why, with the numbers, and starts as soon as one ends. A part that waits for another
// starts as soon as its lead accepts that one -- the lead is woken for that result at once, never only after the
// unrelated parts still running have ended.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type EmployeeDetail, type MissionAccepted, type MissionDetail, type ResourceSummary, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

// A host with room for many attempts at once: the budget is what holds them (maxConcurrent).
const ENV = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300", ORBIT_WEB_CAPACITY_CPU: "16", ORBIT_WEB_CAPACITY_MEMORY: "64g", ORBIT_WEB_CAPACITY_RESERVE_CPU: "0%", ORBIT_WEB_CAPACITY_RESERVE_MEMORY: "0%" };
let n = 0;
const key = () => ({ "idempotency-key": `parallel-${Date.now()}-${(n += 1)}` });

// A part's employee holds its attempt open until the test lets it hand in.
class Gates {
  private readonly open = new Map<string, () => void>();
  private readonly waits = new Map<string, Promise<void>>();

  wait(name: string): Promise<void> {
    let w = this.waits.get(name);
    if (w === undefined) {
      w = new Promise<void>((resolve) => this.open.set(name, resolve));
      this.waits.set(name, w);
    }
    return w;
  }

  release(name: string): void {
    void this.wait(name);
    this.open.get(name)?.();
  }
}

describe("a team works in parallel when the budget holds it", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const gates = new Gates();
  const ids: Record<string, string> = {};
  const MEMBERS = ["Lan", "Hoa", "Binh"];
  const OF: Record<string, string> = { a: "Lan", b: "Hoa", c: "Binh" };
  const problems: string[] = [];

  const hire = async (name: string, canDelegate = false): Promise<void> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      profile: { title: canDelegate ? "Team lead" : "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[name] = (await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY")).id;
  };
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const byKey = (m: MissionDetail, unit: string | null): AssignmentView => m.assignments.find((a) => (unit === null ? a.parentId === null : a.unitKey === unit)) as AssignmentView;
  const give = async (goal: string): Promise<string> => {
    const made = await b.send("POST", "/api/missions", { title: goal.slice(0, 40), goal, targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return (made.body as MissionAccepted).missionId;
  };
  // The parts' attempts running now, by employee name (the lead's own attempts aside).
  const running = async (): Promise<string[]> => {
    const rows = await h.sql("SELECT employee_id FROM workforce.runs WHERE account_id = $1 AND state = 'running'", [h.accountId as string]);
    return rows.map((r) => Object.keys(ids).find((k) => ids[k] === String(r.employee_id)) ?? "?").filter((name) => MEMBERS.includes(name)).sort();
  };
  const slots = async (maxConcurrent: number): Promise<void> => {
    const r = (await b.get("/api/office/resources")).body as ResourceSummary;
    assert.ok(r.budget.authorized.maxConcurrent >= 4, `the host authorizes enough attempts at once (${r.budget.authorized.maxConcurrent})`);
    const set = await b.send("PATCH", "/api/office/resources/budget", { maxConcurrent }, { "if-match": `"${r.budget.version}"` });
    assert.equal(set.status, 200, JSON.stringify(set.body));
  };
  const accept = async (id: string): Promise<void> => {
    const m = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    const root = byKey(m, null);
    const handed = m.handoffs.find((x) => x.assignmentId === root.id);
    const ok = await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: ENV });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Parallel office" })).status, 200);
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        const tag = /\[(p[0-9]):([a-z])\]/.exec(p);
        // A part: held open until its gate is released, then handed in.
        if (tag !== null && !p.includes("The parts you gave your team")) {
          await gates.wait(`${tag[1]}:${tag[2]}`);
          await t.call("write_file", { path: `/output/${tag[2]}.md`, content: `part ${tag[2]}\n` });
          await t.call("submit_handoff", { summary: `Part ${tag[2]}.` });
          return;
        }
        const plan = /\[plan:(p[0-9])(:chain)?\]/.exec(p);
        if (plan === null) return;
        const round = plan[1] as string;
        if (!p.includes("The parts you gave your team")) {
          const parts = [
            { key: "a", employee: "Lan", title: "A", goal: `[${round}:a] Part A.`, deliverables: ["a.md"] },
            { key: "b", employee: "Hoa", title: "B", goal: `[${round}:b] Part B.`, deliverables: ["b.md"] },
            { key: "c", employee: "Binh", title: "C", goal: `[${round}:c] Part C.`, deliverables: ["c.md"], ...(plan[2] !== undefined ? { waits_for: ["a"] } : {}) },
          ];
          const r = await t.call("delegate", { parts });
          if (r.isError) problems.push(r.text);
          return;
        }
        // A review: decide on every part handed in; integrate once every part ended.
        const lines = p.split("\n").filter((l) => /^- [abc]: /.test(l));
        for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) await t.call("review_unit", { part: (l.match(/^- ([abc]):/) as RegExpMatchArray)[1], decision: "accept" });
        if (lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed"))) return;
        await t.call("write_file", { path: "/output/report.md", content: "# Report\n" });
        await t.call("submit_handoff", { summary: "Integrated the parts." });
      }),
    });
    await hire("Mai", true);
    for (const name of MEMBERS) await hire(name);
    for (const name of MEMBERS) assert.equal((await b.send("POST", `/api/employees/${ids.Mai}/delegation-grants`, { target: { kind: "employee", employeeId: ids[name] }, note: "leads the team in this test" })).status, 201);
  });

  after(async () => {
    await h?.close();
  });

  test("three independent parts given to three colleagues run at once when the budget holds three attempts", async () => {
    await slots(3);
    const id = await give("[plan:p1] Three parts at once.");
    // All three hold their attempts open: they run side by side.
    assert.deepEqual(await eventually(running, (r) => r.length === 3, 30_000), ["Binh", "Hoa", "Lan"]);
    assert.deepEqual(problems, []);
    const m = await mission(id);
    assert.deepEqual(["a", "b", "c"].map((k) => byKey(m, k).state), ["RUNNING", "RUNNING", "RUNNING"]);
    for (const k of ["a", "b", "c"]) gates.release(`p1:${k}`);
    await accept(id);
  });

  test("when the budget holds two, the third waits and says why with the numbers -- and starts as soon as one ends", async () => {
    await slots(2);
    const id = await give("[plan:p2] Three parts, two slots.");
    assert.equal((await eventually(running, (r) => r.length === 2, 30_000)).length, 2);
    const waiting = await eventually(() => h.sql("SELECT employee_id, waiting_reason FROM workforce.runs WHERE account_id = $1 AND state = 'waiting_for_resources'", [h.accountId as string]), (rows) => rows.length === 1 && rows[0]?.waiting_reason !== null, 30_000);
    assert.equal(waiting[0]?.waiting_reason, "The account already runs 2 of its 2 concurrent attempts.");
    const started = await running();
    const first = ["a", "b", "c"].find((k) => started.includes(OF[k] as string)) as string;
    gates.release(`p2:${first}`);
    // The one that waited starts once a slot is free; the other is still running beside it.
    await eventually(running, (r) => r.length === 2 && !r.includes(OF[first] as string), 30_000);
    for (const k of ["a", "b", "c"]) gates.release(`p2:${k}`);
    await accept(id);
  });

  test("a part that waits for another starts as soon as its lead accepts that one, beside an unrelated part still running", async () => {
    await slots(3);
    const id = await give("[plan:p3:chain] Two parts, then one after the first.");
    assert.deepEqual(await eventually(running, (r) => r.length === 2, 30_000), ["Hoa", "Lan"]);
    assert.equal(byKey(await mission(id), "c").state, "QUEUED", "c waits for a");
    // a hands in while b still runs: the lead is woken for it at once, accepts it, and c starts -- b is still running.
    gates.release("p3:a");
    const both = await eventually(running, (r) => r.includes("Binh") && r.includes("Hoa"), 30_000);
    assert.deepEqual(both, ["Binh", "Hoa"]);
    assert.equal(byKey(await mission(id), "b").state, "RUNNING", "the unrelated part never held c back");
    gates.release("p3:b");
    gates.release("p3:c");
    await accept(id);
  });
});
