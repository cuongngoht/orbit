// `dotnet test`, read from the console report it prints while it runs (1.8.5, ADR 0020). A stack's own words, so
// it lives here, in the engineering pack, and never under src/.
//
// Passive: Orbit adds no logger, no verbosity and no reporter to the declared command (the output a baseline was taken
// from is the output a later run is compared with). So what it can show is what the test platform prints by
// default, measured on SDK 10.0.202 (VSTest with Microsoft.NET.Test.Sdk 17.14.1 under xUnit 2.9.3 and MSTest 4.0.2;
// Microsoft.Testing.Platform under MSTest 4.0.2):
//   - which runner: VSTest announces `Test run for <assembly> (<framework>)`, Microsoft.Testing.Platform (MTP)
//     `Running tests from <assembly> (<framework>|<arch>)`. The runner is read off that line, never assumed.
//   - the cases that did NOT pass, while it runs: VSTest prints `  Failed <name> [<time>]` with an `Error Message:`
//     and a `Stack Trace:` block, and `  Skipped <name>`; MTP prints `failed <name> (<time>)` with the message, the
//     assembly it came `from` and the stack, and `skipped <name>`. Both arrive in batches, before the run ends.
//   - a PASSED case only when the project's own command asked for it (a console logger at normal verbosity, or MTP's
//     detailed output); then every case is reported and the adapter says so.
//   - the runner's own totals, per assembly (VSTest's `Failed!  - Failed: 1, Passed: 6 …` line) or once (MTP's `Test
//     run summary` block): a total is known only once the runner said it.
// A case is keyed by the assembly it ran in and its full name (which carries a theory's arguments), so one name in
// two assemblies is two cases; a VSTest assembly is the latest `Test run for` line, which projects run in parallel
// can interleave -- the runner's totals then show any disagreement. Reports from other SDKs or runners than the ones
// measured are read the same way and said as such (`verified`), never claimed.
import { cleaned } from "../../../src/orchestration/activity/text.mjs";
import { LIMITS } from "../../../src/orchestration/activity/vocab.mjs";

const isDotnet = (file) => /(^|[\\/])dotnet(\.exe)?$/i.test(String(file ?? ""));

const VSTEST_RUN = /^Test run for (.+?) \(([^)]*)\)\s*$/;
const MTP_RUN = /^Running tests from (.+?) \(([^)]*)\)\s*$/;

export const DOTNET_TEST = Object.freeze({
  id: "dotnet-test",
  framework: "the .NET test platform's console report (VSTest or Microsoft.Testing.Platform)",
  runner: null,
  capabilities: { lifecycle: true, cases: "failures", total: "at-end", order: "reported" },
  observes: ["failed", "skipped"],
  verified: ["SDK 10.0.202 · VSTest (Microsoft.NET.Test.Sdk 17.14.1) · xUnit 2.9.3, MSTest 4.0.2", "SDK 10.0.202 · Microsoft.Testing.Platform · MSTest 4.0.2"],
  claims: (command) => isDotnet(command?.argv?.[0]) && (command.argv ?? []).slice(1).includes("test"),
  sniff: (line) => VSTEST_RUN.test(line) || MTP_RUN.test(line),
  parser: () => dotnetParser(),
});

const fresh = () => ({ runner: null, assembly: null, pending: null, block: null, passedSeen: false, totals: null, cause: null });

export function dotnetParser() {
  const p = fresh();
  return { line: (text) => lineOf(p, text), end: () => [...flushed(p), ...mtpSummary(p)] };
}

const fileName = (path) => cleaned(String(path).split(/[\\/]/).pop(), LIMITS.NAME_CHARS);

// ---- one line, first row that holds --------------------------------------------------------------------------

const VSTEST_CASE = /^\s{1,4}(Passed|Failed|Skipped)\s+(.+?)(?:\s+\[([^\]]*)\])?\s*$/;
const VSTEST_SUMMARY = /^(Passed|Failed)!\s+-\s+Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)(?:,\s*Duration:[^-]*)?\s+-\s+(.+?)\s*$/;
const MTP_CASE = /^(passed|failed|skipped|timed out|cancelled|canceled|errored|error)\s+(.+?)(?:\s+\(([^)]*)\))?\s*$/;
const MTP_SUMMARY = /^Test run summary:/;
const MTP_TOTAL = /^\s+(total|failed|succeeded|skipped):\s*(\d+)\s*$/;
const MTP_DURATION = /^\s+duration:/;
const ASSEMBLY_END = /^.+ \([^)]*\) (passed|failed|skipped)( with .*)?(\(.*\))?\s*$/;
// The runner itself giving up before (or while) it ran the cases: VSTest's `Test Run Aborted.`, after the exception
// that stopped it -- measured under a sandbox that denies the socket VSTest opens to its test host
// (`System.Net.Sockets.SocketException (13): Permission denied`). Zero cases reported then is no run, never a pass.
const ABORTED = /^\s*Test Run Aborted\.?\s*$/i;
const EXCEPTION = /^\s*[\w.]*Exception(?: \(\d+\))?: .+$/;

const LINES = [
  { when: (p, t) => VSTEST_RUN.test(t), then: (p, t) => runnerSeen(p, "VSTest", VSTEST_RUN.exec(t)) },
  { when: (p, t) => MTP_RUN.test(t), then: (p, t) => runnerSeen(p, "Microsoft.Testing.Platform", MTP_RUN.exec(t)) },
  { when: (p, t) => p.runner !== "Microsoft.Testing.Platform" && VSTEST_CASE.test(t), then: (p, t) => vstestCase(p, VSTEST_CASE.exec(t)) },
  { when: (p, t) => VSTEST_SUMMARY.test(t), then: (p, t) => vstestSummary(p, VSTEST_SUMMARY.exec(t)) },
  { when: (p, t) => p.runner === "Microsoft.Testing.Platform" && MTP_CASE.test(t), then: (p, t) => mtpCase(p, MTP_CASE.exec(t)) },
  { when: (p, t) => MTP_SUMMARY.test(t), then: (p) => [...flushed(p), ...withTotals(p)] },
  { when: (p, t) => p.totals !== null && MTP_TOTAL.test(t), then: (p, t) => mtpTotal(p, MTP_TOTAL.exec(t)) },
  { when: (p, t) => p.totals !== null && MTP_DURATION.test(t), then: (p) => mtpSummary(p) },
  { when: (p, t) => p.runner === "Microsoft.Testing.Platform" && ASSEMBLY_END.test(t), then: (p) => flushed(p) },
  { when: (p, t) => ABORTED.test(t), then: (p) => [...flushed(p), abortedOf(p)] },
  { when: (p, t) => p.pending === null && EXCEPTION.test(t), then: (p, t) => Object.assign(p, { cause: cleaned(t.trim(), LIMITS.MESSAGE_CHARS) }) && [] },
  { when: (p) => p.pending !== null, then: (p, t) => blockLine(p, t) },
  { when: () => true, then: () => [] },
];

const lineOf = (p, text) => LINES.find((r) => r.when(p, text)).then(p, text);

// What stopped the runner, in its own words when it printed them; an environment's doing, never a case's.
const abortedOf = (p) => ({ kind: "runner.aborted", why: p.cause ? `the test run aborted: ${p.cause}` : "the test run aborted", category: "environment" });

function withTotals(p) {
  p.totals = {};
  return [];
}

// The runner announced itself: said once, and the assembly it runs from now on.
function runnerSeen(p, runner, m) {
  const out = [...flushed(p), ...(p.runner === runner ? [] : [{ kind: "activity.adapter", adapter: { ...adapterOf(p), runner } }])];
  Object.assign(p, { runner, assembly: fileName(m[1]) });
  return out;
}

const adapterOf = (p) => ({ id: DOTNET_TEST.id, framework: DOTNET_TEST.framework, runner: p.runner, capabilities: { ...DOTNET_TEST.capabilities, cases: p.passedSeen ? "reported" : "failures" }, observes: p.passedSeen ? ["passed", "failed", "skipped"] : DOTNET_TEST.observes, verified: DOTNET_TEST.verified });

// ---- the cases ---------------------------------------------------------------------------------------------------

const VSTEST_STATE = { Passed: "passed", Failed: "failed", Skipped: "skipped" };
const MTP_STATE = { passed: "passed", failed: "failed", errored: "failed", error: "failed", "timed out": "failed", skipped: "skipped", cancelled: "cancelled", canceled: "cancelled" };

function vstestCase(p, m) {
  const out = [...flushed(p), ...passedSeen(p, VSTEST_STATE[m[1]])];
  p.pending = { name: cleaned(m[2], LIMITS.NAME_CHARS), state: VSTEST_STATE[m[1]], time: m[3] ?? null, timedOut: false, message: [], stack: [], assembly: p.assembly };
  p.block = null;
  return out;
}

function mtpCase(p, m) {
  const out = [...flushed(p), ...passedSeen(p, MTP_STATE[m[1]])];
  p.pending = { name: cleaned(m[2], LIMITS.NAME_CHARS), state: MTP_STATE[m[1]], time: m[3] ?? null, timedOut: m[1] === "timed out", message: [], stack: [], assembly: p.assembly };
  p.block = "message";
  return out;
}

// A passed case printed at all means the project asked for every case: the adapter says it reports them all now.
function passedSeen(p, state) {
  if (state !== "passed" || p.passedSeen) return [];
  p.passedSeen = true;
  return [{ kind: "activity.adapter", adapter: adapterOf(p) }];
}

// ---- a failure's block: its message, where it came from, its stack -------------------------------------------------

const BLOCKS = [
  { when: (t) => /^\s+Error Message:\s*$/.test(t), then: (p) => Object.assign(p, { block: "message" }) && [] },
  { when: (t) => /^\s+Stack Trace:\s*$/.test(t), then: (p) => Object.assign(p, { block: "stack" }) && [] },
  { when: (t) => /^\s+Standard (Output|Error) Messages:\s*$/.test(t), then: (p) => Object.assign(p, { block: null }) && [] },
  { when: (t) => /^\s+from .+ \([^)]*\)\s*$/.test(t), then: (p, t) => fromLine(p, t) },
  { when: (t) => /^\s+at\s/.test(t), then: (p, t) => kept(p.pending.stack, t, LIMITS.STACK_LINES) },
  { when: (t) => t.trim() === "", then: (p) => (p.block === "stack" ? flushed(p) : []) },
  { when: () => true, then: (p, t) => (p.block === "message" ? kept(p.pending.message, t, 8) : []) },
];

const blockLine = (p, text) => BLOCKS.find((b) => b.when(text)).then(p, text);

function kept(list, text, max) {
  if (list.length < max) list.push(text.trim());
  return [];
}

// MTP names the assembly a case came from after its message; what follows repeats the message, then the stack.
function fromLine(p, text) {
  p.pending.assembly = fileName(/^\s+from (.+?) \([^)]*\)\s*$/.exec(text)[1]);
  p.block = "stack";
  return [];
}

const UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000 };

const msOf = (text) => ((parts) => (parts.length ? parts.reduce((n, m) => n + Number(m[1]) * UNITS[m[2]], 0) : null))([...String(text ?? "").matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)\b/g)]);

const CATEGORY = [
  { when: (pd, msg) => pd.timedOut || /\btim(ed|e)[ -]?out\b/i.test(msg), category: "timeout" },
  { when: (pd) => pd.state === "cancelled", category: "cancelled" },
  { when: (pd, msg) => /test host process crashed|test run (was )?aborted|could not (find|load)/i.test(msg), category: "environment" },
  { when: (pd, msg) => /\bassert/i.test(msg) || /^\s*expected\b/im.test(msg), category: "assertion" },
  { when: () => true, category: "unknown" },
];

// Where it failed: the first frame with a file and a line, preferring one outside a package's own build tree (a
// `/_/…` source-link path is the test framework's assertion, not the test).
const framesOf = (stack) => stack.map((l) => / in (.+?):(?:line )?(\d+)\s*$/.exec(l)).filter(Boolean);

const locationOf = (stack) => ((frames) => ((m) => (m ? cleaned(`${m[1]}:${m[2]}`, LIMITS.NAME_CHARS) : null))(frames.find((m) => !m[1].startsWith("/_/")) ?? frames[0]))(framesOf(stack));

const keyOf = (pd) => `${pd.assembly ?? "?"}::${pd.name}`;

const caseOf = (pd) => ({ kind: "case.reported", key: keyOf(pd), name: pd.name, suite: pd.assembly, state: pd.state, durationMs: msOf(pd.time) });

// What the assertion said it expected and what it got, on lines of their own (1.8.6) -- the way the frameworks
// measured print them: xUnit `Expected:` / `Actual:`, MSTest `Expected:` / `But was:`. Only a line that says it;
// nothing is read out of a sentence.
const VALUES = { expected: /^Expected:\s*(.+)$/, actual: /^(?:Actual|But was):\s*(.+)$/ };

const valueOf = (lines, re) => ((v) => (v ? cleaned(v, LIMITS.VALUE_CHARS) || null : null))(lines.map((l) => re.exec(l)?.[1]).find(Boolean));

const failureOf = (pd) => ((msg) => ({ kind: "case.failure", key: keyOf(pd), name: pd.name, suite: pd.assembly, category: CATEGORY.find((c) => c.when(pd, msg)).category, message: cleaned(msg, LIMITS.MESSAGE_CHARS) || null, expected: valueOf(pd.message, VALUES.expected), actual: valueOf(pd.message, VALUES.actual), location: locationOf(pd.stack), stack: pd.stack.map((l) => cleaned(l, LIMITS.STACK_CHARS)).filter(Boolean) }))(pd.message.join("\n"));

function flushed(p) {
  const pd = p.pending;
  Object.assign(p, { pending: null, block: null });
  return pd ? [caseOf(pd), ...(pd.state === "failed" ? [failureOf(pd)] : [])] : [];
}

// ---- the runner's own totals -----------------------------------------------------------------------------------

const vstestSummary = (p, m) => [...flushed(p), { kind: "runner.summary", totals: { tests: Number(m[5]), passed: Number(m[3]), failed: Number(m[2]), skipped: Number(m[4]) }, scope: cleaned(m[6], LIMITS.NAME_CHARS) }];

const MTP_NAMES = { total: "tests", failed: "failed", succeeded: "passed", skipped: "skipped" };

function mtpTotal(p, m) {
  p.totals[MTP_NAMES[m[1]]] = Number(m[2]);
  return [];
}

function mtpSummary(p) {
  const totals = p.totals;
  p.totals = null;
  return totals && Object.keys(totals).length ? [{ kind: "runner.summary", totals, scope: "Microsoft.Testing.Platform" }] : [];
}
