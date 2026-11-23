// GOVERNANCE → EMPLOYEE DESKS, LOOKED INTO AND CLEANED UP, through the real API and a scripted sandbox provider. The
// account's owner opens any employee's desk -- one folder at a time (the biggest first), a file's text (a page's markup
// is text), a binary file only named and sized -- each look decided by the account's policy and recorded with what was
// looked at, never what it holds; the use is measured when the desk is opened. The owner cleans it up only while the
// employee holds no work (an assignment awaiting acceptance holds it: its work tree would put back what went) and at the
// desk's version it chose at -- accepted work that reached the desk since makes the clean stale; the toolbox stays. An
// employee that left keeps its desk read only. A look the policy refuses is refused; another account's is not found.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type DeskCleanResult, type DeskFile, type DeskTree, type EmployeeDeskList, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RevisionView, type RuntimeConnection } from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const MiB = 1024 * 1024;
const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

// A revision drafted from the policy in effect, edited, validated and published with the owner's confirmation.
async function publish(b: Browser, edit: (c: Constitution) => Constitution): Promise<RevisionView> {
  const draft = ok<RevisionView>(await b.send("POST", "/api/governance/revisions", {}));
  ok<RevisionView>(await b.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest }));
  const read = ok<RevisionView>(await b.send("POST", `/api/governance/revisions/${draft.id}/validate`));
  return ok<RevisionView>(await b.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: read.impact?.risk ?? null }));
}

describe("Governance → Employee desks: an employee's desk, looked into and cleaned up", () => {
  let h: Harness;
  let b: Browser;
  let employee: EmployeeDetail;
  const sandbox = new FakeSandboxProvider();
  const desk = () => sandbox.desks.get(employee.sandbox.id) as { version: number; files: Map<string, Buffer> };
  const listed = async () => ok<EmployeeDeskList>(await b.get("/api/office/desks")).desks.find((d) => d.employeeId === employee.id);
  const looks = async () => (await h.sql("SELECT data FROM audit_events WHERE account_id = $1 AND event_type = 'office.desk.read' ORDER BY seq", [h.accountId as string])).map((r) => r.data as Record<string, unknown>);

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Desk office" })).status, 200);
    const connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.runtime === "claude" && c.auth === "connected") as RuntimeConnection;
    const model = connection.catalog.models[0] as { id: string; efforts: string[] };
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        await t.call("write_file", { path: "/work/notes/plan.md", content: "The plan.\n" });
        await t.call("write_file", { path: "/output/report.md", content: "Done.\n" });
        await t.call("submit_handoff", { summary: "Wrote the plan." });
      }),
    });
    const hired = await b.send("POST", "/api/employees", {
      name: "Lan",
      profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    employee = await eventually(async () => (await b.get(`/api/employees/${(hired.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
    // What its desk holds, as accepted work would have left it.
    desk().files.set("work/big/archive.log", Buffer.alloc(3 * MiB, 120));
    desk().files.set("work/reports/q3.md", Buffer.from("# Q3\n<script>alert(1)</script>\n"));
    desk().files.set("work/data.bin", Buffer.from([0x50, 0x4b, 0x00, 0x01]));
    desk().files.set("toolbox/skills/report/SKILL.md", Buffer.from("# report\n"));
  });
  after(() => h?.close());

  test("the owner looks into a working employee's desk: a folder at a time, a file's text, a binary file named; each look recorded, never what it holds", async () => {
    const d = await listed();
    assert.deepEqual([d?.employment, d?.leftAt, d?.busy, d?.canBrowse, d?.canClean, d?.deskVersion], ["active", null, false, true, true, 0], "an employee in the office: its desk is listed");
    const top = ok<DeskTree>(await b.get(`/api/employees/${employee.id}/desk`));
    assert.deepEqual(top.entries.map((e) => [e.path, e.type]), [["big", "dir"], ["reports", "dir"], ["toolbox", "dir"], ["data.bin", "file"]], "the biggest first");
    assert.deepEqual([top.dir, top.deskVersion, top.employee.name, top.clean.allowed, top.files], ["", 0, "Lan", true, 4]);
    assert.equal(top.storage.deskUsedMiB, 3, "measured when the desk is opened");
    assert.deepEqual(ok<DeskTree>(await b.get(`/api/employees/${employee.id}/desk?dir=reports`)).entries.map((e) => e.path), ["reports/q3.md"]);
    const page = ok<DeskFile>(await b.get(`/api/employees/${employee.id}/desk/file?path=${encodeURIComponent("reports/q3.md")}`));
    assert.deepEqual([page.text, page.truncated, page.bytes], ["# Q3\n<script>alert(1)</script>\n", false, 31]);
    const bin = ok<DeskFile>(await b.get(`/api/employees/${employee.id}/desk/file?path=data.bin`));
    assert.deepEqual([bin.text, bin.bytes], [null, 4], "a binary file is named and sized, its bytes not sent");
    const big = ok<DeskFile>(await b.get(`/api/employees/${employee.id}/desk/file?path=${encodeURIComponent("big/archive.log")}`));
    assert.deepEqual([big.text?.length, big.truncated, big.bytes], [512 * 1024, true, 3 * MiB], "only the first 512 KiB of a file's text");
    assert.equal((await b.get(`/api/employees/${employee.id}/desk/file?path=${encodeURIComponent("../secret")}`)).status, 400);
    assert.equal((await b.get(`/api/employees/${employee.id}/desk/file?path=nowhere.md`)).status, 404);
    assert.equal((await b.get(`/api/employees/${employee.id}/desk?dir=${encodeURIComponent(".orbit-canary-0123456789abcdef")}`)).status, 400);
    const seen = (await looks()).map((x) => [x.employeeId, x.path, x.kind]);
    assert.deepEqual(seen, [[employee.id, "", "dir"], [employee.id, "reports", "dir"], [employee.id, "reports/q3.md", "file"], [employee.id, "data.bin", "file"], [employee.id, "big/archive.log", "file"]]);
    assert.equal(JSON.stringify(await looks()).includes("alert(1)"), false, "what a file holds is never recorded");
    const decided = await h.sql("SELECT count(*) AS n FROM audit_events WHERE account_id = $1 AND event_type = 'policy.decision' AND data->>'action' = 'employee.desk.read'", [h.accountId as string]);
    assert.ok(Number(decided[0]?.n) >= 6, "every look is decided by the account's policy");
    const measured = await listed();
    assert.deepEqual([measured?.deskUsedMiB, typeof measured?.measuredAt], [3, "string"]);
  });

  test("a clean waits until the employee holds no work and is held to the desk's version it was chosen at; then what it names goes, the toolbox stays", async () => {
    const given = await b.send("POST", "/api/missions", { title: "Write the plan", goal: "Write the plan", targetEmployeeId: employee.id, whenBusy: "enqueue", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, { "Idempotency-Key": "k-desk-plan" });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const missionId = (given.body as MissionAccepted).missionId;
    const rootOf = (m: MissionDetail) => m.assignments.find((a) => a.parentId === null) as AssignmentView;
    const m = await eventually(async () => (await b.get(`/api/missions/${missionId}`)).body as MissionDetail, (x) => x.handoffs.length === 1 && rootOf(x).state === "AWAITING_ACCEPTANCE", 15_000);

    // Awaiting acceptance, the employee holds the work: its work tree, seeded from the desk, would put back what went.
    const busy = await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { remove: ["big"] }, ifMatch(0));
    assert.deepEqual([busy.status, code(busy)], [409, "employee_holds_work"]);
    assert.deepEqual([(await listed())?.busy, (await listed())?.canClean], [true, false]);
    assert.equal(sandbox.cleans.length, 0, "the provider was never asked");

    // Accepted: its work reaches the desk (version 1), and a clean chosen at version 0 is stale.
    const root = rootOf(m);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: m.handoffs.at(-1)?.digest }, ifMatch(root.version))).status, 200);
    await eventually(listed, (d) => d?.deskVersion === 1 && d.busy === false);
    await eventually(() => sandbox.workspaceOf.size, (n) => n === 0);
    assert.equal(desk().files.has("work/notes/plan.md"), true);
    assert.equal((await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { remove: ["big"] }, ifMatch(0))).status, 412);
    assert.equal((await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { remove: ["toolbox"] }, ifMatch(1))).status, 400, "the toolbox's folders stay");
    assert.equal((await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { remove: ["big"] })).status, 428, "a clean names the version it was chosen at");

    // What the provider itself refuses is said as it is.
    sandbox.cleanRefusal = "a workspace of this employee's work still exists (assignment x): what it holds could still reach the desk";
    const refused = await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { remove: ["big"] }, ifMatch(1));
    assert.deepEqual([refused.status, code(refused)], [409, "desk_in_use"]);
    assert.match(JSON.stringify(refused.body), /workspace/);
    sandbox.cleanRefusal = null;

    const done = ok<DeskCleanResult>(await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { remove: ["big", "gone.md"], cache: true }, ifMatch(1)));
    assert.deepEqual([done.removed, done.paths, done.missing, done.cacheEmptied, done.deskVersion], [1, ["big"], ["gone.md"], true, 1]);
    assert.equal([...desk().files.keys()].some((k) => k.startsWith("work/big/")), false);
    assert.deepEqual([desk().files.has("toolbox/skills/report/SKILL.md"), desk().files.has("work/notes/plan.md"), desk().version], [true, true, 1], "the rest stays; the version does not move");
    assert.equal((await listed())?.deskUsedMiB, 0, "measured again after the clean");
    const recorded = await h.sql("SELECT data FROM audit_events WHERE account_id = $1 AND event_type = 'office.command' AND data->>'command' = 'employee.desk.clean'", [h.accountId as string]);
    assert.equal(recorded.length, 1);
    assert.match(String((recorded[0]?.data as { detail?: string }).detail), /removed 1 .*big.*cache emptied/);
    const refusals = await h.sql("SELECT data->>'cause' AS cause FROM audit_events WHERE account_id = $1 AND event_type = 'office.refused' AND data->>'command' = 'employee.desk.clean' ORDER BY seq", [h.accountId as string]);
    assert.deepEqual(refusals.map((r) => r.cause), ["employee_holds_work", "stale_version", "desk_in_use"]);
  });

  test("an employee that left keeps its desk read only; a look the policy refuses is refused; another account's employee is not found", async () => {
    const bob = await h.as("bob");
    assert.equal((await bob.get(`/api/employees/${employee.id}/desk`)).status, 404);
    assert.equal((await bob.get(`/api/employees/${employee.id}/desk/file?path=data.bin`)).status, 404);
    assert.equal((await bob.send("POST", `/api/employees/${employee.id}/desk/clean`, { empty: true }, ifMatch(1))).status, 404);

    await publish(b, (c) => ({ ...c, rules: c.rules.map((r) => (r.id === "office-desk-read" ? { ...r, effect: "deny" as const } : r)) }));
    const denied = await b.get(`/api/employees/${employee.id}/desk`);
    assert.deepEqual([denied.status, code(denied)], [403, "policy_denied"]);
    await publish(b, (c) => ({ ...c, rules: c.rules.map((r) => (r.id === "office-desk-read" ? { ...r, effect: "allow" as const } : r)) }));

    const detail = ok<EmployeeDetail>(await b.get(`/api/employees/${employee.id}`));
    ok(await b.send("POST", `/api/employees/${employee.id}/employment`, { command: "archive", reason: "the project ended" }, ifMatch(detail.version)));
    const tree = ok<DeskTree>(await b.get(`/api/employees/${employee.id}/desk`));
    assert.deepEqual([tree.employee.employment, tree.clean.allowed], ["archived", false]);
    assert.match(tree.clean.why ?? "", /left the office/);
    assert.equal(ok<DeskFile>(await b.get(`/api/employees/${employee.id}/desk/file?path=${encodeURIComponent("notes/plan.md")}`)).text, "The plan.\n", "read only, never unreadable");
    const r = await b.send("POST", `/api/employees/${employee.id}/desk/clean`, { empty: true }, ifMatch(1));
    assert.deepEqual([r.status, code(r)], [409, "desk_read_only"]);
    const d = await listed();
    assert.deepEqual([d?.employment, d?.canBrowse, d?.canClean, typeof d?.leftAt], ["archived", true, false, "string"]);
  });
});
