// A declared playbook REVIEWED from what its runs did (0.0.4, src/skill-factory/review.mjs): every question answered
// from run records read out of the project's own journals -- never a counter -- one session's success never called
// reliable, and a successor PROPOSED, never written.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REVIEW_IDS, reviewOf } from "../src/skill-factory/review.mjs";
import { listOf } from "../src/skill-factory/lifecycle.mjs";
import { COMMANDS } from "../src/skill-factory/index.mjs";
import { next, start } from "./fakes/automation.mjs";
import { declared, evidenceCapability, skillWorld, spec, workflowOf } from "./fakes/skill-run.mjs";

const PIN = "release-readiness-verification:0.1.0:7c195e58";
const step = (id, word, over = {}) => ({ id, word, required: true, calls: 1, retries: 0, waiting: null, bound: "managed:corp", providers: ["managed:corp"], ...over });
const run = (word, session, at, steps = [step("a", word === "VERIFIED" ? "VERIFIED" : "CONTRACT_MET")]) => ({ task: `tsk-${session.padEnd(12, "0")}`, run: "srun-0123456789ab", pin: PIN, word, session, at, steps });
const versions = [{ pin: PIN, version: "0.1.0", status: "active", holds: true }];
const said = (r) => Object.fromEntries(r.questions.map((q) => [q.id, q.answer]));

test("a skill that never ran is UNTRIED, and every question about its runs is unknown", () => {
  const r = reviewOf({ id: "x", runs: [], versions });
  assert.equal(r.reliability.word, "UNTRIED");
  assert.deepEqual(Object.values(said(r)).filter((a) => a === "unknown").length, REVIEW_IDS.length - 1, "all but whether its workflow holds");
  assert.equal(said(r).WORKFLOW_VALID, "yes");
});

test("one good run is never reliable: a single session is INSUFFICIENT however it went", () => {
  assert.equal(reviewOf({ id: "x", runs: [run("VERIFIED", "s1", "2026-10-20T10:00:00Z")], versions }).reliability.word, "INSUFFICIENT");
  assert.equal(reviewOf({ id: "x", runs: [run("VERIFIED", "s1", "2026-10-20T10:00:00Z"), run("VERIFIED", "s1", "2026-10-20T11:00:00Z")], versions }).reliability.word, "INSUFFICIENT", "two runs in one session are one session");
});

test("runs that only answered are UNPROVEN; proven runs across sessions are CONSISTENT -- never universally reliable", () => {
  const reported = reviewOf({ id: "x", runs: [run("REPORTED", "s1", "2026-10-20T10:00:00Z"), run("REPORTED", "s2", "2026-10-20T11:00:00Z")], versions });
  assert.equal(reported.reliability.word, "UNPROVEN");
  assert.equal(said(reported).EVIDENCE, "no");
  const proven = reviewOf({ id: "x", runs: [run("VERIFIED", "s1", "2026-10-20T10:00:00Z"), run("VERIFIED", "s2", "2026-10-20T11:00:00Z")], versions });
  assert.equal(proven.reliability.word, "CONSISTENT");
  assert.match(proven.reliability.because, /never universally reliable/);
});

test("a failed contract or a workflow that no longer holds PROPOSES a successor, and the review writes nothing", () => {
  const failed = reviewOf({ id: "x", runs: [run("FAILED", "s1", "2026-10-20T12:00:00Z", [step("a", "VERIFY_FAILED")]), run("VERIFIED", "s2", "2026-10-20T10:00:00Z")], versions });
  assert.equal(failed.reliability.word, "FAILING", "its newest run failed");
  assert.equal(said(failed).CONTRACTS, "no");
  assert.deepEqual([failed.proposal.successor, failed.proposal.writes], [true, "nothing"]);
  const stale = reviewOf({ id: "x", runs: [], versions: [{ ...versions[0], holds: false }] });
  assert.equal(stale.proposal.successor, true);
  assert.equal(reviewOf({ id: "x", runs: [run("VERIFIED", "s1", "2026-10-20T10:00:00Z")], versions }).proposal.successor, false);
});

test("a call through a provider no owner gate serves, or one the step was not bound to, is not authorized", () => {
  const external = reviewOf({ id: "x", runs: [run("REPORTED", "s1", "2026-10-20T10:00:00Z", [step("a", "CONTRACT_MET", { providers: ["external:corp"] })])], versions });
  assert.equal(said(external).AUTHORIZED_PROVIDER, "no");
  const swapped = reviewOf({ id: "x", runs: [run("REPORTED", "s1", "2026-10-20T10:00:00Z", [step("a", "CONTRACT_MET", { providers: ["managed:other"] })])], versions });
  assert.equal(said(swapped).AUTHORIZED_PROVIDER, "no");
});

test("retries and waits are an intervention; a required step never reached is said", () => {
  const r = reviewOf({ id: "x", runs: [run("BLOCKED", "s1", "2026-10-20T10:00:00Z", [step("a", "CONTRACT_MET", { retries: 1 }), step("b", "BLOCKED", { waiting: "apr-1" }), step("c", "PENDING")])], versions });
  assert.equal(said(r).INTERVENTION, "yes");
  assert.equal(said(r).ALL_REQUIRED_RAN, "no");
});

test("the review of a real skill reads its runs from the project's own journals, per version", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "orbit-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = skillWorld(t, { world: { dir: root }, base: root });
  const reg = await declared(first, { wf: workflowOf() });
  for (const session of ["sess-1"]) {
    const st = start(first.ports, spec);
    await next(first, st.task);
    await next(first, st.task);
  }
  const second = skillWorld(t, { world: { dir: root, start: "2026-10-07T09:00:00.000Z" }, base: root, session: "sess-2", evidence: evidenceCapability({ items: ["REL-8"] }) });
  const st2 = start(second.ports, spec);
  await next(second, st2.task);
  await next(second, st2.task);
  const runs = second.factory.runs(reg.id);
  assert.equal(runs.length, 2, "both workflows' runs, read from their journals");
  assert.deepEqual(runs.map((r) => r.word), ["REPORTED", "REPORTED"]);
  assert.ok(runs.every((r) => r.pin === reg.pin));
  const review = second.factory.review(reg.id);
  assert.equal(review.reliability.word, "UNPROVEN", "they answered, and nothing an owner keeps proved them");
  assert.deepEqual(review.versions.map((v) => [v.pin, v.runs, v.reported, v.holds]), [[reg.pin, 2, 2, true]]);
  assert.equal(said(review).AUTHORIZED_PROVIDER, "yes");
  assert.equal(listOf(second.factory.store).length, 1, "a review registered nothing");
  const printed = COMMANDS.review.say(review);
  assert.match(printed, /REVIEW {5}release-readiness-verification · UNPROVEN/);
  assert.match(COMMANDS.runs.say({ id: reg.id, runs }), /RUNS {7}release-readiness-verification · 2 run\(s\)/);
});
