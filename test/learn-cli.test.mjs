import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { UI_TESTS, fixtureProject } from "./fakes/context.mjs";
import { seedStore } from "./fakes/store.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli");

const temp = (tag) => mkdtempSync(join(tmpdir(), `orbit-${tag}-`));

// A store with the fixture project's ledger already in it. `learn analyse`
// derives lessons FROM runs, and the runs used to arrive for free because the
// ledger was committed inside ui-tests/. It is machine state now, so a test
// that wants evidence has to put evidence there -- which is the honest shape:
// nothing about this project is true of a laptop that has never run a case.
const temp_store = () => seedStore("main", fixtureProject());

// "wrote nothing" cannot be "the directory is empty" any more: a store that
// holds the evidence has files in it before the hook is even asked. What the
// assertion means is that the hook added none, so it compares.
const contents = (dir) => snapshot(dir, {});

// sealed() strips every ORBIT_* and repoints HOME at an empty directory, so the
// home-default branch is exercised for real and the developer's own
// ~/.orbit is never touched by the suite.
const run = (script, args, env = {}, input = undefined) =>
  spawnSync(process.execPath, [join(CLI, script), ...args], { encoding: "utf8", input, env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ...env }) });

const learn = (args, store, env = {}) => run("learn.mjs", args, { ORBIT_STORE_DIR: store, ...env });

// A project directory laid out the way the host lays one out, so the hook's
// walk-up runs against a real tree rather than a string.
function hostMemory() {
  const config = temp("claude");
  const project = join(config, "projects", "-Users-x-Repo-acme");
  mkdirSync(join(project, "memory"), { recursive: true });
  return { dir: join(project, "memory"), transcript: join(project, "1f0c8a3e.jsonl") };
}

const sessionStart = (transcript, store, cwd = ROOT) =>
  run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store }, JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", transcript_path: transcript, cwd }));

// THE proof the whole design rests on: one process writes, a genuinely separate
// process reads, and nothing is shared but the disk.
test("a lesson written by one process is read by the next, with nothing shared but the disk", () => {
  const store = temp_store();
  const a = learn(["remember", "case:create-thing", "Run this one after the seed job", "--not=on a fresh database"], store);
  assert.equal(a.status, 0, a.stderr);

  // No host memory directory is discoverable here, so the hook is the delivery
  // mechanism and has to inject the index itself.
  const b = sessionStart(join(temp("loose"), "session.jsonl"), store);
  assert.equal(b.status, 0, b.stderr);
  assert.ok(b.stdout.trim(), "with no memory directory to project into, the hook must inject");
  const payload = JSON.parse(b.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(payload.hookSpecificOutput.additionalContext, /Run this one after the seed job/);
  assert.match(payload.hookSpecificOutput.additionalContext, /not instructions/);

  const c = learn(["recall", "create-thing"], store);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /Run this one after the seed job/);
  assert.match(c.stdout, /SAID/, "a person said it, and it must never read as an inference");
});

test("SessionStart recalls Orbit directly even when host memory exists", () => {
  const store = temp_store();
  const { dir, transcript } = hostMemory();
  assert.equal(sessionStart(transcript, store).status, 0);
  const analysed = learn(["analyse"], store);
  assert.equal(analysed.status, 0, analysed.stderr);
  assert.ok(!existsSync(join(dir, "MEMORY.md")));
  assert.deepEqual(readdirSync(dir), []);
  const recalled = sessionStart(transcript, store);
  assert.match(recalled.stdout, /learn\.mjs recall/);
  assert.match(recalled.stdout, /No architecture snapshot exists/);
});

// Bounded on purpose: a count and a pointer, mirroring the architecture line
// this hook already prints. Nothing here should ever grow into injecting the
// facts themselves — `engineering facts`/`why` are what read the rest.
test("SessionStart reports a bounded engineering-memory summary once a fact exists, and nothing before that", () => {
  const store = temp_store();
  assert.ok(!sessionStart(join(temp("loose"), "s.jsonl"), store).stdout.includes("Orbit engineering memory"), "nothing recorded yet must print nothing");

  const claim = JSON.stringify({ kind: "invariant", key: "no-raw-sql", statement: "Queries never concatenate raw SQL", scope: ["test/fixtures"], evidence: ["test/fixtures/case.bad.json"], source: "test-suite", enforcedBy: ["test/fixtures/case.bad.json"], strength: "enforced" });
  const recorded = run("engineering.mjs", ["record", "--human"], { ORBIT_STORE_DIR: store }, `${claim}\n`);
  assert.equal(recorded.status, 0, recorded.stderr);

  const after = sessionStart(join(temp("loose"), "s2.jsonl"), store);
  assert.match(after.stdout, /Orbit engineering memory: 1 fact\(s\) — 1 enforced/);
});

test("learning leaves existing host memories byte-for-byte unchanged", () => {
  const store = temp_store();
  const { dir, transcript } = hostMemory();
  const mine = "# Memory Index\n\n<!-- orbit:begin -->\nOld projection\n<!-- orbit:end -->\n";
  writeFileSync(join(dir, "MEMORY.md"), mine);
  writeFileSync(join(dir, "my-note.md"), "mine, untouched");
  assert.equal(sessionStart(transcript, store).status, 0);
  assert.equal(learn(["analyse"], store).status, 0);
  assert.equal(readFileSync(join(dir, "MEMORY.md"), "utf8"), mine);
  assert.equal(readFileSync(join(dir, "my-note.md"), "utf8"), "mine, untouched");
  const refused = run("architecture.mjs", ["project"], { ORBIT_STORE_DIR: store });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /projection is retired/);
});

// git status alone would miss a write into a gitignored directory, which is
// exactly the rule being tested: not into the repo, not even somewhere ignored.
test("learning writes nothing into the repository, not even somewhere gitignored", () => {
  const store = temp_store();
  const before = snapshot();
  const status = () => spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout;
  const gitBefore = status();

  assert.equal(learn(["remember", "case:create-thing", "something to remember"], store).status, 0);
  assert.equal(learn(["analyse"], store).status, 0);

  assert.equal(status(), gitBefore, "the working tree moved");
  assert.deepEqual(snapshot(), before, "a file changed inside the repository");
});

function snapshot(dir = ROOT, seen = {}) {
  for (const name of readdirSync(dir)) walk(join(dir, name), name, seen);
  return seen;
}

function walk(path, name, seen) {
  if ([".git", "node_modules"].includes(name)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) return void snapshot(path, seen);
  seen[path] = `${stat.size}:${stat.mtimeMs}`;
}

// One store on the laptop holds every project, so the partition has to be real.
test("one project never receives another project's lessons", () => {
  const store = temp_store();
  const other = join(temp("other"), "ui-tests");
  cpSync(UI_TESTS, other, { recursive: true });
  const config = JSON.parse(readFileSync(join(other, "project.json"), "utf8"));
  writeFileSync(join(other, "project.json"), JSON.stringify({ ...config, name: "other-product", origin: "https://other.test" }));

  assert.equal(learn(["remember", "case:create-thing", "a secret about the first product"], store).status, 0);
  const theirs = learn(["lessons"], store, { ORBIT_UI_TESTS: other });
  assert.equal(theirs.status, 0, theirs.stderr);
  assert.doesNotMatch(theirs.stdout, /a secret about the first product/);
  assert.match(theirs.stdout, /nothing learned yet/);

  const mine = learn(["lessons"], store);
  assert.match(mine.stdout, /a secret about the first product/);
});

// spawnSync would run these one after the other and prove nothing about
// concurrency, so both are started before either is waited on.
test("two processes writing at once both land, with no duplicate", async () => {
  const store = temp_store();
  const started = ["one", "two"].map((n) => started_(["remember", `case:${n}`, `lesson number ${n}`], store));
  const codes = await Promise.all(started.map(exited));
  assert.deepEqual(codes, [0, 0]);

  const listed = learn(["lessons"], store);
  assert.match(listed.stdout, /lesson number one/);
  assert.match(listed.stdout, /lesson number two/);
  assert.match(listed.stdout, /^2 lesson\(s\)/m);
});

const started_ = (args, store) =>
  spawn(process.execPath, [join(CLI, "learn.mjs"), ...args], { env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store }), stdio: "ignore" });

const exited = (child) => new Promise((done) => child.on("exit", done));

test("the off switch survives a restart, and stops writing without blinding recall", () => {
  const store = temp_store();
  assert.equal(learn(["remember", "case:create-thing", "known before it was switched off"], store).status, 0);
  assert.equal(learn(["auto", "off"], store).status, 0);

  const blocked = learn(["analyse"], store);
  assert.equal(blocked.status, 2, "a fresh process must honour the stored switch");
  assert.match(blocked.stderr, /auto-learning is off/);

  const still = learn(["recall", "create-thing"], store);
  assert.equal(still.status, 0);
  assert.match(still.stdout, /known before it was switched off/);

  const byEnv = learn(["analyse"], store, { ORBIT_LEARN: "off" });
  assert.equal(byEnv.status, 2);
});

test("forget takes effect across processes, and analyse does not bring it back", () => {
  const store = temp_store();
  assert.equal(learn(["analyse"], store).status, 0);
  const target = onlyLesson(store);
  assert.match(learn(["lessons"], store).stdout, new RegExp(target), "the fixture must produce a lesson, or this proves nothing");

  const gone = learn(["forget", target, "measured on a laptop that was building"], store);
  assert.equal(gone.status, 0, gone.stderr);
  assert.match(gone.stdout, /no backup of it was kept/);

  assert.equal(learn(["analyse"], store).status, 0);
  assert.doesNotMatch(learn(["lessons"], store).stdout, new RegExp(target), "it came back from the same history");
  assert.match(learn(["lessons"], store).stdout, /nothing learned yet/);
});

function onlyLesson(store) {
  const dir = join(store, readdirSync(store)[0], "memory", "lessons");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 1, `expected one lesson, got ${files.join(", ")}`);
  return files[0].replace(/\.md$/, "");
}

// It asks the product nothing, so FAIL is not in its vocabulary. 1 would tell CI
// the product is broken because somebody typed an id wrong.
test("learn never exits 1 — it is not a gate", () => {
  const store = temp_store();
  assert.equal(learn([], store).status, 0, "no command prints its own help");
  assert.match(learn([], store).stdout, /node learn\.mjs where/);
  assert.equal(learn(["why", "no-such-lesson"], store).status, 2);
  assert.equal(learn(["auto", "sideways"], store).status, 2);
  assert.equal(learn(["analyse", "--family=nonsense"], store).status, 2);
  assert.equal(learn(["where"], store).status, 0);

  const unwritable = learn(["where"], "/proc/nope/nothing-here");
  assert.ok([0, 2, 3].includes(unwritable.status), `got ${unwritable.status}`);
});

test("a hook never fails a session, whatever it is fed", () => {
  const store = temp_store();
  for (const input of ["", "not json", JSON.stringify({ hook_event_name: "Unheard" }), JSON.stringify({ hook_event_name: "SessionStart" })]) {
    assert.equal(run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store }, input).status, 0, `input: ${input}`);
  }
  const noProject = run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: join(temp("empty"), "nope") }, JSON.stringify({ hook_event_name: "SessionStart", cwd: temp("empty") }));
  assert.equal(noProject.status, 0);
  assert.equal(noProject.stdout.trim(), "", "a repo with no ui-tests gets nothing at all");
});

// This hook fires after Bash commands in every session of every team that
// enables the plugin, so "does nothing, and does it cheaply" is the contract.
// The `if:` in hooks/hooks.json stops it spawning at all for a non-node command;
// this covers the case where it does spawn and is still uninterested.
// These four speak about the LEARNING store, so the session trail -- its own
// room, with its own tests in test/trace.test.mjs -- is switched off here.
test("the after-a-tool hook writes nothing unless a case actually ran", () => {
  const store = temp_store();
  const seeded = contents(store);
  const idle = run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store, ORBIT_TRACE: "off", ORBIT_WORKING_SET: "off" }, JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "node ./scripts/unrelated.mjs" } }));
  assert.equal(idle.status, 0);
  assert.equal(idle.stdout.trim(), "");
  assert.deepEqual(contents(store), seeded, "an uninterested hook must add nothing to the store");

  const after = run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store, ORBIT_TRACE: "off", ORBIT_WORKING_SET: "off" }, JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "node /x/cli/run-case.mjs create-thing NAME=TC-1" } }));
  assert.equal(after.status, 0);
  assert.equal(after.stdout.trim(), "", "a background hook must not print into the transcript");
  assert.match(learn(["lessons"], store).stdout, /home\/Add/, "it folded the run in");
});

// A command exiting non-zero is a TOOL failure to the host, which cannot tell
// one that could not start from a run whose product misbehaved -- run-case
// exits 1 for FAIL on purpose. So this handler must add context and record
// NOTHING: the run already wrote its own ledger line, and folding it in again
// would count one run twice and teach the lessons that every failed shell
// command was a failed test.
test("the after-a-failure hook records nothing and only hands back where to look", () => {
  const store = temp_store();
  const seeded = contents(store);
  const failed = (command) => run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store, ORBIT_TRACE: "off", ORBIT_WORKING_SET: "off" }, JSON.stringify({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command } }));

  const ours = failed("node /x/cli/run-case.mjs create-thing NAME=TC-1");
  assert.equal(ours.status, 0);
  const said = JSON.parse(ours.stdout);
  assert.equal(said.hookSpecificOutput.hookEventName, "PostToolUseFailure");
  assert.match(said.hookSpecificOutput.additionalContext, /not by itself a product defect/);
  assert.match(said.hookSpecificOutput.additionalContext, /do not record it again/);
  assert.match(said.hookSpecificOutput.additionalContext, /triage/, "it has to name the command that reads the evidence");
  assert.deepEqual(contents(store), seeded, "a failure hook that writes anything counts the run twice");
});

test("a failing command that is not ours is left entirely alone", () => {
  const store = temp_store();
  const seeded = contents(store);
  const theirs = run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store, ORBIT_TRACE: "off", ORBIT_WORKING_SET: "off" }, JSON.stringify({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "node ./scripts/build.mjs" } }));
  assert.equal(theirs.status, 0);
  assert.equal(theirs.stdout.trim(), "", "somebody else's failing build is not this plugin's business");
  assert.deepEqual(contents(store), seeded);
});

// Two events can fire for one command, and the same event can fire twice. The
// handler is a string match and a console.log, so repeating it repeats nothing.
test("the same failure delivered twice changes nothing and still writes nothing", () => {
  const store = temp_store();
  const seeded = contents(store);
  const once = () => run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store, ORBIT_TRACE: "off", ORBIT_WORKING_SET: "off" }, JSON.stringify({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "node /x/cli/run-case.mjs create-thing" } }));
  assert.equal(once().stdout, once().stdout, "the same input must produce the same context");
  assert.deepEqual(contents(store), seeded);
});

test("a hook that is off writes nothing even after a case ran", () => {
  const store = temp_store();
  assert.equal(learn(["auto", "off"], store).status, 0);
  const after = run("learn-hook.mjs", [], { ORBIT_STORE_DIR: store }, JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "node /x/cli/run-case.mjs create-thing" } }));
  assert.equal(after.status, 0);
  assert.match(learn(["lessons"], store).stdout, /nothing learned yet/);
});

test("a hook handles Antigravity payload format for PostToolUse and PreInvocation", () => {
  const store = temp_store();
  const antigravityPost = run(
    "learn-hook.mjs",
    ["--host=antigravity", "--protocol=2", "--event=PostToolUse"],
    { ORBIT_STORE_DIR: store },
    JSON.stringify({
      conversationId: "conv-123", workspacePaths: [process.cwd()],
      stepIdx: 2,
      toolCall: { name: "run_command", args: { CommandLine: "node /x/cli/run-case.mjs create-thing NAME=TC-1" } },
    }),
  );
  assert.equal(antigravityPost.status, 0);
  assert.equal(antigravityPost.stdout.trim(), "{}", "Antigravity PostToolUse contract expects empty JSON object");
  assert.match(learn(["lessons"], store).stdout, /home\/Add/, "Antigravity tool run folded in");

  const antigravityPre = run(
    "learn-hook.mjs",
    ["--host=antigravity", "--protocol=2", "--event=PreInvocation"],
    { ORBIT_STORE_DIR: store },
    JSON.stringify({ conversationId: "conv-123", workspacePaths: [process.cwd()], workspacePaths: [process.cwd()] }),
  );
  assert.equal(antigravityPre.status, 0);

  const allowPre = run(
    "learn-hook.mjs",
    ["--host=antigravity", "--protocol=2", "--event=PreToolUse"],
    { ORBIT_STORE_DIR: store },
    JSON.stringify({
      conversationId: "conv-123", workspacePaths: [process.cwd()],
      toolCall: { name: "run_command", args: { CommandLine: "node /x/cli/run-case.mjs create-thing" } },
    }),
  );
  assert.equal(allowPre.status, 0);
  assert.equal(JSON.parse(allowPre.stdout).decision, "allow");

  const askPre = run(
    "learn-hook.mjs",
    ["--host=antigravity", "--protocol=2", "--event=PreToolUse"],
    { ORBIT_STORE_DIR: store },
    JSON.stringify({
      conversationId: "conv-123", workspacePaths: [process.cwd()],
      toolCall: { name: "run_command", args: { CommandLine: "rm -rf /" } },
    }),
  );
  assert.equal(askPre.status, 0);
  assert.equal(JSON.parse(askPre.stdout).decision, "ask");
});


