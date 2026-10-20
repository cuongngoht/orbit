// `cli/live.mjs` as a person runs it: the usage header, the command table and the governance table agree;
// `status` and `watch` read a real journal in a real checkout with no Orbit Control anywhere; a watcher sees a
// line another process appends; Ctrl+C detaches the viewer and leaves the task as it was; nothing a viewer
// does writes a journal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { sealed } from "./home.mjs";
import { NOT_LIVE, OPERATIONS, OPERATION_NAMES } from "../src/live/governance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(ROOT, "cli", "live.mjs");
const TASK = join(ROOT, "cli", "task.mjs");

function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-live-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  return { repo, env: sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", NO_COLOR: "1" }) };
}

const run = (c, file, args) => execFileSync(process.execPath, [file, ...args], { cwd: c.repo, env: c.env, encoding: "utf8" });
const task = (c, ...args) => run(c, TASK, args);
const live = (c, ...args) => run(c, LIVE, args);
const created = (c, objective = "PBI-482 Refund validation") => JSON.parse(task(c, "create", objective, "--json")).task;
const journal = (c, id) => JSON.parse(task(c, "events", id, "--json")).events.length;

test("the usage header documents exactly the commands governance names, and every one says what it writes", () => {
  assert.deepEqual([...documented(headerOf(readFileSync(LIVE, "utf8")), "live")].sort(), [...OPERATION_NAMES].sort());
  for (const [name, op] of Object.entries(OPERATIONS)) assert.ok(["READ", "STORE", "OPEN"].includes(op.class), name);
  assert.deepEqual(OPERATION_NAMES.filter((n) => OPERATIONS[n].class === "OPEN"), ["ensure", "open"], "only `ensure` (what /orbit-help runs) and `open` start anything, and only Orbit's own viewer");
  assert.deepEqual(OPERATION_NAMES.filter((n) => OPERATIONS[n].class === "READ"), ["status", "statusline", "pane", "watch", "tui", "where", "doctor"]);
  assert.ok(NOT_LIVE.some((n) => /approval/.test(n)));
});

test("status reads the one running task of this checkout with no Orbit Control, and writes nothing", (t) => {
  const c = checkout(t);
  const id = created(c);
  task(c, "stage", id, "BUILDING");
  const before = journal(c, id);
  const got = JSON.parse(live(c, "status", "--json"));
  assert.deepEqual([got.association.how, got.association.task, got.stage, got.presentation.state], ["checkout", id, "BUILDING", "LIVE"]);
  assert.match(live(c, "status", "--lines=1"), /^Orbit [◐◓◑◒] ORBITING · BUILDING/);
  assert.equal(journal(c, id), before);
});

test("two tasks running in one checkout are ambiguous until a person pins one", (t) => {
  const c = checkout(t);
  const a = created(c, "one");
  created(c, "two");
  assert.equal(JSON.parse(live(c, "status", "--json")).association.how, "ambiguous");
  live(c, "pin", a);
  assert.deepEqual(((g) => [g.association.how, g.association.task])(JSON.parse(live(c, "status", "--json"))), ["pin", a]);
  live(c, "unpin");
  assert.equal(JSON.parse(live(c, "status", "--json")).association.how, "ambiguous");
});

test("a task this session created is shown over another session's in the same checkout", (t) => {
  const c = checkout(t);
  const mine = created({ ...c, env: { ...c.env, ORBIT_SESSION: "claude:0123456789abcdef" } }, "mine");
  created({ ...c, env: { ...c.env, ORBIT_SESSION: "claude:fedcba9876543210" } }, "theirs");
  const got = JSON.parse(run({ ...c, env: { ...c.env, ORBIT_SESSION: "claude:0123456789abcdef" } }, LIVE, ["status", "--json"]));
  assert.deepEqual([got.association.how, got.association.task], ["session", mine]);
});

test("a pin refuses a task this checkout does not have", (t) => {
  const c = checkout(t);
  created(c);
  assert.throws(() => live(c, "pin", "tsk-000000000000"), (e) => e.status === 2);
});

test("watch --jsonl follows a line another process appends, and Ctrl+C detaches the viewer, not the task", async (t) => {
  const c = checkout(t);
  const id = created(c);
  const child = spawn(process.execPath, [LIVE, "watch", id, "--jsonl"], { cwd: c.repo, env: c.env });
  const out = { text: "" };
  child.stdout.on("data", (d) => { out.text += d; });
  await until(() => out.text.includes('"task-view"'));
  task(c, "stage", id, "TESTING");
  await until(() => out.text.includes('"stage":"TESTING"'));
  const before = journal(c, id);
  child.kill("SIGINT");
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0);
  assert.equal(journal(c, id), before);
  assert.equal(JSON.parse(task(c, "show", id, "--json")).terminal, false, "the task goes on");
  const frames = out.text.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([...new Set(frames.map((f) => f.event))].sort(), ["task-event", "task-view"]);
});

test("a finished task is replayed as plain lines, ends by itself, and a pipe gets no colour", (t) => {
  const c = checkout(t);
  const id = created(c);
  task(c, "complete", id, "--summary=done");
  const text = live(c, "watch", id);
  assert.match(text, /task +completed +completed · done/);
  assert.match(text, /end +terminal/);
  assert.equal(text.includes(String.fromCharCode(27)), false);
});

test("outside any checkout Orbit wrote for, status is BLOCKED and statusline prints nothing and exits 0", (t) => {
  const c = checkout(t);
  assert.throws(() => live(c, "status"), (e) => e.status === 3);
  assert.equal(execFileSync(process.execPath, [LIVE, "statusline", "--host=claude"], { cwd: c.repo, env: c.env, input: JSON.stringify({ session_id: "x", workspace: { current_dir: c.repo } }), encoding: "utf8" }), "");
});

test("tui in a pipe is refused before it writes a byte to stdout, and pointed at watch", (t) => {
  const c = checkout(t);
  const id = created(c);
  const before = journal(c, id);
  const got = spawnSync(process.execPath, [LIVE, "tui", id], { cwd: c.repo, env: c.env, encoding: "utf8" });
  assert.equal(got.status, 2);
  assert.equal(got.stdout, "");
  assert.match(got.stderr, /live watch --plain.*live watch --jsonl/);
  assert.equal(journal(c, id), before);
});

test("open --print starts nothing and prints the command a person runs in a second terminal; a bad id is refused", (t) => {
  const c = checkout(t);
  const id = created(c);
  const got = JSON.parse(live(c, "open", id, "--print", "--json"));
  assert.deepEqual([got.opener, got.started], ["print", false]);
  assert.match(got.command, new RegExp(`'tui' '${id}' '--until-done'$`));
  assert.throws(() => live(c, "open", "tsk-../../x"), (e) => e.status === 2);
});

test("a checkout cannot plant the program live open starts: PATH entries inside it are not looked in", (t) => {
  const c = checkout(t);
  created(c);
  const bin = join(c.repo, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "tmux"), "#!/bin/sh\necho planted\n", { mode: 0o755 });
  const env = { ...c.env, TMUX: "/tmp/tmux-1/default,1,0", PATH: [bin, dirname(process.execPath)].join(delimiter) };
  const checks = JSON.parse(execFileSync(process.execPath, [LIVE, "doctor", "--json"], { cwd: c.repo, env, encoding: "utf8" })).checks;
  assert.doesNotMatch(checks.find((k) => k.name === "open").says, /tmux/);
});

// A fake `tmux` OUTSIDE the checkout: it records how it was called, and exits with the status a test chooses.
function fakeTmux(t, status) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-fake-tmux-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "tmux"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(dir, "called")}'\nexit ${status}\n`, { mode: 0o755 });
  return dir;
}

const openWith = (c, bin, id) => JSON.parse(execFileSync(process.execPath, [LIVE, "open", id, "--json"], { cwd: c.repo, env: { ...c.env, TMUX: "/tmp/tmux-1/default,1,0", PATH: [bin, dirname(process.execPath)].join(delimiter) }, encoding: "utf8" }));

test("open says it opened only when the opener said so, and hands over the command when it did not", { skip: process.platform === "win32" ? "a shell script stands in for tmux" : false }, (t) => {
  const c = checkout(t);
  const id = created(c);
  const ok = fakeTmux(t, 0);
  const good = openWith(c, ok, id);
  assert.deepEqual([good.opener, good.started], ["tmux", true]);
  assert.deepEqual(readFileSync(join(ok, "called"), "utf8").trim().split("\n").slice(0, 6), ["split-window", "-h", "-d", "-l", "36%", "-c"]);
  assert.match(readFileSync(join(ok, "called"), "utf8"), new RegExp(`\ntui\n${id}\n--until-done$`, "m"));
  const bad = openWith(c, fakeTmux(t, 1), id);
  assert.deepEqual([bad.opener, bad.started], ["tmux", false]);
  assert.match(bad.say, /could not open a pane from here/);
  assert.match(bad.command, /'tui' 'tsk-[a-f0-9]{12}' '--until-done'$/);
  const quiet = execFileSync(process.execPath, [LIVE, "open", id, "--auto"], { cwd: c.repo, env: { ...c.env, TMUX: "/tmp/tmux-1/default,1,0", PATH: [fakeTmux(t, 1), dirname(process.execPath)].join(delimiter) }, encoding: "utf8" });
  assert.equal(quiet, "", "--auto says nothing when nothing opened");
});

test("doctor says whether this terminal can show the full-screen viewer", (t) => {
  const c = checkout(t);
  created(c);
  const checks = JSON.parse(live(c, "doctor", "--json")).checks;
  assert.match(checks.find((k) => k.name === "full screen").says, /not an interactive terminal here: `live tui` needs one/);
});

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fn(), "timed out");
}
