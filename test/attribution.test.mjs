// ATTRIBUTION's one vocabulary (0.2.2, ADR 0044): five words in the order a reader trusts them, how a run's link to an
// agent is settled from what was observed and what was reported, the qualified run reference, and the two ids an
// envelope carries -- read off a text that holds the envelope's mark, and nothing else of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTION, ATTRIBUTION_WORDS, ENVELOPE_MARK, SETTLE, attributionOf, envelopeRefOf, parseRunRef, runRefOf, settle } from "../src/attribution.mjs";

test("five words, ranked in the order a reader trusts them, and an unknown word is UNATTRIBUTED", () => {
  assert.deepEqual(ATTRIBUTION_WORDS, ["RUNTIME_BOUND", "HOST_OBSERVED", "REPORTED", "UNATTRIBUTED", "CONFLICTING"]);
  assert.deepEqual(ATTRIBUTION.map((a) => a.rank), [1, 2, 3, 4, 5]);
  assert.ok(ATTRIBUTION.every((a) => a.say.length > 20));
  assert.equal(attributionOf("whatever").id, "UNATTRIBUTED");
});

test("settle: observed, reported, the two agreeing, the two disagreeing, and nothing at all -- every row reachable", () => {
  assert.equal(settle({ observed: ["a"] }).word, "HOST_OBSERVED");
  assert.equal(settle({ reported: ["a"] }).word, "REPORTED");
  assert.equal(settle({ observed: ["a"], reported: ["a"] }).word, "HOST_OBSERVED", "the host's own word and the agent's agree");
  assert.deepEqual(settle({ observed: ["a"], reported: ["b"] }), { word: "CONFLICTING", agents: ["a", "b"], observed: ["a"], reported: ["b"] });
  assert.equal(settle({ observed: ["a", "b"] }).word, "CONFLICTING", "one run launched twice is never quietly one of them");
  assert.equal(settle({}).word, "UNATTRIBUTED");
  assert.equal(settle({ observed: [null, ""], reported: [undefined] }).word, "UNATTRIBUTED", "an empty id is no id");
  assert.equal(SETTLE.at(-1).when({}), true, "the last row always answers");
});

test("a run reference is qualified by its mission, and nothing else parses as one", () => {
  assert.equal(runRefOf("msn-0123456789ab", "arn-3"), "msn-0123456789ab/arn-3");
  assert.deepEqual(parseRunRef("msn-0123456789ab/arn-3"), { mission: "msn-0123456789ab", run: "arn-3" });
  for (const bad of ["arn-3", "msn-0123456789ab", "msn-0123456789AB/arn-3", "msn-0123456789ab/arn-0", "msn-0123456789ab/arn-3/x", "../msn-0123456789ab/arn-3", null]) assert.equal(parseRunRef(bad), null, String(bad));
  assert.equal(runRefOf("msn-x", "arn-1"), null);
  assert.equal(runRefOf(null, null), null);
});

const envelope = (over = {}) => JSON.stringify({ api: ENVELOPE_MARK, missionId: "msn-0123456789ab", agentRunId: "arn-2", instruction: { text: "SECRET-SENTINEL do the thing" }, report: { command: "node satellite.mjs agent report msn-0123456789ab arn-2", example: { agentRunId: "arn-2" } }, ...over }, null, 2);

test("an envelope's two ids are read off its mark, pretty-printed or not, and nothing else of the text travels", () => {
  assert.equal(envelopeRefOf(envelope()), "msn-0123456789ab/arn-2");
  assert.equal(envelopeRefOf(JSON.stringify(JSON.parse(envelope()))), "msn-0123456789ab/arn-2");
  assert.equal(envelopeRefOf(`Run this envelope exactly:\n${envelope()}\nthen report.`), "msn-0123456789ab/arn-2");
  assert.doesNotMatch(String(envelopeRefOf(envelope())), /SECRET|thing|report/);
});

test("no mark, two missions, two runs or a malformed id -- no reference at all", () => {
  assert.equal(envelopeRefOf(envelope().replace(ENVELOPE_MARK, "something/else")), null, "the ids alone are not an envelope");
  assert.equal(envelopeRefOf(`${envelope()}\n${envelope({ missionId: "msn-ba9876543210" })}`), null, "two missions disagree");
  assert.equal(envelopeRefOf(`${envelope()}\n${envelope({ agentRunId: "arn-9" })}`), null, "two runs disagree");
  assert.equal(envelopeRefOf(JSON.stringify({ api: ENVELOPE_MARK, missionId: "msn-0123456789ab", agentRunId: "arn-0" })), null);
  assert.equal(envelopeRefOf(JSON.stringify({ api: ENVELOPE_MARK, missionId: "msn-0123456789ab" })), null, "a mission with no run names nobody");
  assert.equal(envelopeRefOf(undefined), null);
  assert.equal(envelopeRefOf(42), null);
});
