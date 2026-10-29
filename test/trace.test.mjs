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
import { documented, headerOf, orbitCommands } from "../src/trace/commands.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { eventOf, readable } from "../src/trace/events.mjs";
import { KEEP_DAYS, MAX_SHARD_BYTES, traceLog } from "../src/trace/log.mjs";
import { decisionFacts, promptFacts } from "../src/trace/prompt.mjs";
import { turnsOf } from "../src/trace/projections/turns.mjs";
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
