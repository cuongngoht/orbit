// A TEAM, end to end through HTTP on PostgreSQL: a manager gives two parts of its assignment to colleagues (the second
// waiting for the first), they share the mission's team room, the manager reviews each part as it is handed in, the part
// that waited starts only once the first is accepted, and the manager integrates and hands in to the person who gave
// the work. A plan that is not a graph is refused whole; an attempt of another mission has no team room; the room's
// history names who changed what.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type EmployeeDetail, type Inbox, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { ResearchInputs } from "../../src/contexts/execution/application/research-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
let n = 0;
const key = () => ({ "idempotency-key": `team-key-${Date.now()}-${(n += 1)}` });

describe("a team: a manager delegates, reviews and integrates", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const said: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let draftReviews = 0;

  const hire = async (name: string, canDelegate = false): Promise<EmployeeDetail> => {
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
    const d = await eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (x) => x.sandbox.state === "READY");
    ids[name] = d.id;
    return d;
  };
  const note = (who: string, what: string) => (said[who] ??= []).push(what);
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const byKey = (m: MissionDetail, unit: string | null): AssignmentView => m.assignments.find((a) => (unit === null ? a.parentId === null : a.unitKey === unit)) as AssignmentView;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(ResearchInputs).read(p);
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Team office" })).status, 200);
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const p = t.prompt;
        // A lead that asks its part for a revision once, then accepts it and integrates.
        if (p.includes("[team2]") && !p.includes("The parts you gave your team")) {
          const r = await t.call("delegate", { parts: [{ key: "draft", employee: "Oanh", title: "Draft", goal: "[part:draft] Write the draft.", deliverables: ["draft.md"], criteria: ["Has the totals"] }] });
          note("Mai2", r.text);
          return;
        }
        if (p.includes("[team2]")) {
          draftReviews += 1;
          note("Mai2", p);
          if (draftReviews === 1) {
            const r = await t.call("review_unit", { part: "draft", decision: "revise", criteria: "Add the totals." });
            note("Mai2", r.text);
            return;
          }
          const r = await t.call("review_unit", { part: "draft", decision: "accept" });
          note("Mai2", r.text);
          const draft = await t.call("read_file", { path: "/input/unit-draft-draft.md" });
          await t.call("write_file", { path: "/output/report.md", content: `# Report\n${draft.text}` });
          await t.call("submit_handoff", { summary: "Integrated the revised draft." });
          return;
        }
        if (p.includes("[part:draft]")) {
          note("Oanh2", p);
          const revised = p.includes("Add the totals.");
          await t.call("write_file", { path: "/output/draft.md", content: revised ? "Draft v2 with totals: 2,000,000 VND.\n" : "Draft v1.\n" });
          await t.call("submit_handoff", { summary: revised ? "Added the totals." : "First draft." });
          return;
        }
        if (p.includes("[badplan]")) {
          const r = await t.call("delegate", { parts: [{ key: "a", employee: "Nam", title: "A", goal: "a", waits_for: ["b"] }, { key: "b", employee: "Oanh", title: "B", goal: "b", waits_for: ["a"] }] });
          note("badplan", r.text);
          return;
        }
        if (p.includes("[solo]")) {
          const r = await t.call("list_files", { path: "/team" });
          note("solo", r.text);
          await t.call("write_file", { path: "/output/report.md", content: "solo\n" });
          await t.call("submit_handoff", { summary: "Alone." });
          return;
        }
        if (p.includes("[part:research]")) {
          const brief = await t.call("read_file", { path: "/team/brief.md" });
          note("Nam", brief.text);
          await t.call("write_file", { path: "/team/data.csv", content: "invoice,amount\nA,1200000\nB,800000\n" });
          await t.call("write_file", { path: "/output/research.md", content: "Two invoices in Q3.\n" });
          await t.call("submit_handoff", { summary: "Found two Q3 invoices; the data is in /team/data.csv." });
          return;
        }
        if (p.includes("[part:summary]")) {
          const data = await t.call("read_file", { path: "/team/data.csv" });
          note("Oanh", data.isError ? "no data" : data.text);
          await t.call("write_file", { path: "/output/summary.md", content: "Total: 2,000,000 VND.\n" });
          await t.call("submit_handoff", { summary: "Summed the data: 2,000,000 VND." });
          return;
        }
        if (p.includes("[team]") && !p.includes("The parts you gave your team")) {
          await t.call("write_file", { path: "/team/brief.md", content: "Q3 only; amounts in VND.\n" });
          const r = await t.call("delegate", {
            parts: [
              { key: "research", employee: "Nam", title: "Research", goal: "[part:research] Collect the invoices of Q3.", deliverables: ["research.md"], criteria: ["Every Q3 invoice"] },
              { key: "summary", employee: "Oanh", title: "Summary", goal: "[part:summary] Total the invoices.", deliverables: ["summary.md"], criteria: ["The total is right"], waits_for: ["research"] },
            ],
          });
          note("Mai", r.text);
          return;
        }
        if (p.includes("The parts you gave your team")) {
          note("Mai", p);
          const lines = p.split("\n").filter((l) => /^- (research|summary): /.test(l));
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) {
            const unit = (l.match(/^- ([a-z-]+):/) as RegExpMatchArray)[1] as string;
            const r = await t.call("review_unit", { part: unit, decision: "accept" });
            note("Mai", r.text);
          }
          const pending = lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed"));
          if (pending) return;
          const summary = await t.call("read_file", { path: "/input/unit-summary-summary.md" });
          await t.call("write_file", { path: "/output/report.md", content: `# Q3\n${summary.text}` });
          await t.call("submit_handoff", { summary: "Integrated the team's parts." });
        }
      }),
    });
  });

  after(async () => {
    await h?.close();
  });

  test("the plan's parts are made, the waiting part starts once the first is accepted, and the manager hands in to the owner", async () => {
    await hire("Mai", true);
    await hire("Nam");
    await hire("Oanh");
    const made = await b.send("POST", "/api/missions", { title: "Q3 team report", goal: "[team] The Q3 report, with your team.", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: ["Has the total"] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const m = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    assert.equal(m.assignments.length, 3);
    assert.equal(byKey(m, "research").state, "COMPLETED");
    assert.equal(byKey(m, "research").employeeId, ids.Nam);
    assert.equal(byKey(m, "summary").state, "COMPLETED");
    assert.equal(byKey(m, "summary").parentId, byKey(m, null).id);
    assert.deepEqual(byKey(m, "summary").brief.dependsOn, ["research"], "a part says what it waits for");
    assert.deepEqual(byKey(m, "research").brief.dependsOn, []);
    assert.ok(m.planRevision >= 2, "the plan was revised when the parts were given");
    // The team room was shared: the research read the manager's brief, the summary read the research's data.
    assert.equal(said.Nam?.[0], "Q3 only; amounts in VND.\n");
    assert.match(said.Oanh?.[0] ?? "", /A,1200000/);
    // The parts were reviewed by their manager, not put in the owner's Needs me.
    const inbox = (await b.get("/api/inbox?state=open")).body as Inbox;
    const forMission = inbox.items.filter((i) => i.missionId === id);
    assert.deepEqual(forMission.map((i) => `${i.kind}:${i.assignmentId}`), [`acceptance:${byKey(m, null).id}`]);
    // The integrated result.
    const handed = m.handoffs.find((x) => x.assignmentId === byKey(m, null).id);
    assert.deepEqual(handed?.artifacts.map((a) => a.name), ["report.md"]);
    // The room's history: who changed what.
    const history = (await b.get(`/api/missions/${id}/team-room`)).body as { path: string; employeeName: string | null }[];
    assert.ok(history.some((c) => c.path === "brief.md" && c.employeeName === "Mai"), JSON.stringify(history));
    assert.ok(history.some((c) => c.path === "data.csv" && c.employeeName === "Nam"), JSON.stringify(history));
    // The owner accepts the integrated result: the manager is free again.
    const root = byKey(m, null);
    const ok = await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test("a plan whose parts wait for each other in a circle is refused whole, and nothing is made", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Bad plan", goal: "[badplan] something", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    await eventually(() => said.badplan ?? [], (x) => x.length > 0);
    assert.match(said.badplan?.[0] ?? "", /circle/);
    // The manager's run ended having given nothing and handed nothing in: blocked, with why.
    const m = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "BLOCKED");
    assert.equal(m.assignments.length, 1, "no part was made");
    const cancelled = await b.send("POST", `/api/assignments/${byKey(m, null).id}/cancel`, { reason: "done" }, { "if-match": `"${byKey(m, null).version}"` });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  });

  test("a lead asks its part for a revision: the part's first hand-in never completes it, its employee works again, and the lead integrates the revised one", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Draft with a revision", goal: "[team2] A report from a draft.", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const m = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    const part = byKey(m, "draft");
    assert.equal(part.employeeId, ids.Oanh);
    assert.equal(part.state, "COMPLETED");
    assert.equal(part.handoffRevision, 2, "the part handed in twice");
    assert.equal(part.reworkCount, 1);
    const partHandoffs = m.handoffs.filter((h) => h.assignmentId === part.id).sort((x, y) => x.revision - y.revision);
    assert.deepEqual(partHandoffs.map((h) => `${h.revision}:${h.status}`), ["1:revision_requested", "2:accepted"], "the first hand-in was sent back, never accepted");
    // The part's second attempt was told what to change; the lead reviewed twice and integrated the revised draft.
    assert.ok((said.Oanh2 ?? []).some((p) => p.includes("The reviewer asked for these changes") && p.includes("Add the totals.")));
    assert.equal(draftReviews, 2);
    const handed = m.handoffs.find((h) => h.assignmentId === byKey(m, null).id);
    assert.deepEqual(handed?.artifacts.map((a) => a.name), ["report.md"]);
    const root = byKey(m, null);
    const ok = await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test("an attempt of a mission without a team has no team room", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Solo", goal: "[solo] alone", targetEmployeeId: ids.Nam, whenBusy: "enqueue", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    const id = (made.body as MissionAccepted).missionId;
    await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    assert.match(said.solo?.[0] ?? "", /no team room/);
  });
});
