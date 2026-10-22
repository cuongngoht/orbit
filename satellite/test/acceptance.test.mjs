// RECORDING HOST ACCEPTANCE: a person's account of a live run, held to its shape -- one receipt per host, keyed to the
// source it ran on -- and a dry run that writes nothing. Nothing a test does here touches the recorded file.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sealed } from "../../test/home.mjs";
import { passedOn, receiptOf, recordedDoc, recordProblems, resultOf } from "../src/hosts/acceptance.mjs";

const RECORDER = fileURLToPath(new URL("../acceptance/record-host-acceptance.mjs", import.meta.url));
const FILE = fileURLToPath(new URL("../acceptance/host-acceptance.json", import.meta.url));
const HOSTS = ["antigravity", "claude", "codex", "grok"];

const asked = (host, ...texts) => ({ host, version: "2.1.0", results: texts.map((text) => ({ text, parsed: resultOf(text) })) });

test("a result is <host>:<test>:<ops>:<passed|failed>, and anything else is refused by what is wrong", () => {
  assert.deepEqual(resultOf("claude:agent-dispatch:mission.start,dispatch,Agent(general-purpose),agent.report:passed"), { id: "claude:agent-dispatch", ops: ["mission.start", "dispatch", "Agent(general-purpose)", "agent.report"], outcome: "passed" });
  for (const bad of ["claude:agent-dispatch:passed", "claude:agent-dispatch:x:maybe", "claude:agent dispatch:x:passed", "claude:a:b;rm:passed"]) assert.equal(resultOf(bad), null, bad);
  assert.deepEqual(recordProblems(asked("claude", "claude:agent-dispatch:a:passed"), HOSTS), []);
  assert.deepEqual(recordProblems(asked("emacs", "claude:agent-dispatch:a:passed"), HOSTS).map((p) => p.id), ["HOST", "RESULT_HOST"]);
  assert.deepEqual(recordProblems(asked("claude", "claude:x:a:passed", "claude:x:b:failed"), HOSTS).map((p) => p.id), ["RESULT_TWICE"]);
  assert.deepEqual(recordProblems(asked("claude"), HOSTS).map((p) => p.id), ["RESULTS"]);
});

test("one receipt per host: a new one replaces that host's last, and every other host's is kept as it was", () => {
  const first = recordedDoc(null, receiptOf(asked("claude", "claude:agent-dispatch:a:failed"), "c1", "2026-10-22T00:00:00.000Z", {}));
  const codex = recordedDoc(first, receiptOf(asked("codex", "codex:serial-run:a:passed"), "c1", "2026-10-22T00:01:00.000Z", {}));
  const again = recordedDoc(codex, receiptOf(asked("claude", "claude:agent-dispatch:a:passed"), "c2", "2026-10-22T00:02:00.000Z", {}));
  assert.deepEqual(again.receipts.map((r) => [r.host.id, r.host.code, r.results[0].outcome]), [["claude", "c2", "passed"], ["codex", "c1", "passed"]]);
  assert.deepEqual([[...passedOn(again, "c2")], [...passedOn(again, "c1")]], [["claude:agent-dispatch"], ["codex:serial-run"]]);
  assert.equal(again.receipts[0].system.emulated, false);
});

const recorded = (args) => spawnSync(process.execPath, [RECORDER, ...args], { encoding: "utf8", env: sealed({}) });

test("a dry run says what the receipt would earn on this source and writes nothing; a malformed one exits 2", () => {
  const before = existsSync(FILE) ? readFileSync(FILE, "utf8") : null;
  const dry = recorded(["--host=claude", "--version=2.1.0", "--result=claude:agent-parallel:dispatch,dispatch:passed", "--dry"]);
  const bad = recorded(["--host=claude", "--version=2.1.0", "--result=codex:x:a:passed", "--dry"]);
  assert.deepEqual([dry.status, JSON.parse(dry.stdout).earns, JSON.parse(dry.stdout).file, bad.status], [0, ["parallelism"], null, 2]);
  assert.match(JSON.parse(dry.stdout).code, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(FILE) ? readFileSync(FILE, "utf8") : null, before);
});
