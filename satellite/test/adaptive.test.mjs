// ADAPTIVE PLANNING: an initially unknown bug domain is investigated first; what the investigation hands off PROPOSES
// a different plan; the engine records the trigger; the host revises the graph on that evidence -- a new revision that
// names what it replaced, why, and which handoff it rests on -- within Orbit's execution.maxReplans; nothing retries
// without limit, and one unit failing three times the same way stops the mission as NO_PROGRESS.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf } from "../src/mission/context.mjs";
import { finish } from "../src/mission/finish.mjs";
import { start } from "../src/mission/loop.mjs";
import { agentReport } from "../src/mission/report.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { act, explorerRole, intentFor } from "./fakes/flow.mjs";
import { reportOf, satelliteWorld } from "./fakes/world.mjs";

const GOAL = "Payment succeeds, but the customer never receives the confirmation email.";

const INTENT = (g) => intentFor(g, { hypotheses: [{ statement: "the notification service fails to send" }, { statement: "the payment event is never published" }], unknowns: [{ statement: "which component sends the email", blocks: ["implement"] }] });

async function explored(w, extra = {}) {
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: INTENT(goalDigest) });
  await act(w, mission, { kind: "plan", units: [{ key: "explore", kind: "explore", objective: "find where the confirmation email should come from", acceptanceCriteriaRefs: ["acc-1"], ...extra }] });
  await act(w, mission, { kind: "resolve-role", ...explorerRole() });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  return mission;
}

const PROPOSES = { units: [{ key: "consumer", kind: "diagnose", objective: "read why the mailer consumer drops order-paid" }], because: "the event is published; the consumer is where it stops" };

test("an investigation's proposal triggers a revision the host makes on that evidence, within the replan budget", async () => {
  const w = satelliteWorld({ files: { "src/events.mjs": "e1" } });
  const mission = await explored(w);
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { findings: [{ say: "order-paid is published by the payment service", refs: ["file:src/events.mjs"] }], evidenceRefs: ["file:src/events.mjs"], refutes: ["hyp-2"], proposes: PROPOSES }));
  assert.deepEqual([r.outcome, r.trigger], ["succeeded", "CHANGE_PROPOSED"]);
  const revised = await act(w, mission, { kind: "replan", cause: "CHANGE_PROPOSED", proposal: "hof-1", units: [{ ...PROPOSES.units[0], dependsOn: ["explore"], acceptanceCriteriaRefs: ["acc-1"] }], because: "the explore run showed the consumer is where the event stops" });
  assert.equal(revised.outcome, "revised");
  const rev = worldOf(w, mission).m.plans.at(-1);
  assert.deepEqual([rev.rev, rev.cause, rev.evidenceRefs, rev.replaces, rev.affectedUnits], [2, "CHANGE_PROPOSED", ["hof-1"], worldOf(w, mission).m.plans[0].digest, ["wu-2"]]);
  assert.deepEqual(contextOf(w, mission).units.map((u) => [u.id, u.state]), [["wu-1", "done"], ["wu-2", "ready"]]);
});

test("an amendment adds what was learned and settles an unknown with evidence, and never touches the acceptance criteria", async () => {
  const w = satelliteWorld({ files: { "src/events.mjs": "e1" } });
  const mission = await explored(w);
  agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: ["file:src/events.mjs"] }));
  const frozen = await act(w, mission, { kind: "analyze", intent: { acceptanceCriteria: [{ statement: "something easier" }] } });
  assert.deepEqual([frozen.refused, frozen.rule, /ACCEPTANCE_FROZEN/.test(frozen.say)], [true, "INTENT_INVALID", true]);
  const evd = [...worldOf(w, mission).m.evidence.keys()].at(-1);
  const amended = await act(w, mission, { kind: "analyze", intent: { hypotheses: [{ statement: "the mailer consumer drops order-paid" }], settled: [{ id: "unk-1", evidence: [evd] }] } });
  const intent = contextOf(w, mission).intent;
  assert.deepEqual([amended.outcome, intent.hypotheses.map((h) => h.id), intent.unknowns[0].settled.evidence, intent.acceptanceCriteria.length], ["amended", ["hyp-1", "hyp-2", "hyp-3"], [evd], 1]);
});

test("a revision past Orbit's execution.maxReplans is refused, and the mission can only stop with the reason its journal shows", async () => {
  const values = (await import("../../src/automation/settings.mjs")).effectiveOf([{ by: "project", content: { execution: { maxReplans: 1 } } }]).values;
  const w = satelliteWorld({ files: { "src/events.mjs": "e1" }, values });
  const mission = await explored(w);
  agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: ["file:src/events.mjs"] }));
  const once = await act(w, mission, { kind: "replan", cause: "HOST_REVISION", units: [{ key: "more", kind: "review", objective: "review the findings", dependsOn: ["explore"], acceptanceCriteriaRefs: ["acc-1"] }] });
  const twice = await act(w, mission, { kind: "replan", cause: "HOST_REVISION", units: [{ key: "again", kind: "review", objective: "review them again", acceptanceCriteriaRefs: ["acc-1"] }] });
  assert.deepEqual([once.outcome, twice.rule], ["revised", "REPLAN_BUDGET"]);
});

const EMPTY = (run) => reportOf(run, { findings: [], evidenceRefs: [], summary: "nothing found yet" });

async function failedAgain(w, mission, n) {
  agentReport(w, mission, `arn-${n}`, EMPTY(`arn-${n}`));
  return n < 3 ? (await act(w, mission, { kind: "dispatch", unit: "wu-1" }), failedAgain(w, mission, n + 1)) : null;
}

test("an attempt that falls short is retried while attempts are left, and three the same way stop the mission as NO_PROGRESS", async () => {
  const w = satelliteWorld();
  const mission = await explored(w);
  await failedAgain(w, mission, 1);
  const triggers = worldOf(w, mission).m.replans.map((t) => t.trigger);
  assert.deepEqual([triggers, contextOf(w, mission).lifecycle, worldOf(w, mission).m.ended.stop], [["UNIT_FAILED", "UNIT_FAILED", "NO_PROGRESS"], "FAILED", "NO_PROGRESS"]);
});

test("delegation nests no deeper than the policy allows", async () => {
  const w = satelliteWorld({ limits: { maxDepth: 1 } });
  const { mission, goalDigest } = start(w, { goal: GOAL });
  await act(w, mission, { kind: "analyze", intent: INTENT(goalDigest) });
  await act(w, mission, { kind: "plan", units: ["a", "b", "c"].map((k) => ({ key: k, kind: "explore", objective: `explore ${k}`, acceptanceCriteriaRefs: ["acc-1"] })) });
  for (const u of ["wu-1", "wu-2", "wu-3"]) (await act(w, mission, { kind: "resolve-role", ...explorerRole(u) }), await act(w, mission, { kind: "resolve-template", unit: u }));
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-2", parentAgentRun: "arn-1" });
  const deeper = await act(w, mission, { kind: "dispatch", unit: "wu-3", parentAgentRun: "arn-2" });
  assert.deepEqual([contextOf(w, mission).agentRuns.map((r) => [r.id, r.parentAgentRun, r.depth]), deeper.rule], [[["arn-1", null, 0], ["arn-2", "arn-1", 1]], "DEPTH"]);
});

test("a running unit cannot be cancelled; a cancelled mission closes its open read-only runs and refuses their late reports", async () => {
  const w = satelliteWorld();
  const mission = await explored(w);
  const early = await act(w, mission, { kind: "cancel-unit", unit: "wu-1", because: "no longer needed" });
  const stopped = finish(w, mission, { stop: "CANCELLED", because: "the person asked to stop" });
  assert.deepEqual([early.rule, stopped.lifecycle, worldOf(w, mission).m.runs.get("arn-1").ended.outcome], ["UNIT_STATE", "CANCELLED", "interrupted"]);
  assert.throws(() => agentReport(w, mission, "arn-1", reportOf("arn-1")), (e) => e.code === "RUN_ENDED");
});
