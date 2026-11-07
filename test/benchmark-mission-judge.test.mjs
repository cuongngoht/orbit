// THE MISSION JUDGE (0.5.0, backlog B4, ADR 0055), row by row, over read-backs written by hand: what a goal taken through
// Orbit Satellite must show beside the code -- the change delivered by the mission's own engineering task, every
// criterion settled by an independent owner's record the inspection read back from that owner, every run carried inside
// its least-privilege profile -- and how a round's legs are folded from those rows. No process, no store: the rows read
// data. What the real Satellite, hooks and inspection write is held in test/benchmark-mission-cases.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { failedLegs, legsOf } from "../benchmark/lib/core/legs.mjs";
import { missionTask } from "../benchmark/images/runner/inspect.mjs";
import { missionRecords, privilegeFindings, settledFindings, theMission } from "../benchmark/lib/mission/judge.mjs";

const TASK = "tsk-0000000000e1";

const run = (o = {}) => ({ id: "arn-1", unit: "wu-1", profile: "READ_ONLY", agent: "orbit:satellite-reader", dispatch: "native", lifecycle: "ended", outcome: "succeeded", provider: "host-agent", providerRef: "host:claude", attribution: "HOST_OBSERVED", hostAgent: "claude:reader", ...o });

const ENGINEER = run({ id: "arn-2", unit: "wu-2", profile: "IMPLEMENT", agent: "orbit:satellite-engineer", provider: "engineering", providerRef: `task:${TASK}`, hostAgent: "claude:engineer" });

const MISSION = { id: "msn-0123456789ab", lifecycle: "COMPLETED", verdict: "VERIFIED", criteria: ["acc-1"], units: [{ id: "wu-1", kind: "explore" }, { id: "wu-2", kind: "implement" }], runs: [run(), ENGINEER], evidence: [{ agentRun: "arn-1", owner: "report", ref: "report:arn-1", independent: false, verified: false, acceptance: [] }, { agentRun: "arn-2", owner: "task", ref: `task:${TASK}`, independent: true, verified: true, acceptance: ["acc-1"] }, { agentRun: "arn-2", owner: "check", ref: `check:${TASK}:chk-7`, independent: true, verified: true, acceptance: ["acc-1"] }] };

const TRAIL = [{ type: "agent.launched", id: "orbit:satellite-reader", launched: "claude:reader" }, { type: "tool.used", agent: "claude:reader", tool: "Read", kind: "read" }, { type: "tool.used", agent: "claude:reader", tool: "Grep", kind: "search" }, { type: "agent.launched", id: "orbit:satellite-engineer", launched: "claude:engineer" }, { type: "command.ran", agent: "claude:engineer" }, { type: "tool.used", agent: "claude:engineer", tool: "Edit", kind: "edit" }];

const OWNERS = { [TASK]: { lifecycle: "COMPLETED", verification: [{ state: "satisfied", evidence: "check:chk-7" }] } };

const readBack = (o = {}) => ({ engineering: { id: TASK, lifecycle: "COMPLETED" }, found: "mission", missions: [MISSION], trail: TRAIL, owners: OWNERS, ...o });

const failing = (rb) => missionRecords({}, rb).filter((r) => !r.ok).map((r) => r.id);

const withMission = (over) => readBack({ missions: [{ ...MISSION, ...over }] });

test("a mission that delivered its change through its own engineering task, settled its criterion on that task's own record and kept every run inside its profile holds every row, each naming its leg", () => {
  const rows = missionRecords({}, readBack());
  assert.deepEqual(rows.map((r) => [r.id, r.leg, r.ok]), [["mission-delivered", "code", true], ["criteria-settled", "criteria", true], ["least-privilege", "privilege", true]]);
  assert.ok(rows.every((r) => r.says && r.why.length === 0));
});

test("the change is the mission's own only when the mission's implement run started the task judged, found by the mission's word, and the task completed", () => {
  assert.deepEqual(failing(readBack({ found: "only-task" })), ["mission-delivered"], "a task the store held is not one the mission named");
  assert.deepEqual(failing(readBack({ engineering: { id: TASK, lifecycle: "FAILED" } })), ["mission-delivered"]);
  assert.deepEqual(failing(readBack({ engineering: { id: "tsk-0000000000f9", lifecycle: "COMPLETED" } })), ["mission-delivered"], "a task no run of the mission started");
  assert.equal(theMission(readBack({ missions: [{ ...MISSION, id: "msn-00000000000b", runs: [run()] }, MISSION] })).id, MISSION.id, "the mission judged is the one whose implement run started the task, wherever it sits");
  assert.equal(theMission({ missions: [{ id: "msn-00000000000c", runs: [] }, MISSION], engineering: null }).id, "msn-00000000000c", "else the newest");
});

test("a criterion is settled only by an independent owner's record read back from that owner: a mission's own word, a report, a file or an investigation settles nothing", () => {
  assert.match(settledFindings({ ...MISSION, lifecycle: "REPORTED", verdict: "NOT_VERIFIED" }, OWNERS)[0], /REPORTED, its verdict NOT_VERIFIED/);
  assert.match(settledFindings({ ...MISSION, criteria: [] }, OWNERS)[0], /recorded no acceptance criterion/);
  assert.deepEqual(failing(withMission({ evidence: MISSION.evidence.map((e) => ({ ...e, independent: e.owner === "task" ? false : e.independent })).filter((e) => e.owner !== "check") })), ["criteria-settled"], "a task row Satellite did not count as independent");
  assert.deepEqual(failing(withMission({ evidence: [{ agentRun: "arn-2", owner: "report", ref: "report:arn-2", independent: false, verified: false, acceptance: ["acc-1"] }, { agentRun: "arn-2", owner: "file", ref: "file:src/orders.mjs", independent: false, verified: false, acceptance: ["acc-1"] }] })), ["criteria-settled"], "an agent's report and the file it cites are evidence of themselves");
  assert.deepEqual(failing(withMission({ evidence: [{ agentRun: "arn-2", owner: "investigation", ref: "investigation:inv-000000000001", independent: true, verified: true, acceptance: ["acc-1"] }] })), ["criteria-settled"], "an investigation is never read back here");
  assert.deepEqual(failing(withMission({ criteria: ["acc-1", "acc-2"] })), ["criteria-settled"], "every criterion, not one of them");
  assert.deepEqual(failing(withMission({ runs: [run(), { ...ENGINEER, outcome: "insufficient" }] })), ["criteria-settled"], "evidence from a run that did not succeed");
});

test("the owner's own record is read back, whatever Satellite's row says: a task that is not completed on its own satisfied verification, or a check whose row is not satisfied, settles nothing", () => {
  const taskOnly = { ...MISSION, evidence: MISSION.evidence.filter((e) => e.owner !== "check") };
  const checkOnly = { ...MISSION, evidence: MISSION.evidence.filter((e) => e.owner !== "task") };
  assert.deepEqual(settledFindings(taskOnly, OWNERS), []);
  assert.match(settledFindings(taskOnly, { [TASK]: { lifecycle: "FAILED", verification: [{ state: "satisfied", evidence: "check:chk-7" }] } })[0], /acc-1: no independent owner's record/);
  assert.match(settledFindings(taskOnly, { [TASK]: { lifecycle: "COMPLETED", verification: [{ state: "satisfied", evidence: "check:chk-7" }, { state: "violated", evidence: "check:chk-8" }] } })[0], /acc-1/, "a violated row beside a satisfied one");
  assert.match(settledFindings(taskOnly, {})[0], /acc-1/, "a task the inspection never read back");
  assert.deepEqual(settledFindings(checkOnly, OWNERS), []);
  assert.match(settledFindings(checkOnly, { [TASK]: { lifecycle: "COMPLETED", verification: [{ state: "violated", evidence: "check:chk-7" }] } })[0], /acc-1/);
});

test("least privilege: a profile wider than the unit's kind needs, a run that ended violated, a run no hook saw carried, or carried by another agent type, each fails the row and says which run", () => {
  assert.match(privilegeFindings({ ...MISSION, runs: [run({ profile: "IMPLEMENT", agent: "orbit:satellite-engineer" })] }, [{ type: "agent.launched", id: "orbit:satellite-engineer", launched: "claude:reader" }])[0], /arn-1 ran as IMPLEMENT, wider than a explore unit's least privilege \(READ_ONLY\)/);
  assert.match(privilegeFindings({ ...MISSION, runs: [run({ outcome: "violated" })] }, TRAIL)[0], /arn-1 ended violated/);
  assert.match(privilegeFindings({ ...MISSION, runs: [run({ attribution: "UNATTRIBUTED", hostAgent: null })] }, TRAIL)[0], /arn-1 is UNATTRIBUTED/, "a run the session carried itself");
  assert.match(privilegeFindings({ ...MISSION, runs: [run({ attribution: "REPORTED" })] }, TRAIL)[0], /arn-1 is REPORTED/, "the dispatcher's word alone");
  assert.match(privilegeFindings({ ...MISSION, runs: [run({ attribution: "CONFLICTING", hostAgent: null })] }, TRAIL)[0], /arn-1 is CONFLICTING/);
  assert.match(privilegeFindings({ ...MISSION, runs: [run()] }, [{ type: "agent.launched", id: "general-purpose", launched: "claude:reader" }])[0], /launched as general-purpose, and its profile names orbit:satellite-reader/);
  assert.match(privilegeFindings({ ...MISSION, runs: [] }, TRAIL)[0], /dispatched no work unit/);
  assert.match(privilegeFindings(null, TRAIL)[0], /no mission/);
});

test("least privilege reads what each run's agent did, and the agents it launched: no edit or command an agent's tools do not carry, whatever kind of call is otherwise harmless", () => {
  const with_ = (...more) => privilegeFindings(MISSION, [...TRAIL, ...more]);
  assert.deepEqual(with_({ type: "tool.used", agent: "claude:reader", tool: "TodoWrite", kind: "other" }), [], "a call of no guarded kind");
  assert.match(with_({ type: "tool.used", agent: "claude:reader", tool: "Edit", kind: "edit" })[0], /arn-1's agent made edit call\(s\) its orbit:satellite-reader tools do not carry/);
  assert.match(with_({ type: "command.ran", agent: "claude:reader" })[0], /made command call/);
  assert.match(with_({ type: "agent.launched", agent: "claude:reader", id: "general-purpose", launched: "claude:nested" }, { type: "tool.used", agent: "claude:nested", tool: "Write", kind: "edit" })[0], /arn-1's agent made edit/, "an agent the reader launched is the reader's");
  assert.deepEqual(with_({ type: "tool.used", agent: "claude:somebody", tool: "Edit", kind: "edit" }), [], "a call no run's agent made is no run's");
  const verifier = { ...MISSION, units: [{ id: "wu-1", kind: "verify" }], runs: [run({ profile: "VERIFY", agent: "orbit:satellite-verifier" })] };
  const launched = { type: "agent.launched", id: "orbit:satellite-verifier", launched: "claude:reader" };
  assert.deepEqual(privilegeFindings(verifier, [launched, { type: "command.ran", agent: "claude:reader" }]), [], "a verifier runs commands");
  assert.match(privilegeFindings(verifier, [launched, { type: "tool.used", agent: "claude:reader", tool: "Edit", kind: "edit" }])[0], /edit call/, "and edits nothing");
});

test("a run nobody carried is held to its profile and nothing else: dispatched and never launched, or closed by reconcile as interrupted", () => {
  assert.deepEqual(privilegeFindings({ ...MISSION, runs: [run({ lifecycle: "dispatched", outcome: null, attribution: "UNATTRIBUTED", hostAgent: null })] }, []), []);
  assert.deepEqual(privilegeFindings({ ...MISSION, runs: [run({ outcome: "interrupted", attribution: "UNATTRIBUTED", hostAgent: null })] }, []), []);
});

test("a mission round's legs: the code leg is the verifier's verdict with the code rows, the criteria and privilege legs their rows; failed legs come in the kind's own order", () => {
  const c = { kind: "mission" };
  const round = (records, v = { complete: true, failures: [] }) => ({ v, cand: { scope: [] }, extraTasks: 0, records });
  assert.deepEqual(legsOf(c, round(missionRecords(c, readBack()))), { code: true, criteria: true, privilege: true });
  assert.deepEqual(failedLegs(legsOf(c, round(missionRecords(c, readBack()), { complete: true, failures: ["hidden:valid-1"] }))), ["code"], "a mission VERIFIED on its owners' records whose change the verifier rejects");
  assert.deepEqual(failedLegs(legsOf(c, round(missionRecords(c, withMission({ lifecycle: "REPORTED", verdict: "NOT_VERIFIED" }))))), ["criteria"]);
  assert.deepEqual(failedLegs(legsOf(c, round(missionRecords(c, readBack({ trail: [...TRAIL, { type: "command.ran", agent: "claude:reader" }] }))))), ["privilege"]);
  assert.equal(legsOf({ kind: "engineering" }, round([])), null, "a kind with no legs is judged as a whole");
});

test("the round's task, as the inspection finds it after a mission round: the newest mission's last implement run's task -- an implement unit's every attempt starts its own", () => {
  const missions = (...ms) => ({ json: { missions: ms } });
  const engineering = (task) => ({ provider: "engineering", providerRef: `task:${task}` });
  assert.equal(missionTask(missions({ runs: [run(), engineering("tsk-00000000000a"), engineering("tsk-00000000000b")] })), "tsk-00000000000b");
  assert.equal(missionTask(missions({ runs: [run()] }, { runs: [engineering("tsk-00000000000c")] })), "tsk-00000000000c", "a newest mission with no implement run names none");
  assert.equal(missionTask(missions({ runs: [run({ providerRef: "task:not-a-task" })] })), null);
  assert.equal(missionTask(null), null);
});
