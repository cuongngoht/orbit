// The tool-call failure suite (0.5.0, backlog B9): cases that make a host's calls fail on purpose. ORBIT-TOOL-001 is a QA
// case whose request quotes an earlier session's runbook, each of its calls refused by the relay as it is written. What
// this file holds without Docker: every case loads and holds to its fields; its ground truth is acceptance's own; its host
// is asked what every invoice QA case asks, the runbook besides, naming no variant and no shape; each planted call is
// refused by the relay for a reason a host can correct, and the request quotes it as the call a host would type; and its
// controls are the hosts that tell its rows apart. Their verdicts, through the engine double, are
// test/benchmark-qa-flow.test.mjs's; in containers, `node benchmark/run.mjs controls ORBIT-TOOL-001`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { caseFindings, casesOf, QA_HOSTS, REFUSAL_HOSTS } from "../benchmark/lib/core/suites.mjs";
import { relayReasonOf } from "../benchmark/lib/core/tools.mjs";
import { HOSTS } from "../benchmark/lib/qa/hosts.mjs";
import { CORRECTABLE } from "../benchmark/lib/qa/judge.mjs";
import { admitted } from "../benchmark/lib/qa/relay.mjs";

const ROOT = join(import.meta.dirname, "..");
const TOOLS = casesOf(ROOT, "orbit-tools");
const QA = casesOf(ROOT, "orbit-qa");
const ACCEPTANCE = JSON.parse(readFileSync(join(ROOT, "acceptance", "truth.json"), "utf8"));
const INV = "inv-0123456789ab";

const textOf = (c) => readFileSync(join(c.dir, c.request), "utf8");

const qaCases = () => TOOLS.filter((c) => c.kind === "qa");

test("every case of the tool-call failure suite loads, holds to its fields, and plants calls a host would send", () => {
  assert.ok(qaCases().length >= 1, `${qaCases().length} QA case(s)`);
  for (const c of TOOLS) assert.deepEqual(caseFindings(JSON.parse(readFileSync(join(c.dir, "case.json"), "utf8")), c.dir), [], c.id);
  for (const c of qaCases()) assert.ok(c.refusals?.planted?.length > 0, `${c.id} plants calls`);
});

test("a QA case's ground truth is acceptance's own, for its stack and variant", () => {
  for (const c of qaCases()) {
    const t = JSON.parse(readFileSync(join(c.dir, c.acceptance.truth), "utf8"));
    assert.deepEqual([t.default, t.shapes, t.expect], [ACCEPTANCE.default, ACCEPTANCE.shapes, ACCEPTANCE.stacks[c.target.stack].variants[c.target.variant]], c.id);
  }
});

test("its host is asked what every invoice QA case asks, the runbook besides, and the request names no variant and no shape", () => {
  const asked = textOf(QA[0]).trimEnd();
  for (const c of qaCases()) {
    assert.ok(textOf(c).startsWith(asked), `${c.id}: the invoice QA request, word for word`);
    for (const word of [...Object.keys(ACCEPTANCE.stacks["invoice-a"].variants).filter((v) => v !== "correct"), ...ACCEPTANCE.shapes]) assert.ok(!textOf(c).includes(word), `${c.id}: ${word}`);
    assert.deepEqual(c.target.withheld, QA[0].target.withheld, "it withholds what every QA case withholds");
  }
});

test("each planted call is refused by the relay as it is written, for a reason a host can correct, and the request quotes it as typed", () => {
  for (const c of qaCases()) {
    for (const argv of c.refusals.planted) {
      const a = admitted({ argv, stdin: "" }, INV);
      assert.ok(a.refused, `${c.id}: ${argv.join(" ")} is refused`);
      assert.ok(CORRECTABLE.includes(relayReasonOf(a)), `${c.id}: ${argv.join(" ")} is refused for how it is written (${relayReasonOf(a)})`);
      assert.ok(textOf(c).includes(`\`node /work/repo/cli/autonomous-qa.mjs ${argv.join(" ")}\``), `${c.id}: the request quotes ${argv.join(" ")}`);
    }
  }
});

test("its controls are the hosts that tell its rows apart: a host that recovers and one that never meets a refusal pass, the others fail", () => {
  const expected = { reference: "PASS", recovers: "PASS", repeats: "FAIL", uncorrected: "FAIL", idle: "FAIL", "false-alarm": "FAIL" };
  for (const c of qaCases()) {
    assert.deepEqual(Object.fromEntries(c.controls.map((k) => [k.host, k.expect])), expected, c.id);
    assert.ok(c.controls.every((k) => typeof HOSTS[k.host] === "function" && [...QA_HOSTS, ...REFUSAL_HOSTS].includes(k.host)));
    assert.ok(c.refusals.planted.some((argv) => argv[0] === "finish"), `${c.id}: a planted finish, so the uncorrected host leaves a call it was told to make uncorrected`);
    assert.ok(c.refusals.repeats < 3, `${c.id}: a bound the repeating host can pass`);
  }
});
