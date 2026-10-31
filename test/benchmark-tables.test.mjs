// The Docker benchmark's tables, each row on its own: the SCOPE a candidate is held to before anything of it runs (a
// repair that touches the harness, a check, an existing test, or brings a process into the source is refused by
// name), the CAUSES a baseline is diagnosed by, the NEXT step after a round, what a host's output says, what the egress
// proxy lets through, and the judge.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addedLines, agentTestsOf, changesOf, importsOf, onlyAdded, overlaid, scopeFindings } from "../benchmark/lib/candidate.mjs";
import { CAUSES, causeOf } from "../benchmark/lib/classify.mjs";
import { NEXT, nextOf, signatureOf } from "../benchmark/lib/decide.mjs";
import { FIXTURE_DRIFT, mutatedEntries } from "../benchmark/lib/faults.mjs";
import { hostEnd, hostOf } from "../benchmark/lib/host.mjs";
import { answersOf, judgedAnswer, says } from "../benchmark/lib/judge.mjs";
import { globRe, matchesAny, safeRel } from "../benchmark/lib/paths.mjs";
import { allowedTarget } from "../benchmark/images/verifier/egress.mjs";

// ---- scope: what a repair may change ---------------------------------------------------------------------------------

const ALLOW = ["src/improvement/oracle.mjs", "src/improvement/safety.mjs", "test/*.test.mjs"];

const ctxOf = (texts) => ({ allow: ALLOW, deny: [], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" }, textOf: (rel, side) => texts[`${side}:${rel}`] ?? null });

const change = (rel, kind = "modified", extra = {}) => ({ rel, change: kind, kind: "file", size: 10, ...extra });

const ids = (changes, texts) => scopeFindings(changes, ctxOf(texts)).map((f) => f.id);

const OLD_TEST = 'import { test } from "node:test";\ntest("a", () => {\n  assert.equal(1, 1);\n});\n';

const ORACLE = 'import { sha } from "../hash.mjs";\nexport const x = 1;\n';

test("a repair in scope, with a test of its own, raises nothing", () => {
  const texts = { "before:src/improvement/oracle.mjs": ORACLE, "after:src/improvement/oracle.mjs": ORACLE.replace("1", "2"), "after:test/oracle-regression.test.mjs": OLD_TEST };
  assert.deepEqual(ids([change("src/improvement/oracle.mjs"), change("test/oracle-regression.test.mjs", "added")], texts), []);
});

test("each way a candidate makes its own grading easier is refused by name", () => {
  const cases = [
    [[change("benchmark/packs/orbit-source/ORBIT-SRC-001/hidden/spec.mjs", "added")], { "after:benchmark/packs/orbit-source/ORBIT-SRC-001/hidden/spec.mjs": "x" }, "BENCHMARK_TOUCHED"],
    [[change("package.json")], { "before:package.json": "{}", "after:package.json": '{"scripts":{"test":"true"}}' }, "CHECK_TAMPERED"],
    [[change("cli/check-five-lines.mjs")], { "before:cli/check-five-lines.mjs": "a", "after:cli/check-five-lines.mjs": "b" }, "CHECK_TAMPERED"],
    [[change("src/run/status.mjs")], { "before:src/run/status.mjs": "a", "after:src/run/status.mjs": "b" }, "OUT_OF_SCOPE"],
    [[change("test/improvement-core.test.mjs", "deleted")], {}, "TEST_DELETED"],
    [[change("test/improvement-core.test.mjs")], { "before:test/improvement-core.test.mjs": OLD_TEST, "after:test/improvement-core.test.mjs": OLD_TEST.replace("assert.equal(1, 1);", "assert.ok(true);") }, "TEST_WEAKENED"],
    [[change("test/new.test.mjs", "added")], { "after:test/new.test.mjs": 'test.skip("x", () => {});\n' }, "TEST_SKIPPED"],
    [[change("test/new.test.mjs", "added")], { "after:test/new.test.mjs": 'test("x", { skip: true }, () => {});\n' }, "TEST_SKIPPED"],
    [[change("src/improvement/oracle.mjs")], { "before:src/improvement/oracle.mjs": ORACLE, "after:src/improvement/oracle.mjs": `${ORACLE}process.exitCode = 0;\n` }, "UNSAFE_CODE"],
    [[change("src/improvement/oracle.mjs")], { "before:src/improvement/oracle.mjs": ORACLE, "after:src/improvement/oracle.mjs": `${ORACLE}globalThis.x = 1;\n` }, "UNSAFE_CODE"],
    [[change("src/improvement/oracle.mjs")], { "before:src/improvement/oracle.mjs": ORACLE, "after:src/improvement/oracle.mjs": `import assert from "node:assert";\n${ORACLE}` }, "NEW_IMPORT"],
    [[change("src/improvement/oracle.mjs", "modified", { kind: "link" })], {}, "NOT_REGULAR"],
    [[change("../outside.mjs", "added")], { "after:../outside.mjs": "x" }, "UNSAFE_PATH"],
  ];
  for (const [changes, texts, id] of cases) assert.ok(ids(changes, texts).includes(id), `${id} for ${changes[0].rel}: got ${ids(changes, texts).join(", ")}`);
});

test("an existing test may only gain lines, a source change with no test of its own is not a repair", () => {
  assert.equal(onlyAdded(OLD_TEST, OLD_TEST.replace("});\n", '});\ntest("b", () => {});\n')), true);
  assert.equal(onlyAdded(OLD_TEST, 'import { test } from "node:test";\n'), false);
  assert.deepEqual(addedLines("a\nb\n", "a\nb\nc\nb\n"), ["c", "b"]);
  assert.deepEqual(ids([change("src/improvement/oracle.mjs")], { "before:src/improvement/oracle.mjs": ORACLE, "after:src/improvement/oracle.mjs": ORACLE.replace("1", "3") }), ["NO_REGRESSION_TEST"]);
  assert.deepEqual([...importsOf('import a from "x";\nexport { b } from "y";\nimport "z";\n')].sort(), ["x", "y", "z"]);
});

test("the changes are a diff of two file lists, and the candidate is the subject with them laid over it", () => {
  const base = [{ rel: "a", mode: "file", digest: "1", bytes: Buffer.from("a") }, { rel: "b", mode: "file", digest: "2", bytes: Buffer.from("b") }];
  const ws = [{ rel: "a", kind: "file", digest: "9", size: 1 }, { rel: "c", kind: "file", digest: "3", size: 1 }];
  const changes = changesOf(base, ws);
  assert.deepEqual(changes.map((c) => [c.rel, c.change]), [["a", "modified"], ["b", "deleted"], ["c", "added"]]);
  assert.deepEqual(overlaid(base, changes, (rel) => Buffer.from(`new ${rel}`)).map((e) => [e.rel, e.bytes.toString()]).sort(), [["a", "new a"], ["c", "new c"]]);
  assert.deepEqual(agentTestsOf([change("test/x.test.mjs", "added"), change("test/fixtures/y.json", "added")], "^test/[^/]+\\.test\\.mjs$"), ["test/x.test.mjs"]);
});

// ---- causes and the next step ---------------------------------------------------------------------------------------

const run = (over = {}) => ({ complete: true, signature: "aaaaaaaaaaaa", failures: [], hiddenFailed: 0, gatesFailed: 0, missingExports: [], probeBroken: false, ...over });

test("a cause is the first row its facts match, the last row always matches, and only a declared cause is repairable", () => {
  const f = (over) => causeOf({ benchmark: null, environment: null, credentials: null, provider: null, budget: null, runs: [run(), run()], repairable: ["ORBIT_SOURCE_DEFECT"], ...over });
  assert.equal(f({}).id, "PASS");
  assert.equal(f({ runs: [run({ hiddenFailed: 3, failures: ["x"] }), run({ hiddenFailed: 3, failures: ["x"] })] }).id, "ORBIT_SOURCE_DEFECT");
  assert.equal(f({ runs: [run({ hiddenFailed: 3, failures: ["x"] }), run({ hiddenFailed: 3, failures: ["x"] })] }).repairable, true);
  assert.equal(f({ runs: [run({ signature: "a" }), run({ signature: "b" })] }).id, "INSUFFICIENT_EVIDENCE", "a baseline that disagrees with itself is not stable enough to repair on");
  assert.equal(f({ benchmark: { says: "drift" }, runs: [run({ hiddenFailed: 1 })] }).id, "BENCHMARK_INVALID");
  assert.equal(f({ environment: { says: "oom" } }).repairable, false);
  assert.equal(f({ runs: [run({ gatesFailed: 1, failures: ["gate:x"] }), run({ gatesFailed: 1, failures: ["gate:x"] })] }).id, "GATE_UNEXPLAINED");
  assert.equal(f({ runs: [run({ missingExports: ["a#b"], failures: ["x"] }), run({ missingExports: ["a#b"], failures: ["x"] })] }).id, "CAPABILITY_MISSING");
  assert.equal(CAUSES.at(-1).when({}), true);
});

const round = (over = {}) => ({ frozenIntact: true, roundError: null, verified: false, changed: true, engineering: { lifecycle: "EXECUTING", terminal: false, stopReason: null }, signature: "bbbbbbbbbbbb", previous: ["aaaaaaaaaaaa"], left: { rounds: 1, minutes: 60, usd: 5 }, scope: [], ...over });

test("after a round: verified completes, a repeat is NO_PROGRESS, a spent budget stops, and nothing starts a second task", () => {
  assert.deepEqual([nextOf(round({ verified: true })).id, nextOf(round({ verified: true })).end], ["VERIFIED", "complete"]);
  assert.deepEqual([nextOf(round({ signature: "aaaaaaaaaaaa" })).id, nextOf(round({ signature: "aaaaaaaaaaaa" })).stop], ["NO_PROGRESS", "NO_PROGRESS"]);
  assert.equal(nextOf(round({ left: { rounds: 0, minutes: 60, usd: 5 } })).stop, "BUDGET_EXHAUSTED");
  assert.equal(nextOf(round({ roundError: { cause: "PROVIDER", says: "x" } })).end, "block");
  assert.equal(nextOf(round({ frozenIntact: false, verified: true })).outcome, "BENCHMARK_INVALID", "a benchmark that moved is never graded");
  assert.equal(nextOf(round({ engineering: { lifecycle: "COMPLETED", terminal: true }, scope: [{ id: "TEST_WEAKENED" }] })).stop, "UNSAFE_CHANGE");
  assert.equal(nextOf(round({ engineering: { lifecycle: "FAILED", terminal: true, stopReason: "NO_PROGRESS" } })).stop, "NO_PROGRESS");
  assert.equal(nextOf(round()).id, "CONTINUE");
  assert.ok(NEXT.every((r) => !/start|second|raise/i.test(r.id)));
  assert.match(signatureOf(["b", "a", "a"]), /^[a-f0-9]{12}$/);
  assert.equal(signatureOf(["b", "a"]), signatureOf(["a", "b"]));
});

// ---- what the host said ---------------------------------------------------------------------------------------------

// Lines in the shape Claude Code 2.1.314 printed in this harness's own run with an invalid key (hooks, init, the result).
const INVALID_KEY = [{ type: "system", subtype: "hook_started" }, { type: "system", subtype: "init", model: "model-under-test", session_id: "s-1" }, { type: "assistant", message: { content: [{ type: "text", text: "x" }] } }, { type: "result", subtype: "success", is_error: true, result: "Invalid API key · Fix external API key", num_turns: 1, total_cost_usd: 0 }].map((e) => JSON.stringify(e)).join("\n");

test("a host's own output is read for what it reports, and what it does not report is unknown", () => {
  const h = hostOf(INVALID_KEY);
  assert.deepEqual([h.started, h.model, h.isError, h.toolCalls, h.basis], [true, "model-under-test", true, 0, "REPORTED"]);
  assert.equal(hostEnd(h, { exit: 1 }).cause, "PROVIDER");
  assert.match(hostEnd(h, { exit: 1 }).says, /Invalid API key/);
  const empty = hostOf("not json\n");
  assert.deepEqual([empty.started, empty.costUsd, empty.turns, empty.tokens.input], [false, null, null, null]);
  assert.equal(hostEnd(empty, { exit: 127 }).cause, "PROVIDER");
  assert.equal(hostEnd(hostOf(INVALID_KEY), { timedOut: true }), null, "a deadline ends a round; it is not the provider's");
  const tools = hostOf([{ type: "system", subtype: "init", model: "m" }, { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }, { type: "tool_use", name: "Edit" }, { type: "tool_use", name: "Bash" }] } }].map((e) => JSON.stringify(e)).join("\n"));
  assert.deepEqual([tools.toolCalls, tools.tools.Bash, tools.tools.Edit], [3, 2, 1]);
});

// ---- egress, paths and the judge --------------------------------------------------------------------------------------

test("the egress proxy lets through only the hosts it was given, on 443, by name", () => {
  const hosts = ["api.anthropic.com"];
  assert.equal(allowedTarget("api.anthropic.com:443", hosts).ok, true);
  assert.equal(allowedTarget("API.Anthropic.com.:443", hosts).ok, true);
  for (const bad of ["api.anthropic.com:80", "github.com:443", "1.2.3.4:443", "api.anthropic.com.evil.com:443", "api.anthropic.com", ":443", "x y:443"]) assert.equal(allowedTarget(bad, hosts).ok, false, bad);
});

test("a glob says what a path is, and a safe path stays inside", () => {
  assert.ok(matchesAny(["benchmark/**"], "benchmark/packs/x/case.json"));
  assert.ok(matchesAny(["test/benchmark-*.test.mjs"], "test/benchmark-cases.test.mjs"));
  assert.ok(!matchesAny(["test/benchmark-*.test.mjs"], "test/autonomous-qa-benchmark.test.mjs"));
  assert.ok(globRe("test/*.test.mjs").test("test/a.test.mjs") && !globRe("test/*.test.mjs").test("test/sub/a.test.mjs"));
  for (const bad of ["../x", "/abs", "a//b", "a\\b", "C:/x", "a\u0000b"]) assert.equal(safeRel(bad), false, bad);
});

test("the judge holds an answer to its expectation, and reads only the probe's own line", () => {
  assert.equal(judgedAnswer({ expect: { has: ["A"] } }, { got: ["A", "B"] }).ok, true);
  assert.equal(judgedAnswer({ expect: { exactly: [] } }, { got: ["A"] }).ok, false);
  assert.equal(judgedAnswer({ expect: { lacks: ["A"] } }, { got: ["A"] }).ok, false);
  assert.equal(judgedAnswer({ expect: { has: ["A"] } }, { threw: "boom" }).ok, false);
  assert.equal(judgedAnswer({ expect: { has: ["A"] } }, undefined).ok, false);
  assert.equal(judgedAnswer({ expect: { exactly: [] } }, { got: "nothing" }).ok, false);
  assert.match(says({ has: ["A"], lacks: ["B"] }), /includes A; never B/);
  assert.equal(answersOf('noise\n{"answers":[{"id":"x","got":[]}]}\n').answers[0].id, "x");
  assert.equal(answersOf("ALL CHECKS PASSED\n").error.code, "PROBE_UNREADABLE", "a sentence claiming a pass is not an answer");
});

test("a planted fault is exact: found as many times as it says, or nothing is applied and the answer is FIXTURE_DRIFT", () => {
  const entries = [{ rel: "src/x.mjs", mode: "file", bytes: Buffer.from("a >= b; a >= b;\n"), digest: "d" }];
  const doc = (count, find = "a >= b") => ({ mutations: [{ id: "flip", file: "src/x.mjs", find, replace: "a < b", count }] });
  const ok = mutatedEntries(entries, doc(2));
  assert.deepEqual([ok.ok, ok.entries[0].bytes.toString(), ok.applied], [true, "a < b; a < b;\n", ["flip"]]);
  assert.equal(entries[0].bytes.toString(), "a >= b; a >= b;\n", "applied to a copy, never to what it was handed");
  for (const [d, found] of [[doc(1), 2], [doc(1, "a > b"), 0], [{ mutations: [{ id: "gone", file: "src/y.mjs", find: "x", replace: "y", count: 1 }] }, 0]]) {
    const r = mutatedEntries(entries, d);
    assert.deepEqual([r.ok, r.code, r.drift.found, r.entries], [false, FIXTURE_DRIFT, found, undefined]);
  }
});
