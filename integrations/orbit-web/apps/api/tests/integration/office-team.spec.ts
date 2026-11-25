// A TEAM, end to end through HTTP on PostgreSQL: a manager gives two parts of its assignment to colleagues (the second
// waiting for the first), they share the mission's team room, the manager reviews each part as it is handed in, the part
// that waited starts only once the first is accepted, and the manager integrates and hands in to the person who gave
// the work. A plan that is not a graph is refused whole; an attempt of another mission has no team room; the room's
// history names who changed what.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type AssignmentView, type EmployeeDetail, type Inbox, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { AccessWatch } from "../../src/contexts/execution/application/access-watch.js";
import { AttemptInputs } from "../../src/contexts/execution/application/attempt-inputs.js";
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
  let revFailCount = 0;
  let revWatchRound = 0;
  let raceHook: (() => Promise<void>) | null = null;
  let raceRelease: (() => void) | null = null;
  let raceWait: Promise<void> = Promise.resolve();
  let raceArmed = false;

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
  // Authority to give work is a person's grant (or an appointment): never the profile's "team lead" switch alone.
  const grant = async (lead: string, to: string) => {
    const r = await b.send("POST", `/api/employees/${ids[lead]}/delegation-grants`, { target: { kind: "employee", employeeId: ids[to] }, note: "leads the team in this test" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  };
  const mission = async (id: string): Promise<MissionDetail> => (await b.get(`/api/missions/${id}`)).body as MissionDetail;
  const byKey = (m: MissionDetail, unit: string | null): AssignmentView => m.assignments.find((a) => (unit === null ? a.parentId === null : a.unitKey === unit)) as AssignmentView;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    sandbox.readInput = (p) => h.app.get(AttemptInputs).read(p);
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
        // A lead that accepts its part and ends without handing in the integrated result.
        if (p.includes("[noint]") && !p.includes("The parts you gave your team")) {
          note("noint", (await t.call("delegate", { parts: [{ key: "piece", employee: "Oanh", title: "Piece", goal: "[part:piece] A piece.", deliverables: ["piece.md"] }] })).text);
          return;
        }
        if (p.includes("[noint]")) {
          const line = p.split("\n").find((l) => l.startsWith("- piece: ") && l.includes("awaiting acceptance"));
          if (line !== undefined) note("noint", (await t.call("review_unit", { part: "piece", decision: "accept" })).text);
          return;
        }
        if (p.includes("[part:piece]")) {
          await t.call("write_file", { path: "/output/piece.md", content: "piece\n" });
          await t.call("submit_handoff", { summary: "The piece." });
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
        // A lead whose first REVIEWING attempt fails technically (CLI exit 1) before calling review_unit.
        if (p.includes("[revfail]") && !p.includes("The parts you gave your team")) {
          await t.call("delegate", { parts: [{ key: "parta", employee: "Oanh", title: "Part A", goal: "[part:revfail-a] Do Part A.", deliverables: ["a.md"] }] });
          return;
        }
        if (p.includes("[revfail]")) {
          revFailCount += 1;
          note("revfail:prompt", p);
          if (revFailCount === 1) throw new Error("rate_limit_exceeded");
          await t.call("review_unit", { part: "parta", decision: "accept" });
          await t.call("write_file", { path: "/output/report.md", content: "# Retried review\n" });
          await t.call("submit_handoff", { summary: "Reviewed and integrated after retry." });
          return;
        }
        if (p.includes("[part:revfail-a]")) {
          await t.call("write_file", { path: "/output/a.md", content: "Part A content\n" });
          await t.call("submit_handoff", { summary: "Part A ready." });
          return;
        }
        // Multi-part review with colliding/spaced deliverables and an AccessWatch heartbeat right after `revise`.
        if (p.includes("[revwatch]") && !p.includes("The parts you gave your team")) {
          await t.call("delegate", {
            parts: [
              { key: "alpha", employee: "Nam", title: "Alpha", goal: "[part:rw-alpha] Write alpha.", deliverables: ["Policy v1.md", "Policy-v1.md"] },
              { key: "beta", employee: "Oanh", title: "Beta", goal: "[part:rw-beta] Write beta.", deliverables: ["beta.md"] },
            ],
          });
          return;
        }
        if (p.includes("[revwatch]")) {
          revWatchRound += 1;
          const listed = await t.call("list_files", { path: "/input" });
          note("revwatch:input", listed.text);
          if (revWatchRound === 1) {
            const r1 = await t.call("review_unit", { part: "alpha", decision: "revise", criteria: "Add compliance table." });
            note("revwatch:r1", r1.text);
            // AccessWatch runs mid-review right after alpha's handoff becomes `revision_requested`: must NOT stop Mai.
            const stopped = await h.app.get(AccessWatch).check(h.accountId as string, null, "heartbeat");
            note("revwatch:stopped", String(stopped));
            const r2 = await t.call("review_unit", { part: "beta", decision: "accept" });
            note("revwatch:r2", JSON.stringify(r2));
            return;
          }
          const r3 = await t.call("review_unit", { part: "alpha", decision: "accept" });
          note("revwatch:r3", r3.text);
          await t.call("write_file", { path: "/output/report.md", content: "# Integrated alpha and beta\n" });
          await t.call("submit_handoff", { summary: "Accepted revised alpha and beta." });
          return;
        }
        if (p.includes("[part:rw-alpha]")) {
          const revised = p.includes("Add compliance table.");
          await t.call("write_file", { path: "/output/Policy v1.md", content: revised ? "Alpha v2\n" : "Alpha v1\n" });
          await t.call("write_file", { path: "/output/Policy-v1.md", content: "Alpha companion\n" });
          await t.call("submit_handoff", { summary: revised ? "Alpha v2 with table." : "Alpha v1." });
          return;
        }
        if (p.includes("[part:rw-beta]")) {
          await t.call("write_file", { path: "/output/beta.md", content: "Beta v1\n" });
          await t.call("submit_handoff", { summary: "Beta v1." });
          return;
        }
        // Race condition: `second` hands in AFTER the lead's prompt was snapshotted (T0) and BEFORE startedAt (T1).
        if (p.includes("[revrace]") && !p.includes("The parts you gave your team")) {
          await t.call("delegate", {
            parts: [
              { key: "first", employee: "Nam", title: "First", goal: "[part:rr-first] First.", deliverables: ["first.md"] },
              { key: "second", employee: "Oanh", title: "Second", goal: "[part:rr-second] Second.", deliverables: ["second.md"] },
              { key: "third", employee: "Nam", title: "Third", goal: "[part:rr-third] Third.", deliverables: ["third.md"], waits_for: ["first"] },
            ],
          });
          return;
        }
        if (p.includes("[revrace]")) {
          const lines = p.split("\n").filter((l) => /^- (first|second|third): /.test(l));
          for (const l of lines.filter((x) => x.includes("awaiting acceptance"))) {
            const unit = (l.match(/^- ([a-z-]+):/) as RegExpMatchArray)[1] as string;
            await t.call("review_unit", { part: unit, decision: "accept" });
          }
          if (lines.some((l) => !l.includes("awaiting acceptance") && !l.includes(", completed"))) return;
          await t.call("write_file", { path: "/output/report.md", content: "# Race done\n" });
          await t.call("submit_handoff", { summary: "All three integrated." });
          return;
        }
        if (p.includes("[part:rr-first]")) {
          await t.call("write_file", { path: "/output/first.md", content: "first\n" });
          await t.call("submit_handoff", { summary: "First." });
          return;
        }
        if (p.includes("[part:rr-second]")) {
          await raceWait;
          await t.call("write_file", { path: "/output/second.md", content: "second\n" });
          await t.call("submit_handoff", { summary: "Second." });
          return;
        }
        if (p.includes("[part:rr-third]")) {
          await t.call("write_file", { path: "/output/third.md", content: "third\n" });
          await t.call("submit_handoff", { summary: "Third." });
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
    await grant("Mai", "Nam");
    await grant("Mai", "Oanh");
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

  test("a lead that accepts every part and ends without handing in is blocked saying so -- never left waiting for nothing", async () => {
    const made = await b.send("POST", "/api/missions", { title: "No integration", goal: "[noint] Do it with a part.", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const m = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "BLOCKED", 30_000);
    assert.equal(byKey(m, "piece").state, "COMPLETED");
    assert.match(byKey(m, null).reason ?? "", /ended without handing in the integrated result/);
    const root = byKey(m, null);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/cancel`, { reason: "done" }, { "if-match": `"${root.version}"` })).status, 200);
  });

  test("an attempt of a mission without a team has no team room", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Solo", goal: "[solo] alone", targetEmployeeId: ids.Nam, whenBusy: "enqueue", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    const id = (made.body as MissionAccepted).missionId;
    const m = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    assert.match(said.solo?.[0] ?? "", /no team room/);
    const root = byKey(m, null);
    const handed = m.handoffs.find((x) => x.assignmentId === root.id);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` })).status, 200);
  });

  test("a failed REVIEWING attempt blocks with the actual failure detail (never 'without deciding') and retries cleanly back into REVIEWING", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Review failure", goal: "[revfail] Review fails once.", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const blocked = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "BLOCKED", 30_000);
    const root = byKey(blocked, null);
    assert.match(root.reason ?? "", /rate_limit_exceeded/);
    assert.doesNotMatch(root.reason ?? "", /without deciding/);
    assert.equal(root.lastRun?.state, "failed");
    assert.equal(root.lastRun?.observed.exit?.code, 1);
    const retried = await b.send("POST", `/api/assignments/${root.id}/retry`, {}, { "if-match": `"${root.version}"` });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    const done = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    assert.equal(byKey(done, "parta").state, "COMPLETED");
    assert.match(said["revfail:prompt"]?.at(-1) ?? "", /this review attempt was retried/);
    const doneRoot = byKey(done, null);
    const handed = done.handoffs.find((x) => x.assignmentId === doneRoot.id);
    assert.equal((await b.send("POST", `/api/assignments/${doneRoot.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${doneRoot.version}"` })).status, 200);
  });

  test("AccessWatch does not stop a live REVIEWING attempt after review_unit(revise), colliding filenames stage cleanly, and review_unit reports remaining parts", async () => {
    const made = await b.send("POST", "/api/missions", { title: "Multi-part review", goal: "[revwatch] Review two parts.", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = (made.body as MissionAccepted).missionId;
    const done = await eventually(() => mission(id), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 30_000);
    assert.equal(said["revwatch:stopped"]?.[0], "0", "AccessWatch must not revoke a lead's own live review after revising a part");
    assert.match(said["revwatch:r1"]?.[0] ?? "", /Still awaiting your review \(1\): beta/);
    const r2 = JSON.parse(said["revwatch:r2"]?.[0] ?? "{}") as { text?: string; isError?: boolean };
    assert.equal(r2.isError, false);
    assert.match(r2.text ?? "", /No other parts await your review now/);
    assert.match(said["revwatch:r3"]?.[0] ?? "", /Every part has ended: integrate/);
    assert.match(said["revwatch:input"]?.[0] ?? "", /unit-alpha-Policy-v1\.md/);
    assert.match(said["revwatch:input"]?.[0] ?? "", /unit-alpha-Policy-v1-2\.md/);
    assert.equal(byKey(done, "alpha").state, "COMPLETED");
    assert.equal(byKey(done, "beta").state, "COMPLETED");
    const root = byKey(done, null);
    const handed = done.handoffs.find((x) => x.assignmentId === root.id);
    assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` })).status, 200);
  });

  test("a part that hands in between dispatch snapshot (T0) and startedAt (T1) wakes the lead again instead of falsely blocking as undecided", async () => {
    const origStart = sandbox.startAttempt.bind(sandbox);
    raceWait = new Promise<void>((resolve) => {
      raceRelease = resolve;
    });
    raceArmed = true;
    let raceMissionId = "";
    sandbox.startAttempt = async (spec) => {
      const handle = await origStart(spec);
      // Fire once when Mai's review attempt (attempt 2, with only `first` staged) is starting: let `second` hand in
      // BEFORE startedAt (T1) is recorded for Mai's review attempt.
      if (raceArmed && spec.employeeId === ids.Mai && spec.dispatchKey.endsWith(":2")) {
        raceArmed = false;
        if (raceHook !== null) await raceHook();
      }
      return handle;
    };
    try {
      const made = await b.send("POST", "/api/missions", { title: "Review race", goal: "[revrace] Race between T0 and T1.", targetEmployeeId: ids.Mai, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, key());
      assert.equal(made.status, 201, JSON.stringify(made.body));
      raceMissionId = (made.body as MissionAccepted).missionId;
      raceHook = async () => {
        raceRelease?.();
        await eventually(() => mission(raceMissionId), (x) => byKey(x, "second")?.state === "AWAITING_ACCEPTANCE", 15_000);
      };
      const done = await eventually(() => mission(raceMissionId), (x) => byKey(x, null)?.state === "AWAITING_ACCEPTANCE", 45_000);
      assert.equal(byKey(done, "first").state, "COMPLETED");
      assert.equal(byKey(done, "second").state, "COMPLETED");
      assert.equal(byKey(done, "third").state, "COMPLETED");
      const root = byKey(done, null);
      const handed = done.handoffs.find((x) => x.assignmentId === root.id);
      assert.equal((await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: handed?.digest }, { "if-match": `"${root.version}"` })).status, 200);
    } finally {
      raceRelease?.();
      sandbox.startAttempt = origStart;
    }
  });
});
