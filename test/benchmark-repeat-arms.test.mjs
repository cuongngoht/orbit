// REPEATED RUNS (0.5.0, B2) and the ARMS a case is compared on (B23), through the Docker double over a small repository
// of its own: `run --repeat=N` makes N runs -- each its own room and task -- named as one repeat group in every manifest,
// bounded by BOUNDS; and a case that declares arms runs each one with the plugin that arm hands the host: none at all
// (no --plugin-dir, no plugin mounted: no Orbit hooks, no trail), the plugin frozen from a named git revision (the
// previous release), or the run's own source -- everything else the same.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOUNDS, COMMANDS } from "../benchmark/lib/commands.mjs";
import { docRead, roomOf } from "../benchmark/lib/core/room.mjs";
import { dockerDouble, harnessOf, NEVER, worldOf } from "./benchmark-double.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const CASE = { schema: 1, kind: "source", id: "CALC-001", version: "1.0.0", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "correctness", capability: "calc.add", repairable: ["ORBIT_SOURCE_DEFECT"] }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, prepare: { requires: ["node"] }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "calc-suite", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: {} }, controls: [] };

const SPEC = `export const GROUPS = { sums: "add returns the sum of its two numbers" };
export const cases = (seed, samples) => Array.from({ length: samples }, (_, i) => ({ id: "sums-" + (i + 1), group: "sums", input: { call: "add", a: i, b: (seed % 7) + i }, expect: { exactly: [String(i + (seed % 7) + i)] } }));
export const selfTest = () => [];
`;

const PROBE = `import { join } from "node:path";
import { pathToFileURL } from "node:url";
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d)).on("end", async () => {
  const inputs = JSON.parse(Buffer.concat(chunks).toString()).inputs;
  try { const m = await import(pathToFileURL(join(process.argv[2], "src/calc.mjs")).href); process.stdout.write(JSON.stringify({ answers: inputs.map((i) => ({ id: i.id, got: [String(m.add(i.a, i.b))] })) }) + "\\n"); }
  catch (e) { process.stdout.write(JSON.stringify({ error: { code: "IMPORT", message: String(e.message) } }) + "\\n"); }
});
`;

const FILES = {
  "package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "test/calc.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds", () => {\n  assert.equal(add(1, 2), 3);\n});\n',
  "benchmark/suites/fixture/suite.json": JSON.stringify({ schema: 1, id: "fixture", version: "1.0.0", title: "a calculator", cases: ["CALC-001"] }),
  "benchmark/suites/fixture/calc-001/case.json": JSON.stringify(CASE, null, 2),
  "benchmark/suites/fixture/calc-001/request.md": "Make add return the sum of its two numbers.\n",
  "benchmark/suites/fixture/calc-001/verifier/spec.mjs": SPEC,
  "benchmark/suites/fixture/calc-001/verifier/probe.mjs": PROBE,
};

const manifestOf = (w, run) => docRead(roomOf(w.storeRoot, run), "manifest.json");

// ---- repeats ------------------------------------------------------------------------------------------------------------

test("--repeat=N runs a case N times, each its own room and task, named as one repeat group in every manifest", async (t) => {
  const w = worldOf(t, FILES);
  const r = await COMMANDS.run.run(harnessOf(w, dockerDouble(NEVER)), ["CALC-001", "--repeat=3", "--seed=3"]);
  const manifests = r.runs.map((x) => manifestOf(w, x.run));
  assert.match(r.repeat.group, /^rpt-[a-f0-9]{12}$/);
  assert.deepEqual([r.runs.length, new Set(r.runs.map((x) => x.run)).size, new Set(manifests.map((m) => m.task)).size], [3, 3, 3], "three rooms, three tasks");
  assert.deepEqual(manifests.map((m) => [m.config.repeat.id, m.config.repeat.index, m.config.repeat.of]), [1, 2, 3].map((i) => [r.repeat.group, i, 3]));
  assert.deepEqual([r.runs.map((x) => x.outcome), r.exit, COMMANDS.run.exit(r)], [["PASS", "PASS", "PASS"], 0, 0]);
  assert.match(COMMANDS.run.say(r), /\(repeat 2\/3, rpt-/);
});

test("--repeat is bounded as data, never names a single run, and a run with none is the one run it always was", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  assert.deepEqual(BOUNDS.find(([k]) => k === "repeat"), ["repeat", 1, 10]);
  for (const bad of ["--repeat=0", "--repeat=11", "--repeat=two"]) await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", bad]), /out of bounds: --repeat is 1\.\.10/, bad);
  await assert.rejects(async () => COMMANDS.run.run(h, ["CALC-001", "--repeat=2", "--run-id=bnr-0123456789ab"]), /--run-id names one run, and --repeat starts one run per repeat/);
  const one = await COMMANDS.run.run(h, ["CALC-001", "--seed=3"]);
  assert.deepEqual([one.outcome, one.runs, one.repeat, manifestOf(w, one.run).config.repeat], ["PASS", undefined, undefined, null], "no group, and the same answer as before");
});

test("--repeat with --suite repeats every case as a group of its own, and --like repeats an earlier run", async (t) => {
  const w = worldOf(t, FILES);
  const h = harnessOf(w, dockerDouble(NEVER));
  const s = await COMMANDS.run.run(h, ["--suite=fixture", "--repeat=2", "--seed=3"]);
  assert.deepEqual([s.runs.length, new Set(s.runs.map((x) => x.repeat.id)).size, s.exit], [2, 1, 0]);
  const again = await COMMANDS.run.run(h, [`--like=${s.runs[0].run}`, "--repeat=2"]);
  assert.deepEqual([again.runs.length, again.runs.every((x) => manifestOf(w, x.run).config.seed === 3)], [2, true], "the same case, seed and limits, again and again");
  assert.notEqual(again.repeat.group, s.runs[0].repeat.id, "a new group");
});
