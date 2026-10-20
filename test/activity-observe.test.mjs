// What a running check is observed doing (1.8.5, ADR 0020), below the check runner: the text a child printed made
// safe (bytes split before decoding, a line bounded by bytes, escape sequences and secrets gone -- a secret cut by a
// chunk boundary included), the adapters read from REAL captured output (Node 22's TAP; .NET 10's VSTest under xUnit
// and MSTest, and Microsoft.Testing.Platform), the one fold every reader shares, and the observation's own rules: an
// adapter claimed or sniffed, a budget that drops case events first and always writes the end, a sink that fails
// without failing the run, and never a total nobody said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS, CAPABILITY_MATRIX } from "../skills/orbit-engineer/observers/index.mjs";
import { DOTNET_TEST, dotnetParser } from "../skills/orbit-engineer/observers/dotnet-test.mjs";
import { emptyObservation, foldObservation, observationView, summaryOf } from "../src/orchestration/activity/fold.mjs";
import { GENERIC } from "../src/orchestration/activity/generic.mjs";
import { createObservation } from "../src/orchestration/activity/observe.mjs";
import { ACTIVITY_SOURCE, activityFile, activityLine } from "../src/orchestration/activity/source.mjs";
import { TAP, tapParser } from "../src/orchestration/activity/tap.mjs";
import { cleaned, createSplitter, plain } from "../src/orchestration/activity/text.mjs";
import { KINDS, LIMITS } from "../src/orchestration/activity/vocab.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => readFileSync(join(ROOT, "test", "fixtures", "activity", name));

// Every line a parser sees: split as the observation splits, made plain as it does.
function parsedWith(parser, bytes, chunk = 4096) {
  const sp = createSplitter(LIMITS.LINE_BYTES);
  const lines = [];
  for (let i = 0; i < bytes.length; i += chunk) lines.push(...sp.push(bytes.subarray(i, i + chunk)));
  return [...[...lines, ...sp.end()].flatMap((l) => parser.line(plain(l), "out")), ...parser.end()];
}

// ---- the text ----------------------------------------------------------------------------------------------------

test("bytes are split before decoding: a character a chunk cut in two is whole, and CRLF is a line end", () => {
  const sp = createSplitter(64);
  const text = Buffer.from("ok 1 - café ✓\r\nnext");
  const cut = text.indexOf(Buffer.from("é")) + 1;
  assert.deepEqual([...sp.push(text.subarray(0, cut)), ...sp.push(text.subarray(cut)), ...sp.end()], ["ok 1 - café ✓", "next"]);
});

test("a line is bounded by BYTES, cut at a character's start, and the rest of it dropped up to its end", () => {
  const sp = createSplitter(10);
  const out = [...sp.push(Buffer.from("ééééééé")), ...sp.push(Buffer.from("éééé\nafter\n"))];
  assert.equal(out[0], "ééééé…", "five two-byte characters fit in ten bytes; never half of one");
  assert.deepEqual(out.slice(1), ["after"]);
  const huge = createSplitter(LIMITS.LINE_BYTES);
  const many = [];
  for (let i = 0; i < 50; i++) many.push(...huge.push(Buffer.alloc(64 * 1024, 0x41)));
  assert.equal(many.length, 1, "a child writing megabytes with no newline: one cut line, nothing held without bound");
  assert.ok(Buffer.byteLength(many[0]) <= LIMITS.LINE_BYTES + 3);
});

test("escape sequences go whole, a carriage return cannot overwrite what it follows, and a secret cut by a chunk is still masked", () => {
  assert.equal(plain("\u001b[31mnot ok\u001b[0m 1 \u001b]0;title\u0007- x\u001b]8;;http://e.x\u001b\\link"), "not ok 1 - xlink");
  assert.equal(plain("progress 50%\rFAILED: real failure"), "progress 50%FAILED: real failure", "both halves stay readable");
  assert.equal(plain("\u202eevil\u2066"), "evil");
  const sp = createSplitter(LIMITS.LINE_BYTES);
  const lines = [...sp.push(Buffer.from("Error: password=hun")), ...sp.push(Buffer.from("ter2 in config\n"))];
  assert.equal(cleaned(lines[0], 200), "Error: password [redacted] in config");
  assert.equal(cleaned("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh", 200), "token [token]");
  assert.equal([...cleaned("é".repeat(500), 10)].length, 11, "bounded in code points, then marked");
});

// ---- TAP, from Node 22's own output -------------------------------------------------------------------------------

const NODE22 = `TAP version 13
# Subtest: suite one
    # Subtest: passes
    ok 1 - passes
      ---
      duration_ms: 0.449
      type: 'test'
      ...
    # Subtest: fails
    not ok 2 - fails
      ---
      duration_ms: 0.799
      type: 'test'
      location: '/w/c.test.mjs:5:3'
      failureType: 'testCodeFailure'
      error: '1 == 2'
      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      expected: 2
      actual: 1
      operator: '=='
      stack: |-
        TestContext.<anonymous> (file:///w/c.test.mjs:5:32)
        Test.runInAsyncScope (node:async_hooks:214:14)
      ...
    # Subtest: skipped
    ok 3 - skipped # SKIP
      ---
      duration_ms: 0.176
      ...
    # Subtest: slow
    not ok 4 - slow
      ---
      failureType: 'testTimeoutFailure'
      error: 'test timed out after 100ms'
      ...
    1..4
not ok 1 - suite one
  ---
  type: 'suite'
  failureType: 'subtestsFailed'
  error: '2 subtests failed'
  ...
# Subtest: suite two
    # Subtest: passes
    ok 1 - passes
      ---
      duration_ms: 0.094
      ...
    1..1
ok 2 - suite two
  ---
  type: 'suite'
  ...
# Subtest: top level
ok 3 - top level
  ---
  duration_ms: 0.127
  ...
1..3
# tests 6
# suites 2
# pass 3
# fail 2
# cancelled 0
# skipped 1
# todo 0
# duration_ms 12.5
`;

test("TAP: only leaves are cases, two tests with one name in two suites are two cases, and a suite is never counted", () => {
  const events = parsedWith(tapParser(), Buffer.from(NODE22), 7);
  const cases = events.filter((e) => e.kind === "case.reported");
  assert.deepEqual(cases.map((c) => [c.key, c.name, c.suite, c.state]), [["1.1", "passes", "suite one", "passed"], ["1.2", "fails", "suite one", "failed"], ["1.3", "skipped", "suite one", "skipped"], ["1.4", "slow", "suite one", "failed"], ["2.1", "passes", "suite two", "passed"], ["3", "top level", null, "passed"]]);
  assert.equal(cases[0].durationMs, 0.449);
  const failures = events.filter((e) => e.kind === "case.failure");
  assert.deepEqual(failures.map((f) => [f.name, f.category]), [["fails", "assertion"], ["slow", "timeout"]], "the suite that failed only because its children did is no failure of its own");
  assert.equal(failures[0].message, "1 == 2 · expected 2 · actual 1");
  assert.equal(failures[0].location, "/w/c.test.mjs:5:3");
  assert.equal(failures[0].stack.length, 2);
  assert.deepEqual(events.at(-1), { kind: "runner.summary", totals: { tests: 6, passed: 3, failed: 2, cancelled: 0, skipped: 1, todo: 0 }, scope: "TAP" });
});

test("TAP is recognised by its own first line; a script's preamble before it is not its", () => {
  assert.equal(TAP.sniff("TAP version 13"), true);
  assert.equal(TAP.sniff("> app@1.0.0 test"), false);
  const events = parsedWith(tapParser(), Buffer.from("> app@1.0.0 test\n> node --test\n\nok 1 - not yet TAP\nTAP version 13\nok 1 - real\n1..1\n"));
  assert.deepEqual(events.map((e) => e.name), ["real"]);
  assert.equal(TAP.claims({ argv: ["node", "--test"] }), false, "a protocol claims no command: its output proves it");
});

test("TAP: a cancelled case is a cancel, a TODO is a todo, and a hook's own failure is a failure with no case", () => {
  const text = "TAP version 13\n# Subtest: s\n    # Subtest: a\n    not ok 1 - a\n      ---\n      failureType: 'cancelledByParent'\n      ...\n    # Subtest: b\n    not ok 2 - b # TODO later\n    1..2\nnot ok 1 - s\n  ---\n  failureType: 'hookFailure'\n  error: 'before failed'\n  ...\n";
  const events = parsedWith(tapParser(), Buffer.from(text));
  assert.deepEqual(events.filter((e) => e.kind === "case.reported").map((e) => e.state), ["cancelled", "todo"]);
  assert.deepEqual(events.filter((e) => e.kind === "case.failure").map((e) => [e.name, e.message]), [["s", "before failed"]]);
});

// ---- .NET, from the platform's own console report -----------------------------------------------------------------

test(".NET VSTest (xUnit): the runner named by its own line, the failed and skipped cases with message, location and stack, the runner's totals", () => {
  const events = parsedWith(DOTNET_TEST.parser(), fixture("dotnet-vstest-xunit.txt"), 37);
  assert.equal(events[0].adapter.runner, "VSTest");
  const cases = events.filter((e) => e.kind === "case.reported");
  assert.deepEqual(cases.map((c) => [c.name, c.state]), [["XTests.FastFailing.A_Fails", "failed"], ["XTests.FastFailing.B_Skipped", "skipped"]], "passed cases are not printed at this verbosity, and none is invented");
  assert.equal(cases[0].key, "XTests.dll::XTests.FastFailing.A_Fails");
  const failure = events.find((e) => e.kind === "case.failure");
  assert.equal(failure.category, "assertion");
  assert.match(failure.message, /Assert\.Equal\(\) Failure: Strings differ/);
  assert.match(failure.location, /UnitTest1\.cs:6$/);
  assert.deepEqual(events.at(-1), { kind: "runner.summary", totals: { tests: 8, passed: 6, failed: 1, skipped: 1 }, scope: "XTests.dll (net10.0)" });
});

test(".NET VSTest (MSTest) and Microsoft.Testing.Platform: each runner read as itself; the location is the test's frame, not the framework's", () => {
  const vstest = parsedWith(dotnetParser(), fixture("dotnet-vstest-mstest.txt"));
  const mtp = parsedWith(dotnetParser(), fixture("dotnet-mtp-mstest.txt"));
  assert.deepEqual([vstest[0].adapter.runner, mtp[0].adapter.runner], ["VSTest", "Microsoft.Testing.Platform"]);
  for (const events of [vstest, mtp]) {
    assert.deepEqual(events.filter((e) => e.kind === "case.reported").map((c) => [c.name, c.state]).sort(), [["A_Fails", "failed"], ["B_Skipped", "skipped"]]);
    assert.match(events.find((e) => e.kind === "case.failure").location, /Test1\.cs:7$/);
    assert.deepEqual(events.find((e) => e.kind === "runner.summary").totals, { tests: 5, passed: 3, failed: 1, skipped: 1 });
  }
});

test(".NET VSTest that ABORTED before any case (a sandbox denied its socket): an environment's doing, said in the runner's own words -- never zero passed", () => {
  const events = parsedWith(dotnetParser(), fixture("dotnet-vstest-aborted-socket.txt"), 23);
  assert.deepEqual(events.map((e) => e.kind), ["activity.adapter", "runner.aborted"], "no case, no total: nothing ran");
  assert.deepEqual(events[1], { kind: "runner.aborted", why: "the test run aborted: System.Net.Sockets.SocketException (13): Permission denied", category: "environment" });
  let s = emptyObservation();
  const lines = [{ kind: "activity.started", command: { purpose: "test" } }, ...events, { kind: "activity.failed", outcome: { status: 1 } }];
  lines.forEach((e, seq) => (s = foldObservation(s, { v: 1, seq, gen: "g", at: "2026-10-15T00:00:00.000Z", ...e })));
  const view = observationView(s);
  assert.deepEqual([view.state, view.reported, view.total, view.aborted.category], ["failed", 0, null, "environment"]);
  assert.equal(summaryOf(view).aborted.why, events[1].why, "the check's record keeps it too");
  const inBlock = parsedWith(dotnetParser(), Buffer.from("Test run for /w/A.dll (.NETCoreApp,Version=v10.0)\n  Failed A.B [1 ms]\n  Error Message:\n   System.InvalidOperationException: boom\n  Stack Trace:\n     at A.B() in /w/A.cs:line 3\n\nFailed!  - Failed:     1, Passed:     0, Skipped:     0, Total:     1, Duration: 1 ms - A.dll (net10.0)\n"));
  assert.ok(!inBlock.some((e) => e.kind === "runner.aborted"), "an exception inside a case's failure is that case's, never an abort");
});

test(".NET claims `dotnet test` by its argument list only, and says what it was measured on", () => {
  assert.equal(DOTNET_TEST.claims({ argv: ["dotnet", "test", "src/App.Tests"] }), true);
  assert.equal(DOTNET_TEST.claims({ argv: ["/usr/local/share/dotnet/dotnet", "test"] }), true);
  assert.equal(DOTNET_TEST.claims({ argv: ["C:\\Program Files\\dotnet\\dotnet.exe", "test"] }), true);
  assert.equal(DOTNET_TEST.claims({ argv: ["dotnet", "build"] }), false);
  assert.equal(DOTNET_TEST.claims({ argv: ["npm", "test"] }), false);
  assert.ok(DOTNET_TEST.verified.every((v) => /SDK 10\.0\.202/.test(v)));
});

test("a project that asks for every case gets them all: a Passed line turns the adapter's cases to reported", () => {
  const text = "Test run for /b/A.Tests.dll (.NETCoreApp,Version=v10.0)\n  Passed A.Tests.One [1 ms]\n  Passed A.Tests.Two [2 ms]\n\nPassed!  - Failed:     0, Passed:     2, Skipped:     0, Total:     2, Duration: 5 ms - A.Tests.dll (net10.0)\n";
  const events = parsedWith(dotnetParser(), Buffer.from(text));
  assert.deepEqual(events.filter((e) => e.kind === "activity.adapter").map((e) => e.adapter.capabilities.cases), ["failures", "reported"]);
  assert.equal(events.filter((e) => e.kind === "case.reported").length, 2);
});

test("the adapters are tried in order -- a stack's own claim, a protocol's first line, the lifecycle only -- and each says what it can show", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id), ["dotnet-test", "tap", "generic"]);
  assert.equal(ADAPTERS.at(-1), GENERIC);
  assert.deepEqual(CAPABILITY_MATRIX.map((r) => [r.id, r.cases, r.total]), [["dotnet-test", "failures", "at-end"], ["tap", "reported", "at-end"], ["generic", "none", "none"]]);
});

// ---- the fold ----------------------------------------------------------------------------------------------------

const line = (seq, kind, extra = {}) => ({ v: 1, seq, gen: 1, at: `2026-10-15T09:00:${String(seq).padStart(2, "0")}.000Z`, kind, ...extra });

const folded = (lines) => observationView(lines.reduce(foldObservation, emptyObservation()));

test("the fold counts a case by its LAST word, keeps the one before, and never counts a duplicate or a line of another run", () => {
  const view = folded([
    line(0, "activity.started", { task: "tsk-0123456789ab", action: "act-7", check: "chk-7", adapter: { id: "tap", capabilities: { cases: "reported" }, observes: ["passed", "failed", "skipped", "todo", "cancelled"] } }),
    line(1, "case.reported", { key: "1", name: "flaky", state: "failed" }),
    line(2, "case.reported", { key: "1", name: "flaky", state: "passed" }),
    line(2, "case.reported", { key: "2", name: "duplicate seq", state: "failed" }),
    { ...line(3, "case.reported", { key: "3", name: "another run", state: "failed" }), gen: 2 },
    line(5, "case.reported", { key: "4", name: "after a hole", state: "skipped" }),
  ]);
  assert.deepEqual(view.counts, { passed: 1, failed: 0, skipped: 1, todo: 0, cancelled: 0 });
  assert.equal(view.reported, 2);
  assert.equal(view.recent.find((r) => r.name === "flaky" && r.state === "passed").before, "failed", "the retry is visible: failed, then passed");
  assert.match(view.gaps.join(" | "), /2 line\(s\) out of order or of another run, ignored/);
  assert.match(view.gaps.join(" | "), /2 line\(s\) of the observation are missing/);
  assert.equal(view.total, null, "no runner said a total: none is shown");
  assert.equal(view.complete, false, "still running");
});

test("the fold says when the runner's totals disagree with what was observed -- only for what the adapter observes in full", () => {
  const start = line(0, "activity.started", { adapter: { id: "dotnet-test", capabilities: { cases: "failures" }, observes: ["failed", "skipped"] } });
  const ok = folded([start, line(1, "case.reported", { key: "a", state: "failed" }), line(2, "runner.summary", { totals: { tests: 8, passed: 7, failed: 1, skipped: 0 } }), line(3, "activity.completed", { outcome: { status: 1 } })]);
  assert.equal(ok.mismatch, false, "seven passed cases nobody printed are not a disagreement for an adapter that observes failures");
  assert.equal(ok.total, 8);
  assert.equal(ok.complete, true);
  const off = folded([start, line(1, "runner.summary", { totals: { tests: 8, passed: 6, failed: 2, skipped: 0 } }), line(2, "activity.completed", { outcome: { status: 1 } })]);
  assert.equal(off.mismatch, true);
  assert.match(off.gaps.join(), /the runner said 2 failed; 0 were observed/);
});

test("per-assembly totals add up, and a record keeps a bounded summary -- never the stream", () => {
  const view = folded([line(0, "activity.started", {}), line(1, "runner.summary", { totals: { tests: 3, passed: 3, failed: 0 } }), line(2, "runner.summary", { totals: { tests: 2, passed: 1, failed: 1 } }), line(3, "activity.completed", {})]);
  assert.deepEqual(view.totals, { tests: 5, passed: 4, failed: 1 });
  const summary = summaryOf(view);
  assert.deepEqual(Object.keys(summary).sort(), ["aborted", "adapter", "complete", "counts", "failures", "gaps", "mismatch", "reported", "state", "total", "totals"]);
});

// ---- the observation ---------------------------------------------------------------------------------------------

function observed(over = {}) {
  const written = [];
  const clock = { ms: Date.parse("2026-10-15T09:00:00.000Z") };
  const o = createObservation({ identity: { task: "tsk-0123456789ab", action: "act-7", attempt: "att-2", check: "chk-7" }, command: { id: "rt-command-1", purpose: "test", component: "node:api", declaredAs: "test", argv: ["npm", "test"] }, why: "required: the change reaches node:api", adapters: ADAPTERS, sink: { append: (text) => written.push(text) }, clock: () => (clock.ms += 10), budget: LIMITS.ACTION_BYTES, ...over });
  return { o, written, lines: () => written.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

test("an observation sniffs TAP after a script's preamble, writes allow-listed lines with a growing sequence, and ends with the process's FACTS", () => {
  const w = observed();
  w.o.chunk("out", Buffer.from("> api@1.0.0 test\n> node --test\n\nTAP version 13\n# Subtest: a\nok 1 - a\n"));
  w.o.chunk("out", Buffer.from("# Subtest: b\nnot ok 2 - b\n  ---\n  error: 'boom'\n  ...\n1..2\n# tests 2\n# pass 1\n# fail 1\n"));
  const view = w.o.settled({ ok: false, started: true, timedOut: false, overflow: false, status: 1, durationMs: 1200 });
  const lines = w.lines();
  assert.deepEqual(lines.map((l) => l.seq), lines.map((l, i) => i));
  assert.equal(lines[0].kind, "activity.started");
  assert.equal(lines[0].authority, "observation");
  assert.deepEqual(lines[0].command, { id: "rt-command-1", purpose: "test", component: "node:api", declaredAs: "test", program: "npm" }, "never the argument list: the program's own name only");
  assert.ok(lines.some((l) => l.kind === "activity.adapter" && l.adapter.id === "tap"));
  assert.ok(lines.every((l) => Object.keys(l).every((k) => ["v", "seq", "gen", "at", "kind", ...KINDS[l.kind]].includes(k))), "every field is one its kind allows");
  assert.deepEqual(lines.at(-1).outcome, { started: true, timedOut: false, overflow: false, status: 1, durationMs: 1200, observerFailed: false });
  assert.deepEqual(view.counts, { passed: 1, failed: 1, skipped: 0, todo: 0, cancelled: 0 });
  assert.equal(view.complete, true);
});

test("the budget drops case events first and counts them; the end of an observation always fits", () => {
  const w = observed({ budget: LIMITS.ENDING_BYTES + 400 });
  w.o.chunk("out", Buffer.from(`TAP version 13\n${Array.from({ length: 200 }, (_, i) => `ok ${i + 1} - case ${i}`).join("\n")}\n`));
  const view = w.o.settled({ ok: true, started: true, status: 0, durationMs: 5 });
  const lines = w.lines();
  assert.equal(lines.at(-1).kind, "activity.completed");
  assert.ok(lines.some((l) => l.kind === "activity.gap" && l.dropped > 0));
  assert.equal(view.counts.passed, 200, "what was read is counted in full, whatever the file could hold");
  assert.match(view.gaps.join(), /event\(s\) not kept: the observation's budget/);
});

test("a sink that fails is let go: the run's observation goes on in memory and says what was not written", () => {
  const w = observed({ sink: { append: () => { throw Object.assign(new Error("no space"), { code: "ENOSPC" }); } } });
  w.o.chunk("out", Buffer.from("TAP version 13\nnot ok 1 - x\n"));
  const view = w.o.settled({ ok: false, started: true, status: 1, durationMs: 5 });
  assert.equal(view.counts.failed, 1);
  assert.match(view.gaps.join(), /the sink failed: ENOSPC/);
});

test("a command nothing reads shows its lifecycle only, and says so; a silent command writes no progress", () => {
  const w = observed({ command: { id: "b", purpose: "build", argv: ["make"] } });
  w.o.chunk("out", Buffer.from("compiling 1/3\ncompiling 2/3 passed\n"));
  const view = w.o.settled({ ok: true, started: true, status: 0, durationMs: 5 });
  assert.equal(view.adapter.id, "generic");
  assert.equal(view.reported, 0, "a line that says `passed` is no case that passed");
  assert.match(view.gaps.join(), /printed nothing Orbit reads as case results/);
  assert.equal(view.output.lines, 2);
  const quiet = observed();
  const before = quiet.written.length;
  assert.equal(before, 1, "only the start");
  quiet.o.settled({ ok: false, started: true, timedOut: true, status: null, durationMs: 1800000 });
  assert.deepEqual(quiet.lines().map((l) => l.kind), ["activity.started", "activity.failed"], "a command that timed out is an activity that failed to complete, said as a fact");
});

test("a dotnet test command is claimed from its first line, before the runner announces itself", () => {
  const w = observed({ command: { id: "t", purpose: "test", component: "dotnet:App.Tests", argv: ["dotnet", "test", "App.Tests"] } });
  w.o.chunk("out", fixture("dotnet-vstest-xunit.txt"));
  const view = w.o.settled({ ok: false, started: true, status: 1, durationMs: 9000 });
  assert.equal(w.lines()[0].adapter.id, "dotnet-test");
  assert.equal(view.adapter.runner, "VSTest");
  assert.deepEqual([view.counts.failed, view.counts.skipped, view.total, view.mismatch], [1, 1, 8, false]);
});

// ---- the source a viewer follows ------------------------------------------------------------------------------

test("an observation's file is the action's own, inside the task's room, and a line is kept only as its writer wrote it", () => {
  assert.equal(activityFile("/s", "tsk-0123456789ab", "act-7"), join("/s", "orchestration", "tsk-0123456789ab", "activity", "act-7.jsonl"));
  assert.throws(() => activityFile("/s", "tsk-0123456789ab", "../../etc"), /act- id/);
  assert.throws(() => activityFile("/s", "../x", "act-1"), /act- id/);
  assert.equal(activityLine('{"v":1,"seq":0,"gen":1,"kind":"case.reported"}').kind, "case.reported");
  for (const bad of ['{"v":2,"seq":0,"gen":1,"kind":"case.reported"}', '{"v":1,"gen":1,"kind":"case.reported"}', '{"v":1,"seq":0,"gen":1,"kind":"rm -rf"}', "not json"]) assert.equal(activityLine(bad), null, bad);
  assert.deepEqual(ACTIVITY_SOURCE.observedOf({ actions: [{ id: "act-1", type: "plan" }, { id: "act-2", type: "build" }, { id: "act-3", type: "test" }, { id: "act-4", type: "verify" }] }), ["act-2", "act-3", "act-4"]);
});

test("the README's adapter table names exactly the adapters the engine binds, with the cases each can show", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const rows = [...readme.matchAll(/^ {2}\| `([a-z-]+)` \|[^|]*\| ([^|]+) \|/gm)].map((m) => m[1]);
  assert.deepEqual(rows, CAPABILITY_MATRIX.map((r) => r.id));
});

// ---- 1.8.6: what a failed case expected and what it got, as values of their own -------------------------------

test("expected and actual: a value of their own when the runner printed them as such, bounded, the message unchanged", () => {
  const tap = parsedWith(tapParser(), Buffer.from(NODE22), 7).find((e) => e.kind === "case.failure" && e.name === "fails");
  assert.deepEqual([tap.expected, tap.actual, tap.message], ["2", "1", "1 == 2 · expected 2 · actual 1"]);
  for (const name of ["dotnet-vstest-xunit.txt", "dotnet-vstest-mstest.txt", "dotnet-mtp-mstest.txt"]) {
    const f = parsedWith(dotnetParser(), fixture(name)).find((e) => e.kind === "case.failure");
    assert.deepEqual([f.expected, f.actual], ['"tool-a"', '"tool-b"'], `${name}: xUnit says Actual, MSTest says But was`);
  }
  assert.deepEqual(KINDS["case.failure"].slice(-2), ["expected", "actual"], "allow-listed, so the writer keeps them");
  const s = emptyObservation();
  foldObservation(s, { v: 1, seq: 0, gen: 1, at: "2026-10-16T00:00:00.000Z", kind: "case.failure", key: "k", name: "n", expected: "2", actual: "1" });
  assert.deepEqual([observationView(s).failures[0].expected, observationView(s).failures[0].actual], ["2", "1"]);
  assert.equal(summaryOf(observationView(s)).failures[0].expected, undefined, "a check's record keeps what it kept: the values stay in the observation");
});

test("a case that says nothing of what it expected has no expected value -- one is never read out of its sentence", () => {
  const slow = parsedWith(tapParser(), Buffer.from(NODE22), 7).find((e) => e.kind === "case.failure" && e.name === "slow");
  assert.deepEqual([slow.expected, slow.actual], [null, null]);
});
