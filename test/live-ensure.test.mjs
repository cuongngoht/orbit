// `/orbit-help` opens Orbit Live by itself (1.8.5, ADR 0020): ONE viewer per host · session · checkout, reused after,
// never opened twice by two asks at once, never brought back by a workflow after a person closed it, and never on
// the strength of an opener's exit code alone -- the viewer has to say it is ready. Every way it cannot open is an
// answer with the command for a second terminal, and none of it grants anything. The launcher runs over a REAL store
// (the lease room's lock is the one the product uses); the opener and the viewer are played by the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureViewer } from "../cli/live-ensure.mjs";
import { viewerCommand } from "../cli/live-open.mjs";
import { effectiveOf, FIELDS } from "../src/automation/settings.mjs";
import { ENTRIES, POLICY, RULES, STATUS, STATUS_NAMES, SWITCHES, answerOf, leaseRule, policyRefusal, switchRefusal } from "../src/live/ensure.mjs";
import { HEARTBEAT_MS, SILENT_MS, STARTING_MS, leaseKey, leaseWhere, livenessOf, readLease, viewerBeat, viewerLeft, viewerReady } from "../src/live/lease.mjs";
import { realIo } from "../src/store/io.mjs";

const SESSION = "0123456789abcdef";
const CHECKOUT = "c".repeat(64);
const T0 = Date.parse("2026-10-15T09:00:00.000Z");
const TASK = "tsk-0123456789ab";
const OTHER = "tsk-ba9876543210";

// A world the launcher is handed: a real store, a clock the test moves, an opener that records each launch and --
// when `viewer` says so -- plays the viewer that the launch started (it writes `ready` on its lease).
function worldOf(t, over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ensure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { ms: T0 };
  const io = realIo({ nowMs: () => clock.ms, now: () => new Date(clock.ms).toISOString() });
  const w = { io, clock, launches: [], viewerReady: true, alive: () => true, startedAtOf: () => null, nowMs: () => clock.ms, nowIso: () => new Date(clock.ms).toISOString(), liveRoom: join(dir, "live"), machine: "m1", host: "claude", session: SESSION, place: { checkout: CHECKOUT, project: "p" }, settings: () => ({ open: true, display: "auto" }), live: true, attended: true, opener: { id: "macos-terminal" }, waitMs: 300, token: tokens(), sleep: async () => { clock.ms += 100; }, ...over };
  w.viewer = ({ task, lease }) => ({ argv: viewerCommand({ node: "node", cli: "live.mjs", task, lease, stay: true }), cwd: dir, env: {} });
  w.plan = (viewer) => ({ id: "macos-terminal", argv: ["/usr/bin/open"], viewer });
  w.typed = (viewer) => viewer.argv.join(" ");
  w.launch = (plan) => launchedBy(w, plan);
  return w;
}

function tokens() {
  let n = 0;
  return () => (n += 1).toString(16).padStart(16, "0");
}

// The launch "opens a window", and the viewer in it says it is ready -- unless the test says the window never came up.
function launchedBy(w, plan) {
  w.launches.push(plan);
  if (w.launchFails) return false;
  const [key, owner] = String(plan.viewer.argv.find((a) => a.startsWith("--lease=")) ?? "").slice("--lease=".length).split(".");
  if (w.viewerReady) viewerReady(w.io, leaseWhere(w.liveRoom, w.machine, key), { owner }, { at: w.nowIso(), pid: 4242, pidStartedAt: "2026-10-15T08:59:00.000Z", shows: null });
  return true;
}

const whereOf = (w) => leaseWhere(w.liveRoom, w.machine, leaseKey({ host: w.host, session: w.session, checkout: w.place.checkout }));
const leaseOf = (w) => readLease(w.io, whereOf(w));
const help = (task = null) => ({ entry: "help", task });
const workflow = (task) => ({ entry: "workflow", task });

// ---- the policy: who may stop a viewer opening by itself, and in what order -------------------------------------

test("every reason not to open is a row, said with the command for a second terminal, and nothing is launched", async (t) => {
  const cases = [
    [{ live: false }, "DISABLED_BY_POLICY", /switched off for this host/],
    [{ settings: () => null }, "DISABLED_BY_POLICY", /could not be read/],
    [{ settings: () => ({ open: false, display: "auto" }) }, "DISABLED_BY_POLICY", /switched off \(Orbit Control/],
    [{ settings: () => ({ open: true, display: "off" }) }, "DISABLED_BY_POLICY", /display is off/],
    [{ attended: false }, "HEADLESS_FALLBACK", /does not say a person is at this session/],
    [{ place: null }, "NOT_A_CHECKOUT", /not inside a repository/],
    [{ session: null }, "HEADLESS_FALLBACK", /no session mark/],
    [{ opener: { id: "print" } }, "UNSUPPORTED_TERMINAL", /nothing here can open|no tmux pane/],
  ];
  for (const [over, status, why] of cases) {
    const w = worldOf(t, over);
    const got = await ensureViewer(w, help(TASK));
    assert.equal(got.status, status, JSON.stringify(over));
    assert.match(got.why, why);
    assert.equal(got.opened, false);
    assert.match(got.command, /tui tsk-0123456789ab$/, "the command a person runs instead: the viewer, staying until they leave it");
    assert.equal(w.launches.length, 0, "a refusal opens nothing");
  }
});

test("the person's switches come before everything else, and the host's word decides whether a person is there", () => {
  const ok = { live: true, settings: { open: true, display: "auto" }, attended: true, checkout: CHECKOUT, key: "k", opener: "tmux" };
  assert.equal(policyRefusal(ok), null);
  assert.equal(policyRefusal({ ...ok, live: false, attended: false }).status, "DISABLED_BY_POLICY", "Live off is a hard deny, whatever else holds");
  assert.equal(policyRefusal({ ...ok, attended: undefined }).status, "HEADLESS_FALLBACK", "an unknown attendance is not a person");
  assert.deepEqual(POLICY.map((r) => r.status).filter((s, i, all) => all.indexOf(s) === i), ["DISABLED_BY_POLICY", "HEADLESS_FALLBACK", "NOT_A_CHECKOUT"], "whether anything here can OPEN a viewer is a lease rule: it matters only when one would be opened");
  assert.deepEqual(SWITCHES.map((r) => r.status), ["DISABLED_BY_POLICY", "DISABLED_BY_POLICY", "DISABLED_BY_POLICY", "DISABLED_BY_POLICY"]);
  assert.equal(switchRefusal({ live: true, settings: { open: true, display: "auto" }, attended: false, checkout: null, key: null, opener: "print" }), null, "a docked pane honours the person's switches and nothing else");
  assert.equal(switchRefusal({ live: true, settings: { open: false, display: "auto" } }).status, "DISABLED_BY_POLICY");
  assert.deepEqual(ENTRIES, ["help", "workflow"]);
  assert.ok(STATUS_NAMES.every((s) => typeof STATUS[s].opened === "boolean" && STATUS[s].say.length > 10));
  assert.equal(answerOf("OPENED").opened, true);
});

test("live.open is on unless a person said otherwise: unset is on, a saved false stays false, and the machine's false wins", () => {
  const row = FIELDS.find((f) => f.path.join(".") === "live.open");
  assert.equal(row.default, true);
  assert.equal(row.narrow, "and");
  const open = (docs) => effectiveOf(docs).values.live.open;
  assert.equal(open([]), true, "nothing saved: on");
  assert.equal(open([{ by: "machine", content: {} }]), true, "a document that never set it: on");
  assert.equal(open([{ by: "machine", content: { live: { open: false } } }]), false, "a saved false is a person's word, never re-read as a default");
  assert.equal(open([{ by: "machine", content: { live: { open: false } } }, { by: "project", content: { live: { open: true } } }]), false, "a project cannot widen the machine");
  assert.equal(open([{ by: "machine", content: {} }, { by: "project", content: { live: { open: false } } }]), false, "a project may narrow");
  assert.deepEqual(effectiveOf([{ by: "machine", content: { live: { open: false } } }]).restrictions, undefined, "closing Live is no restriction on coordination: observation and execution are separate rows");
  assert.equal(effectiveOf([{ by: "machine", content: { live: { open: false } } }]).values.trigger.arbitraryPrompt, true, "a viewer switched off never stops the work");
});

// ---- the lease: one viewer per session, reused -------------------------------------------------------------------

test("the first ask opens ONE viewer and says OPENED only once that viewer said it is ready", async (t) => {
  const w = worldOf(t);
  const got = await ensureViewer(w, help());
  assert.equal(got.status, "OPENED");
  assert.equal(w.launches.length, 1);
  assert.ok(w.launches[0].viewer.argv.some((a) => /^--lease=[a-f0-9]{16}\.[a-f0-9]{16}$/.test(a)), "the viewer is told its lease");
  assert.ok(!w.launches[0].viewer.argv.includes("--until-done"), "a viewer /orbit-help opened stays until the person leaves it");
  assert.equal(leaseOf(w).state, "ready");
  assert.equal(leaseOf(w).last.status, "OPENED", "doctor can say what the last ask came to");
});

test("an opener that exited 0 is a request, not a viewer: STARTING until the viewer itself says ready, and never a second launch while it starts", async (t) => {
  const w = worldOf(t, { viewerReady: false });
  assert.equal((await ensureViewer(w, help())).status, "STARTING");
  assert.equal((await ensureViewer(w, help(TASK))).status, "STARTING", "asked again while it starts: wait, never open another");
  assert.equal(w.launches.length, 1);
  assert.equal(leaseOf(w).selection.task, TASK, "the task asked for meanwhile is waiting for it");
  w.clock.ms += STARTING_MS + 1;
  w.viewerReady = true;
  assert.equal((await ensureViewer(w, help())).status, "REOPENED", "a launch that never became a viewer is retried by the next explicit ask");
  assert.equal(w.launches.length, 2);
});

test("an open viewer is reused: the same task is ALREADY_ATTACHED, another is SELECTED, and a person's pick is only offered (HELD)", async (t) => {
  const w = worldOf(t);
  await ensureViewer(w, help());
  const me = { owner: leaseOf(w).owner };
  viewerBeat(w.io, whereOf(w), me, { at: w.nowIso(), shows: TASK, picked: false });
  assert.equal((await ensureViewer(w, help(TASK))).status, "ALREADY_ATTACHED");
  assert.equal((await ensureViewer(w, help())).status, "ALREADY_ATTACHED", "help with no task reuses whatever it shows");
  assert.equal((await ensureViewer(w, workflow(OTHER))).status, "SELECTED");
  assert.equal(leaseOf(w).selection.task, OTHER);
  viewerBeat(w.io, whereOf(w), me, { at: w.nowIso(), shows: TASK, picked: true });
  assert.equal((await ensureViewer(w, help(OTHER))).status, "HELD", "a viewer whose task a person picked is told, never moved");
  assert.equal(w.launches.length, 1, "four asks, one window");
});

test("a person's q is final for a workflow: NOT_REOPENED -- and the next /orbit-help brings it back", async (t) => {
  const w = worldOf(t);
  await ensureViewer(w, help());
  viewerLeft(w.io, whereOf(w), { owner: leaseOf(w).owner }, { at: w.nowIso(), why: "detached" });
  assert.equal((await ensureViewer(w, workflow(TASK))).status, "NOT_REOPENED");
  assert.equal(w.launches.length, 1, "no heartbeat, no workflow step reopens what a person closed");
  assert.equal((await ensureViewer(w, help(TASK))).status, "REOPENED");
  assert.equal(w.launches.length, 2);
});

test("a viewer that is gone is told from the evidence: its pid not running, its pid reused, or silence -- and a workflow never brings it back", async (t) => {
  const scenes = [
    ["pid not running", { alive: () => false }],
    ["pid reused", { startedAtOf: () => "2026-10-15T09:00:30.000Z" }],
    ["silent", {}],
  ];
  for (const [name, over] of scenes) {
    const w = worldOf(t);
    await ensureViewer(w, help());
    Object.assign(w, over);
    if (name === "silent") w.clock.ms += SILENT_MS + 1;
    assert.equal(livenessOf(leaseOf(w), { nowMs: w.clock.ms, alive: w.alive, startedAtOf: w.startedAtOf }).state, "gone", name);
    assert.equal((await ensureViewer(w, workflow(TASK))).status, "NOT_REOPENED", `${name}: a workflow asks, nothing opens`);
    assert.equal((await ensureViewer(w, help(TASK))).status, "REOPENED", `${name}: the person asks, it opens again`);
  }
});

test("a pid alone proves nothing: the same pid that started at the recorded time is the viewer; a heartbeat keeps it attached", () => {
  const lease = { owner: "a".repeat(16), state: "ready", requestedAt: new Date(T0).toISOString(), readyAt: new Date(T0).toISOString(), heartbeatAt: new Date(T0 + 4000).toISOString(), pid: 4242, pidStartedAt: "2026-10-15T08:59:00.000Z" };
  const facts = (over) => ({ nowMs: T0 + HEARTBEAT_MS, alive: () => true, startedAtOf: () => "2026-10-15T08:59:00.000Z", ...over });
  assert.equal(livenessOf(lease, facts()).state, "attached");
  assert.equal(livenessOf(lease, facts({ startedAtOf: () => null })).state, "attached", "a platform that cannot say when a pid started is not a mismatch");
  assert.equal(livenessOf({ ...lease, pid: null }, facts()).state, "attached", "no pid recorded: the heartbeat speaks");
  assert.equal(livenessOf(null, facts()).state, "none");
});

test("a launch the opener refused is LAUNCH_FAILED with the command, and the next ask may try again", async (t) => {
  const w = worldOf(t, { launchFails: true });
  const got = await ensureViewer(w, help(TASK));
  assert.equal(got.status, "LAUNCH_FAILED");
  assert.match(got.command, /tui tsk-0123456789ab$/);
  assert.equal(leaseOf(w).state, "failed");
  w.launchFails = false;
  assert.equal((await ensureViewer(w, help(TASK))).status, "REOPENED");
});

test("two asks at once open one viewer: the lease is reserved under the lock before anything is launched", async (t) => {
  const w = worldOf(t, { viewerReady: false });
  const got = await Promise.all([ensureViewer(w, help()), ensureViewer(w, help(TASK)), ensureViewer(w, workflow(TASK))]);
  assert.equal(w.launches.length, 1, got.map((g) => g.status).join(","));
  assert.ok(got.every((g) => g.status === "STARTING"));
});

test("a session is a session: another session or another checkout of the same repository keeps a viewer of its own", async (t) => {
  const w = worldOf(t);
  await ensureViewer(w, help());
  assert.equal((await ensureViewer({ ...w, session: "fedcba9876543210" }, help())).status, "OPENED");
  assert.equal((await ensureViewer({ ...w, place: { checkout: "d".repeat(64), project: "p" } }, help())).status, "OPENED", "a second worktree of the same repository");
  assert.equal(w.launches.length, 3);
  assert.equal(leaseKey({ host: "claude", session: null, checkout: CHECKOUT }), null, "no session mark: no key shared by everybody");
  assert.notEqual(leaseKey({ host: "claude", session: SESSION, checkout: CHECKOUT }), leaseKey({ host: "codex", session: SESSION, checkout: CHECKOUT }));
});

// ---- the viewer's own writes ---------------------------------------------------------------------------------------

test("a viewer writes only while it owns the lease: one a newer launch replaced can never overwrite its successor", async (t) => {
  const w = worldOf(t, { viewerReady: false });
  await ensureViewer(w, help());
  const old = { owner: leaseOf(w).owner };
  w.clock.ms += STARTING_MS + 1;
  w.viewerReady = true;
  await ensureViewer(w, help());
  const fresh = leaseOf(w);
  assert.notEqual(fresh.owner, old.owner);
  viewerReady(w.io, whereOf(w), old, { at: w.nowIso(), pid: 1, shows: OTHER });
  assert.equal(viewerBeat(w.io, whereOf(w), old, { at: w.nowIso(), shows: OTHER }).held, false, "the replaced viewer learns it lost the lease");
  viewerLeft(w.io, whereOf(w), old, { at: w.nowIso(), why: "detached" });
  assert.deepEqual({ ...leaseOf(w), last: null }, { ...fresh, last: null }, "the successor's record is untouched");
});

test("RULES: reuse first, a person's pick offered, a start waited for, a workflow never reopening, the last row always answering", () => {
  assert.deepEqual(RULES.map((r) => r.status), ["ALREADY_ATTACHED", "HELD", "SELECTED", "STARTING", "NOT_REOPENED", "UNSUPPORTED_TERMINAL", "OPENED", "REOPENED"]);
  assert.equal(RULES.at(-1).when({ state: "anything" }, { entry: "help" }, null), true);
});

test("a viewer already open -- a pane the host docks -- is ALREADY_ATTACHED where nothing could open one; only an open is refused", () => {
  const attached = { state: "attached" };
  assert.deepEqual(leaseRule(attached, { entry: "help", task: null, opener: "print" }, { opener: "pane", shows: null }), { act: "keep", status: "ALREADY_ATTACHED", why: null });
  assert.equal(leaseRule({ state: "starting" }, { entry: "help", task: null, opener: "print" }, null).status, "STARTING");
  assert.equal(leaseRule({ state: "detached" }, { entry: "workflow", task: null, opener: "print" }, null).status, "NOT_REOPENED", "a workflow never brings back a closed viewer, here or anywhere");
  const none = leaseRule({ state: "none" }, { entry: "help", task: null, opener: "print" }, null);
  assert.deepEqual([none.act, none.status], ["refuse", "UNSUPPORTED_TERMINAL"]);
  assert.match(none.why, /no tmux pane/);
  assert.equal(leaseRule({ state: "none" }, { entry: "help", task: null, opener: "tmux" }, null).status, "OPENED");
});
