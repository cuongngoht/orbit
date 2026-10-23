// THE OWNERS EVIDENCE IS READ BACK FROM, as the composition root binds them: an Orbit QA investigation read through
// Orbit's own investigation store and model, never a copy. A completed investigation with no defect verifies; one with a
// defect is behaviour observed and never verified; a paused one is blocked; one still running keeps a report waiting;
// one nobody created, or an id that is no investigation id at all, is unknown -- never "still running" for ever.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvestigations } from "../../src/investigation/store.mjs";
import { investigationOf } from "../cli/bind.mjs";
import { READ_BACK } from "../src/evidence/readback.mjs";
import { finish } from "../src/mission/finish.mjs";
import { start } from "../src/mission/loop.mjs";
import { agentReport } from "../src/mission/report.mjs";
import { act, explorerRole, intentFor } from "./fakes/flow.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { reportOf, satelliteWorld } from "./fakes/world.mjs";

const ROOT = "/orbit-store/repo-owners";
const ID = "inv-20261022-080000-abcd";

function portsWith(lines) {
  const store = createInvestigations(ROOT, fakeIo());
  store.create({ id: ID, objective: "check the retry loop against its deadline" });
  for (const [kind, record] of lines) store.append(ID, kind, record);
  return { owners: { investigation: (id) => investigationOf(store, id) } };
}

const back = (ports, id = ID) => READ_BACK.investigation(ports, { id });

const finding = (outcome) => ["finding", { id: "fnd-1", key: "retry-deadline", family: "timing", outcome, confidence: "high", say: "the loop was observed against the deadline" }];

const completed = (lifecycle = "completed", reason = "completed-scope") => ["completed", { id: "cmp-1", reason, lifecycle, by: "session", why: "the scope has a disposition" }];

test("a completed investigation with no defect verifies, on Orbit's own record of it", () => {
  const r = back(portsWith([finding("OBSERVED_EXPECTED_BEHAVIOR"), completed()]));
  assert.deepEqual([r.level, r.open], ["VERIFIED", false]);
});

test("a completed investigation with a defect is behaviour observed, never verified", () => {
  assert.equal(back(portsWith([finding("CONFIRMED_DEFECT"), completed()])).level, "BEHAVIOR_OBSERVED");
});

test("a paused investigation is blocked, and says why", () => {
  const r = back(portsWith([completed("paused", "budget-exhausted")]));
  assert.deepEqual([r.level, r.open, /budget-exhausted/.test(r.say)], ["BLOCKED", false, true]);
});

test("a cancelled investigation proves nothing either way, and keeps nothing waiting", () => {
  const r = back(portsWith([finding("OBSERVED_EXPECTED_BEHAVIOR"), ["cancelled", { why: "a person cancelled it", by: "person" }]]));
  assert.deepEqual([r.level, r.open, /cancelled/.test(r.say)], ["UNKNOWN", false, true]);
});

test("an investigation still running keeps the report waiting", () => {
  assert.deepEqual([back(portsWith([finding("SUSPECTED_DEFECT")])).open, back(portsWith([])).level], [true, "UNKNOWN"]);
});

test("an id nobody created, or one that is no investigation id, is unknown and keeps nothing waiting", () => {
  const ports = portsWith([]);
  for (const id of ["inv-20261022-080000-ffff", "../../etc/passwd"]) assert.deepEqual([back(ports, id).level, back(ports, id).open], ["UNKNOWN", false]);
});

test("a verify unit completes the mission on a QA investigation's own outcome", async () => {
  const w = satelliteWorld({ investigations: { [ID]: { lifecycle: "completed", ended: true, reason: "completed-scope", findings: 2, defects: 0, task: null } } });
  const { mission, goalDigest } = start(w, { goal: "Verify the retry loop respects the job deadline." });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units: [{ key: "verify", kind: "verify", objective: "read the investigation back against the criterion", acceptanceCriteriaRefs: ["acc-1"] }] });
  await act(w, mission, { kind: "resolve-role", ...explorerRole("wu-1", { responsibilities: [{ activity: "verify", subject: "acceptance" }], profile: "VERIFY" }) });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  const r = agentReport(w, mission, "arn-1", reportOf("arn-1", { evidenceRefs: [`investigation:${ID}`] }));
  const end = finish(w, mission);
  assert.deepEqual([r.outcome, end.lifecycle, end.verdict, end.acceptance[0].independent], ["succeeded", "COMPLETED", "VERIFIED", true]);
});
