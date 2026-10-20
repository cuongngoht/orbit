// UNIFIED WORK TRACKING (1.8.8): one stable work id follows a request from /orbit-help through the host or an autonomous task to what
// it came to, and one read model says where it stands. These tests drive the engine over a real disk with a clock they move, and the
// working sets of "sessions" they write the lines of themselves. NONE of them is host-live verification: no Claude Code, Codex or
// Antigravity hook ran, so what they prove is what the engine does with the lines such a hook keeps -- not that a host sends them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { startWork } from "../src/work/actions.mjs";
import { modelOf } from "../src/work/model.mjs";
import { workOf } from "../src/work/store.mjs";
import { workSummary } from "../src/work/summary.mjs";
import { attach, attachNamed, attached } from "../src/work/track/auto.mjs";
import { trackOf } from "../src/work/track/fold.mjs";
import { continuedWork, digestOf, refWorkId } from "../src/work/track/ids.mjs";
import { currentOf, listOf, scanOf } from "../src/work/track/resolve.mjs";
import { handoff, link, report, state, track } from "../src/work/track/write.mjs";
import { phaseAt } from "../src/work/track/fold.mjs";
import { LIFECYCLE } from "../src/work/track/vocab.mjs";
import { TASK_A, TASK_B, trackWorld } from "./work-track.harness.mjs";

const journalOf = (w, id) => readFileSync(join(w.works.dirOf(id), "journal.jsonl"), "utf8");
const kindsOf = (w, id) => w.works.read(id).map((l) => l.kind);
const AUTO_OFF = "no Automation setting is read or written anywhere in this test: tracking needs none";

// ---- identity -----------------------------------------------------------------------------------------

test("a request is tracked: the work is created once, this session is bound to it, and a replay finds the same open work", (t) => {
  const w = trackWorld(t);
  const first = track(w.ctx(), { objective: "Fix the refund limit", route: "orbit-develop", because: "a small change", skill: "orbit-help" });
  assert.deepEqual([first.tracked, first.created, first.how, first.mode, first.route], [true, true, "request", "developer", "orbit-develop"]);
  w.tick();
  const again = track(w.ctx(), { objective: "Fix the refund limit", route: "orbit-develop", because: "a small change", skill: "orbit-help" });
  assert.deepEqual([again.work, again.created, again.changed], [first.work, false, false], "a replay is the same work and writes nothing");
  assert.deepEqual(kindsOf(w, first.work), ["created", "bound"]);
});

test("the same request after the work was closed is a NEW work (the next generation), and a replay then finds that one", (t) => {
  const w = trackWorld(t);
  const one = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  report(w.ctx(), { work: one, outcome: "done", summary: "fixed" });
  w.tick();
  const two = track(w.ctx(), { objective: "Fix the refund limit" });
  assert.notEqual(two.work, one);
  assert.equal(two.created, true);
  assert.equal(track(w.ctx(), { objective: "Fix the refund limit" }).work, two.work);
  assert.equal(trackOf(w.works.read(one)).closed.outcome, "done", "the first work is still what it was reported to be");
});

test("two sessions asking for the same thing are two works: a title alone is never what merges them", (t) => {
  const w = trackWorld(t);
  const a = track(w.ctx("sess-a"), { objective: "Fix the refund limit" });
  w.tick();
  const b = track(w.ctx("sess-b"), { objective: "  fix the REFUND limit " });
  assert.notEqual(a.work, b.work);
  assert.equal(digestOf("Fix the refund  limit"), digestOf("fix the refund limit"), "spacing and case are not a different request, inside one session");
  assert.equal(currentOf(scanOf(w.works), w.ctx("sess-a").session, w.ctx().checkout).id, a.work);
  assert.equal(currentOf(scanOf(w.works), w.ctx("sess-b").session, w.ctx().checkout).id, b.work);
});

test("--continue names a work and reopens a closed one; an unknown or malformed id is refused and creates nothing", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  report(w.ctx(), { work: made, outcome: "done" });
  w.tick();
  const back = track(w.ctx("sess-b"), { continue: made });
  assert.deepEqual([back.work, back.reopened, back.created], [made, true, false]);
  assert.equal(trackOf(w.works.read(made)).closed, null, "continuing is the explicit act that moves a closed work");
  assert.throws(() => track(w.ctx(), { continue: "w-000000000000" }), Refused);
  assert.throws(() => continuedWork(w.works, "../etc"), Refused);
  assert.deepEqual(w.works.list(), [made]);
});

test("--ref names the item's own work: the requirement's when one is kept, else an id taken from the item, the same in every session", (t) => {
  const w = trackWorld(t);
  const kept = { root: "req-3f9a1c0b7e21", identity: { provider: "azure-devops", organization: "acme", project: "web", id: "482" } };
  const viaRequirement = track(w.ctx("sess-a", { requirementOf: () => kept }), { objective: "Implement PBI-482", ref: "PBI-482" });
  assert.equal(viaRequirement.work, workOf(kept.root), "the requirement's work, so `work start --ref` and tracking are one work");
  assert.deepEqual(w.works.read(viaRequirement.work)[0].root, kept.identity);
  const bare = track(w.ctx("sess-a"), { ref: "BUG-218" });
  const other = track(w.ctx("sess-b"), { ref: "bug-218" });
  assert.equal(bare.work, other.work);
  assert.equal(bare.work, refWorkId("BUG-218"));
  assert.equal(w.works.read(bare.work)[0].objective, "work item BUG-218");
});

test("no session mark and no --ref or --continue: nothing is tracked, nothing is created, and it is not an error", (t) => {
  const w = trackWorld(t);
  const got = track(w.ctx(null), { objective: "Fix the refund limit" });
  assert.deepEqual([got.tracked, got.work, got.changed], [false, null, false]);
  assert.match(got.warnings[0], /nothing is blocked/);
  assert.deepEqual(w.works.list(), []);
  const named = track(w.ctx(null), { ref: "PBI-1" });
  assert.equal(named.tracked, true, "a ref names the work without a session");
  assert.match(named.warnings[0], /no session mark/);
});

// ---- 1 and 2: Automation off, and general guidance ------------------------------------------------------------

test("with Automation off, tracking creates a work and follows the host's own activity -- and creates no task, no sandbox, no workflow", (t) => {
  const w = trackWorld(t);
  assert.ok(AUTO_OFF);
  const made = track(w.ctx(), { objective: "Fix the refund limit", route: "orbit-develop", because: "a small change" }).work;
  w.tick();
  w.edit("sess-a", "src/RefundService.cs");
  w.tick();
  w.run("sess-a", "test", "dotnet", true);
  const view = w.view(made);
  assert.deepEqual([view.mode, view.lifecycle.state, view.evidence.level, view.tasks], ["developer", "IN_PROGRESS", "observed", []]);
  assert.deepEqual(view.activity.files, [{ path: "src/RefundService.cs", attribution: "observed" }]);
  assert.deepEqual(readdirSync(join(w.dir, "store")), ["work"], "the only room tracking wrote is the work's: no task, orchestration or runtime room");
});

test("general guidance is not a work: a session that asks nothing concrete tracks nothing", (t) => {
  const w = trackWorld(t);
  assert.throws(() => track(w.ctx(), { objective: "" }), /say what the request is/);
  assert.deepEqual(w.works.list(), []);
  assert.equal(currentOf(scanOf(w.works), w.ctx().session, w.ctx().checkout), null);
  assert.deepEqual(listOf(scanOf(w.works), w.ctx().checkout), []);
});

// ---- 3 and 4: autonomous, handoff ------------------------------------------------------------------------

test("a workflow and its engineering task join the session's CURRENT work, once each, and the work goes to the autonomous side once", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  const flow = attach(w.ctx(), { task: TASK_A, what: "workflow", because: "a coordinated workflow took the work" });
  w.tick();
  const eng = attach(w.ctx(), { task: TASK_B, what: "task", because: "an engineering task was started" });
  assert.deepEqual([flow.work, flow.linked, flow.handedOver, eng.work, eng.linked, eng.handedOver], [made, true, true, made, true, false]);
  assert.equal(attach(w.ctx(), { task: TASK_B, what: "task" }).linked, false, "joining twice is the same line");
  w.task(TASK_A, { lifecycle: "EXECUTING", stage: "REQUIREMENT" });
  w.task(TASK_B, { lifecycle: "EXECUTING", stage: "TESTING" });
  const view = w.view(made);
  assert.deepEqual(view.tasks.map((x) => [x.task, x.what, x.lifecycle]), [[TASK_A, "workflow", "EXECUTING"], [TASK_B, "task", "EXECUTING"]]);
  assert.equal(view.mode, "autonomous");
});

test("a task that starts where no work is tracked creates NOTHING; a closed work, and another session's work, are not joined", (t) => {
  const w = trackWorld(t);
  assert.equal(attach(w.ctx(), { task: TASK_A, what: "task" }), null);
  assert.deepEqual(w.works.list(), []);
  const closed = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  report(w.ctx(), { work: closed, outcome: "done" });
  assert.equal(attach(w.ctx(), { task: TASK_A, what: "task" }), null, "a task nobody asked about by name is not a request to reopen");
  track(w.ctx("sess-b"), { objective: "Another thing" });
  assert.equal(attach(w.ctx("sess-c"), { task: TASK_B, what: "task" }), null, "a session never joins a task to a work it did not bind");
});

test("`task create --work` joins only a work that is TRACKED; a requirement's work nobody tracks is left as it was", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  assert.equal(attachNamed(w.ctx(), made, { task: TASK_A, what: "task" }).linked, true);
  startWork({ works: w.works, now: w.now, session: "s" }, { objective: "Implement the refund limit", root: "req-3f9a1c0b7e21", identity: { id: "1" } });
  assert.equal(attachNamed(w.ctx(), workOf("req-3f9a1c0b7e21"), { task: TASK_B, what: "task" }), null);
  assert.deepEqual(kindsOf(w, workOf("req-3f9a1c0b7e21")), ["created"]);
});

test("developer -> autonomous keeps the same work id and its whole history: one handoff line, nothing re-bound, nothing lost", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  w.edit("sess-a", "src/a.cs");
  w.tick();
  const moved = handoff(w.ctx(), { work: made, to: "autonomous", task: TASK_A, because: "automation took it" });
  assert.deepEqual([moved.changed, moved.from, moved.to, moved.linked], [true, "developer", "autonomous", true]);
  assert.deepEqual(kindsOf(w, made), ["created", "bound", "linked", "handoff"]);
  const again = handoff(w.ctx(), { work: made, to: "autonomous", task: TASK_A });
  assert.deepEqual([again.changed, again.duplicate], [false, true], "already there: a no-op");
  handoff(w.ctx(), { work: made, to: "developer", because: "back to the host" });
  const view = w.view(made);
  assert.deepEqual(view.handoffs.map((h) => [h.from, h.to]), [["developer", "autonomous"], ["autonomous", "developer"]]);
  assert.deepEqual([view.work, view.mode, view.activity.files.length], [made, "developer", 1], "the activity from before the handoff is still the work's");
});

test("what a session did is attributed to the mode and task standing at that moment", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  const before = w.now();
  w.tick(10);
  handoff(w.ctx(), { work: made, to: "autonomous", task: TASK_A });
  w.tick(10);
  const fold = trackOf(w.works.read(made));
  assert.deepEqual(phaseAt(fold, before), { mode: "developer", task: null });
  assert.deepEqual(phaseAt(fold, w.now()), { mode: "autonomous", task: TASK_A });
});

// ---- 5, 7 and 8: attribution ---------------------------------------------------------------------------------

test("a session's activity belongs to the work it was bound to AT THE TIME: binding another work moves what comes after, never what came before", (t) => {
  const w = trackWorld(t);
  const one = track(w.ctx(), { objective: "First request" }).work;
  w.tick();
  w.edit("sess-a", "src/one.cs");
  w.tick();
  const two = track(w.ctx(), { objective: "Second request" }).work;
  w.tick();
  w.edit("sess-a", "src/two.cs");
  assert.deepEqual(w.view(one).activity.files.map((f) => f.path), ["src/one.cs"]);
  assert.deepEqual(w.view(two).activity.files.map((f) => f.path), ["src/two.cs"]);
  w.tick();
  track(w.ctx(), { continue: one });
  w.tick();
  w.edit("sess-a", "src/three.cs");
  assert.deepEqual(w.view(one).activity.files.map((f) => f.path).sort(), ["src/one.cs", "src/three.cs"], "going back to a work resumes its attribution");
  assert.deepEqual(w.view(two).activity.files.map((f) => f.path), ["src/two.cs"]);
});

test("two sessions in one project do not mix, and a path both edited is flagged shared in each", (t) => {
  const w = trackWorld(t);
  const a = track(w.ctx("sess-a"), { objective: "Request A" }).work;
  const b = track(w.ctx("sess-b"), { objective: "Request B" }).work;
  w.tick();
  w.edit("sess-a", "src/a.cs", "src/both.cs");
  w.edit("sess-b", "src/b.cs", "src/both.cs");
  w.run("sess-b", "test", "npm", true);
  const va = w.view(a, "sess-a");
  const vb = w.view(b, "sess-b");
  assert.deepEqual(va.activity.files.map((f) => [f.path, f.attribution]).sort(), [["src/a.cs", "observed"], ["src/both.cs", "shared"]]);
  assert.deepEqual(vb.activity.files.map((f) => [f.path, f.attribution]).sort(), [["src/b.cs", "observed"], ["src/both.cs", "shared"]]);
  assert.deepEqual([va.activity.checks.length, vb.activity.checks.length], [0, 1], "B's command is not A's check");
  assert.notEqual(va.sessions[0].session, vb.sessions[0].session);
});

test("only an edit tool's lines count: files dirty before the work began, reads, and edits from before the binding are not its changes", (t) => {
  const w = trackWorld(t);
  w.edit("sess-a", "src/dirty-before.cs");
  w.tick();
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  w.read("sess-a", "src/only-read.cs");
  w.tick();
  w.edit("sess-a", "src/changed.cs");
  assert.deepEqual(w.view(made).activity.files.map((f) => f.path), ["src/changed.cs"]);
  const reported = report(w.ctx(), { work: made, outcome: "done", changed: [{ path: "src/typed-by-the-caller.cs" }] });
  assert.deepEqual(w.works.read(made).at(-1).changed.map((c) => c.path), ["src/changed.cs"], "the report's files are what was observed, never what the caller typed");
  assert.equal(reported.files, 1);
});

// ---- 6 and 12: replays and late events -----------------------------------------------------------------------

test("a callback delivered twice -- the same event id, or the same state -- adds no line and no work", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit", eid: "t1" }).work;
  const lines = () => w.works.read(made).length;
  const sends = [
    () => track(w.ctx(), { objective: "Fix the refund limit", eid: "t1" }),
    () => link(w.ctx(), { work: made, what: "task", target: TASK_A, eid: "l1" }),
    () => link(w.ctx(), { work: made, what: "task", target: TASK_A, eid: "l1" }),
    () => handoff(w.ctx(), { work: made, to: "autonomous", eid: "h1" }),
    () => handoff(w.ctx(), { work: made, to: "autonomous", eid: "h1" }),
    () => state(w.ctx(), { work: made, state: "waiting", wait: "user", why: "which database?", eid: "s1" }),
    () => state(w.ctx(), { work: made, state: "waiting", wait: "user", why: "which database?", eid: "s1" }),
    () => state(w.ctx(), { work: made, state: "waiting", wait: "user", why: "which database?" }),
  ];
  const counts = sends.map((send) => { send(); return lines(); });
  assert.deepEqual(counts, [2, 3, 3, 4, 4, 5, 5, 5], "each distinct event is one line, and a repeat is none");
  assert.deepEqual(w.works.list(), [made]);
  assert.equal(trackOf(w.works.read(made)).duplicates, 0);
});

test("a work that was closed is moved only by an explicit reopening: late progress changes nothing", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  report(w.ctx(), { work: made, outcome: "done", summary: "fixed" });
  const before = w.works.read(made).length;
  const late = state(w.ctx(), { work: made, state: "working" });
  assert.deepEqual([late.changed, late.ignored], [false, true]);
  assert.equal(report(w.ctx(), { work: made, outcome: "blocked", blocked: ["a late thought"] }).ignored, true);
  assert.equal(w.works.read(made).length, before, "nothing was written");
  assert.equal(w.view(made).lifecycle.state, "REPORTED_DONE");
  assert.throws(() => report(w.ctx(), { work: made, outcome: "failed" }), /closed as done/);
  w.tick();
  state(w.ctx(), { work: made, state: "working", reopen: true });
  assert.equal(trackOf(w.works.read(made)).closed, null);
});

test("a progress line that is already in the journal after a closing one is counted and moves nothing (the fold, whoever wrote it)", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  state(w.ctx(), { work: made, state: "failed", why: "the environment is gone" });
  w.tick();
  w.works.append(made, "state", { id: "st-9", state: "working", occurred: w.now(), at: w.now() });
  w.works.append(made, "report", { id: "rpt-9", outcome: "blocked", at: w.now() });
  const fold = trackOf(w.works.read(made));
  assert.deepEqual([fold.ignored, fold.closed.outcome], [2, "failed"]);
  assert.equal(w.view(made).lifecycle.state, "FAILED");
});

test("a state that happened BEFORE the one standing is late, whatever order it was written in", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  const early = w.now();
  w.tick(30);
  state(w.ctx(), { work: made, state: "blocked", why: "no database", occurred: w.now() });
  const got = state(w.ctx(), { work: made, state: "waiting", wait: "user", occurred: early });
  assert.deepEqual([got.changed, got.ignored], [false, true]);
  assert.equal(w.view(made).lifecycle.state, "BLOCKED");
});

// ---- 9 and 13: session end, and what a host can see ----------------------------------------------------------

test("a session that ended is INTERRUPTED and never completed; a session that just stopped is quiet, and the work is still in progress", (t) => {
  const w = trackWorld(t);
  const ended = track(w.ctx("sess-a"), { objective: "Request A" }).work;
  const quiet = track(w.ctx("sess-b"), { objective: "Request B" }).work;
  w.tick();
  w.edit("sess-a", "src/a.cs");
  w.edit("sess-b", "src/b.cs");
  w.endSession("sess-a");
  assert.equal(w.view(ended, "sess-a").lifecycle.state, "INTERRUPTED");
  assert.notEqual(w.view(ended, "sess-a").lifecycle.state, "REPORTED_DONE");
  w.tick(3600);
  const view = w.view(quiet, "sess-b");
  assert.deepEqual([view.lifecycle.state, view.liveness], ["IN_PROGRESS", "QUIET"], "a dead process never marks anything completed or failed");
  assert.equal(view.evidence.level, "observed");
});

test("a host with no hooks, or no session end, says what it cannot see and fabricates nothing", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx("sess-a", { host: "some-new-host" }), { objective: "Fix the refund limit" }).work;
  const unknown = w.view(made, "sess-a", { host: "some-new-host" });
  assert.deepEqual([unknown.coverage.observation, unknown.coverage.edits, unknown.lifecycle.state, unknown.activity.files, unknown.activity.checks], ["explicit", "none", "RECEIVED", [], []]);
  assert.match(unknown.warnings.join(" "), /only what is reported through cli\/track\.mjs is tracked/);
  const agy = track(w.ctx("sess-b", { host: "antigravity" }), { objective: "Request B" }).work;
  const view = w.view(agy, "sess-b", { host: "antigravity" });
  assert.equal(view.coverage.sessionEnd, false);
  assert.match(view.warnings.join(" "), /INTERRUPTED is never derived/);
  assert.match(view.warnings.join(" "), /results stay unknown/);
  const off = w.view(made, "sess-a", { host: "claude", workingSet: { source: "off", tail: () => null, sessions: () => [] } });
  assert.match(off.warnings.join(" "), /working set is switched off/);
});

// ---- 10 and 11: evidence -----------------------------------------------------------------------------------

test("a host's done without an owner behind it is REPORTED, never verified; a completed linked task, and no edit after it, is", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  w.edit("sess-a", "src/a.cs");
  w.tick();
  report(w.ctx(), { work: made, outcome: "done", summary: "fixed", proved: ["the unit test ended ok"] });
  assert.deepEqual([w.view(made).lifecycle.state, w.view(made).evidence.level], ["REPORTED_DONE", "reported"]);
  w.tick();
  link(w.ctx(), { work: made, what: "task", target: TASK_A });
  w.task(TASK_A, { lifecycle: "COMPLETED", terminal: true, ended: { at: w.now() } });
  const verified = w.view(made);
  assert.equal(verified.evidence.level, "verified");
  assert.match(verified.evidence.why, /task tsk-aaaaaaaaaaaa completed, as its own journal says/);
  assert.equal(w.view(made).summary.reportedBy, "host-or-person");
});

test("a linked task that did not complete is never verification, and a work reported done over a failed task is still only reported", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  link(w.ctx(), { work: made, what: "task", target: TASK_A });
  w.task(TASK_A, { lifecycle: "FAILED", terminal: true, ended: { at: w.now() } });
  report(w.ctx(), { work: made, outcome: "done" });
  assert.deepEqual([w.view(made).evidence.level, w.view(made).lifecycle.state], ["reported", "REPORTED_DONE"]);
});

test("a check followed by a later edit is no longer current, and a verified completion followed by an edit drops back to reported", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  w.edit("sess-a", "src/a.cs");
  w.tick();
  w.run("sess-a", "test", "dotnet", true);
  w.tick();
  assert.equal(w.view(made).activity.checks[0].current, true);
  w.edit("sess-a", "src/b.cs");
  const stale = w.view(made).activity.checks[0];
  assert.deepEqual([stale.current, stale.result, stale.what], [false, "exit-ok", "dotnet (named like a test)"], "ended ok, and no longer a check of what the work is now");
  link(w.ctx(), { work: made, what: "task", target: TASK_A });
  w.task(TASK_A, { lifecycle: "COMPLETED", terminal: true, ended: { at: w.now() } });
  report(w.ctx(), { work: made, outcome: "done" });
  assert.equal(w.view(made).evidence.level, "verified");
  w.tick();
  w.edit("sess-a", "src/c.cs");
  const dropped = w.view(made);
  assert.equal(dropped.evidence.level, "reported");
  assert.match(dropped.evidence.why, /an edit was seen after the linked task completed/);
});

test("a command is labelled by its WORDS, and its result is how it ended -- never a pass, and a grep named like a test is not a test", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  w.run("sess-a", "test", "grep", true);
  w.run("sess-a", "build", "npm", false);
  const checks = w.view(made).activity.checks;
  assert.deepEqual(checks.map((c) => [c.what, c.result]).sort(), [["grep (named like a test)", "exit-ok"], ["npm (named like a build)", "exit-error"]]);
  assert.ok(checks.every((c) => c.basis === "command-words"));
  assert.doesNotMatch(JSON.stringify(w.view(made)), /"passed"|PASSED/);
});

// ---- lifecycle, links, state, report --------------------------------------------------------------------------

test("every lifecycle state is reachable, in table order, and the reported states land where they should", (t) => {
  const w = trackWorld(t);
  const mk = (n) => track(w.ctx(`s-${n}`), { objective: `Request ${n}` }).work;
  const reached = {};
  const a = mk(1);
  reached.RECEIVED = w.view(a, "s-1").lifecycle.state;
  w.tick();
  w.edit("s-1", "x.cs");
  reached.IN_PROGRESS = w.view(a, "s-1").lifecycle.state;
  state(w.ctx("s-1"), { work: a, state: "waiting", wait: "permission", why: "needs approval" });
  reached.WAITING = w.view(a, "s-1").lifecycle.state;
  w.tick();
  state(w.ctx("s-1"), { work: a, state: "blocked", why: "no database" });
  reached.BLOCKED = w.view(a, "s-1").lifecycle.state;
  w.tick();
  state(w.ctx("s-1"), { work: a, state: "paused" });
  reached.PAUSED = w.view(a, "s-1").lifecycle.state;
  const b = mk(2);
  w.edit("s-2", "y.cs");
  w.endSession("s-2");
  reached.INTERRUPTED = w.view(b, "s-2").lifecycle.state;
  for (const [n, outcome] of [[3, "done"], [4, "failed"], [5, "cancelled"]]) {
    const id = mk(n);
    report(w.ctx(`s-${n}`), { work: id, outcome });
    reached[{ done: "REPORTED_DONE", failed: "FAILED", cancelled: "CANCELLED" }[outcome]] = w.view(id, `s-${n}`).lifecycle.state;
  }
  assert.deepEqual(Object.keys(reached).sort(), LIFECYCLE.map((r) => r.state).sort());
  for (const [want, got] of Object.entries(reached)) assert.equal(got, want);
});

test("a waiting work says what it waits for, and tool activity after a reported wait says the work went on -- but a pause is a person's", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  w.tick();
  state(w.ctx(), { work: made, state: "waiting", wait: "environment", why: "the database is off the VPN" });
  const waiting = w.view(made).lifecycle;
  assert.deepEqual([waiting.state, waiting.wait, waiting.why], ["WAITING", "environment", "the database is off the VPN"]);
  w.tick();
  w.edit("sess-a", "src/a.cs");
  assert.equal(w.view(made).lifecycle.state, "IN_PROGRESS");
  state(w.ctx(), { work: made, state: "paused" });
  w.tick();
  w.edit("sess-a", "src/b.cs");
  assert.equal(w.view(made).lifecycle.state, "PAUSED");
});

test("a linked task's own state is the work's: a waiting approval, a block, and an ended task the host has not reported", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  handoff(w.ctx(), { work: made, to: "autonomous", task: TASK_A });
  w.task(TASK_A, { lifecycle: "WAITING_APPROVAL" });
  assert.deepEqual([w.view(made).lifecycle.state, w.view(made).lifecycle.wait], ["WAITING", "permission"]);
  w.task(TASK_A, { lifecycle: "BLOCKED" });
  assert.equal(w.view(made).lifecycle.state, "BLOCKED");
  w.task(TASK_A, { lifecycle: "FAILED", terminal: true, ended: { at: w.now() } });
  const failed = w.view(made).lifecycle;
  assert.deepEqual([failed.state, failed.terminal], ["BLOCKED", false]);
  assert.match(failed.why, /ended FAILED; the work is not closed until it is reported/);
  w.task(TASK_A, { lifecycle: "COMPLETED", terminal: true, ended: { at: w.now() } });
  assert.equal(w.view(made).lifecycle.state, "IN_PROGRESS", "a completed task is not a reported work");
});

test("a link names a thing in its own shape; a work that is not tracked cannot be written to", (t) => {
  const w = trackWorld(t);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  assert.throws(() => link(w.ctx(), { work: made, what: "task", target: "tsk-not-hex" }), /looks like/);
  assert.throws(() => link(w.ctx(), { work: made, what: "mcp", target: "x" }), /links to/);
  assert.equal(link(w.ctx(), { work: made, what: "investigation", target: "inv-20261017-090000-ab12" }).changed, true);
  assert.throws(() => state(w.ctx(), { work: made, state: "done" }), /--state is one of/);
  assert.throws(() => state(w.ctx(), { work: made, state: "working", wait: "user" }), /only goes with/);
  assert.throws(() => report(w.ctx(), { work: made, outcome: "maybe" }), /--outcome is one of/);
  assert.throws(() => report(w.ctx(), { work: made, outcome: "done", evidence: ["a file at /etc/passwd"] }), /pointer/);
  startWork({ works: w.works, now: w.now, session: "s" }, { objective: "An untracked work", root: "req-111111111111", identity: { id: "9" } });
  assert.throws(() => link(w.ctx(), { work: workOf("req-111111111111"), what: "task", target: TASK_A }), /is not tracked/);
});

// ---- 14: the past still reads --------------------------------------------------------------------------------

test("a work written before tracking, and a journal with tracking lines in it, both read -- the old engine's fold ignores the new kinds", (t) => {
  const w = trackWorld(t);
  startWork({ works: w.works, now: w.now, session: "s" }, { objective: "Implement the refund limit", root: "req-3f9a1c0b7e21", identity: { id: "1" } });
  const old = workOf("req-3f9a1c0b7e21");
  assert.deepEqual([trackOf(w.works.read(old)).tracked, w.view(old).tracked, w.view(old).lifecycle.state], [false, false, "RECEIVED"]);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  link(w.ctx(), { work: made, what: "task", target: TASK_A });
  assert.doesNotThrow(() => modelOf(w.works.read(made)), "the work model folds a journal that has tracking lines in it");
  assert.equal(modelOf(w.works.read(made)).needs.size, 0);
  assert.deepEqual(listOf(scanOf(w.works), w.ctx().checkout).map((r) => r.work), [made], "an untracked work is not in the tracked list");
  assert.equal(workSummary(w.works).works.length, 2, "and `work list` still counts both");
  assert.deepEqual([workSummary(w.works).open, workSummary(w.works).blocked], [1, 0], "only the requirement's work is a requirement not yet complete: a tracked request must not route /orbit-help to the requirements playbook");
});

// ---- 15 and 16: nothing blocks, nothing leaks ------------------------------------------------------------------

test("tracking never blocks the task it sits beside: a refusal or a broken journal is a warning, and the viewer is not involved", (t) => {
  const w = trackWorld(t);
  const bad = attached(() => attach(w.ctx(), { task: "not-a-task", what: "task" }));
  assert.equal(bad, null);
  const made = track(w.ctx(), { objective: "Fix the refund limit" }).work;
  const warned = attached(() => attach(w.ctx(), { task: "not-a-task", what: "task" }));
  assert.match(warned.warning, /was not added to its tracked work/);
  const view = w.view(made, "sess-a", { workingSet: { source: "ok", tail: () => { throw new Error("the disk went away"); }, sessions: () => { throw new Error("the disk went away"); } } });
  assert.deepEqual([view.lifecycle.state, view.warnings.some((x) => /could not be read/.test(x))], ["RECEIVED", true], "an unreadable working set is a limit the view says, never an error");
  const src = readFileSync(new URL("../src/work/track/write.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /live|spawn|automation/i, "tracking opens no viewer and starts no workflow");
});

test("a secret in the request, a reason or a summary never reaches the journal, and no command line, prompt or reply has a field", (t) => {
  const w = trackWorld(t);
  // Masked by SHAPE (src/scrub.mjs): a token's own shape, a named secret, a bearer header.
  const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk";
  const made = track(w.ctx(), { objective: `Fix login with password=hunter2 and ${secret} <script>x</script>`, because: `token: ${secret}` }).work;
  w.run("sess-a", "test", "npm", true);
  state(w.ctx(), { work: made, state: "blocked", why: `Authorization: Bearer ${secret}` });
  report(w.ctx(), { work: made, outcome: "done", summary: `done with ${secret}`, proved: ["api_key=abc123xyz"], unverified: [`secret=${secret}`] });
  const text = journalOf(w, made);
  for (const leaked of ["hunter2", secret, "abc123xyz", "<script>"]) assert.equal(text.includes(leaked), false, `${leaked} must not be kept`);
  assert.ok(w.works.read(made).every((l) => !("prompt" in l) && !("reply" in l) && !("command" in l) && !("argv" in l)));
  assert.throws(() => track(w.ctx(), { objective: "x", route: "$(curl evil)" }), /--route/);
  assert.throws(() => track(w.ctx(), { objective: "x", eid: "has space" }), /--eid/);
});
