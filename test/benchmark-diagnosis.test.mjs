// A RUN'S DIAGNOSIS (benchmark/lib/core/diagnosis.mjs, 0.5.0 backlog B6): what a person diagnosing a failed
// model-carried row used to read the room for -- how the host's session ended, the budget it used, what the relay
// refused, what the engine stopped and where a run stopped short -- read off the run's own records into its report,
// where a release ship's --status reads it. It decides nothing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diagnosisLines, diagnosisOf, FINISH, relayLines, SHOWN } from "../benchmark/lib/core/diagnosis.mjs";
import { qaReportOf } from "../benchmark/lib/qa/report.mjs";
import { newRunId, roomOf } from "../benchmark/lib/core/room.mjs";

const MANIFEST = { run: "bnr-000000000d01", task: "tsk-000000000d01", at: "2026-11-05T10:00:00.000Z", config: { usd: 20, minutes: 120, rounds: 1, model: "claude-opus-5-5", host: "coding-host" }, source: { branch: "main", commit: "c".repeat(40), mode: "head", digest: "d1" }, subject: { digest: "s1" }, benchmark: { case: "ORBIT-QA-003", version: "1.0.0", suite: "orbit-qa", suiteVersion: "1.0.0" }, target: { app: "invoice", stack: "a", variant: "planted", clean: "correct", plan: "p", mode: "m" }, plugin: { digest: "p1", withheld: [], relayed: "cli/autonomous-qa.mjs" }, images: { qaWorker: "q", runner: "r", claudeCode: "2.1.314" }, host: { docker: "27" } };

const ENDING = { outcome: "FAIL", summary: "FAIL — a planted defect was not found", at: "2026-11-05T10:47:00.000Z" };

const HOST = { started: true, subtype: "success", isError: false, turns: 42, toolCalls: 61, costUsd: 4.125, errorText: null };

const STOPPED = { outcome: "INVALID_TEST", rule: "TEST_WRONG", step: 2, do: "call", capability: "orbit.state.read", as: "refused", says: "request.key … or request.match" };

const RELAY = [
  { sub: "protocol", refused: null, exit: 0 },
  { sub: "--help", refused: "the relay runs no `--help`", exit: 2 },
  { sub: "step", refused: null, exit: 0, stopped: STOPPED },
  { sub: "finish", refused: null, exit: 2, why: "inv-1 is already paused" },
  { request: "x.json", error: "could not remove it" },
];

test("FINISH: why a host's round ended, every row reached and in order -- the host's own word only where nothing else explains it", () => {
  const rounds = [{ interrupted: true, host: HOST }, { timedOut: true, host: HOST }, { host: { started: false } }, { host: { ...HOST, subtype: "error_max_turns", isError: true } }, { host: null }];
  assert.deepEqual(rounds.map((r) => FINISH.find((x) => x.when(r)).id), FINISH.map((x) => x.id));
  assert.equal(diagnosisOf({ manifest: MANIFEST, ending: ENDING, rounds: [{ round: 1, host: { ...HOST, subtype: "error_max_turns", isError: true } }], relay: null }).finish[0].reason, "error_max_turns (an error)");
});

test("a run's diagnosis: its finish, the budget it used against its allowance, the relay's refusals and the engine's stops, where a run stopped short", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-diagnosis-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "relay.jsonl"), `${RELAY.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n`);
  const d = diagnosisOf({ manifest: MANIFEST, ending: ENDING, rounds: [{ round: 1, host: HOST }], relay: relayLines(join(dir, "relay.jsonl")) });
  assert.deepEqual(d.finish, [{ round: 1, reason: "success", turns: 42, toolCalls: 61, error: null }]);
  assert.deepEqual(d.budget, { usd: { used: 4.125, cap: 20 }, minutes: { used: 47, cap: 120 }, rounds: { used: 1, cap: 1 } });
  assert.deepEqual([d.relay.requests, d.relay.refused, d.relay.stopped], [5, 1, 2], "a line that does not parse is left out");
  assert.deepEqual(d.relay.stops, [{ sub: "finish", exit: 2, why: "inv-1 is already paused" }, { sub: null, exit: null, why: "could not remove it" }]);
  assert.deepEqual(d.stopped, [STOPPED]);
  assert.equal(relayLines(join(dir, "nothing.jsonl")), null, "a run that kept no relay log");
  const many = diagnosisOf({ manifest: MANIFEST, ending: ENDING, rounds: [], relay: Array.from({ length: 9 }, (_, i) => ({ sub: "--help", refused: `no ${i}`, exit: 2 })) });
  assert.deepEqual([many.relay.refused, many.relay.refusals.length, many.relay.refusals.at(-1).why], [9, SHOWN, "no 8"], "counted whole, the latest shown");
  assert.deepEqual(diagnosisOf({ manifest: MANIFEST, ending: null, rounds: [{ round: 1, interrupted: true, host: null }], relay: null }).budget.usd.used, null, "what nobody reported is null, never 0");
});

test("a QA run's report carries its diagnosis, read off its round and its relay log, and says it in report.md", (t) => {
  const store = mkdtempSync(join(tmpdir(), "orbit-diagnosis-room-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const room = roomOf(store, newRunId("diagnosis"));
  mkdirSync(room.at("rounds", "1", "relay"), { recursive: true });
  writeFileSync(room.at("rounds", "1", "relay", "relay.jsonl"), RELAY.map((l) => JSON.stringify(l)).join("\n"));
  const view = { lifecycle: "COMPLETED", actions: [{ id: "act-1", type: "benchmark.qa" }] };
  const steps = { "act-1": { driver: "coding-host", host: HOST, relay: { served: 4 }, container: { timedOut: false } } };
  const rep = qaReportOf(room, MANIFEST, view, steps, ENDING);
  assert.deepEqual([rep.json.diagnosis.finish[0].reason, rep.json.diagnosis.budget.usd.used, rep.json.diagnosis.relay.refused, rep.json.diagnosis.stopped.length], ["success", 4.125, 1, 1]);
  assert.match(rep.md, /## Diagnosis\n\n- round 1: success, 42 turns, 61 tool calls\n- budget used: 4\.125 of 20 USD \(reported\), 47 of 120 minutes, 1 of 1 round\(s\)/);
  assert.ok(diagnosisLines(rep.json.diagnosis).some((l) => /stopped short at step 2 \(call orbit\.state\.read, refused; INVALID_TEST TEST_WRONG\)/.test(l)));
});
