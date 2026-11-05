// TOOL-CALL FAILURES (0.5.0, backlog B9), read off what one run's room keeps: per tool, from the host's own stream (the
// controller's capture first, the runner's copy after it); what each failed call cost before the next useful one; per
// relay subcommand, refusals by reason -- the reason read off the very sentence the relay writes; per sandbox step,
// attempts, failures, the class of each (pinned to the engine's own words), the host calls each cost before the host
// got past it or stopped, and whether it ended BLOCKED with its reason. Where no record says it, the answer is unknown
// with why -- never 0.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { docWritten, roomOf } from "../benchmark/lib/core/room.mjs";
import { admitted } from "../benchmark/lib/qa/relay.mjs";
import { classOf, relayReasonOf, runToolsOf, SANDBOX_FAILURES, SANDBOX_STEPS, toolsMarkdown } from "../benchmark/lib/core/tools.mjs";

const ROOT = join(import.meta.dirname, "..");

const jsonl = (events) => events.map((e) => JSON.stringify(e)).join("\n");

const call = (id, name, o = {}) => ({ type: "assistant", ...(o.parent ? { parent_tool_use_id: o.parent } : {}), message: { id: o.message ?? `m-${id}`, content: [{ type: "tool_use", id, name, input: o.input ?? {} }], usage: o.usage ?? { input_tokens: 10, output_tokens: 0 } } });

const result = (id, isError, o = {}) => ({ type: "user", ...(o.parent ? { parent_tool_use_id: o.parent } : {}), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "out" }] } });

const ENDED = (cost) => ({ type: "result", subtype: "success", is_error: false, num_turns: 4, total_cost_usd: cost });

// Bash fails twice in a row, then a Read gets past it; an Edit fails and nothing after it succeeds.
const SESSION = [{ type: "system", subtype: "init", model: "claude-test" }, call("a", "Bash"), result("a", true), call("b", "Bash"), result("b", true), call("c", "Read"), result("c", false), call("d", "Edit"), result("d", true), ENDED(0.5)];

function roomFor(t, kind = "engineering") {
  const store = mkdtempSync(join(tmpdir(), "orbit-bench-tools-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const room = roomOf(store, "bnr-00000000000a");
  docWritten(room, "manifest.json", { run: room.id, benchmark: { kind } });
  return room;
}

const put = (room, rel, text) => (mkdirSync(dirname(room.at(rel)), { recursive: true }), writeFileSync(room.at(rel), text));

const manifest = (kind = "engineering") => ({ benchmark: { kind } });

test("per tool: calls, failed calls and unanswered ones, from the controller's capture -- and from the runner's own copy only where nothing was captured", (t) => {
  const room = roomFor(t);
  put(room, "rounds/1/host.stream.jsonl", jsonl(SESSION));
  put(room, "rounds/1/out/host.jsonl", jsonl([SESSION[0], call("x", "Write"), ENDED(1)]));
  const f = runToolsOf(room, manifest());
  assert.deepEqual([f.basis, f.calls.calls, f.calls.failed, f.calls.byTool.Bash, f.calls.byTool.Write], ["HOST_OBSERVED", 4, 3, { calls: 2, failed: 2, unanswered: 0 }, undefined]);
  put(room, "rounds/1/host.stream.jsonl", "");
  const old = runToolsOf(room, manifest());
  assert.deepEqual([old.basis, old.calls.byTool.Write], ["REPORTED", { calls: 1, failed: 0, unanswered: 1 }], "an empty capture (a runner that printed nothing) is no evidence: the runner's copy is read, and said to be REPORTED");
});

test("what a failed call cost: the turns, tokens and apportioned cost of its thread until the next call that did not fail -- one episode for failures that share it", (t) => {
  const room = roomFor(t);
  put(room, "rounds/1/host.stream.jsonl", jsonl(SESSION));
  const r = runToolsOf(room, manifest()).recovery;
  assert.deepEqual([r.failed, r.episodes, r.recovered, r.turns, r.tokens, r.costBasis], [3, 2, 1, 2, 20, "APPORTIONED"], "a, b got past by c two turns later; d never got past");
  assert.equal(r.costUsd, 0.25, "the reported cost, apportioned by the reported tokens of the turns spent");
  put(room, "rounds/1/host.stream.jsonl", jsonl(SESSION.slice(0, -1)));
  assert.equal(runToolsOf(room, manifest()).recovery.costUsd, null, "no reported cost, no cost -- never an estimate");
});

test("with no host stream at all the calls are unknown, and say why -- never zero", (t) => {
  const f = runToolsOf(roomFor(t), manifest());
  assert.deepEqual([f.calls, f.recovery], [null, null]);
  assert.match(f.unknown.calls, /no round left a host stream/);
  assert.match(f.unknown.sandbox, /no host round ran/);
});

// ---- the relay ----------------------------------------------------------------------------------------------------------

const INV = "inv-0123456789ab";

const refusal = (argv, stdin) => admitted({ argv, stdin }, INV).refused;

test("every reason the relay refuses for is a word of its own, read off the sentence the relay itself writes", () => {
  const cases = [[["context", "--help"], "HELP"], [["plan", "--objective=x"], "NOT_RELAYED"], [["context", "--investigation=inv-ffffffffffff"], "OTHER_INVESTIGATION"], [["show", "inv-1"], "WORDS"], [["show", "--json=yes"], "FLAG_VALUE"], [["report", "--out=/x"], "FLAG"], [["context"], "STDIN", "{}"]];
  for (const [argv, reason, stdin] of cases) assert.equal(relayReasonOf({ refused: refusal(argv, stdin) }), reason, `${argv.join(" ")}: ${refusal(argv, stdin)}`);
  assert.equal(relayReasonOf({ refused: admitted(null, INV).refused }), "NOT_A_REQUEST");
  assert.equal(relayReasonOf({ refused: "is not a regular file a request is" }), "NOT_A_REQUEST", "what the mailbox removed unread");
  assert.equal(relayReasonOf({ refused: "a sentence no row knows" }), "OTHER", "the last row always holds");
});

test("per relay subcommand: requests, refusals by reason and the engine's non-zero exits, from the round's relay log", (t) => {
  const room = roomFor(t, "qa");
  const lines = [{ sub: "context", refused: refusal(["context", "--help"]), exit: 2 }, { sub: "context", refused: null, exit: 0 }, { sub: "step", refused: null, exit: 3, why: "inv-… is already paused" }, { sub: "plan", refused: refusal(["plan"]), exit: 2 }, { request: "x.json", error: "the controller could not serve it" }];
  put(room, "rounds/1/relay/relay.jsonl", lines.map((l) => JSON.stringify(l)).join("\n"));
  const relay = runToolsOf(room, manifest("qa")).relay;
  assert.deepEqual(relay.context, { requests: 2, refused: { HELP: 1 }, nonZero: 0, errors: 0 });
  assert.deepEqual([relay.step.nonZero, relay.plan.refused, relay["(unreadable)"].errors], [1, { NOT_RELAYED: 1 }, 1]);
  assert.match(runToolsOf(roomFor(t), manifest()).unknown.relay, /only a QA round's host reaches the engine through the relay/);
});

// ---- the sandbox ----------------------------------------------------------------------------------------------------------

const at = (s) => `2026-11-05T00:00:${String(s).padStart(2, "0")}.000Z`;

const ms = (s) => Date.parse(at(s));

const act = (id, type, state, startS, endS, o = {}) => ({ id, type, state, startedAt: at(startS), endedAt: endS === null ? null : at(endS), summary: o.summary ?? null, reason: o.reason ?? null });

const op = (kind, state, s, because = null) => ({ kind, state, at: at(s), settledAt: at(s + 1), because });

// The engineering task as the inspection read it back: a preparation that failed on a restore, the host's flailing,
// a preparation that came through, a start whose application never answered, a release that could not be proven.
const TASK = (o = {}) => ({ exit: 0, json: { lifecycle: o.lifecycle ?? "EXECUTING", blocked: o.blocked ?? null, actions: [act("act-1", "prepare-sandbox", "error", 1, 10, { reason: "restoring node:. (npm ci) failed with exit 1" }), act("act-2", "check", "failed", 20, 25), act("act-3", "prepare-sandbox", "succeeded", 30, 35), act("act-4", "start-sandbox", "succeeded", 40, 45, { summary: "1 started, 0 already running, 0 replaced, 1 not answering yet" })] } });

const SANDBOX = { exit: 0, json: { sandboxes: [{ id: "env-1", state: "QUARANTINED", operations: [op("prepare", "FAILED", 2, "restoring node:. (npm ci) failed with exit 1"), op("restore", "FAILED", 3, "restoring node:. (npm ci) failed with exit 1"), op("prepare", "DONE", 31), op("restore", "DONE", 32), op("up", "DONE", 33), op("teardown", "FAILED", 50, "network: 1 container(s) are still attached"), op("dispatch", "FAILED", 51)] }] } };

// Five host calls, each arriving at a moment the capture's index keeps: two before the failure ends, two while the host
// flails, one after it got past it.
function captured(room, seconds) {
  put(room, "rounds/1/host.stream.jsonl", jsonl([{ type: "system", subtype: "init", model: "m" }, ...seconds.map((s, i) => call(`c${i}`, "Bash"))]));
  put(room, "rounds/1/host.stream.at.json", JSON.stringify({ schema: 1, lines: seconds.map((s, i) => [i + 2, ms(s)]) }));
}

function engineeringRoom(t, o = {}) {
  const room = roomFor(t);
  put(room, "rounds/1/inspect/task.json", JSON.stringify(TASK(o)));
  if (o.sandbox !== false) put(room, "rounds/1/inspect/sandbox.json", JSON.stringify(SANDBOX));
  if (o.times !== false) captured(room, [5, 9, 12, 18, 40]);
  return room;
}

test("per sandbox step: attempts and failures, from the engineering task's own actions and the runtime operations the inspection read back", (t) => {
  const s = runToolsOf(engineeringRoom(t), manifest()).sandbox;
  const row = (step) => ((r) => [r.attempts, r.failures, r.classes])(s.steps[step]);
  assert.deepEqual(row("sandbox-prepare"), [2, 1, { RESTORE_FAILED: 1 }], "what the host asked for, each a decision of its own");
  assert.deepEqual(row("restore"), [2, 1, { RESTORE_FAILED: 1 }]);
  assert.deepEqual(row("container-build"), [1, 0, {}]);
  assert.deepEqual(row("sandbox-start"), [1, 0, {}]);
  assert.deepEqual(row("readiness"), [1, 1, { READINESS: 1 }], "a start whose application never answered failed its readiness");
  assert.deepEqual(row("sandbox-release"), [1, 1, { TEARDOWN_UNPROVEN: 1 }]);
  assert.deepEqual([s.by, Object.keys(s.steps)], ["host", SANDBOX_STEPS], "a generated test's dispatch is not a step of the sandbox");
});

test("what a sandbox failure cost: the host's calls after it ended, until its task's next action that succeeded -- or to the end -- by the controller's own clock", (t) => {
  const s = runToolsOf(engineeringRoom(t), manifest()).sandbox;
  const prepare = s.failures.find((f) => f.step === "sandbox-prepare");
  assert.deepEqual([prepare.calls, prepare.past, prepare.blocked], [2, true, null], "the calls at 12s and 18s, before act-3 succeeded at 30s");
  const release = s.failures.find((f) => f.step === "sandbox-release");
  assert.deepEqual([release.calls, release.past], [0, false], "nothing got past it, and nothing came after it");
  assert.deepEqual(s.steps["sandbox-prepare"].calls, { counted: 1, total: 2, unknown: 0 });
  const unclocked = runToolsOf(engineeringRoom(t, { times: false }), manifest()).sandbox;
  assert.deepEqual(unclocked.steps["sandbox-prepare"].calls, { counted: 0, total: 0, unknown: 1 }, "a stream captured with no moments cannot place a call: unknown, never zero");
});

test("a failure the host never got past ended BLOCKED with its reason -- or it did not, and that is said", (t) => {
  const blocked = runToolsOf(engineeringRoom(t, { lifecycle: "BLOCKED", blocked: { stop: "ENVIRONMENT_BLOCKED", because: "the sandbox's teardown could not be proven" } }), manifest()).sandbox;
  assert.deepEqual([blocked.steps["sandbox-release"].stopped, blocked.steps["sandbox-release"].endedBlocked], [1, 1]);
  assert.match(blocked.failures.find((f) => f.step === "sandbox-release").blocked.because, /could not be proven/);
  const open = runToolsOf(engineeringRoom(t), manifest()).sandbox;
  assert.deepEqual([open.steps["sandbox-release"].stopped, open.steps["sandbox-release"].endedBlocked], [1, 0]);
});

test("an older room whose inspection never read the sandboxes back: the task's own steps are known, runtime's are unknown and say why", (t) => {
  const f = runToolsOf(engineeringRoom(t, { sandbox: false }), manifest());
  assert.deepEqual(Object.keys(f.sandbox.steps), ["sandbox-prepare", "sandbox-start", "readiness"]);
  assert.match(f.unknown.restore, /did not read the runner store's sandboxes back/);
});

test("a QA run's sandbox was the controller's: its steps come from the engine store's operations, no host call is counted against them, and a start nobody journals is unknown", (t) => {
  const room = roomFor(t, "qa");
  const opsDir = room.at("engine", "repo-app", "runtime", "controller-host", "checkouts", "co-1", "sandboxes", "env-9", "operations");
  put(room, "engine/repo-app/checkouts/co-1/sandboxes/env-9.json", JSON.stringify({ schema: 1, id: "env-9", kind: "sandbox", owner: { id: "tsk-0000000000b1" }, state: "BLOCKED" }));
  writeFileSync((mkdirSync(opsDir, { recursive: true }), join(opsDir, "op-000000000001.json")), JSON.stringify({ schema: 1, ...op("prepare", "FAILED", 1, "no isolation provider answers on this machine (docker: the docker daemon did not answer)") }));
  const f = runToolsOf(room, manifest("qa"), { outcome: "BLOCKED", summary: "BLOCKED — the application's sandbox did not come up" });
  assert.deepEqual([f.sandbox.by, f.sandbox.steps["sandbox-prepare"].classes, f.sandbox.steps["sandbox-prepare"].calls, f.sandbox.steps["sandbox-prepare"].endedBlocked], ["controller", { DOCKER_DOWN: 1 }, null, 1]);
  assert.match(f.unknown["sandbox-start"], /not operations runtime journals/);
});

// ---- the classes, pinned to the engine's own words -----------------------------------------------------------------------

const SOURCES = ["src/runtime/isolation/index.mjs", "src/runtime/sandbox/topology.mjs", "src/runtime/sandbox/prepare.mjs", "src/runtime/sandbox/ports.mjs", "src/runtime/sandbox/isolated-prepare.mjs", "src/runtime/sandbox/model.mjs", "src/orchestration/sandbox.mjs"].map((rel) => readFileSync(join(ROOT, rel), "utf8")).join("\n");

test("each class of a sandbox failure reads a word the engine itself writes, and the last row always holds", () => {
  const said = [["no isolation provider answers", "DOCKER_DOWN"], ["a sandbox never pulls", "IMAGE_PULL"], ["cannot give it another port", "PORT_HELD"], ["is free to lease", "PORT_HELD"], ["holds a lease on it", "PORT_HELD"], ["is not ready on the task's network", "READINESS"], ["not answering yet", "READINESS"], ["could not be proven", "TEARDOWN_UNPROVEN"]];
  for (const [fragment, id] of said) {
    assert.ok(SOURCES.includes(fragment), `the engine still writes "${fragment}"`);
    assert.equal(classOf({ step: "sandbox-prepare", because: `x ${fragment} y` }), id, fragment);
  }
  assert.ok(SOURCES.includes("`restoring ${"), "a restore's own sentence starts with `restoring`");
  assert.equal(classOf({ step: "sandbox-prepare", because: "restoring node:. (npm ci) failed with exit 1" }), "RESTORE_FAILED");
  assert.equal(classOf({ step: "container-build", because: "toomanyrequests: You have reached your pull rate limit" }), "IMAGE_PULL", "a registry's refusal, as a build's error carries it");
  assert.equal(classOf({ step: "sandbox-release", because: null }), "TEARDOWN_UNPROVEN");
  assert.equal(classOf({ step: "sandbox-start", because: "something else" }), "UNCLASSIFIED");
  assert.equal(SANDBOX_FAILURES.at(-1).when({}), true);
});

test("the report's tool-call section says counts and words of Orbit's, never a command or an output", (t) => {
  const room = engineeringRoom(t);
  const md = toolsMarkdown(runToolsOf(room, manifest())).join("\n");
  assert.match(md, /## Tool calls/);
  assert.match(md, /sandbox `sandbox-release` \(host\): 1\/1 failed — TEARDOWN_UNPROVEN 1; 0 host call\(s\) after 1 failure\(s\); 1 never got past, 0 ended BLOCKED with a reason/);
  assert.match(md, /sandbox `sandbox-prepare` \(host\): 1\/2 failed — RESTORE_FAILED 1; 2 host call\(s\) after 1 failure\(s\)\n/);
  assert.ok(!md.includes("npm ci"), "a step's sentence is evidence in the facts, never a line of the summary");
});
