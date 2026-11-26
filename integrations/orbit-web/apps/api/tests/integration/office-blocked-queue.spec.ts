// EXPLAIN BLOCKED ASSIGNMENTS AND SEPARATE REVIEWS FROM CLARIFICATIONS (Issue #5):
// Verifies through the real API and PostgreSQL:
//   1. An employee waiting for information (BLOCKED) is NOT counted under active `working` (0 active attempts -> working === 0,
//      waiting === 1), and `/api/office/roster?status=working` vs `?status=waiting` agree with the summary counts.
//   2. Needs me counts reviews (`acceptance`) and clarification requests (`information`) separately and filters each cleanly.
//   3. With one clarification on Assignment A (holding Ana's slot) and one unrelated review on Assignment B (Bao), a mission
//      queued behind Ana exposes `queuedBehind` pointing to Assignment A and its blocking clarification -- never to the
//      unrelated review -- while cross-account access and `redactQueuedBehind(..., false)` never reveal restricted details.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type EmployeeDetail, type Inbox, type MissionAccepted, type MissionDetail, type MissionList, type ResourceSummary, type Roster, type RuntimeConnection } from "@orbit-web/contracts";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { redactQueuedBehind } from "../../src/contexts/work/application/mission.queries.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };

describe("blocked assignment visibility, active vs waiting counts, and separated Needs me (Issue #5)", () => {
  let h: Harness;
  let b: Browser;
  let ana: EmployeeDetail;
  let bao: EmployeeDetail;
  const sandbox = new FakeSandboxProvider();

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Clarity Co" })).status, 200);
    const connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.runtime === "claude" && c.auth === "connected") as RuntimeConnection;
    const model = connection.catalog.models[0] as { id: string; efforts: string[] };

    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        if (t.prompt.includes("[ask-clarification]")) {
          await t.call("ask_question", { question: "Which currency should the vendor quote table use?" });
          return;
        }
        await t.call("write_file", { path: "/output/report.md", content: "Ready for review.\n" });
        await t.call("submit_handoff", { summary: "Handed in for review." });
      }),
    });

    const hire = async (name: string): Promise<EmployeeDetail> => {
      const r = await b.send("POST", "/api/employees", {
        name,
        profile: { title: "Analyst", duties: "Analyze.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
        resources: DEFAULT_PRESETS[0]?.profile,
        skipProbation: true,
        skipReason: "test",
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return eventually(async () => (await b.get(`/api/employees/${(r.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
    };

    ana = await hire("Ana");
    bao = await hire("Bao");
  });

  after(() => h?.close());

  test("zero active attempts + one waiting-for-info employee: counts agree with filters, Needs me separates reviews from clarifications, and queued mission points to blocking clarification", async () => {
    // 1. Ana takes Mission A and blocks asking the owner for clarification.
    const blockingRes = await b.send(
      "POST",
      "/api/missions",
      { title: "Collect vendor quotes", goal: "[ask-clarification] Prepare vendor quote table.", targetEmployeeId: ana.id, whenBusy: "reject", deliverables: [], acceptanceCriteria: [] },
      { "Idempotency-Key": "k-issue5-blocking-a" },
    );
    assert.equal(blockingRes.status, 201, JSON.stringify(blockingRes.body));
    const blockingId = (blockingRes.body as MissionAccepted).missionId;
    const blockingAssignmentId = (blockingRes.body as MissionAccepted).assignmentId;
    await eventually(async () => (await b.get(`/api/missions/${blockingId}`)).body as MissionDetail, (m) => m.assignment.state === "BLOCKED" && m.assignment.waitingOn === "information", 15_000);
    // Ensure zero active compute attempts remain running.
    await eventually(async () => (await b.get("/api/office/resources")).body as ResourceSummary, (r) => r.running === 0, 10_000);

    // Verify with 0 active attempts and 1 employee waiting for information (Ana) + 1 ready (Bao):
    const rosterSingle = (await b.get("/api/office/roster")).body as Roster;
    assert.equal(rosterSingle.counts.working, 0, "waiting-for-info employee must not increase active working count");
    assert.equal(rosterSingle.counts.waiting, 1, "waiting-for-info employee must appear under waiting count");
    assert.equal(rosterSingle.counts.ready, 1);

    const workingFiltered = (await b.get("/api/office/roster?status=working")).body as Roster;
    assert.equal(workingFiltered.employees.length, 0, "status=working filter must agree with counts.working === 0");
    const waitingFiltered = (await b.get("/api/office/roster?status=waiting")).body as Roster;
    assert.equal(waitingFiltered.employees.length, 1, "status=waiting filter must agree with counts.waiting === 1");
    assert.equal(waitingFiltered.employees[0]?.id, ana.id);
    assert.equal(waitingFiltered.employees[0]?.workLabel, "waiting_info");

    // 2. Bao takes Mission B and hands in an unrelated review (AWAITING_ACCEPTANCE).
    const reviewRes = await b.send(
      "POST",
      "/api/missions",
      { title: "Unrelated quarterly summary", goal: "[review-b] Write summary.", targetEmployeeId: bao.id, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] },
      { "Idempotency-Key": "k-issue5-review-b" },
    );
    assert.equal(reviewRes.status, 201, JSON.stringify(reviewRes.body));
    const reviewMissionId = (reviewRes.body as MissionAccepted).missionId;
    await eventually(async () => (await b.get(`/api/missions/${reviewMissionId}`)).body as MissionDetail, (m) => m.assignment.state === "AWAITING_ACCEPTANCE", 15_000);
    await eventually(async () => (await b.get("/api/office/resources")).body as ResourceSummary, (r) => r.running === 0, 10_000);

    // 3. Queue Mission C behind Ana (blocked on Mission A's clarification).
    const queuedRes = await b.send(
      "POST",
      "/api/missions",
      { title: "Follow-up audit", goal: "Audit finalized quotes.", targetEmployeeId: ana.id, whenBusy: "enqueue", deliverables: [], acceptanceCriteria: [] },
      { "Idempotency-Key": "k-issue5-queued-c" },
    );
    assert.equal(queuedRes.status, 202, JSON.stringify(queuedRes.body));
    const queuedMissionId = (queuedRes.body as MissionAccepted).missionId;

    // 4. Roster now has 0 working, 2 waiting (1 waiting_info, 1 waiting_review), and split inbox counts (1 review, 1 clarification).
    const rosterBoth = (await b.get("/api/office/roster")).body as Roster;
    assert.equal(rosterBoth.counts.working, 0);
    assert.equal(rosterBoth.counts.waiting, 2);
    assert.equal(rosterBoth.counts.inbox, 2);
    assert.equal(rosterBoth.counts.reviews, 1);
    assert.equal(rosterBoth.counts.clarifications, 1);
    assert.equal(((await b.get("/api/office/roster?status=waiting")).body as Roster).employees.length, 2);
    assert.equal(((await b.get("/api/office/roster?status=working")).body as Roster).employees.length, 0);

    // 5. Needs me separates reviews and clarification requests.
    const inboxAll = (await b.get("/api/inbox?state=open")).body as Inbox;
    assert.equal(inboxAll.open, 2);
    assert.deepEqual(inboxAll.counts, { total: 2, reviews: 1, clarifications: 1, other: 0 });

    const inboxReviews = (await b.get("/api/inbox?state=open&category=reviews")).body as Inbox;
    assert.equal(inboxReviews.items.length, 1);
    assert.equal(inboxReviews.items[0]?.kind, "acceptance");
    assert.equal(inboxReviews.items[0]?.missionId, reviewMissionId);

    const inboxClarifications = (await b.get("/api/inbox?state=open&category=clarifications")).body as Inbox;
    assert.equal(inboxClarifications.items.length, 1);
    assert.equal(inboxClarifications.items[0]?.kind, "information");
    assert.equal(inboxClarifications.items[0]?.missionId, blockingId);

    // 6. Queued mission (list & detail) points specifically to Ana's blocking assignment & clarification, NOT Bao's unrelated review.
    const queuedDetail = (await b.get(`/api/missions/${queuedMissionId}`)).body as MissionDetail;
    assert.equal(queuedDetail.assignment.state, "QUEUED");
    assert.ok(queuedDetail.queuedBehind !== null && queuedDetail.queuedBehind !== undefined);
    assert.equal(queuedDetail.queuedBehind.accessible, true);
    assert.equal(queuedDetail.queuedBehind.assignmentId, blockingAssignmentId);
    assert.equal(queuedDetail.queuedBehind.missionId, blockingId);
    assert.equal(queuedDetail.queuedBehind.title, "Collect vendor quotes");
    assert.equal(queuedDetail.queuedBehind.state, "BLOCKED");
    assert.equal(queuedDetail.queuedBehind.waitingOn, "information");
    assert.ok(queuedDetail.queuedBehind.ownerAction !== null);
    assert.equal(queuedDetail.queuedBehind.ownerAction.kind, "information");
    assert.equal(queuedDetail.queuedBehind.ownerAction.missionId, blockingId);
    assert.notEqual(queuedDetail.queuedBehind.ownerAction.missionId, reviewMissionId);

    const missionList = (await b.get("/api/missions?state=open")).body as MissionList;
    const queuedInList = missionList.missions.find((m) => m.id === queuedMissionId);
    assert.equal(queuedInList?.queuedBehind?.missionId, blockingId);
    assert.equal(queuedInList?.queuedBehind?.ownerAction?.kind, "information");

    // 7. Restricted access redaction never leaks assignment title, id, state, or owner action.
    const redacted = redactQueuedBehind(queuedDetail.queuedBehind, false);
    assert.deepEqual(redacted, {
      accessible: false,
      assignmentId: null,
      missionId: null,
      title: null,
      state: null,
      waitingOn: null,
      ownerAction: null,
    });

    // 8. Another account cannot read the mission or inbox items.
    const other = await h.as("other");
    assert.equal((await other.get(`/api/missions/${queuedMissionId}`)).status, 404);
    assert.equal(((await other.get("/api/inbox?state=open")).body as Inbox).open, 0);
  });
});
