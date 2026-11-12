// What a failure is about, and the identity two runs of one failure share. A signature must not
// move for what changes between two runs of the SAME failure, and must move for a different one; a
// class is chosen from demonstrable facts and never changes a failure into a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLASSES, classify, excerptOf, signatureOf } from "../src/orchestration/failure.mjs";
import { noProgress, PROGRESS } from "../src/orchestration/progress.mjs";

const ROOT = "/Users/dev/.orbit/projects/repo-1/workspaces/tsk-0123456789ab/tree";

const run = (lines, extra = {}) => ({ purpose: "test", command: "rt-command-0000a7e5", lines, status: 1, ...extra });

test("the same failure signs the same across timestamps, paths, ids, durations and line order", () => {
  const a = run(["2026-10-07T10:00:01Z FAIL RefundTests.rejects_amount_over_paid (12 ms)", `    at Object.<anonymous> (${ROOT}/src/refund.test.js:14:5)`, "Expected: false  Received: true", "Tests: 1 failed, 9 passed"]);
  const b = run(["Tests: 1 failed, 9 passed", "Expected: false  Received: true", "2026-10-07T11:42:59Z FAIL RefundTests.rejects_amount_over_paid (31 ms)", "    at Object.<anonymous> (/tmp/other-place/tree/src/refund.test.js:14:5)"]);
  assert.equal(signatureOf(a, ROOT), signatureOf(b, "/tmp/other-place/tree"));
  assert.match(signatureOf(a, ROOT), /^[a-f0-9]{12}$/);
});

test("a random id or a hash in a failing line does not move it either", () => {
  const a = run(["Error: request 3f9a1c0b7e21aa failed for order 550e8400-e29b-41d4-a716-446655440000"]);
  const b = run(["Error: request 9c0d1e2f3a4b5c failed for order 123e4567-e89b-12d3-a456-426614174000"]);
  assert.equal(signatureOf(a), signatureOf(b));
});

test("a different failing test, a different command, a different purpose or a timeout signs differently", () => {
  const base = run(["FAIL RefundTests.rejects_amount_over_paid"]);
  assert.notEqual(signatureOf(base), signatureOf(run(["FAIL RefundTests.accepts_amount_within_paid"])));
  assert.notEqual(signatureOf(base), signatureOf({ ...base, command: "rt-command-0000a7e6" }));
  assert.notEqual(signatureOf(base), signatureOf({ ...base, purpose: "build" }));
  assert.notEqual(signatureOf(base), signatureOf({ ...base, timedOut: true }));
});

test("output with no failing line signs by its exit, so it is still deterministic", () => {
  assert.equal(signatureOf(run(["all good, then something went wrong"], { status: 3 })), signatureOf(run(["entirely different noise"], { status: 3 })));
  assert.notEqual(signatureOf(run(["x"], { status: 3 })), signatureOf(run(["x"], { status: 4 })));
});

test("an excerpt is the failing lines first, then the end, scrubbed and with the workspace's path replaced -- never the whole log", () => {
  const lines = [...Array.from({ length: 200 }, (_, i) => `line ${i}`), `FAIL x at ${ROOT}/a.js`, "Authorization: Bearer abc.def.ghi", "API_TOKEN=s3cr3t-value"];
  const out = excerptOf({ lines }, ROOT);
  assert.ok(out.length <= 40);
  assert.equal(out[0], "FAIL x at <workspace>/a.js");
  assert.ok(out.every((l) => !l.includes("s3cr3t-value") && !l.includes("abc.def.ghi")), out.join("\n"));
  assert.ok(!out.join("\n").includes(ROOT));
});

// ---- the classes ----------------------------------------------------------------------------------

const facts = (extra) => ({ purpose: "test", started: true, timedOut: false, changed: true, signature: "aaaaaaaaaaaa", baseline: null, ...extra });

test("each class is reached from facts, and only a passing baseline earns `high` for the change", () => {
  const cases = [
    [{ started: false, restore: { ok: false, status: 1 } }, "DEPENDENCY", "high"],
    [{ unreachable: [{ target: "db", label: "orders db" }] }, "ACCESS", "high"],
    [{ restore: { ok: false, status: 1 }, baseline: { state: "succeeded", signature: null } }, "DEPENDENCY", "low"],
    [{ started: false }, "ENVIRONMENT", "high"],
    [{ baseline: { state: "failed", signature: "aaaaaaaaaaaa" } }, "ENVIRONMENT", "low"],
    [{ purpose: "build", baseline: { state: "succeeded", signature: null } }, "CODE", "high"],
    [{ baseline: { state: "succeeded", signature: null } }, "TEST", "high"],
    [{ status: 127 }, "ENVIRONMENT", "low"],
    [{ timedOut: true }, "ENVIRONMENT", "low"],
    [{ timedOut: true, baseline: { state: "succeeded", signature: null } }, "TEST", "high"],
    [{ purpose: "build" }, "CODE", "low"],
    [{}, "TEST", "low"],
    [{ purpose: "run" }, "CODE", "low"],
    [{ purpose: "review", unexpected: 2 }, "SCOPE", "high"],
    [{ purpose: "review", missing: 1 }, "CAPABILITY", "high"],
    [{ changed: false }, "UNKNOWN", "low"],
    [{ purpose: "run", changed: false }, "UNKNOWN", "low"],
  ];
  for (const [given, cls, confidence] of cases) assert.deepEqual([classify(facts(given)).class, classify(facts(given)).confidence], [cls, confidence], JSON.stringify(given));
  const reached = new Set(cases.map(([given]) => CLASSES.findIndex((c) => c.when(facts(given)))));
  assert.equal(reached.size, CLASSES.length, "every row is reachable");
});

// 0.6.0, P4: what stopped a check is told from FACTS -- the Process port's code, the shell's own exit statuses, the
// workspace's restore receipt and a fresh reach answer -- never from what the output says.
test("DEPENDENCY is a restore that ran and failed: high when what the check runs then could not be run, low otherwise", () => {
  const failedRestore = { ok: false, status: 1 };
  for (const unrunnable of [{ started: false, spawnCode: "ENOENT" }, { status: 127 }, { status: 126 }]) {
    const got = classify(facts({ ...unrunnable, restore: failedRestore }));
    assert.deepEqual([got.class, got.confidence], ["DEPENDENCY", "high"], JSON.stringify(unrunnable));
    assert.match(got.because, /restoring its dependencies in this workspace failed \(exit 1\)/);
  }
  assert.deepEqual(["class", "confidence"].map((k) => classify(facts({ status: 1, restore: failedRestore }))[k]), ["DEPENDENCY", "low"]);
  for (const restore of [null, undefined, { ok: true, status: 0 }]) assert.notEqual(classify(facts({ started: false, restore })).class, "DEPENDENCY", "a restore that passed, or none at all, says nothing about dependencies");
});

test("ACCESS is a target the component requires that a fresh check could not reach -- only for a check that ran", () => {
  const unreachable = [{ target: "orders-db", label: "orders database" }];
  const got = classify(facts({ unreachable }));
  assert.deepEqual([got.class, got.confidence], ["ACCESS", "high"]);
  assert.match(got.because, /orders database/);
  assert.equal(classify(facts({ started: false, unreachable })).class, "ENVIRONMENT", "a check that never started is about its start, not the network");
  assert.equal(classify(facts({ unreachable: [] })).class, "TEST");
});

test("a check that could not start says why by the OS's code, and the shell's 126/127 is the machine's -- unless a passing baseline names the change", () => {
  assert.match(classify(facts({ started: false, spawnCode: "ENOENT" })).because, /ENOENT: no such program here/);
  assert.match(classify(facts({ started: false, spawnCode: "EACCES" })).because, /EACCES: it is here, but not executable/);
  assert.equal(classify(facts({ started: false, spawnCode: "EWHATEVER" })).because, "it could not be started here", "a code with no words of its own is not guessed at");
  assert.deepEqual(["class", "confidence"].map((k) => classify(facts({ status: 126 }))[k]), ["ENVIRONMENT", "low"]);
  assert.equal(classify(facts({ status: 127, baseline: { state: "succeeded", signature: null } })).class, "TEST", "it passed before the change: the change is what moved");
});

test("an output that SAYS a dependency is missing, access was denied or a host refused is still not a class without the fact", () => {
  const said = ["Error: Cannot find module 'left-pad'", "permission denied", "EACCES: permission denied, open '/x'", "connect ECONNREFUSED 10.0.0.5:5432", "getaddrinfo ENOTFOUND db.internal", "npm ERR! missing dependency", "sh: 1: jest: not found"];
  for (const line of said) {
    const got = classify(facts({ lines: [line], error: line, reason: line, status: 1 }));
    assert.ok(!["DEPENDENCY", "ACCESS"].includes(got.class), `${line} -> ${got.class}`);
    assert.equal(got.class, "TEST", line);
  }
});

test("an application that stopped by itself is CODE only when the code changed, and never more than low -- nothing shows how it ran before", () => {
  assert.deepEqual([classify(facts({ purpose: "run" })).class, classify(facts({ purpose: "run" })).confidence], ["CODE", "low"]);
  assert.match(classify(facts({ purpose: "run" })).because, /started from the changed code and stopped by itself/);
  assert.equal(classify(facts({ purpose: "run", changed: false })).class, "UNKNOWN");
  assert.equal(classify(facts({ purpose: "run", started: false })).class, "ENVIRONMENT");
});

test("a failure that failed differently before the change says so, and stays low", () => {
  const got = classify(facts({ baseline: { state: "failed", signature: "bbbbbbbbbbbb" } }));
  assert.deepEqual([got.class, got.confidence], ["TEST", "low"]);
  assert.match(got.because, /failed differently before/);
});

// ---- no progress ----------------------------------------------------------------------------------

const lwWith = (repeats, sig = "aaaaaaaaaaaa") => ({ view: { repeats, attempts: [{ endedAt: "x", failureSignature: sig }] } });

test("NO_PROGRESS is three attempts in a row on one signature -- two is not, and the signature is named", () => {
  assert.equal(noProgress(lwWith(2)), null);
  assert.equal(noProgress(lwWith(3)).id, "SAME_FAILURE");
  assert.match(noProgress(lwWith(3)).because, /3 attempts .* aaaaaaaaaaaa/);
  assert.equal(PROGRESS.length, 1);
});
