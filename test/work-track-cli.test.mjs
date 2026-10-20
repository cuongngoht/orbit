// `cli/track.mjs` and the places that join a task to a tracked work, in REAL processes over a real Git checkout and a real store:
// exit codes, what is written (the machine store only, never the repository), and the whole path a person sees -- Claude Code's hook
// payloads through cli/learn-hook.mjs, `track status`, `live status` and `live pane`. The hook payloads are SYNTHETIC: this is the
// engine's own path with a made-up host in front of it, and it is NOT host-live verification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostSession } from "../src/memory/session.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = (name) => join(ROOT, "cli", `${name}.mjs`);

function repo(t, { init = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-track-cli-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "repo");
  const env = (over = {}) => sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", ...over });
  execFileSync("git", ["init", "-q", checkout], { env: sealed() });
  execFileSync("git", ["-C", checkout, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  if (init) execFileSync(process.execPath, [cli("init"), checkout, "--origin=http://localhost:3000"], { env: env(), stdio: "ignore" });
  return { dir, checkout, env };
}

// One command, as a host's shell runs it: the session Claude Code's start exported (`claude:<hash of its session id>`, the very
// session its hooks keep the working set under) in ORBIT_SESSION. `session: null` is a shell that carries none.
function run(p, tool, args, { session = "sess-a", over = {}, input } = {}) {
  const r = spawnSync(process.execPath, [cli(tool), ...args], { cwd: p.checkout, env: p.env({ ...(session ? { ORBIT_SESSION: hostSession("claude", session) } : {}), ...over }), encoding: "utf8", input });
  return { status: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

const track = (p, args, opts) => run(p, "track", args, opts);

const hook = (p, payload) => spawnSync(process.execPath, [cli("learn-hook")], { input: JSON.stringify({ cwd: p.checkout, ...payload }), env: p.env({ CLAUDE_PROJECT_DIR: p.checkout }), encoding: "utf8" });
const edited = (p, session, path, id) => hook(p, { hook_event_name: "PostToolUse", session_id: session, tool_use_id: id, tool_name: "Edit", tool_input: { file_path: join(p.checkout, path) } });
const ran = (p, session, command, id, ok = true) => hook(p, { hook_event_name: ok ? "PostToolUse" : "PostToolUseFailure", session_id: session, tool_use_id: id, tool_name: "Bash", tool_input: { command } });

test("track in a Git checkout with NO ui-tests/: a work is made, the repository is untouched, and the usage header documents the commands", (t) => {
  const p = repo(t);
  const made = track(p, ["track", "Fix the refund limit", "--route=orbit-develop", "--because=a small change", "--json"]);
  assert.equal(made.status, 0, made.err);
  const got = made.json();
  assert.deepEqual([got.tracked, got.created, got.mode, got.route, got.session], [true, true, "developer", "orbit-develop", true]);
  assert.match(got.work, /^w-[0-9a-f]{12}$/);
  assert.deepEqual(readdirSync(p.checkout).filter((n) => n !== ".git"), [], "nothing was written into the repository");
  assert.equal(existsSync(join(p.checkout, "ui-tests")), false);
  const status = track(p, ["status", "--json"]).json();
  assert.deepEqual([status.work, status.lifecycle.state, status.evidence.level, status.mode], [got.work, "RECEIVED", "none", "developer"]);
  const help = track(p, []);
  assert.match(help.out, /node track\.mjs track "<the request/);
  assert.match(help.out, /Exit 0 = done .* Never 1\./s);
});

test("exit codes: a repeat is 0, nothing to track is 0, a bad id or an unknown work is 2 -- and never 1", (t) => {
  const p = repo(t);
  assert.equal(track(p, ["track", "Fix the refund limit"]).status, 0);
  assert.equal(track(p, ["track", "Fix the refund limit"]).status, 0);
  const none = track(p, ["track", "Fix the refund limit", "--json"], { session: null });
  assert.deepEqual([none.status, none.json().tracked, none.json().work], [0, false, null]);
  assert.equal(track(p, ["status", "not-a-work"]).status, 2);
  assert.equal(track(p, ["status", "w-000000000000"]).status, 2);
  assert.equal(track(p, ["state", "--state=maybe"]).status, 2);
  assert.equal(track(p, ["track", "x", "--continue=w-000000000000"]).status, 2);
  assert.equal(track(p, ["link", "--task=nonsense"]).status, 2);
  assert.equal(track(p, ["list"]).status, 0);
});

test("general guidance creates no work: the session never calls track, and nothing in the store says it was ever here", (t) => {
  const p = repo(t);
  assert.equal(track(p, ["status", "--json"]).json().tracked, false);
  assert.equal(track(p, ["current", "--json"]).json().tracked, false);
  assert.deepEqual(track(p, ["list", "--json"]).json().works, []);
  assert.equal(existsSync(join(p.dir, "store")), false, "reading binds and creates nothing");
});

test("the whole path: a session tracks a request, its hooks' edits and checks are read back as OBSERVED, and a done report is reported -- not verified", (t) => {
  const p = repo(t, { init: true });
  const made = track(p, ["track", "Fix the refund limit", "--route=orbit-develop", "--because=a small change", "--json"]).json().work;
  edited(p, "sess-a", "src/RefundService.cs", "tu-1");
  ran(p, "sess-a", "node --test test/refund.test.js", "tu-2");
  const seen = track(p, ["status", "--json"]).json();
  assert.deepEqual(seen.activity.files, [{ path: "src/RefundService.cs", attribution: "observed" }]);
  assert.deepEqual(seen.activity.checks.map((c) => [c.what, c.result, c.current]), [["node (named like a test)", "exit-ok", true]]);
  assert.deepEqual([seen.lifecycle.state, seen.evidence.level], ["IN_PROGRESS", "observed"]);
  const done = track(p, ["report", "--outcome=done", "--summary=refund limit fixed", "--proved=the test ended ok", "--json"]).json();
  assert.deepEqual([done.work, done.changed, done.files, done.checks], [made, true, 1, 1]);
  const after = track(p, ["status", "--json"]).json();
  assert.deepEqual([after.lifecycle.state, after.evidence.level, after.summary.proved], ["REPORTED_DONE", "reported", ["the test ended ok"]]);
  const late = track(p, ["state", "--state=working", "--json"]).json();
  assert.deepEqual([late.changed, late.ignored], [false, true]);
});

test("two sessions in one checkout do not mix: each asks for its own current work, and its own activity", (t) => {
  const p = repo(t, { init: true });
  const a = track(p, ["track", "Request A", "--json"], { session: "sess-a" }).json().work;
  const b = track(p, ["track", "Request B", "--json"], { session: "sess-b" }).json().work;
  edited(p, "sess-a", "src/a.cs", "tu-1");
  edited(p, "sess-b", "src/b.cs", "tu-2");
  assert.notEqual(a, b);
  const sa = track(p, ["status", "--json"], { session: "sess-a" }).json();
  const sb = track(p, ["status", "--json"], { session: "sess-b" }).json();
  assert.deepEqual([sa.work, sa.activity.files.map((f) => f.path)], [a, ["src/a.cs"]]);
  assert.deepEqual([sb.work, sb.activity.files.map((f) => f.path)], [b, ["src/b.cs"]]);
  assert.equal(track(p, ["current", "--json"], { session: "sess-c" }).json().tracked, false, "a session nothing bound resolves to nothing -- never the newest work on the machine");
  assert.equal(track(p, ["list", "--json"], { session: "sess-c" }).json().works.length, 2);
});

test("`task create --work` joins a tracked work to its task, and a work nobody tracks is left alone; creating a task makes no work", (t) => {
  const p = repo(t);
  const none = run(p, "task", ["create", "an ad-hoc task", "--json"]);
  assert.equal(none.status, 0, none.err);
  assert.equal(none.json().tracking, undefined, "no tracked work: nothing joined, nothing made");
  assert.deepEqual(track(p, ["list", "--json"]).json().works, []);
  const work = track(p, ["track", "Fix the refund limit", "--json"]).json().work;
  const made = run(p, "task", ["create", "Fix the refund limit", `--work=${work}`, "--json"]);
  assert.equal(made.status, 0, made.err);
  const task = made.json().task;
  assert.deepEqual([made.json().tracking.work, made.json().tracking.linked, made.json().tracking.handedOver], [work, true, true]);
  const view = track(p, ["status", "--json"]).json();
  assert.deepEqual([view.mode, view.tasks.map((x) => [x.task, x.what, x.readable, x.lifecycle]), view.handoffs.map((h) => [h.from, h.to, h.task])], ["autonomous", [[task, "task", true, "QUEUED"]], [["developer", "autonomous", task]]]);
});

test("`autonomous-engineering start` in the session of a tracked work joins its task to it -- with no work, it makes none", (t) => {
  const p = repo(t);
  const plain = run(p, "autonomous-engineering", ["start", "Fix the refund limit", "--json"]);
  assert.equal(plain.status, 0, plain.err);
  assert.equal(plain.json().tracking, undefined);
  assert.deepEqual(track(p, ["list", "--json"]).json().works, []);
  const work = track(p, ["track", "Another request", "--json"]).json().work;
  const started = run(p, "autonomous-engineering", ["start", "Another request", "--json"]);
  assert.equal(started.status, 0, started.err);
  assert.deepEqual([started.json().tracking.work, started.json().tracking.linked], [work, true]);
  const view = track(p, ["status", "--json"]).json();
  assert.deepEqual([view.mode, view.tasks.map((x) => x.task)], ["autonomous", [started.json().task]]);
  assert.equal(view.tasks[0].readable, true);
  assert.equal(view.activity.files.length, 0, "starting a task is not an edit");
});

test("a tracked work changes nothing about where /orbit-help sends the next task", (t) => {
  const p = repo(t, { init: true });
  const next = () => JSON.parse(run(p, "help", ["--for=fix the validation bug in the login form", "--json"]).out).next;
  const before = next();
  track(p, ["track", "fix the validation bug in the login form", "--route=orbit-develop"]);
  assert.deepEqual(next(), before, "a request with no requirement is not a requirement waiting to be settled");
});

test("`live status` shows the session's work -- and prints what it always printed when there is none", (t) => {
  const p = repo(t, { init: true });
  const bare = run(p, "live", ["status", "--json"]);
  assert.equal(bare.status, 0, bare.err);
  assert.equal(bare.json().work, null);
  assert.match(run(p, "live", ["status"]).out, /no Orbit task in this checkout/);
  const work = track(p, ["track", "Fix the refund limit", "--route=orbit-develop", "--json"]).json().work;
  edited(p, "sess-a", "src/RefundService.cs", "tu-1");
  const got = run(p, "live", ["status", "--json"]).json();
  assert.deepEqual([got.work.work, got.work.mode, got.work.lifecycle.state, got.work.activity.files.map((f) => f.path)], [work, "developer", "IN_PROGRESS", ["src/RefundService.cs"]]);
  const text = run(p, "live", ["status"]).out;
  assert.match(text, new RegExp(`WORK\\s+${work} — Fix the refund limit`));
  assert.match(text, /LIFECYCLE\s+IN PROGRESS/);
  assert.match(text, /EVIDENCE\s+observed/);
  assert.match(text, /FILES\s+1 observed: src\/RefundService\.cs/);
  assert.doesNotMatch(text, /%/, "no percentage anywhere");
});

test("a broken work journal is a viewer that shows no work, never a viewer or a task that fails", (t) => {
  const p = repo(t, { init: true });
  const work = track(p, ["track", "Fix the refund limit", "--json"]).json().work;
  const store = join(p.dir, "store");
  const journal = join(store, readdirSync(store).find((n) => n.startsWith("repo-")), "work", work, "journal.jsonl");
  execFileSync(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(journal)}, "not json at all\\n{broken")`]);
  const status = run(p, "live", ["status", "--json"]);
  assert.equal(status.status, 0, status.err);
  assert.equal(status.json().work, null);
  assert.equal(run(p, "task", ["create", "a task beside a broken work", "--json"]).status, 0);
  assert.equal(run(p, "live", ["pane", "--host=claude", "--columns=70", "--rows=40"], { input: JSON.stringify({ session_id: "sess-a", cwd: p.checkout }) }).status, 0);
});

test("the pane draws the WORK block above the raw tool list, in a narrow column too, and nothing of it when no work is bound", (t) => {
  const p = repo(t, { init: true });
  const pane = (columns) => JSON.parse(run(p, "live", ["pane", "--host=claude", `--columns=${columns}`, "--rows=40"], { input: JSON.stringify({ session_id: "sess-a", cwd: p.checkout }) }).out);
  const text = (a) => a.current.map((r) => `${(r.left ?? []).map((s) => s.text).join("")} ${(r.right ?? []).map((s) => s.text).join("")}`).join("\n");
  assert.doesNotMatch(text(pane(70)), /WORK\s/);
  const work = track(p, ["track", "Fix the refund limit", "--route=orbit-develop", "--json"]).json().work;
  edited(p, "sess-a", "src/RefundService.cs", "tu-1");
  ran(p, "sess-a", "node --test test/refund.test.js", "tu-2", false);
  const wide = text(pane(80));
  assert.match(wide, new RegExp(`WORK\\s+${work} · Fix the refund limit`));
  assert.match(wide, /state\s+● IN PROGRESS · evidence observed/);
  assert.match(wide, /mode\s+developer · routed to orbit-develop/);
  assert.match(wide, /files\s+1 observed · src\/RefundService\.cs/);
  assert.match(wide, /checks\s+node \(named like a test\) · exit-error/);
  assert.ok(wide.indexOf("WORK") < wide.indexOf("last"), "the work comes above the session's raw tool list");
  const narrow = text(pane(30));
  assert.match(narrow, /WORK/);
  assert.match(narrow, /state/);
  assert.doesNotMatch(narrow, /files\s/, "a narrow column keeps the work, its state and its blocker");
});
