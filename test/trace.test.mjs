// The SESSION TRAIL: an event-driven log of what sessions did through Orbit,
// read back by pure projections -- and a hard line around what it may hold.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { trace } from "../src/lifecycle/subscribers/trace.mjs";
import { ATTRIBUTION_WORDS } from "../src/attribution.mjs";
import { documented, headerOf, operations, orbitCommands } from "../src/trace/commands.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { eventOf, readable } from "../src/trace/events.mjs";
import { KEEP_DAYS, MAX_SHARD_BYTES, RECENT_BYTES, traceLog } from "../src/trace/log.mjs";
import { decisionFacts, promptFacts } from "../src/trace/prompt.mjs";
import { ACTIVATION_VERDICTS, LINKS, activationOf } from "../src/trace/projections/activation.mjs";
import { FOLLOW_VERDICTS, lastTurnOf, turnsOf } from "../src/trace/projections/turns.mjs";
import { ruleOf, usageOf } from "../src/trace/projections/usage.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";
import { ended } from "../src/trace/views.mjs";

// A host that sends no exit status (AGY, Codex's shell) leaves a step's result null: "not reported", never "failed".
test("a step whose result the host did not report is shown as not reported, never as failed", () => {
  assert.equal(ended({ ok: null }).long, "  ? not reported");
  assert.equal(ended({ ok: false }).long, "  ✖ failed");
  assert.equal(ended({ ok: true }).long, "");
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Built with join, as the code builds every path under it: a POSIX literal here
// is a different key from what the log writes on Windows.
const rooms = { trace: join("/store", "control", "activity", "trace") };

let seq = 0;
const ev = (type, data = {}, over = {}) => eventOf(type, data, { id: `e-${String(seq++).padStart(4, "0")}`, at: over.at ?? `2026-09-24T10:00:${String(seq).padStart(2, "0")}.000Z`, session: over.session === undefined ? "claude:s1" : over.session, project: over.project ?? "p1" });

test("an event keeps only its type's allow-list, scrubbed; an undeclared type is no event at all", () => {
  const e = eventOf("command.ran", { orbit: "cli/knowledge", sub: "verify", ok: true }, { id: "e-1", at: "2026-09-24T00:00:00.000Z" });
  assert.deepEqual(Object.keys(e.data).sort(), ["ok", "orbit", "sub"]);
  assert.equal(eventOf("prompt.text", { text: "x" }, { id: "e-2", at: "t" }), null);
  assert.equal(readable({ ...e, v: 99 }), null, "a newer engine's line is skipped, never half-read");
  assert.deepEqual(Object.keys(readable({ ...e, data: { ...e.data, sneaked: 1 } }).data).sort(), ["ok", "orbit", "sub"]);
});

test("the log: one shard per day and host, capped ONCE, pruned past its retention, read tolerantly", () => {
  const io = fakeIo({ host: "laptop-a" });
  const log = traceLog(rooms, io);
  log.append(ev("turn.ended", {}, { at: "2026-06-01T00:00:00.000Z" }));
  log.append(ev("turn.ended", {}, { at: "2026-09-24T00:00:00.000Z" }));
  assert.deepEqual(io.list(rooms.trace).filter((n) => n.endsWith(".jsonl")).sort(), ["2026-09-24-laptop-a.jsonl"], `a shard older than ${KEEP_DAYS} days is pruned when a day starts`);
  const shard = join(rooms.trace, "2026-09-24-laptop-a.jsonl");
  io.files.set(shard, `${io.files.get(shard)}{torn\n${"x".repeat(MAX_SHARD_BYTES)}\n`);
  log.append(ev("turn.ended", {}, { at: "2026-09-24T01:00:00.000Z" }));
  log.append(ev("turn.ended", {}, { at: "2026-09-24T02:00:00.000Z" }));
  const read = log.read({});
  assert.deepEqual(read.map((e) => e.type), ["turn.ended", "trace.dropped"], "torn lines dropped; the cap said once");
});

// Why three hook processes racing for one trail could never be a deterministic test (test/multi-host-runtime.test.mjs):
// the writer is FAIL-OPEN, so a line whose writer cannot take the trail's lock costs that line and nothing else --
// whether another writer held the lock past this writer's bounded backoff, or the disk kept refusing the lock directory.
// A refusal for a MOMENT is waited out (0.5.0 review of B7, src/store/lock.mjs PASSING): Windows answers EPERM to a
// mkdir that races another process removing the same directory, and that once cost the line. Once the lock is free, the
// next line lands.
const lockEperm = (io, mkdir, times) => {
  const left = { n: times };
  io.mkdir = (p) => (p.endsWith(".lock") && left.n-- > 0 ? (() => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); })() : mkdir(p));
};

test("a line whose writer cannot take the trail's lock is dropped, never thrown -- a moment's refusal is waited out, and the next one lands", () => {
  const io = fakeIo();
  const log = traceLog(rooms, io);
  const lock = join(rooms.trace, ".lock");
  io.dirs.add(lock);
  io.write(join(lock, "owner.json"), JSON.stringify({ host: "another", pid: 2, token: "live" }));
  assert.doesNotThrow(() => log.append(ev("turn.ended")));
  assert.deepEqual(log.read({}), [], "held past the writer's backoff: the line is lost, the moment it describes is not");
  io.remove(lock);
  const mkdir = io.mkdir;
  lockEperm(io, mkdir, 1);
  log.append(ev("turn.ended"));
  assert.equal(log.read({}).length, 1, "a lock directory the disk refused for a moment -- a release racing the mkdir -- is waited out: the line lands");
  lockEperm(io, mkdir, Infinity);
  assert.doesNotThrow(() => log.append(ev("turn.ended")));
  assert.equal(log.read({}).length, 1, "one the disk keeps refusing costs that line, and never throws");
  io.mkdir = mkdir;
  log.append(ev("turn.ended"));
  assert.equal(log.read({}).length, 2, "the next line, with the lock free, lands");
});

test("the emitter stamps what a producer never supplies, is a no-op when off, and a listener cannot stop an append", () => {
  const io = fakeIo();
  const log = traceLog(rooms, io);
  const seen = [];
  const emit = createEmitter({ log, now: () => "2026-09-24T10:00:00.000Z", session: "claude:s1", project: "p1", listeners: [() => { throw new Error("listener bug"); }, (e) => seen.push(e)] });
  const e = emit("turn.ended", {});
  assert.deepEqual([e.session, e.project, /^e-[0-9a-z]+-[0-9a-f]{8}$/.test(e.id), seen.length, log.read({}).length], ["claude:s1", "p1", true, 1, 1]);
  assert.equal(createEmitter({ log, now: () => "t", on: false })("turn.ended"), null);
});

test("a Orbit command is its shipped script and a DOCUMENTED subcommand -- never an argument", () => {
  const subs = documented(headerOf(readFileSync(join(ROOT, "cli", "knowledge.mjs"), "utf8")), "knowledge");
  assert.ok(["claims", "verify", "decide", "locate"].every((s) => subs.has(s)));
  const lookup = (rel) => (rel === "cli/knowledge.mjs" ? subs : rel === "cli/run-case.mjs" ? new Set() : null);
  assert.deepEqual(orbitCommands('node "/p/cli/knowledge.mjs" verify --for="my secret task words"', lookup), [{ id: "cli/knowledge", sub: "verify" }]);
  assert.deepEqual(orbitCommands("node /p/cli/run-case.mjs create-thing NAME=TC-1", lookup), [{ id: "cli/run-case", sub: null }], "a case id is not a subcommand run-case documents");
  assert.deepEqual(orbitCommands("node /p/cli/unknown.mjs x && node /p/cli/knowledge.mjs claims", lookup), [{ id: "cli/knowledge", sub: "claims" }]);
  assert.deepEqual(orbitCommands('node C:\\p\\cli\\knowledge.mjs verify --for="x"', lookup), [{ id: "cli/knowledge", sub: "verify" }], "a Windows path is the same command");
});

test("a prompt is a salted fingerprint and a length -- never its text -- and the decision is table words and ids", () => {
  const a = promptFacts("implement the invoice export feature", "salt-one");
  assert.deepEqual([a.chars, a.hash.length], [36, 12]);
  assert.notEqual(promptFacts("implement the invoice export feature", "salt-two").hash, a.hash, "the salt never leaves the machine, so neither does a comparable hash");
  assert.deepEqual(promptFacts("x", null), { chars: 1 }, "no salt, no fingerprint at all");
  const decision = { intent: { id: "development", confidence: "high" }, cues: ["implement", "feature"], requirements: ["development.implementation"], graph: { nodes: [{ requirement: "development.implementation", level: "required", status: "selected", transitive: false, provider: { kind: "skill", id: "orbit-develop", routing: { signals: ["secret"] } } }] }, selected: [{ kind: "skill", id: "orbit-develop", requirement: "development.implementation", reason: "free text" }], approval: [], blocked: [], missing: [] };
  const facts = decisionFacts(decision, true);
  assert.deepEqual(facts.graph[0].provider, { kind: "skill", id: "orbit-develop" });
  assert.equal(JSON.stringify(facts).includes("free text"), false);
});

test("the decision trace: a turn per prompt, its path, and whether the session FOLLOWED the router", () => {
  const routed = { routing: "on", intent: "development", confidence: "high", selected: [{ kind: "skill", id: "orbit-develop" }] };
  const events = [ev("prompt.submitted", { prompt: { chars: 10, hash: "abc" }, ...routed }), ev("skill.invoked", { id: "orbit:orbit-develop", ours: true, outcome: "started" }), ev("command.ran", { orbit: "cli/context", ok: true }), ev("tool.used", { tool: "Read", kind: "read", ok: true }), ev("tool.used", { tool: "Read", kind: "read", ok: true }), ev("command.ran", { class: "test", exe: "npm", ok: false }), ev("turn.ended"), ev("prompt.submitted", { prompt: { chars: 4 }, ...routed }), ev("tool.used", { tool: "Edit", kind: "edit", ok: true }), ev("turn.ended"), ev("prompt.submitted", { prompt: { chars: 4 }, routing: "off" })];
  const [third, second, first] = turnsOf(events);
  assert.deepEqual([first.followed.verdict, first.outcome, first.path.map((s) => `${s.label}×${s.times}`)], ["followed", "failed", ["orbit:orbit-develop×1", "cli/context×1", "Read×2", "test (npm)×1"]]);
  assert.deepEqual([second.followed.verdict, third.followed.verdict], ["not-invoked", "nothing-routed"]);
});

test("a command with no session remains separate from the project's active turn", () => {
  const events = [ev("prompt.submitted", { routing: "off" }, { at: "2026-09-24T10:00:00.000Z" }), ev("knowledge.opportunity.offered", { capability: "a.b" }, { session: null, at: "2026-09-24T10:00:05.000Z" }), ev("turn.ended", {}, { at: "2026-09-24T10:00:09.000Z" })];
  const turns = turnsOf(events);
  assert.equal(turns.length, 2);
  assert.equal(turns.find((t) => t.session)?.steps.length, 0);
  assert.deepEqual(turns.find((t) => !t.session).steps.map((s) => s.label), ["offered a.b"]);
});

test("usage: counts with their denominators, flows, failures and what followed, and least privilege", () => {
  const events = [ev("prompt.submitted", { routing: "off" }), ev("skill.invoked", { id: "orbit-develop", ours: true, outcome: "started" }), ev("command.ran", { orbit: "cli/context", ok: true }), ev("command.ran", { orbit: "cli/knowledge", sub: "record", ok: false }), ev("command.ran", { orbit: "cli/knowledge", sub: "record", ok: true }), ev("command.ran", { class: "test", exe: "npm", ok: true }), ev("session.ended")];
  const allowed = new Map([["orbit-develop", ["Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/context.mjs*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs call*)", "Read"]]]);
  const u = usageOf(events, { allowed });
  assert.deepEqual([u.totals.orbit, u.totals.shell, u.totals.failed], [3, 1, { failed: 1, of: 4 }]);
  assert.deepEqual(u.commands.map((c) => [c.id, c.sub, c.runs, c.failed]), [["cli/knowledge", "record", 2, 1], ["cli/context", null, 1, 0]]);
  assert.deepEqual(u.skills.map((s) => [s.id, s.invoked, s.commands]), [["orbit-develop", 1, 4]]);
  assert.deepEqual(u.failures.map((f) => [f.label, f.failed, f.of, f.followedBy[0].label]), [["cli/knowledge record", 1, 2, "cli/knowledge record"]]);
  assert.ok(u.transitions.some((t) => t.from === "orbit-develop" && t.to === "cli/context"));
  assert.deepEqual(u.privilege.unused, [{ skill: "orbit-develop", rule: "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs call*)" }]);
  assert.deepEqual(u.privilege.unapproved, [{ skill: "orbit-develop", command: "cli/knowledge record" }]);
  assert.deepEqual(ruleOf("Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/resources.mjs route*)"), { rule: "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/resources.mjs route*)", script: "cli/resources", sub: "route" });
});

test("the trace subscriber emits what happened, never speaks, and keeps no argument", () => {
  const emitted = [];
  const world = { plugin: "orbit", env: {}, trace: () => ({ emit: (type, data) => emitted.push({ type, data }), lookup: (rel) => (rel === "cli/knowledge.mjs" ? new Set(["verify"]) : null) }) };
  const said = [
    trace.run({ event: "pre-tool", invokes: { kind: "skill", name: "orbit:orbit-develop" } }, world),
    trace.run({ event: "post-tool", tool: { kind: "command" }, command: "node /p/cli/knowledge.mjs verify --for='password=hunter2 task'", ok: true }, world),
    trace.run({ event: "post-tool-failure", tool: { kind: "command" }, command: "npm test -- --token=abc", ok: false }, world),
    trace.run({ event: "post-tool", tool: { name: "mcp__docs__search", kind: "other" }, ok: true }, world),
    trace.run({ event: "turn-end" }, world),
  ];
  assert.deepEqual(said, [null, null, null, null, null]);
  assert.deepEqual(emitted.map((e) => e.type), ["skill.invoked", "command.ran", "command.ran", "tool.used", "turn.ended"]);
  assert.deepEqual(emitted[1].data, { orbit: "cli/knowledge", sub: "verify", ok: true });
  assert.deepEqual(emitted[2].data, { class: "test", exe: "npm", ok: false });
  assert.equal(JSON.stringify(emitted).includes("hunter2") || JSON.stringify(emitted).includes("abc"), false);
});

test("end to end through the real hooks and cli/trace.mjs: the prompt's path, told back, without a word of the prompt", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-trail-"));
  const env = sealed({ ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: join(ROOT, "test", "fixtures", "ui-tests") });
  const hook = (file, input) => spawnSync(process.execPath, [join(ROOT, "cli", file)], { input: JSON.stringify({ session_id: "raw-s-1", cwd: ROOT, ...input }), env, encoding: "utf8", timeout: 30000 });
  hook("router-hook.mjs", { hook_event_name: "UserPromptSubmit", prompt: "implement the frobnicator feature quietly" });
  hook("learn-hook.mjs", { hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill: "orbit:orbit-develop" } });
  hook("learn-hook.mjs", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: `node ${join(ROOT, "cli", "knowledge.mjs")} verify --for="frobnicator secret words"` } });
  hook("learn-hook.mjs", { hook_event_name: "Stop" });
  const shards = readdirSync(join(store, "control", "activity", "trace")).filter((n) => n.endsWith(".jsonl"));
  const text = shards.map((n) => readFileSync(join(store, "control", "activity", "trace", n), "utf8")).join("");
  assert.equal(/frobnicator|raw-s-1/.test(text), false, "neither the prompt, the arguments nor the raw session id");
  const turns = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "trace.mjs"), "turns", "--json"], { env, encoding: "utf8" }).stdout).turns;
  assert.deepEqual([turns[0].routing.intent, turns[0].steps.map((s) => s.label), turns[0].followed.verdict, turns[0].endedAt !== null], ["development", ["orbit:orbit-develop", "cli/knowledge verify"], "followed", true]);
  const usage = spawnSync(process.execPath, [join(ROOT, "cli", "trace.mjs"), "usage"], { env, encoding: "utf8" });
  assert.equal(usage.status, 0, usage.stderr);
  assert.match(usage.stdout, /cli\/knowledge verify/);
});

// ---- the requirement events -----------------------------------------------------------------------

test("the requirement events carry counts and ids and nothing else: an undeclared field never reaches the disk, and every row says what it is", async () => {
  const { EVENT_TYPES, eventOf, readable } = await import("../src/trace/events.mjs");
  const rows = EVENT_TYPES.filter((r) => r.type.startsWith("requirements."));
  assert.deepEqual(rows.map((r) => r.type), ["requirements.source.acquired", "requirements.recorded", "requirements.question.asked", "requirements.decision.recorded", "requirements.snapshot.created", "requirements.roundtable.reviewed", "requirements.roundtable.closed"]);
  for (const r of rows) assert.ok(r.doc.length > 20 && r.fields.length > 0, r.type);
  const meta = { id: "e-1", at: "2026-09-30T10:00:00.000Z", session: null, project: null };
  const leaky = { root: "req-aaaaaaaaaaaa", outcomes: { new: 2 }, results: [{ says: "A refund above 500 needs a manager" }], says: "words", body: "SENTINEL" };
  const written = eventOf("requirements.recorded", leaky, meta);
  assert.deepEqual(Object.keys(written.data).sort(), ["outcomes", "root"]);
  assert.doesNotMatch(JSON.stringify(written), /manager|SENTINEL|words/);
  const line = readable({ ...written, data: { ...written.data, results: [{ says: "edited in" }] } });
  assert.deepEqual(Object.keys(line.data).sort(), ["outcomes", "root"], "and a line somebody edited is cut again on the way out");
});

test("the roundtable events carry a perspective, a round and counts: a candidate's question, a verdict or a reviewer's reasoning has no field", async () => {
  const { eventOf } = await import("../src/trace/events.mjs");
  const meta = { id: "e-1", at: "2026-09-30T10:00:00.000Z", session: null, project: null };
  const reviewed = eventOf("requirements.roundtable.reviewed", { root: "req-aaaaaaaaaaaa", perspective: "qa", candidates: 3, asks: "SENTINEL-QUESTION", reasoning: "SENTINEL-REASONING" }, meta);
  const closed = eventOf("requirements.roundtable.closed", { root: "req-aaaaaaaaaaaa", round: 1, pooled: 9, retained: 4, asked: 3, stop: "waiting-human", verdicts: [{ because: "SENTINEL-VERDICT" }] }, meta);
  assert.deepEqual(Object.keys(reviewed.data).sort(), ["candidates", "perspective", "root"]);
  assert.deepEqual(Object.keys(closed.data).sort(), ["asked", "pooled", "retained", "root", "round", "stop"]);
  assert.doesNotMatch(JSON.stringify([reviewed, closed]), /SENTINEL/);
});

// ---- the work events ------------------------------------------------------------------------------

test("the work events carry ids and counts and nothing else: a need's sentence or an answer never reaches the disk", async () => {
  const { EVENT_TYPES, eventOf, readable } = await import("../src/trace/events.mjs");
  const rows = EVENT_TYPES.filter((r) => r.type.startsWith("work."));
  assert.deepEqual(rows.map((r) => r.type), ["work.started", "work.checkpoint", "work.resumed", "work.need.settled"]);
  for (const r of rows) assert.ok(r.doc.length > 20 && r.fields.length > 0, r.type);
  const meta = { id: "e-1", at: "2026-09-30T10:00:00.000Z", session: null, project: null };
  const leaky = { work: "w-aaaaaaaaaaaa", need: "nd-aaaaaaaaaa", state: "satisfied", why: "the refund form now checks the limit", evidence: ["the unit test passes"], asks: "SENTINEL" };
  const written = eventOf("work.need.settled", leaky, meta);
  assert.deepEqual(Object.keys(written.data).sort(), ["need", "state", "work"]);
  assert.doesNotMatch(JSON.stringify(written), /refund|unit test|SENTINEL/);
  const line = readable({ ...written, data: { ...written.data, why: "edited in" } });
  assert.deepEqual(Object.keys(line.data).sort(), ["need", "state", "work"], "and a line somebody edited is cut again on the way out");
});

// ---- the task events ------------------------------------------------------------------------------

test("the task events carry ids and words, never an objective, a decision or an action's parameters", async () => {
  const { EVENT_TYPES, eventOf, readable } = await import("../src/trace/events.mjs");
  const rows = EVENT_TYPES.filter((r) => r.type.startsWith("task."));
  assert.deepEqual(rows.map((r) => r.type), ["task.started", "task.attempt", "task.approval.decided", "task.finished"]);
  for (const r of rows) assert.ok(r.doc.length > 20 && r.fields.length > 0, r.type);
  const meta = { id: "e-1", at: "2026-10-06T21:10:00.000Z", session: null, project: null };
  const leaky = { task: "tsk-aaaaaaaaaaaa", approval: "apr-1", decision: "granted", objective: "SENTINEL refund validation", params: { schema: 82 }, observed: "two tests failed" };
  const written = eventOf("task.approval.decided", leaky, meta);
  assert.deepEqual(Object.keys(written.data).sort(), ["approval", "decision", "task"]);
  assert.doesNotMatch(JSON.stringify(written), /SENTINEL|schema|tests failed/);
  const line = readable({ ...written, data: { ...written.data, objective: "edited in" } });
  assert.deepEqual(Object.keys(line.data).sort(), ["approval", "decision", "task"], "and a line somebody edited is cut again on the way out");
});

// ---- the sign-in event ----------------------------------------------------------------------------

test("a connection's sign-in leaves a fixed-vocabulary moment on the trail: never an account, a directory, a tenant, a token or what a tool printed", async () => {
  const { EVENT_TYPES, eventOf, readable } = await import("../src/trace/events.mjs");
  const rows = EVENT_TYPES.filter((r) => r.type === "connection.auth");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].fields, ["provider", "strategy", "phase", "outcome"]);
  const meta = { id: "e-1", at: "2026-10-29T10:00:00.000Z", session: null, project: null };
  const leaky = { provider: "azure-devops", strategy: "azure-cli", phase: "login", outcome: "ok", tenant: "contoso.example", account: "person@contoso.example", token: "SENTINEL-TOKEN-aaaaaaaaaaaaaaaaaaaa", stderr: "To sign in, use a web browser ... ABCD1234" };
  const written = eventOf("connection.auth", leaky, meta);
  assert.deepEqual(Object.keys(written.data).sort(), ["outcome", "phase", "provider", "strategy"]);
  assert.doesNotMatch(JSON.stringify(written), /contoso|SENTINEL|ABCD1234|person@/);
  const line = readable({ ...written, data: { ...written.data, tenant: "edited in" } });
  assert.deepEqual(Object.keys(line.data).sort(), ["outcome", "phase", "provider", "strategy"], "and a line somebody edited is cut again on the way out");
});

// ---- 0.2.2, ADR 0044: which agent made a call, as the host's own payload says -------------------------------------

const envelopeText = (mission, run) => JSON.stringify({ api: "orbit.satellite.envelope/v1", missionId: mission, agentRunId: run, instruction: { text: "SECRET-SENTINEL read the notifier" } }, null, 2);

test("end to end through the real hooks: a subagent's calls carry its agent, a duplicate delivery is one event, and nothing it said is kept", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-trail-agents-"));
  const env = sealed({ ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: join(ROOT, "test", "fixtures", "ui-tests") });
  const hook = (input) => spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs")], { input: JSON.stringify({ session_id: "raw-s-7", cwd: ROOT, ...input }), env, encoding: "utf8", timeout: 30000 });
  const sub = { agent_id: "raw-agent-X", agent_type: "orbit:satellite-reader" };
  hook({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "toolu_A", tool_input: { subagent_type: "orbit:satellite-reader", prompt: envelopeText("msn-0123456789ab", "arn-1") } });
  hook({ hook_event_name: "SubagentStart", ...sub });
  for (const _ of [1, 2]) hook({ hook_event_name: "PostToolUse", ...sub, tool_name: "Read", tool_use_id: "toolu_R1", tool_input: { file_path: join(ROOT, "README.md") }, tool_response: { file: { content: "SECRET-SENTINEL" } } });
  hook({ hook_event_name: "PostToolUse", ...sub, tool_name: "Bash", tool_use_id: "toolu_B1", tool_input: { command: "node --version" }, tool_response: { stdout: "SECRET-SENTINEL" } });
  hook({ hook_event_name: "PostToolUse", tool_name: "Agent", tool_use_id: "toolu_A", tool_input: { subagent_type: "orbit:satellite-reader", prompt: envelopeText("msn-0123456789ab", "arn-1") }, tool_response: { status: "async_launched", agentId: "raw-agent-X" } });
  hook({ hook_event_name: "SubagentStop", ...sub, last_assistant_message: "SECRET-SENTINEL", agent_transcript_path: "/home/p/.claude/projects/x/raw-s-7/subagents/agent-raw-agent-X.jsonl" });
  hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "toolu_M1", tool_input: { command: "git status" } });
  const dir = join(store, "control", "activity", "trace");
  const text = readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => readFileSync(join(dir, n), "utf8")).join("");
  assert.doesNotMatch(text, /SECRET-SENTINEL|raw-agent-X|raw-s-7|toolu_|subagents|notifier/, "no prompt, output, last message, transcript, raw agent, session or call id");
  const u = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "trace.mjs"), "usage", "--json"], { env, encoding: "utf8" }).stdout).attribution;
  assert.equal(u.byAgent.length, 1);
  const [x] = u.byAgent;
  assert.deepEqual([x.type, x.by, x.run, x.started, x.ended, x.events, x.calls, x.commands], ["orbit:satellite-reader", "session", "msn-0123456789ab/arn-1", true, true, 2, 2, 1], "the Read delivered twice is one event");
  assert.deepEqual([u.session.events, u.session.calls], [2, 2], "the session's own Agent call and its own command");
  assert.deepEqual([u.coverage.of, u.coverage.withAgent, u.coverage.hosts.map((h) => [h.host, h.withAgent, h.events])], [4, 2, [["claude", 2, 4]]]);
});

test("an agent launched by an agent names its parent; two starts of one skill are two runs; a result nobody reported is never a success", () => {
  const emitted = [];
  const world = { plugin: "orbit", env: {}, trace: () => ({ emit: (type, data) => emitted.push(eventOf(type, data, { id: `e-${emitted.length}`, at: `2026-10-30T10:00:0${emitted.length}.000Z`, session: "claude:s1", agentHost: "claude" })), lookup: () => null }) };
  trace.run({ event: "agent-start", agent: { id: "claude:x", type: "orbit:satellite-engineer" } }, world);
  trace.run({ event: "post-tool", tool: { name: "Agent", kind: "other" }, invokes: { kind: "agent", name: "Explore" }, agent: { id: "claude:x", type: "orbit:satellite-engineer" }, delivery: "claude:c1", launched: "claude:y", ok: true }, world);
  trace.run({ event: "post-tool", tool: { name: "Read", kind: "read" }, agent: { id: "claude:y", type: "Explore" }, delivery: "claude:c2", ok: true }, world);
  for (const call of ["claude:k1", "claude:k2", "claude:k2"]) trace.run({ event: "pre-tool", invokes: { kind: "skill", name: "orbit:orbit-develop" }, agent: { id: "claude:y", type: "Explore" }, delivery: call }, world);
  const launched = emitted.find((e) => e.type === "agent.launched");
  assert.deepEqual([launched.data.agent, launched.data.launched, launched.data.call], ["claude:x", "claude:y", "claude:c1"]);
  const u = usageOf([...emitted, ev("tool.used", { tool: "Bash", kind: "command", ok: null, outcome: "unknown" })]);
  assert.deepEqual(u.attribution.byAgent.find((r) => r.agent === "claude:y").by, "claude:x");
  assert.deepEqual(u.attribution.byAgent.find((r) => r.agent === "claude:y").skills, ["orbit-develop"]);
  assert.deepEqual(u.skills.map((s) => [s.id, s.invoked, s.runs]), [["orbit-develop", 3, 2]], "three starts, one delivered twice: two runs");
  assert.deepEqual([u.attribution.session.unknown, u.attribution.session.failed], [1, 0]);
});

// 0.5.0 (B22, ADR 0050): RouteDecision v3 reaches the trail as table words and ids -- the strategy's word and row, the
// activation's path and id, the synthetic flag -- and never its reason or its command, which carry the engine's path.
test("a v3 decision tells the trail its strategy, the path and id it named, and whether the host wrote the prompt -- nothing more", () => {
  const decision = { version: 3, intent: { id: "development", confidence: "high" }, cues: ["implement"], requirements: [], graph: { nodes: [] }, selected: [], approval: [], blocked: [], missing: [], strategy: { word: "COORDINATED", row: "several-owners", because: "free text of a reason", shown: true }, activation: { path: "workflow", id: "orbit-help", how: "automation", invoke: "node /home/someone/plugin/cli/automation.mjs start" }, synthetic: false };
  const facts = decisionFacts(decision, true);
  assert.deepEqual([facts.strategy, facts.activation, facts.synthetic], [{ word: "COORDINATED", row: "several-owners" }, { path: "workflow", id: "orbit-help" }, false]);
  assert.equal(/free text|someone|automation\.mjs/.test(JSON.stringify(facts)), false, "neither the reason nor the command");
  const e = eventOf("prompt.submitted", { prompt: { chars: 9 }, ...facts, because: "sneaked" }, { id: "e-v3", at: "2026-11-05T00:00:00.000Z" });
  assert.deepEqual(["strategy", "activation", "synthetic"].map((k) => k in e.data), [true, true, true]);
  assert.equal("because" in e.data, false, "the allow-list keeps what it declares and nothing else");
  assert.deepEqual(decisionFacts(null, false, true), { routing: "off", synthetic: true }, "with routing off, a host's own prompt is still said to be one");
  assert.deepEqual(decisionFacts(null, false), { routing: "off" }, "and a person's is what it always was");
  assert.equal("strategy" in decisionFacts({ ...decision, strategy: undefined, activation: undefined }, false), false, "a v2 decision carries no strategy");
});

// ---- 0.5.0 (B22 M3, ADR 0050): what a Stop hold counts, and the activation chain ------------------------------------

test("a prompt's MARKS reach the trail as table words, with routing on or off, and only when there is one", () => {
  const decision = { intent: { id: "general", confidence: "low" }, cues: [], requirements: [], graph: { nodes: [] }, selected: [], approval: [], blocked: [], missing: [] };
  assert.deepEqual(decisionFacts(decision, false, false, ["halt"]).marks, ["halt"]);
  assert.deepEqual(decisionFacts(null, false, false, ["halt", "command"]), { routing: "off", marks: ["halt", "command"] }, "routing off: still said, so a hold can tell a person said to stop");
  assert.equal("marks" in decisionFacts(decision, false, false, []), false);
  const e = eventOf("prompt.submitted", { prompt: { chars: 4 }, routing: "off", marks: ["halt"] }, { id: "e-m", at: "2026-11-05T00:00:00.000Z" });
  assert.deepEqual(e.data.marks, ["halt"]);
});

test("turn.held keeps which workflow, which ready steps and which hold of the prompt -- never the reason's text", () => {
  const e = eventOf("turn.held", { task: "tsk-0123456789ab", steps: ["qa"], count: 1, reason: "Orbit holds this turn: SENTINEL", because: "SENTINEL" }, { id: "e-h", at: "2026-11-05T00:00:00.000Z" });
  assert.deepEqual(e.data, { task: "tsk-0123456789ab", steps: ["qa"], count: 1 });
  assert.equal(readable({ ...e, data: { ...e.data, reason: "edited in" } }).data.reason, undefined);
  assert.deepEqual(turnsOf([ev("prompt.submitted", { routing: "off" }), ev("turn.held", { task: "tsk-0123456789ab", steps: ["qa", "review"], count: 1 })])[0].steps.map((s) => [s.kind, s.label]), [["hold", "held for tsk-0123456789ab (qa, review)"]], "a hold is a step of the turn it held");
});

test("an OPERATION is kept only where the usage documents it after that subcommand: `goal step`, never an argument or a description", () => {
  const header = headerOf(readFileSync(join(ROOT, "cli", "orbit.mjs"), "utf8"));
  const words = new Set([...documented(header, "orbit"), ...operations(header, "orbit")]);
  assert.ok(["goal start", "goal step", "goal status", "goal resume"].every((w) => words.has(w)));
  const lookup = (rel) => (rel === "cli/orbit.mjs" ? words : null);
  assert.deepEqual(orbitCommands("node /p/cli/orbit.mjs goal step goal-0123456789ab --json", lookup), [{ id: "cli/orbit", sub: "goal", op: "step" }]);
  assert.deepEqual(orbitCommands("node /p/cli/orbit.mjs goal goal-0123456789ab", lookup), [{ id: "cli/orbit", sub: "goal" }], "an id after the subcommand is no operation");
  assert.deepEqual(orbitCommands("node /p/cli/orbit.mjs goal step", () => documented(header, "orbit")), [{ id: "cli/orbit", sub: "goal" }], "a lookup that knows no operation answers what it always did");
  for (const [file, name] of [["help.mjs", "help"], ["plan-check.mjs", "plan-check"], ["schema.mjs", "schema"], ["automation.mjs", "automation"], ["setup.mjs", "setup"]]) assert.deepEqual([...operations(headerOf(readFileSync(join(ROOT, "cli", file), "utf8")), name)], [], `${file}: a description a column away is no operation`);
  const emitted = [];
  trace.run({ event: "post-tool", tool: { kind: "command" }, command: "node /p/cli/orbit.mjs goal step goal-0123456789ab", ok: true }, { plugin: "orbit", env: {}, trace: () => ({ emit: (type, data) => emitted.push({ type, data }), lookup }) });
  assert.deepEqual(emitted.map((e) => e.data), [{ orbit: "cli/orbit", sub: "goal", op: "step", ok: true }]);
  assert.deepEqual(eventOf("command.ran", { orbit: "cli/orbit", sub: "goal", op: "step", ok: true }, { id: "e-o", at: "2026-11-05T00:00:00.000Z" }).data.op, "step");
});

test("the trail's one bounded read: this host's newest shards, their tails, and one session's lines alone", () => {
  const io = fakeIo({ host: "laptop-a" });
  const log = traceLog(rooms, io);
  const at = (day, s) => `2026-11-0${day}T10:00:${String(s).padStart(2, "0")}.000Z`;
  for (const [day, session, type] of [[1, "claude:s1", "turn.ended"], [4, "claude:s1", "prompt.submitted"], [5, "claude:s1", "command.ran"], [5, "claude:s2", "prompt.submitted"], [5, "claude:s1", "turn.held"]]) log.append(ev(type, {}, { at: at(day, seq % 60), session }));
  io.files.set(join(rooms.trace, "2026-11-05-laptop-b.jsonl"), `${JSON.stringify(ev("turn.ended", {}, { at: at(5, 1), session: "claude:s1" }))}\n`);
  assert.deepEqual(log.recent({ session: "claude:s1" }).map((e) => e.type), ["prompt.submitted", "command.ran", "turn.held"], "the two newest of THIS host's shards; another host's shard and older days are not read");
  assert.deepEqual(log.recent({ session: "claude:s9" }), []);
  assert.deepEqual(log.recent({}), [], "no session, no lines");
  const shard = join(rooms.trace, "2026-11-05-laptop-a.jsonl");
  io.files.set(shard, `${"x".repeat(RECENT_BYTES)}\n${io.files.get(shard)}`);
  assert.deepEqual(log.recent({ session: "claude:s1" }).map((e) => e.type), ["prompt.submitted", "command.ran", "turn.held"], "only the tail is read: a long day's head is cut, whole lines kept");
});

test("the newest turn of one session is its last prompt and everything of that session after it", () => {
  const events = [ev("prompt.submitted", { routing: "off" }), ev("command.ran", { orbit: "cli/automation", sub: "step", ok: true }), ev("prompt.submitted", { routing: "on" }), ev("tool.used", { tool: "Read", kind: "read", ok: true }), ev("tool.used", { tool: "Read", kind: "read", ok: true }, { session: "claude:other" })];
  const last = lastTurnOf(events, "claude:s1");
  assert.deepEqual([last.prompt.data.routing, last.events.map((e) => e.type)], ["on", ["tool.used"]]);
  assert.equal(lastTurnOf(events.slice(1, 2), "claude:s1"), null, "no prompt of the session: nobody can say which turn this is");
});

// One turn of a session, as the hooks record it: the router's decision, then what the session did.
const routedAs = (strategy, activation, selected = []) => ev("prompt.submitted", { prompt: { chars: 30 }, routing: "on", intent: "development", confidence: "high", selected, strategy, activation });
const VIA = { "orbit-map-healer": ["orbit-ui-map", "orbit-test-suite"], "satellite-reader": ["satellite"] };
const agentRan = (id, over = {}) => ev("agent.invoked", { id: `orbit:${id}`, ours: true, outcome: "started", ...over });

test("the activation chain: five links, each from its own source with its basis, and the verdict extended by over-delegated alone", () => {
  assert.deepEqual(LINKS.map((l) => l.link), ["suggested", "selected", "dispatched", "executed", "verified"]);
  assert.deepEqual(LINKS.map((l) => l.basis), ["ORBIT_DECISION", "HOST_OBSERVED", "HOST_OBSERVED", "RUNTIME_BOUND", "OWNER_RECORD"]);
  assert.ok(LINKS.slice(1, 4).every((l) => ATTRIBUTION_WORDS.includes(l.basis)), "the middle three are attribution words");
  assert.deepEqual(ACTIVATION_VERDICTS, [...FOLLOW_VERDICTS, "over-delegated"]);
  const events = [routedAs({ word: "DIRECT", row: "one-skill" }, { path: "skill", id: "orbit-develop" }, [{ kind: "skill", id: "orbit-develop" }]), ev("skill.invoked", { id: "orbit:orbit-develop", ours: true, outcome: "started" }), ev("skill.invoked", { id: "orbit:orbit-report", ours: true, outcome: "refused" }), ev("task.started", { task: "tsk-0123456789ab" }), ev("command.ran", { orbit: "cli/context", ok: true }), ev("turn.ended")];
  const [t] = activationOf(events).turns;
  assert.deepEqual([t.strategy, t.verdict.verdict, t.excess], [{ word: "DIRECT", row: "one-skill" }, "followed", []]);
  assert.deepEqual([t.links.suggested.ids, t.links.selected.ids, t.links.dispatched.ids], [["orbit-develop"], ["orbit-develop", "orbit-report"], ["orbit-develop"]], "a call its switch refused was selected, never dispatched");
  assert.deepEqual(t.links.executed.owners, [{ type: "task.started", id: "tsk-0123456789ab" }], "an owner's own event is the executed link; a command the hooks saw is not");
  assert.deepEqual([t.links.suggested.source.split(" · ")[0], t.links.selected.basis, t.links.executed.basis, t.links.verified.source], ["prompt.submitted", "HOST_OBSERVED", "RUNTIME_BOUND", "the work view (workViewOf), read back from the owners and handed in"]);
});

test("owner-verified comes ONLY from the work view handed in: a task the trail says finished is never verified by the trail", () => {
  const events = [routedAs({ word: "DIRECT", row: "one-skill" }, { path: "skill", id: "orbit-engineer" }), ev("task.finished", { task: "tsk-0123456789ab", lifecycle: "COMPLETED" }), ev("turn.ended")];
  const without = activationOf(events).turns[0].links.verified;
  assert.deepEqual([without.verified, without.level, without.work], [false, null, null], "no view: nothing is verified, whatever the trail says");
  const view = { work: "w-0123456789ab", lifecycle: { state: "REPORTED_DONE" }, evidence: { level: "verified", why: "task tsk-0123456789ab completed, as its own journal says" } };
  const a = activationOf(events, { work: () => view });
  assert.deepEqual([a.turns[0].links.verified.verified, a.turns[0].links.verified.work, a.turns[0].links.verified.basis], [true, "w-0123456789ab", "OWNER_RECORD"]);
  assert.deepEqual(a.works.map((w) => [w.work, w.turns.length, w.links.verified.verified]), [["w-0123456789ab", 1, true]], "and per work");
  const reported = activationOf(events, { work: () => ({ ...view, evidence: { level: "reported", why: "reported by the host" } }) }).turns[0].links.verified;
  assert.deepEqual([reported.verified, reported.level], [false, "reported"], "a reported work is not a verified one");
});

test("over-delegated: a via agent with no parent in the turn, an agent no strategy path named, one agent type twice for one work -- never a mission's run", () => {
  const verdictOf = (events) => activationOf(events, { via: VIA }).turns[0];
  const skillTurn = routedAs({ word: "DIRECT", row: "one-skill" }, { path: "skill", id: "orbit-ui-test" }, [{ kind: "skill", id: "orbit-ui-test" }]);
  const orphan = verdictOf([skillTurn, agentRan("orbit-map-healer")]);
  assert.deepEqual([orphan.verdict.verdict, orphan.excess], ["over-delegated", [{ agent: "orbit-map-healer", why: "via-without-parent" }]]);
  assert.match(orphan.verdict.say, /orbit-map-healer is dispatched only from its parent skill/);
  assert.equal(verdictOf([skillTurn, ev("skill.invoked", { id: "orbit:orbit-ui-map", ours: true, outcome: "started" }), agentRan("orbit-map-healer")]).verdict.verdict, "diverged", "its parent ran: the agent is its parent's to dispatch, and the turn's verdict is the followed one");
  assert.deepEqual(verdictOf([skillTurn, agentRan("orbit-failure-analyst")]).excess, [{ agent: "orbit-failure-analyst", why: "not-in-strategy" }]);
  assert.deepEqual(verdictOf([routedAs({ word: "NONE", row: "conversational" }, { path: "none", id: null }), agentRan("orbit-qa-agent")]).excess, [{ agent: "orbit-qa-agent", why: "not-in-strategy" }], "a NONE turn names no agent");
  assert.equal(verdictOf([routedAs({ word: "DIRECT", row: "one-agent" }, { path: "agent", id: "orbit-failure-analyst" }, [{ kind: "agent", id: "orbit-failure-analyst" }]), agentRan("orbit-failure-analyst")]).verdict.verdict, "followed", "the one agent the strategy named");
  assert.deepEqual(verdictOf([routedAs({ word: "COORDINATED", row: "several-owners" }, { path: "workflow", id: "orbit-help" }), agentRan("orbit-qa-agent"), agentRan("orbit-qa-agent")]).excess, [{ agent: "orbit-qa-agent", why: "twice-for-one-work" }]);
  assert.deepEqual(verdictOf([routedAs({ word: "COORDINATED", row: "several-owners" }, { path: "workflow", id: "orbit-help" }), agentRan("orbit-engineering-agent"), agentRan("orbit-qa-agent")]).excess, [], "a coordinated path dispatches its steps' agents: each once is accounted for");
  const mission = [routedAs({ word: "SATELLITE", row: "mission" }, { path: "mission", id: "satellite" }), agentRan("satellite-reader", { run: "msn-0123456789ab/arn-1" }), agentRan("satellite-reader", { run: "msn-0123456789ab/arn-2" })];
  assert.deepEqual(verdictOf(mission).excess, [], "a mission's runs are its mission's to account for, however many");
  assert.deepEqual(verdictOf([routedAs(undefined, undefined), agentRan("orbit-qa-agent")]).excess, [], "no strategy recorded: nothing the strategy did not account for");
  assert.deepEqual(verdictOf([skillTurn, agentRan("orbit-map-healer", { outcome: "refused" }), ev("agent.invoked", { id: "Explore", ours: false, outcome: "started" })]).excess, [], "a refused call and another plugin's agent are not Orbit's dispatches");
});

test("over-delegated across the turns of one work: one agent type dispatched in two turns of one work", () => {
  const view = { work: "w-0123456789ab", lifecycle: { state: "IN_PROGRESS" }, evidence: { level: "observed", why: "seen" } };
  const turnOne = [routedAs({ word: "COORDINATED", row: "several-owners" }, { path: "workflow", id: "orbit-help" }), agentRan("orbit-qa-agent"), ev("turn.ended")];
  const turnTwo = [routedAs({ word: "RESUME", row: "resume" }, { path: "resume", id: "w-0123456789ab" }), agentRan("orbit-qa-agent"), ev("turn.ended")];
  const a = activationOf([...turnOne, ...turnTwo], { work: () => view });
  assert.deepEqual(a.turns.map((t) => t.excess), [[], []], "each turn alone is fine");
  assert.deepEqual(a.works.map((w) => [w.work, w.turns.length, w.verdict.verdict]), [["w-0123456789ab", 2, "over-delegated"]]);
});

test("end to end through cli/trace.mjs: `activation` prints each link with its source and basis, and --json is the fold", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-trail-activation-"));
  const env = sealed({ ORBIT_STORE_DIR: store });
  const hook = (file, input) => spawnSync(process.execPath, [join(ROOT, "cli", file)], { input: JSON.stringify({ session_id: "raw-a-1", cwd: store, ...input }), env, encoding: "utf8", timeout: 30000 });
  hook("router-hook.mjs", { hook_event_name: "UserPromptSubmit", prompt: "find the locator that drifted on the orders screen" });
  hook("learn-hook.mjs", { hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "toolu_1", tool_input: { subagent_type: "orbit:orbit-map-healer", prompt: "x" } });
  hook("learn-hook.mjs", { hook_event_name: "Stop" });
  const text = spawnSync(process.execPath, [join(ROOT, "cli", "trace.mjs"), "activation"], { env, encoding: "utf8", cwd: store });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ACTIVATION  last 1 day\(s\) · 1 turn\(s\)/);
  assert.match(text.stdout, /OVER-DELEGATED/);
  assert.match(text.stdout, /selected orbit-map-healer → dispatched orbit-map-healer/);
  assert.match(text.stdout, /verified: the work view \(workViewOf\), read back from the owners and handed in \(OWNER_RECORD\)/);
  const json = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "trace.mjs"), "activation", "--json"], { env, encoding: "utf8", cwd: store }).stdout);
  assert.deepEqual([json.version, json.turns.length, json.turns[0].verdict.verdict, json.turns[0].excess[0].why], [1, 1, "over-delegated", "via-without-parent"]);
  assert.equal(json.turns[0].links.verified.verified, false, "no tracked work here: nothing verified");
});

// 0.6.0 (P2, P6): advice from evidence is a suggestion too -- unioned into the suggested link with what it was about, so
// the chain follows advice -> selected -> executed -> the owner's word; and an agent it named is accounted for.
test("advice.given joins the suggested link with its fact and subject, and an agent it named is not over-delegation", () => {
  const advised = (provider, kind = "skill") => ev("advice.given", { fact: "check.failed", subject: "test (npm)", provider, kind, text: "never kept" });
  assert.deepEqual(Object.keys(eventOf("advice.given", { fact: "check.failed", subject: "test (npm)", provider: "orbit-develop", kind: "skill", text: "the line", prompt: "x" }, { id: "e-1", at: "2026-11-12T00:00:00.000Z" }).data).sort(), ["fact", "kind", "provider", "subject"], "an allow-list: never the line's text");
  const none = routedAs({ word: "NONE", row: "conversational" }, { path: "none", id: null });
  const [t] = activationOf([none, ev("command.ran", { class: "test", exe: "npm", ok: false }), advised("orbit-develop"), ev("skill.invoked", { id: "orbit:orbit-develop", ours: true, outcome: "started" }), ev("task.started", { task: "tsk-0123456789ab" })]).turns;
  assert.deepEqual(t.links.suggested.ids, ["orbit-develop"]);
  assert.deepEqual(t.links.suggested.advised, [{ fact: "check.failed", subject: "test (npm)", provider: "orbit-develop", kind: "skill" }]);
  assert.deepEqual([t.links.selected.ids, t.links.dispatched.ids, t.links.executed.owners.map((o) => o.id)], [["orbit-develop"], ["orbit-develop"], ["tsk-0123456789ab"]]);
  const agentTurn = activationOf([none, advised("orbit-failure-analyst", "agent"), agentRan("orbit-failure-analyst")], { via: VIA }).turns[0];
  assert.deepEqual(agentTurn.excess, [], "advice named it: accounted for");
  assert.equal(activationOf([none, agentRan("orbit-failure-analyst")], { via: VIA }).turns[0].excess.length, 1, "and without the advice, still over-delegated");
});
