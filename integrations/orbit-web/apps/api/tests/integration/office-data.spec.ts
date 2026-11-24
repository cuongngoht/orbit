// WHAT EACH ATTEMPT MAY READ, end to end through HTTP on PostgreSQL with scripted employees (ADR 0061 §9). A lead of no
// department gives a mission's research to Research and its numbers to Finance: each part reads only what the lead shared
// with it (Research the market notes; Finance the ledger and Research's SUMMARY, never its files), each department works
// in a room of its own (never the other's, never the lead's), and the lead reads its parts' hand-ins by supervision. The
// input reader serves an attempt only what its manifest names and its grant still allows: a store's own path, a name not
// in the manifest and another account's attempt are refused and recorded. A share revoked, or an employee moved to another
// department, while an attempt runs stops it, and its work is blocked saying why.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type DataShareView, type Department, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";
import { newWorkspace, settledSource, uploaded } from "../../src/testing/research-client.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
let n = 0;
const key = () => ({ "idempotency-key": `data-key-${Date.now()}-${(n += 1)}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The file names of a list_files answer ("- <size>\t<path>" per line).
const names = (listing: string): string[] => listing.split("\n").map((l) => (l.split("\t").pop() ?? "").trim().replace(/^.*\//, "")).filter((l) => l.length > 0 && l !== "(empty)");

describe("each attempt reads only what it may: shares, per-department rooms, the manifest, and revocation", () => {
  let h: Harness;
  let b: Browser;
  let accountId: string;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const seen: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  const dept: Record<string, string> = {};
  const revisions: Record<string, string> = {};
  let workspaceId = "";

  const note = (who: string, what: string) => (seen[who] ??= []).push(what);
  const hire = async (name: string, departmentId: string | null, canDelegate = false): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const r = await b.send("POST", "/api/employees", {
      name,
      ...(departmentId !== null ? { departmentId } : {}),
      profile: { title: canDelegate ? "Lead" : "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    ids[name] = d.id;
    return d;
  };
  const give = (employeeId: string, goal: string, extra: Record<string, unknown> = {}) =>
    b.send("POST", "/api/missions", { title: goal.slice(0, 60), goal, targetEmployeeId: employeeId, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Correct"], workspaceId, sourceRevisionIds: [revisions.market, revisions.ledger], ...extra }, key());
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const byKey = (m: MissionDetail, unit: string | null): AssignmentView => m.assignments.find((a) => (unit === null ? a.parentId === null : a.unitKey === unit)) as AssignmentView;
  const until = (id: string, ok: (m: MissionDetail) => boolean, ms = 30_000) => eventually(() => mission(id), ok, ms);
  const slow = async (t: ToolCaller) => {
    for (let i = 0; i < 600 && t.child.signals.length === 0; i += 1) {
      await t.call("list_files", { path: "/work" });
      await sleep(25);
    }
  };

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    accountId = h.accountId as string;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Data office" })).status, 200);
    for (const name of ["Research", "Finance"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    const ws = await newWorkspace(b, "Game market");
    workspaceId = ws.id;
    for (const [label, file, text] of [["market", "market-notes.txt", "The game market grew 9 percent in 2026, led by mobile titles."], ["ledger", "ledger.txt", "Ledger 2026: revenue 1,000,000 VND; costs 400,000 VND."]] as const) {
      const src = await uploaded(h, ws.id, file, Buffer.from(text), b);
      const ready = await settledSource(b, src.id);
      revisions[label] = ready.revision?.id as string;
    }
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        // The lead: gives the research to Research and the numbers to Finance, sharing with each only what it needs.
        if (p.includes("[data]") && !p.includes("The parts you gave your team")) {
          await t.call("write_file", { path: "/team/lead-note.md", content: "The lead's own notes.\n" });
          const r = await t.call("delegate", {
            parts: [
              { key: "research", employee: "Rhea", title: "Research", goal: "[part:research] Size the market.", deliverables: ["research.md"], share_sources: ["S1"] },
              { key: "finance", employee: "Fin", title: "Finance", goal: "[part:finance] The numbers.", deliverables: ["finance.md"], waits_for: ["research"], share_sources: ["S2"], receives: [{ from: "research", as: "summary" }] },
            ],
          });
          note("Lena", r.text);
          return;
        }
        if (p.includes("[data]")) {
          const lines = p.split("\n").filter((l) => /^- (research|finance): /.test(l));
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) await t.call("review_unit", { part: (l.match(/^- ([a-z-]+):/) as RegExpMatchArray)[1] as string, decision: "accept" });
          if (lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed"))) return;
          note("Lena:input", (await t.call("list_files", { path: "/input" })).text);
          await t.call("write_file", { path: "/output/report.md", content: "# The market and its numbers\n" });
          await t.call("submit_handoff", { summary: "Integrated research and finance." });
          return;
        }
        if (p.includes("[part:research]")) {
          note("Rhea:input", (await t.call("list_files", { path: "/input" })).text);
          note("Rhea:team", (await t.call("list_files", { path: "/team" })).text);
          await t.call("write_file", { path: "/team/research-note.md", content: "Research's working notes.\n" });
          await t.call("write_file", { path: "/output/research.md", content: "The market grew 9 percent.\n" });
          await t.call("submit_handoff", { summary: "Research: the game market grew 9 percent in 2026." });
          return;
        }
        if (p.includes("[part:finance]")) {
          note("Fin:prompt", p);
          note("Fin:input", (await t.call("list_files", { path: "/input" })).text);
          note("Fin:summary", (await t.call("read_file", { path: "/input/from-research-summary.md" })).text);
          note("Fin:team", (await t.call("list_files", { path: "/team" })).text);
          await t.call("write_file", { path: "/output/finance.md", content: "Revenue 1,000,000 VND.\n" });
          await t.call("submit_handoff", { summary: "Finance: revenue 1,000,000 VND." });
          return;
        }
        // A lead that shares what it was never given: the plan is refused whole.
        if (p.includes("[badshare]")) {
          note("badshare", (await t.call("delegate", { parts: [{ key: "x", employee: "Rhea", title: "X", goal: "x", share_sources: ["S9"] }] })).text);
          return;
        }
        // A lead whose part holds what it shared while the part runs (the share is revoked under it).
        if (p.includes("[hold]") && !p.includes("The parts you gave your team")) {
          note("hold", (await t.call("delegate", { parts: [{ key: "hold", employee: "Sam", title: "Hold", goal: "[part:hold] Read the notes slowly.", deliverables: ["hold.md"], share_sources: ["S1"] }] })).text);
          return;
        }
        if (p.includes("[part:hold]") || p.includes("[slow]")) return slow(t);
      }),
    });
    await hire("Lena", null, true);
    await hire("Rhea", dept.Research as string);
    await hire("Fin", dept.Finance as string);
    await hire("Sam", dept.Research as string);
    await hire("Tom", dept.Research as string);
    // Lena leads by a person's grants (no appointment): she may give work to these three.
    for (const to of ["Rhea", "Fin", "Sam"]) {
      const r = await b.send("POST", `/api/employees/${ids.Lena}/delegation-grants`, { target: { kind: "employee", employeeId: ids[to] } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
  });

  after(async () => {
    await h?.close();
  });

  test("each part reads only what its lead shared; each department works in a room of its own; the lead supervises its parts' hand-ins", async () => {
    const made = await give(ids.Lena as string, "[data] Research the game market, with its numbers.");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const m = await until(id, (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 60_000);
    assert.deepEqual([byKey(m, "research").state, byKey(m, "finance").state], ["COMPLETED", "COMPLETED"]);

    // Research: the market notes it was shared, nothing else -- not the ledger, no one's hand-in, not the lead's room.
    const rhea = names(seen["Rhea:input"]?.[0] ?? "");
    assert.ok(rhea.length > 0 && rhea.every((f) => f.startsWith("S1-")), JSON.stringify(rhea));
    assert.ok(!(seen["Rhea:team"]?.[0] ?? "").includes("lead-note.md"), "the lead's room is not Research's");
    // Finance: the ledger and Research's SUMMARY (never its files, never the market notes), in a room of its own.
    const fin = names(seen["Fin:input"]?.[0] ?? "");
    assert.ok(fin.some((f) => f.startsWith("S2-")), JSON.stringify(fin));
    assert.ok(fin.includes("from-research-summary.md"), JSON.stringify(fin));
    assert.ok(!fin.some((f) => f.startsWith("S1-") || f === "from-research-research.md" || f.startsWith("unit-")), JSON.stringify(fin));
    assert.match(seen["Fin:summary"]?.[0] ?? "", /the game market grew 9 percent in 2026/);
    assert.match(seen["Fin:prompt"]?.[0] ?? "", /from-research-summary\.md -- "research"'s accepted hand-in \(revision 1\), shared by your lead: its summary/);
    assert.ok(!/research-note\.md|lead-note\.md/.test(seen["Fin:team"]?.[0] ?? ""), seen["Fin:team"]?.[0]);
    // The lead: the mission's sources, and each part's hand-in by supervision.
    const lena = names(seen["Lena:input"]?.[0] ?? "");
    for (const f of ["unit-research-research.md", "unit-finance-finance.md"]) assert.ok(lena.includes(f), JSON.stringify(lena));
    assert.ok(lena.some((f) => f.startsWith("S1-")) && lena.some((f) => f.startsWith("S2-")), JSON.stringify(lena));

    // Three rooms: the company's (the lead's), Research's and Finance's -- each committed on its own.
    const rooms = await h.sql("SELECT room_key, department_id FROM workforce.team_rooms WHERE account_id = $1 AND mission_id = $2 ORDER BY room_key", [accountId, id]);
    assert.deepEqual(rooms.map((r) => r.room_key).sort(), ["company", `department:${dept.Finance}`, `department:${dept.Research}`].sort());
    const committed = await h.sql("SELECT count(*)::int AS n FROM workforce.storage_usage WHERE account_id = $1 AND category = 'team' AND owner_ref IN (SELECT id::text FROM workforce.team_rooms WHERE account_id = $1 AND mission_id = $2)", [accountId, id]);
    assert.equal(committed[0]?.n, 3);

    // What was shared, to whom and from where: listed for the owner, and audited.
    const shares = (await b.get(`/api/missions/${id}/data-shares`)).body as DataShareView[];
    assert.deepEqual(shares.map((s) => [s.recipientUnit, s.kind, s.kind === "source" ? s.sourceRevisionId : s.fromUnit, s.mode]).sort(), [
      ["finance", "handoff", "research", "summary"],
      ["finance", "source", revisions.ledger, "full"],
      ["research", "source", revisions.market, "full"],
    ].sort());
    const audited = await h.sql("SELECT event_type, count(*)::int AS n FROM audit_events WHERE account_id = $1 AND event_type IN ('office.data.shared', 'office.run.inputs') GROUP BY event_type ORDER BY event_type", [accountId]);
    assert.equal(audited.find((a) => a.event_type === "office.data.shared")?.n, 3);
    assert.ok(Number(audited.find((a) => a.event_type === "office.run.inputs")?.n) >= 4, JSON.stringify(audited));
    // Each attempt's manifest says why each input is there.
    const finRun = byKey(m, "finance").lastRun?.id as string;
    const manifest = await h.sql("SELECT name, origin FROM workforce.attempt_inputs WHERE account_id = $1 AND run_id = $2 ORDER BY name", [accountId, finRun]);
    assert.ok(manifest.length > 0 && manifest.every((r) => r.origin === "share"), JSON.stringify(manifest));
    // The owner accepts the integrated result: the lead is free again.
    const root = byKey(m, null);
    const handed = m.handoffs.find((x) => x.assignmentId === root.id);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, ifMatch(root.version))).status, 200);
  });

  test("the input reader serves an attempt only what its manifest names: a store's path, a name it was not given and another account's are refused and recorded", async () => {
    const inputs = h.app.get(AttemptInputs);
    await assert.rejects(inputs.read(`research-text:${accountId}/${revisions.market}`), /refused/);
    const finRun = (await h.sql("SELECT r.id FROM workforce.runs r JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.assignment_id WHERE r.account_id = $1 AND a.unit_key = 'finance' ORDER BY r.created_at DESC LIMIT 1", [accountId]))[0]?.id as string;
    await assert.rejects(inputs.read(`attempt:${accountId}/${finRun}/S1-market-notes.txt.txt`), /refused/);
    await assert.rejects(inputs.read(`attempt:${accountId}/${finRun}/from-research-summary.md`), /refused/, "an ended attempt reads nothing");
    await assert.rejects(inputs.read(`attempt:00000000-0000-4000-8000-000000000001/${finRun}/x.txt`), /refused/);
    const violations = await h.sql("SELECT data->>'target' AS target FROM audit_events WHERE account_id = $1 AND event_type = 'boundary.violation' AND data->>'kind' = 'input_not_authorized'", [accountId]);
    assert.ok(violations.length >= 3, JSON.stringify(violations));
    assert.ok(violations.some((v) => String(v.target).startsWith("research-text:")));
  });

  test("a lead shares only what it reads: a plan sharing a source it was never given is refused whole", async () => {
    const made = await give(ids.Lena as string, "[badshare] share what you do not have", { sourceRevisionIds: [revisions.market] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    await eventually(() => seen.badshare ?? [], (x) => x.length > 0, 30_000);
    assert.match(seen.badshare?.[0] ?? "", /"S9" is not a source you were given/);
    const id = (made.body as MissionAccepted).missionId;
    const m = await until(id, (x) => byKey(x, null)?.state === "BLOCKED");
    assert.equal(m.assignments.length, 1, "nothing was made");
    const root = byKey(m, null);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/cancel`, { reason: "done with it" }, ifMatch(root.version))).status, 200);
    await until(id, (x) => byKey(x, null)?.state === "CANCELLED");
  });

  test("a share revoked while its part runs: the attempt is stopped and its work blocked saying why", async () => {
    const made = await give(ids.Lena as string, "[hold] hold a share");
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await until(id, (x) => byKey(x, "hold")?.state === "RUNNING");
    const share = ((await b.get(`/api/missions/${id}/data-shares`)).body as DataShareView[]).find((s) => s.recipientUnit === "hold") as DataShareView;
    const revoked = await b.send("POST", `/api/data-shares/${share.id}/revoke`, {});
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    const m = await until(id, (x) => byKey(x, "hold")?.state === "BLOCKED");
    assert.match(byKey(m, "hold").reason ?? "", /no longer its to read/);
    assert.equal(byKey(m, "hold").lastRun?.state, "failed");
    const audit = await h.sql("SELECT data->>'cause' AS cause FROM audit_events WHERE account_id = $1 AND event_type = 'office.access.revoked'", [accountId]);
    assert.ok(audit.some((a) => /no longer its to read \(a share revoked\)/.test(String(a.cause))), JSON.stringify(audit));
    // Revoking it again changes nothing.
    assert.equal((await b.send("POST", `/api/data-shares/${share.id}/revoke`, {})).status, 200);
    assert.equal(((await b.get(`/api/missions/${id}/data-shares`)).body as DataShareView[]).find((s) => s.id === share.id)?.revokedBy !== null, true);
  });

  test("an employee moved to another department while its attempt runs: the attempt is stopped (its room is not its department's now)", async () => {
    const made = await give(ids.Tom as string, "[slow] a long read", { sourceRevisionIds: [] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await until(id, (x) => byKey(x, null)?.state === "RUNNING");
    const tom = (await b.get(`/api/employees/${ids.Tom}`)).body as EmployeeDetail;
    const moved = await b.send("POST", `/api/employees/${ids.Tom}/department`, { departmentId: dept.Finance }, ifMatch(tom.version));
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const m = await until(id, (x) => byKey(x, null)?.state === "BLOCKED");
    assert.match(byKey(m, null).reason ?? "", /no longer its to read/);
    const audit = await h.sql("SELECT data->>'cause' AS cause FROM audit_events WHERE account_id = $1 AND event_type = 'office.access.revoked'", [accountId]);
    assert.ok(audit.some((a) => /moved to another department/.test(String(a.cause))), JSON.stringify(audit));
  });
});
