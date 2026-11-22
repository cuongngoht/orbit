// THE VIRTUAL OFFICE END TO END, through HTTP as a browser drives it, on PostgreSQL: set up the office, hire an employee
// (Personal Sandbox provisioned), give it work, the employee works in its own sandbox through Orbit's real tool endpoint
// with its run's token, hands in, a revision is asked, it hands in again, the result is accepted, the accepted work
// reaches its desk, and its queued work starts from that desk. The sandbox is the in-memory fake provider and the CLI a
// scripted stand-in (the native runtimes are reported separately: no account is used by these tests).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type EmployeeDetail, type HandoffView, type Inbox, type MissionAccepted, type MissionDetail, type Office, type RuntimeConnection } from "@orbit-web/contracts";
import { ResearchInputs } from "../../src/contexts/execution/application/research-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { filled, routesOf } from "../../src/testing/routes.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };

const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let keys = 0;
const key = () => ({ "idempotency-key": `test-key-${Date.now()}-${(keys += 1)}` });

interface Ctx {
  h: Harness;
  b: Browser;
  sandbox: FakeSandboxProvider;
  connection: RuntimeConnection;
}

async function hire(c: Ctx, name: string): Promise<EmployeeDetail> {
  const model = c.connection.catalog.models[0];
  assert.ok(model !== undefined, "the connection has a model catalog from its CLI");
  const r = await c.b.send("POST", "/api/employees", {
    name,
    profile: {
      title: "Accountant",
      duties: "Prepare the reports asked for.",
      instructions: "Be exact.",
      skills: ["spreadsheets"],
      languages: ["en"],
      knowledge: [],
      execution: { runtime: "claude", connectionId: c.connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false },
      handoffStandard: "A short summary and the files.",
      reportingRule: "Say what was checked.",
      canDelegate: false,
      maxAssistants: 0,
      canHirePermanent: false,
    },
    resources: DEFAULT_PRESETS[0]?.profile,
    skipProbation: true,
    skipReason: "a test employee",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const e = r.body as EmployeeDetail;
  return eventually(
    async () => (await c.b.get(`/api/employees/${e.id}`)).body as EmployeeDetail,
    (d) => d.sandbox.state === "READY",
  );
}

const mission = async (c: Ctx, employeeId: string, title: string, whenBusy: "reject" | "enqueue" = "reject", headers = key()) =>
  c.b.send("POST", "/api/missions", { title, goal: `${title}: total the invoices of the quarter.`, targetEmployeeId: employeeId, whenBusy, deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Has the total"] }, headers);

const detail = async (c: Ctx, id: string): Promise<MissionDetail> => (await c.b.get(`/api/missions/${id}`)).body as MissionDetail;
const root = (m: MissionDetail): AssignmentView => m.assignments.find((a) => a.parentId === null) as AssignmentView;
const waitFor = (c: Ctx, missionId: string, ok: (m: MissionDetail) => boolean, ms = 15_000) => eventually(() => detail(c, missionId), ok, ms);

describe("the virtual office, end to end", () => {
  const c = {} as Ctx;
  // What each attempt's scripted CLI saw: its prompt, and the doors it knocked on with its run's token.
  const seen: { prompt: string; toolbox: string | null; doors: Record<string, number> }[] = [];

  before(async () => {
    c.sandbox = new FakeSandboxProvider();
    c.h = await startHarness({ overrides: [[SANDBOX_PROVIDER, c.sandbox]], env: FAST });
    c.sandbox.readInput = (p) => c.h.app.get(ResearchInputs).read(p);
    c.b = c.h.owner as Browser;
    const list = (await c.b.get("/api/connections")).body as { connections: RuntimeConnection[] };
    c.connection = list.connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    // The employee's attempts: read what the desk gave them, knock on the doors that must stay shut, write the report,
    // a script and a skill of their own, run the script, and hand in.
    c.sandbox.cli.on(
      program("claude"),
      {
        spawn: scriptedEmployee(async (t: ToolCaller) => {
          const toolbox = await t.call("read_file", { path: "/toolbox/scripts/sum.py" });
          const doors: Record<string, number> = {};
          for (const [name, path] of [["agent gateway", "/api/agent/whoami"], ["owner route", "/api/office/roster"]] as const) {
            const r = await fetch(t.bridge.url.replace("/api/runtime/tools", path), { headers: { "x-orbit-run-token": t.bridge.token, "x-orbit-web": "1" } });
            doors[name] = r.status;
          }
          seen.push({ prompt: t.prompt, toolbox: toolbox.isError ? null : toolbox.text, doors });
          const revised = t.prompt.includes("The reviewer asked for these changes");
          await t.call("write_file", { path: "/toolbox/scripts/sum.py", content: "print(1200000 + 800000)\n" });
          await t.call("write_file", { path: "/toolbox/skills/quarterly-totals/SKILL.md", content: "---\nname: quarterly-totals\ndescription: Total a quarter's invoices.\n---\nSum the rows of the quarter only.\n" });
          const ran = await t.call("shell", { command: "python3 /toolbox/scripts/sum.py" });
          assert.equal(ran.isError, false, ran.text);
          await t.call("write_file", { path: "/output/report.md", content: revised ? "# Q3\nTotal: 2,000,000 VND\nVAT: 200,000 VND\n" : "# Q3\nTotal: 2,000,000 VND\n" });
          const handed = await t.call("submit_handoff", { summary: revised ? "Added the VAT line." : "Totalled the quarter.", claims: [{ text: "The total is 2,000,000 VND." }] });
          assert.equal(handed.isError, false, handed.text);
        }),
      },
    );
  });

  after(async () => {
    await c.h?.close();
  });

  test("set up the office, hire an employee: its Personal Sandbox is provisioned, it reserves no CPU or memory while idle", async () => {
    const office = await c.b.send("POST", "/api/office/setup", { name: "Acme office" });
    assert.equal(office.status, 200, JSON.stringify(office.body));
    assert.equal((office.body as Office).name, "Acme office");
    const ana = await hire(c, "Ana");
    assert.equal(ana.employment, "active");
    assert.equal(ana.sandbox.state, "READY");
    assert.ok(ana.sandbox.areas.some((a) => a.area === "desk" && a.level === "HARD_ENFORCED"));
    assert.equal(ana.activeRun, null);
    const reserved = await c.h.sql("SELECT count(*) AS n FROM workforce.compute_reservations WHERE account_id = $1 AND released_at IS NULL", [c.h.accountId as string]);
    assert.equal(Number(reserved[0]?.n), 0);
  });

  test("give work, hand in, ask for a revision, hand in again, accept: the employee's next work starts from its desk", async () => {
    const [ana] = (await c.h.sql("SELECT id FROM workforce.employees WHERE account_id = $1 AND name = 'Ana'", [c.h.accountId as string])).map((r) => String(r.id));
    assert.ok(ana !== undefined);
    const first = await mission(c, ana, "Q3 report");
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const m1 = (first.body as MissionAccepted).missionId;

    // Busy now: "start now" is refused with who holds it, and nothing is made; queued is accepted.
    const busy = await mission(c, ana, "Q4 report", "reject");
    assert.equal(busy.status, 409);
    assert.equal(code(busy), "employee_busy");
    const queued = await mission(c, ana, "Q4 report", "enqueue");
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    const m2 = (queued.body as MissionAccepted).missionId;
    assert.equal((queued.body as MissionAccepted).state, "QUEUED");

    // The first attempt hands in.
    let d = await waitFor(c, m1, (m) => root(m).state === "AWAITING_ACCEPTANCE");
    let h1 = d.handoffs[0] as HandoffView;
    assert.equal(h1.revision, 1);
    assert.deepEqual(h1.artifacts.map((a) => a.name), ["report.md"]);
    assert.deepEqual(h1.missing, []);
    // Its run: three records kept apart, the sandbox's attestation, what the model reported.
    d = await waitFor(c, m1, (m) => root(m).lastRun?.state === "succeeded");
    const run = root(d).lastRun;
    assert.equal(run?.sandbox?.state, "attested");
    assert.equal(run?.sandbox?.shell, true);
    assert.ok(run?.resources?.requested && run.resources.applied && run.resources.observed);
    assert.equal(run?.modelUsage.costUsd, 0.0123);
    assert.equal(run?.observed.runtimeVersion, "2.1.330");
    // The run's token opened its tool endpoint, and no other door.
    assert.equal(seen[0]?.doors["agent gateway"], 401);
    assert.equal(seen[0]?.doors["owner route"], 403);
    // The artifact's bytes, verified, never served as a page that could run script.
    const file = await fetch(`${c.h.url}/api/artifacts/${h1.artifacts[0]?.id}/content`, { headers: { cookie: c.b.cookie } });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "# Q3\nTotal: 2,000,000 VND\n");
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.match(file.headers.get("content-security-policy") ?? "", /sandbox/);

    // A revision names the version and the handoff it was looking at.
    const a = root(d);
    const stale = await c.b.send("POST", `/api/assignments/${a.id}/request-revision`, { handoffDigest: h1.digest, criteria: "Add the VAT line" }, ifMatch(a.version - 1));
    assert.equal(stale.status, 412);
    const wrongDigest = await c.b.send("POST", `/api/assignments/${a.id}/request-revision`, { handoffDigest: "0".repeat(64), criteria: "Add the VAT line" }, ifMatch(a.version));
    assert.equal(wrongDigest.status, 409);
    assert.equal(code(wrongDigest), "stale_handoff");
    const revise = await c.b.send("POST", `/api/assignments/${a.id}/request-revision`, { handoffDigest: h1.digest, criteria: "Add the VAT line" }, ifMatch(a.version));
    assert.equal(revise.status, 200, JSON.stringify(revise.body));

    // The second attempt was told what to change, kept the employee, and handed in revision 2.
    d = await waitFor(c, m1, (m) => root(m).state === "AWAITING_ACCEPTANCE" && m.handoffs.some((h) => h.revision === 2));
    assert.match(seen[1]?.prompt ?? "", /Add the VAT line/);
    assert.equal(root(d).employeeId, ana);
    assert.equal(root(d).reworkCount, 1);
    const h2 = d.handoffs.find((h) => h.revision === 2) as HandoffView;
    h1 = d.handoffs.find((h) => h.revision === 1) as HandoffView;
    assert.equal(h1.status, "revision_requested");

    // Accepted once; the employee is released, its accepted work reaches its desk, and the queued work starts.
    const accept = await c.b.send("POST", `/api/assignments/${root(d).id}/accept`, { handoffDigest: h2.digest }, ifMatch(root(d).version));
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    const again = await c.b.send("POST", `/api/assignments/${root(d).id}/accept`, { handoffDigest: h2.digest }, ifMatch(root(d).version + 1));
    assert.equal(again.status, 409);
    d = await detail(c, m1);
    assert.equal(d.state, "completed");
    const desk = await eventually(() => c.h.sql("SELECT published, desk_version FROM workforce.desk_publications WHERE account_id = $1 AND assignment_id = $2", [c.h.accountId as string, root(d).id]), (rows) => rows.length === 1);
    assert.equal(desk[0]?.published, true);

    // The queued mission was claimed and its attempt found the script and the skill the first one wrote.
    const d2 = await waitFor(c, m2, (m) => root(m).state === "AWAITING_ACCEPTANCE");
    assert.equal(root(d2).employeeId, ana);
    assert.equal(seen[2]?.toolbox, "print(1200000 + 800000)\n");
    assert.ok(d.timeline.some((e) => e.type === "RevisionRequested"));
    assert.ok((await detail(c, m1)).timeline.some((e) => e.type === "DeskPublished"));
  });

  test("the same Idempotency-Key and request answer the same result; another request under that key is refused", async () => {
    const [bao] = [(await hire(c, "Bao")).id];
    const headers = key();
    const one = await mission(c, bao, "Same key", "enqueue", headers);
    const two = await mission(c, bao, "Same key", "enqueue", headers);
    assert.ok(one.status === 201 || one.status === 202, JSON.stringify(one.body));
    assert.equal(two.status, one.status);
    assert.equal((two.body as MissionAccepted).missionId, (one.body as MissionAccepted).missionId);
    const other = await mission(c, bao, "Another request", "enqueue", headers);
    assert.equal(other.status, 409);
    assert.equal(code(other), "idempotency_conflict");
  });

  test("Needs me holds what waits for the owner, pinned to what it was raised against", async () => {
    const inbox = (await c.b.get("/api/inbox?state=open")).body as Inbox;
    assert.ok(Array.isArray(inbox.items));
    for (const item of inbox.items.filter((i) => i.kind === "acceptance")) assert.match(item.pin.handoffDigest ?? "", /^[0-9a-f]{64}$/);
  });

  test("another account reaches nothing of this office: every route under its employee, mission, assignment or artifact is not found, and its lists hold none of it", async () => {
    const one = async (sql: string) => String((await c.h.sql(sql, [c.h.accountId as string]))[0]?.id ?? "");
    const dept = await c.b.send("POST", "/api/office/departments", { name: "Finance" });
    assert.equal(dept.status, 201, JSON.stringify(dept.body));
    const ids = {
      employee: await one("SELECT id FROM workforce.employees WHERE account_id = $1 LIMIT 1"),
      mission: await one("SELECT id FROM workforce.missions WHERE account_id = $1 LIMIT 1"),
      assignment: await one("SELECT id FROM workforce.assignments WHERE account_id = $1 LIMIT 1"),
      artifact: await one("SELECT id FROM workforce.artifacts WHERE account_id = $1 LIMIT 1"),
      department: await one("SELECT id FROM workforce.departments WHERE account_id = $1 LIMIT 1"),
    };
    assert.ok(Object.values(ids).every((v) => v !== ""), JSON.stringify(ids));
    const mallory = await c.h.as("mallory");
    const under = [["/api/employees/:id", ids.employee], ["/api/missions/:id", ids.mission], ["/api/assignments/:id", ids.assignment], ["/api/artifacts/:id", ids.artifact], ["/api/office/departments/:id", ids.department]] as const;
    const routes = routesOf(c.h).filter((r) => under.some(([prefix]) => r.path.startsWith(prefix)));
    assert.ok(routes.length >= 15, `every route under them was read (${routes.length})`);
    // Each answers exactly what it answers for an id nobody has -- not found, or the same refusal of the body before any
    // lookup -- so nothing says the record exists, and nothing of it is changed.
    const ask = (method: string, path: string) => (method === "GET" ? mallory.get(path) : mallory.send(method, path, {}, { "if-match": '"1"' }));
    for (const r of routes) {
      const id = (under.find(([prefix]) => r.path.startsWith(prefix)) as readonly [string, string])[1];
      const foreign = await ask(r.method, filled(r.path, { id, revision: "1" }));
      const nobody = await ask(r.method, filled(r.path, { id: "00000000-0000-4000-8000-0000000000ff", revision: "1" }));
      assert.deepEqual([foreign.status, code(foreign)], [nobody.status, code(nobody)], `${r.method} ${r.path}: ${foreign.status} ${JSON.stringify(foreign.body).slice(0, 160)}`);
      assert.ok(foreign.status === 404 || foreign.status === 400, `${r.method} ${r.path} answered ${foreign.status}`);
      if (r.method === "GET") assert.equal(foreign.status, 404, `${r.method} ${r.path}`);
    }
    const roster = JSON.stringify((await mallory.get("/api/office/roster")).body);
    const missions = JSON.stringify((await mallory.get("/api/missions?state=open")).body) + JSON.stringify((await mallory.get("/api/missions?state=closed")).body);
    const inbox = JSON.stringify((await mallory.get("/api/inbox?state=open")).body);
    for (const id of Object.values(ids)) {
      assert.ok(!roster.includes(id) && !missions.includes(id) && !inbox.includes(id), `${id} appears to another account`);
    }
    // Its own writes cannot name this account's records either: work for this account's employee is not found.
    const given = await mallory.send("POST", "/api/missions", { goal: "steal", targetEmployeeId: ids.employee, whenBusy: "enqueue", deliverables: [], acceptanceCriteria: [] }, { "idempotency-key": "mallory-key-0001" });
    assert.equal(given.status, 404, JSON.stringify(given.body));
  });
});
