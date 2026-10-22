// HOST CAPABILITY HONESTY: with no native acceptance recorded for this source, no capability of any host is
// `verified`; Codex, Antigravity and Grok never report native agent dispatch; a receipt for another source earns
// nothing; and a serial host is never shown as parallel. The report a run returns is held to its contract whole.
import assert from "node:assert/strict";
import { test } from "node:test";
import { passedOn, sourceDigestOf } from "../src/hosts/acceptance.mjs";
import { hostOf } from "../src/hosts/detect.mjs";
import { CAPABILITIES, HOST_IDS, hostRowOf, hostsMatrix, serialOnly, VALUES } from "../src/hosts/matrix.mjs";
import { reportProblems } from "../src/hosts/report.mjs";

test("with no acceptance recorded, no cell of any host is verified", () => {
  const matrix = hostsMatrix(new Set());
  for (const host of HOST_IDS) for (const cap of CAPABILITIES) assert.notEqual(matrix[host][cap].value, "verified", `${host} ${cap}`);
  assert.equal(matrix.claude.nativeAgentDispatch.value, "reported");
});

test("Codex, Antigravity and Grok never report native agent dispatch, and are serial", () => {
  for (const host of ["codex", "antigravity", "grok", "unknown"]) assert.deepEqual([hostRowOf(host).nativeAgentDispatch.value === "unavailable" || hostRowOf(host).nativeAgentDispatch.value === "unknown", serialOnly(hostRowOf(host))], [true, true], host);
});

test("every cell says on what grounds, unless nothing does", () => {
  for (const host of HOST_IDS) for (const cap of CAPABILITIES) {
    const cell = hostsMatrix(new Set())[host][cap];
    assert.ok(VALUES.includes(cell.value));
    assert.ok(cell.value === "unknown" || cell.by, `${host} ${cap} says ${cell.value} on no grounds`);
  }
});

test("a receipt earns verified only for the very source it ran on", () => {
  const files = [{ rel: "satellite/src/a.mjs", text: "a" }];
  const digest = sourceDigestOf(files);
  const doc = { schema: 1, receipts: [{ kit: "host", host: { id: "claude", code: digest }, system: { emulated: false }, results: [{ id: "claude:agent-dispatch", outcome: "passed" }] }] };
  assert.equal(hostRowOf("claude", passedOn(doc, digest)).nativeAgentDispatch.value, "verified");
  assert.equal(hostRowOf("claude", passedOn(doc, sourceDigestOf([{ rel: "satellite/src/a.mjs", text: "b" }]))).nativeAgentDispatch.value, "reported");
  const row = hostRowOf("claude", passedOn(doc, digest));
  assert.deepEqual([row.parallelism.value, row.parallelism.claimed, serialOnly(row)], ["reported", "claude:agent-parallel", false], "parallelism the host documents is used, and said to be only reported");
});

test("which host a command runs under is asked of its environment, and an explicit ORBIT_HOST wins", () => {
  assert.deepEqual([hostOf({ ORBIT_HOST: "codex", CLAUDECODE: "1" }), hostOf({ CLAUDECODE: "1" }), hostOf({ GROK_SESSION_ID: "grok-session-0001" }), hostOf({})], ["codex", "claude", "grok", "unknown"]);
});

const ok = { schemaVersion: 1, agentRunId: "arn-1", executionState: "reported", findings: [{ say: "found it", refs: ["file:a.mjs"] }], evidenceRefs: ["file:a.mjs"], summary: "one sentence" };

test("a report that claims an outcome, a level or a mode is refused by name, whole", () => {
  const ids = (r) => reportProblems(r, { run: { id: "arn-1" } }).map((p) => p.id);
  assert.deepEqual(ids(ok), []);
  assert.deepEqual(ids({ ...ok, verdict: "PASS", level: "VERIFIED" }), ["REPORT_FORBIDDEN"]);
  assert.deepEqual(ids({ ...ok, agentRunId: "arn-2" }), ["REPORT_RUN"]);
  assert.deepEqual(ids({ ...ok, evidenceRefs: ["shell:rm -rf"] }), ["REPORT_EVIDENCE"]);
  assert.deepEqual(ids({ ...ok, summary: "password=hunter2" }), ["REPORT_SECRET"]);
  assert.deepEqual(ids({ ...ok, executionState: "succeeded" }), ["REPORT_STATE"]);
});
