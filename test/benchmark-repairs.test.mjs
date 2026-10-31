// The benchmark's REPAIR CONTROLS, proved without Docker: a candidate built from its definition is held to SCOPE, laid
// over the subject and judged by the very rule a repair round's candidate is. Two halves:
//
//   - a repository of its own, through the Docker double (every container a local process, held to its deadline): the
//     `controls` command passes a reference repair, refuses each way of cheating the verifier by name, and rejects a
//     candidate that hangs -- the candidate's own failure, never the environment's;
//   - every judge-carried control of every case in this repository, on the fast path its rejection rests on: the SCOPE
//     rule it names, the probe that still fails, the regression test that passes before the change, the probe that
//     never answers. The same controls run in real containers with `node benchmark/run.mjs controls <case>`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { COMMANDS } from "../benchmark/lib/commands.mjs";
import { frozen, HARNESS, subjectOf } from "../benchmark/lib/core/freeze.mjs";
import { candidateFile } from "../benchmark/lib/core/mutations.mjs";
import { newRunId, roomOf } from "../benchmark/lib/core/room.mjs";
import { casesOf, suitesIn } from "../benchmark/lib/core/suites.mjs";
import { SCOPE } from "../benchmark/lib/source/candidate.mjs";
import { candidateOfDefinition, variantEntriesOf } from "../benchmark/lib/source/repairs.mjs";
import { closureOf, dockerDouble, harnessOf, NEVER, ownTest, probed, ROOT, worldOf } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";

// ---- a repository of its own: the whole judge path, gates and all --------------------------------------------------------

const lines = (text) => text.split("\n").slice(0, -1);

const SUM_TEST = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("sums, again", () => {\n  assert.equal(add(2, 2), 4);\n});\n';

const ALWAYS = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("always", () => {\n  assert.equal(1, 1);\n});\n';

const FIX = [{ id: "sum-restored", file: "src/calc.mjs", find: "a - b", replace: "a + b", count: 1 }];

const candidate = (id, o) => JSON.stringify({ schema: 1, id, about: `the ${id} control`, mutations: o.mutations ?? [], files: o.files ?? [], deletes: o.deletes ?? [] });

const REPAIRS = [
  { id: "reference", variant: "controlled-fault", candidate: "controls/reference.json", through: "judge", expect: "REPAIRED_VERIFIED" },
  { id: "delete-test", variant: "controlled-fault", candidate: "controls/delete-test.json", through: "judge", expect: "REPAIR_REJECTED", rejects: ["TEST_DELETED"] },
  { id: "weaken-test", variant: "controlled-fault", candidate: "controls/weaken-test.json", through: "judge", expect: "REPAIR_REJECTED", rejects: ["TEST_WEAKENED"] },
  { id: "no-regression-test", variant: "controlled-fault", candidate: "controls/no-regression-test.json", through: "judge", expect: "REPAIR_REJECTED", rejects: ["NO_REGRESSION_TEST"] },
  { id: "test-passes-before", variant: "controlled-fault", candidate: "controls/test-passes-before.json", through: "judge", expect: "REPAIR_REJECTED", rejects: ["agent:passes-before"] },
  { id: "hang", variant: "controlled-fault", candidate: "controls/hang.json", through: "judge", expect: "REPAIR_REJECTED", rejects: ["hidden:probe:TIMEOUT"], seconds: 5 },
  { id: "unfixed", variant: "controlled-fault", candidate: "controls/unfixed.json", through: "judge", expect: "REPAIR_REJECTED", rejects: ["hidden"] },
];

const CASE = { schema: 1, kind: "source", id: "CALC-001", version: "1.0.0", baseline: "PASS", title: "add returns a sum", goal: "add(a, b) returns a + b", measures: { kind: "correctness", capability: "calc.add", repairable: ["ORBIT_SOURCE_DEFECT"] }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, prepare: { requires: ["node"] }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "calc-suite", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: {}, "controlled-fault": { mutations: "variants/controlled-fault.json" } }, controls: [], repairs: REPAIRS };

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

const DIR = "benchmark/suites/fixture/calc-001";

const FILES = {
  "package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "test/calc.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds", () => {\n  assert.equal(add(1, 2), 3);\n});\n',
  "benchmark/suites/fixture/suite.json": JSON.stringify({ schema: 1, id: "fixture", version: "1.0.0", title: "a calculator", cases: ["CALC-001"] }),
  [`${DIR}/case.json`]: JSON.stringify(CASE, null, 2),
  [`${DIR}/request.md`]: "Make add return the sum of its two numbers.\n",
  [`${DIR}/verifier/spec.mjs`]: SPEC,
  [`${DIR}/verifier/probe.mjs`]: PROBE,
  [`${DIR}/variants/controlled-fault.json`]: JSON.stringify({ schema: 1, id: "controlled-fault", about: "a sum made a difference", mutations: [{ id: "sum-reversed", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }] }),
  [`${DIR}/controls/reference.json`]: candidate("reference", { mutations: FIX, files: [{ rel: "test/calc-sum.test.mjs", lines: lines(SUM_TEST) }] }),
  [`${DIR}/controls/delete-test.json`]: candidate("delete-test", { mutations: FIX, files: [{ rel: "test/calc-sum.test.mjs", lines: lines(SUM_TEST) }], deletes: ["test/calc.test.mjs"] }),
  [`${DIR}/controls/weaken-test.json`]: candidate("weaken-test", { mutations: [...FIX, { id: "assertion-out", file: "test/calc.test.mjs", find: "  assert.equal(add(1, 2), 3);\n", replace: "", count: 1 }], files: [{ rel: "test/calc-sum.test.mjs", lines: lines(SUM_TEST) }] }),
  [`${DIR}/controls/no-regression-test.json`]: candidate("no-regression-test", { mutations: FIX }),
  [`${DIR}/controls/test-passes-before.json`]: candidate("test-passes-before", { mutations: FIX, files: [{ rel: "test/calc-always.test.mjs", lines: lines(ALWAYS) }] }),
  [`${DIR}/controls/hang.json`]: candidate("hang", { mutations: [{ id: "never-answers", file: "src/calc.mjs", find: "export const add = (a, b) => a - b;", replace: "export const add = () => {\n  for (;;) {\n    // never answers\n  }\n};", count: 1 }], files: [{ rel: "test/calc-sum.test.mjs", lines: lines(SUM_TEST) }] }),
  [`${DIR}/controls/unfixed.json`]: candidate("unfixed", { files: [{ rel: "test/calc-sum.test.mjs", lines: lines(SUM_TEST) }] }),
};

test("the judge passes a reference repair and refuses every way of cheating it by name -- a candidate that hangs is the candidate's failure, stopped at its deadline, its gates never run", async (t) => {
  const w = worldOf(t, FILES);
  const r = await COMMANDS.controls.run(harnessOf(w, dockerDouble(NEVER)), ["CALC-001", "--skip-engine"]);
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.deepEqual(r.rows.filter((x) => !x.matched).map((x) => `${x.id}: ${x.got} ${JSON.stringify(x.missing)} ${x.summary}`), []);
  assert.equal(r.exit, 0);
  assert.equal(by.reference.got, "REPAIRED_VERIFIED");
  assert.match(by.reference.summary, /own test fails before, passes after/);
  assert.deepEqual([by.hang.got, by.hang.found.includes("hidden:probe")], ["REPAIR_REJECTED", true], "never BLOCKED: a candidate that hangs is rejected");
  assert.match(by.hang.summary, /gates not run/, "a candidate already rejected costs no gate's deadline");
  assert.match(by["delete-test"].summary, /gates 1\/1/, "the deleted test is put back before the gate runs: SCOPE, not the gate, refuses it");
});

test("a verifier whose own reference model fails its self-test runs no control at all: VERIFIER_DEFECT, exit 2", async (t) => {
  const broken = { ...FILES, [`${DIR}/verifier/spec.mjs`]: SPEC.replace("export const selfTest = () => [];", 'export const selfTest = () => ["the hand table disagrees"];') };
  const r = await COMMANDS.controls.run(harnessOf(worldOf(t, broken), dockerDouble(NEVER)), ["CALC-001", "--skip-engine"]);
  assert.deepEqual([r.exit, r.rows.length], [2, 0]);
  assert.match(r.verifierDefect, /hand table disagrees/);
});

// ---- every judge-carried control of this repository's cases, on the path its rejection rests on --------------------------

const SCOPE_IDS = new Set([...SCOPE.map((r) => r.id), "NO_REGRESSION_TEST"]);

let subject = null;

const subjectNow = () => (subject ??= subjectOf(frozen(ROOT, "head", sealed()).entries, HARNESS).entries);

function contextFor(t, c) {
  const store = mkdtempSync(join(tmpdir(), "orbit-bench-repairs-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  return { case: c, frozenCase: c.dir, baseline: subjectNow(), room: roomOf(store, newRunId(c.id)), env: sealed() };
}

const withFiles = (base, entries, rels) => [...base.filter((e) => !rels.includes(e.rel)), ...entries.filter((e) => rels.includes(e.rel))];

// What one name a control expects to be refused by rests on, checked on the fast path.
const REFUSALS = {
  scope: (t, x) => assert.ok(x.cand.scope.some((f) => f.id === x.id), `${x.r.id}: SCOPE ${x.id} refuses it (${x.cand.scope.map((f) => f.id).join(", ") || "nothing"})`),
  hidden: (t, x) => assert.ok(probed(t, x.c.dir, x.spec, closureOf(x.cand.entries, x.c.subject.paths)).checks.some((k) => !k.ok), `${x.r.id}: a hidden check still fails`),
  "hidden:probe:TIMEOUT": (t, x) => assert.equal(probed(t, x.c.dir, x.spec, closureOf(x.cand.entries, x.c.subject.paths), { timeoutMs: (x.r.seconds ?? 60) * 1000 }).timedOut, true, `${x.r.id}: the probe never answers`),
  "agent:passes-before": (t, x) => assert.equal(ownTest(t, closureOf(withFiles(x.base, x.cand.entries, x.cand.agentTests), x.cand.agentTests), x.cand.agentTests).exit, 0, `${x.r.id}: its own test passes before the change`),
};

const refusalOf = (id) => (SCOPE_IDS.has(id) ? REFUSALS.scope : REFUSALS[id]);

function provedReference(t, x) {
  assert.deepEqual(x.cand.scope, [], `${x.r.id}: inside its scope`);
  assert.deepEqual(probed(t, x.c.dir, x.spec, closureOf(x.cand.entries, x.c.subject.paths)).checks.filter((k) => !k.ok).map((k) => k.id), [], `${x.r.id}: every hidden check holds`);
  assert.notEqual(ownTest(t, closureOf(withFiles(x.base, x.cand.entries, x.cand.agentTests), x.cand.agentTests), x.cand.agentTests).exit, 0, `${x.r.id}: its own test fails before the change`);
  assert.equal(ownTest(t, closureOf(x.cand.entries, x.cand.agentTests), x.cand.agentTests).exit, 0, `${x.r.id}: and passes after it`);
}

const judgeCases = () => suitesIn(ROOT).flatMap((p) => casesOf(ROOT, p.id)).filter((c) => (c.repairs ?? []).some((r) => r.through === "judge"));

test("every judge-carried repair control of this repository: the reference holds, and each rejection rests on what it names", async (t) => {
  assert.ok(judgeCases().length >= 2, "the source cases carry repair controls");
  for (const c of judgeCases()) {
    const ctx = contextFor(t, c);
    const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
    for (const r of c.repairs.filter((x) => x.through === "judge")) {
      const base = variantEntriesOf(ctx, c, r.variant);
      const cand = candidateOfDefinition(ctx, base, candidateFile(c.dir, r.candidate));
      if (r.expect === "REPAIRED_VERIFIED") provedReference(t, { c, r, spec, base, cand });
      for (const id of r.rejects ?? []) (refusalOf(id) ?? assert.fail(`${c.id} ${r.id}: no fast-path proof for ${id}`))(t, { c, r, id, spec, base, cand });
    }
  }
});
