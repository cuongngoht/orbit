// The whole thing for REAL, once: a real Git checkout, a real store, the real tool
// detection, the real Process port launching a real dev server that listens on a real
// port, a real readiness probe, and a stop that ends the process group -- through the
// same binding the CLI and Orbit Control use. Everything else in the runtime suite is
// fakes; this is the one test that proves the fakes were describing something true.
//
// Only where npm can be asked, through the same Process port the runtime launches with. A start
// runs on POSIX; reading a checkout runs wherever npm is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindRuntime, bindSandbox, originAnswer } from "../skills/orbit-runtime/bind.mjs";
import { createLocalClones } from "../src/frontend/local-clones.mjs";
import { createWorkspaces } from "../src/orchestration/workspace.mjs";
import { COMMANDS } from "../src/runtime/index.mjs";
import { createProbe } from "../src/probe/index.mjs";
import { createProcess } from "../src/process/index.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const hasNpm = createProcess().run("npm", ["--version"], { timeoutMs: 30000 }).ok;
const skip = hasNpm ? false : "needs npm on the PATH";
// A real start, readiness and stop on Windows -- a process tree ended by taskkill, a start time asked of
// PowerShell -- is not yet proven by this suite. There, the shim path is proven by asking npm for real
// (test/process.test.mjs) and by the Process port's own tests; here the whole start runs on POSIX.
const starts = process.platform === "win32" ? "a real start on Windows is not yet proven by this suite: it runs on POSIX" : skip;

const freePort = () => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const git = (cwd, ...args) => spawnSync("git", args, { cwd, stdio: "ignore", env: sealed({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }) });

async function repository(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-real-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "shop");
  const port = await freePort();
  mkdirSync(join(repo, "web"), { recursive: true });
  writeFileSync(join(repo, "web", "package.json"), JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { dev: "node serve.js", release: "echo never offered" } }));
  writeFileSync(join(repo, "web", "package-lock.json"), "{}");
  writeFileSync(join(repo, "web", "serve.js"), `require("net").createServer((s) => s.on("error", () => {})).listen(${port}, "127.0.0.1");\nsetInterval(() => {}, 1000);\n`);
  git(repo, "init", "-q", ".");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  return { repo, port, env: sealed({ ORBIT_STORE_DIR: join(base, "store") }) };
}

test("discover, doctor, configure, start, ready, status, stop -- a real dev server in a real checkout, ended with nothing left behind", { skip: starts, timeout: 120000 }, async (t) => {
  const { repo, port, env } = await repository(t);
  const bind = () => bindRuntime({ pluginRoot: ROOT, env, cwd: repo, host: "test-host" });
  try {
    await acceptance(bind, port);
  } finally {
    await COMMANDS.stop.run(bind(), []).catch(() => null);
  }
});

async function acceptance(bind, port) {
  const discovered = await COMMANDS.discover.run(bind(), []);
  assert.deepEqual([discovered.decision.name, discovered.state, discovered.byKind.command], ["BOOTSTRAP", "CURRENT", 2], "the dev script it declared, and the restore the lock file implies");
  assert.equal((await COMMANDS.discover.run(bind(), [])).decision.name, "CURRENT", "the second look reads nothing");
  const doctor = await COMMANDS.doctor.run(bind(), []);
  assert.equal(doctor.plan.overall, "READY", JSON.stringify(doctor.plan.components));
  await COMMANDS.configure.run(bind(), ["--component=node:web", "--probe=tcp", `--target=${port}`, "--human"]);
  const started = await COMMANDS.start.run(bind(), ["--wait=30"]);
  assert.equal(started.started[0].readiness.state, "READY", JSON.stringify(started));
  const status = await COMMANDS.status.run(bind(), []);
  const session = status.sessions.find((s) => s.component === "node:web");
  assert.deepEqual([session.state, session.ownership, session.readiness.state, session.readiness.probe.source], ["RUNNING", "ORBIT_OWNED", "READY", "human"]);
  assert.equal((await createProbe().tcp(port)).ok, true, "something really is listening");
  assert.equal((await COMMANDS.start.run(bind(), [])).skipped.length, 1, "a second start starts nothing");
  const stopped = await COMMANDS.stop.run(bind(), []);
  assert.deepEqual(stopped.stopped.map((s) => s.how), ["SIGTERM"]);
  for (let i = 0; i < 50 && (await createProbe().tcp(port)).ok; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await createProbe().tcp(port)).ok, false, "the whole process group is gone, not only the package manager");
  const projects = await COMMANDS.projects.run({ registry: bind().registry }, []);
  assert.deepEqual([projects.length, projects[0].checkouts[0].summary.runtime], [1, "STOPPED"]);
}

test("a real checkout is never written by discovery: the repository is exactly as it was committed", { skip }, async (t) => {
  const { repo, env } = await repository(t);
  await COMMANDS.discover.run(bindRuntime({ pluginRoot: ROOT, env, cwd: repo }), []);
  const status = spawnSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo, encoding: "utf8" });
  assert.equal(status.stdout.trim(), "", "no file, no directory, not even an ignored one");
});

// What an investigation asks of the runtime before it acts on an approved environment: the
// binding, the memory and a real connection. Nothing is started -- only a port that a file
// declares, and a socket the test itself holds.
test("the origin an environment approves: silent before anything is understood, then served or not, from a real connection", { timeout: 60000 }, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-origin-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "shop");
  const port = await freePort();
  mkdirSync(join(repo, "api", "Properties"), { recursive: true });
  writeFileSync(join(repo, "api", "Api.csproj"), '<Project Sdk="Vendor.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>');
  writeFileSync(join(repo, "api", "Properties", "launchSettings.json"), JSON.stringify({ profiles: { http: { commandName: "Project", applicationUrl: `http://localhost:${port}` } } }));
  git(repo, "init", "-q", ".");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store") });
  const where = { pluginRoot: ROOT, env, cwd: repo };
  const origin = `http://localhost:${port}`;
  assert.equal(await originAnswer(where, origin), null, "nothing has read this checkout: silence, not a stop");
  await COMMANDS.discover.run(bindRuntime({ pluginRoot: ROOT, env, cwd: repo }), []);
  const down = await originAnswer(where, origin);
  assert.deepEqual([down.component, down.port, down.served], ["dotnet:api", port, false]);
  const server = createServer((s) => s.on("error", () => {}));
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    assert.equal((await originAnswer(where, origin)).served, true, "a listener on the declared port answers it");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await originAnswer(where, "https://app.example.test"), null, "an origin that is not this machine is nobody's news here");
  assert.equal(await originAnswer({ ...where, cwd: base }, origin), null, "a directory that is no checkout is silence too");
});

// A reach target for REAL: the real binding, the real Reach port, a real name lookup and real
// connections -- to a listener on this machine's loopback the test itself holds, because a test that
// depended on a corporate network would prove nothing anywhere else. Up, down, up again: a retry asks
// NOW, and an answer is never the one from before.
test("a reach target checked for real: reachable, then not once the server is gone, then reachable again -- from this machine, by the saved policy", { timeout: 60000 }, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-reach-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "shop");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "# shop\n");
  git(repo, "init", "-q", ".");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store") });
  const bind = () => bindRuntime({ pluginRoot: ROOT, env, cwd: repo });
  const port = await freePort();
  await COMMANDS.configure.run(bind(), ["--reach=local-db", "--label=Local database", "--address=127.0.0.1", `--port=${port}`, "--check-from=native", "--retry-attempts=2", "--retry-interval-ms=250", "--retry-timeout-ms=1000", "--human"]);
  const server = createServer((s) => s.on("error", () => {}));
  t.after(() => server.listening && server.close());
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const up = await COMMANDS.check.run(bind(), ["local-db"]);
  assert.deepEqual([up.results.native.state, up.results.native.resolution, up.results.native.transport, up.results.native.attemptsUsed], ["REACHABLE", "NOT_ATTEMPTED", "REACHABLE", 1], "an address needs no lookup");
  await new Promise((resolve) => server.close(resolve));
  const down = await COMMANDS.retry.run(bind(), ["local-db"]);
  assert.deepEqual([down.results.native.state, down.results.native.attemptsUsed, down.results.native.configuredAttempts], ["UNREACHABLE", 2, 2], "every attempt of the policy, and no more");
  assert.match(down.results.native.because, /could not be reached/);
  const again = createServer((s) => s.on("error", () => {}));
  t.after(() => again.listening && again.close());
  await new Promise((resolve) => again.listen(port, "127.0.0.1", resolve));
  try {
    const back = await COMMANDS.retry.run(bind(), ["local-db"]);
    assert.deepEqual([back.results.native.state, back.results.native.attemptsUsed], ["REACHABLE", 1], "it stops at the first answer that settles it");
    const read = await COMMANDS.connectivity.run(bind(), []);
    assert.deepEqual([read.targets[0].observations.native.state, read.targets[0].observations.native.freshness.stale], ["REACHABLE", false]);
  } finally {
    await new Promise((resolve) => again.close(resolve));
  }
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8", env: sealed() }).stdout, "", "the checkout is exactly as it was");
});

// Two processes, two terminals: both look, neither finds anything running -- unless the look and the
// launch are one step taken in turn, which they are, by a lock in the checkout's live room.
test("two real CLI starts at the same moment start the server ONCE: the second finds it running", { skip: starts, timeout: 120000 }, async (t) => {
  const { repo, port, env } = await repository(t);
  const cli = (...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "cli", "runtime.mjs"), ...args], { cwd: repo, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
  try {
    await cli("discover");
    await cli("doctor");
    const [a, b] = await Promise.all([cli("start", "--json"), cli("start", "--json")]);
    const results = [a, b].map((r) => JSON.parse(r.out));
    assert.deepEqual(results.map((r) => r.started.length).sort(), [0, 1], "exactly one of them started it");
    assert.deepEqual(results.map((r) => r.skipped.length).sort(), [0, 1], "and the other found it running");
    const status = JSON.parse((await cli("status", "--json")).out);
    assert.equal(status.sessions.filter((s) => s.state === "RUNNING").length, 1, "one session, one server");
    assert.equal(port > 0, true);
  } finally {
    await cli("stop");
  }
});

// A manifest that is staged when the checkout is read is in the index and not in the last commit, so
// there is nothing to read of it. That must be SAID, and it must be read once the commit has it --
// not recorded as understood and never looked at again.
test("a manifest that was only staged when the checkout was read is said to be unread, and read once it is committed", async (t) => {
  const { repo, env } = await repository(t);
  const bind = () => bindRuntime({ pluginRoot: ROOT, env, cwd: repo });
  await COMMANDS.discover.run(bind(), []);
  mkdirSync(join(repo, "apps", "new"), { recursive: true });
  writeFileSync(join(repo, "apps", "new", "package.json"), JSON.stringify({ name: "new", scripts: { dev: "vite" } }));
  writeFileSync(join(repo, "apps", "new", "package-lock.json"), "{}");
  git(repo, "add", "-A");
  const staged = await COMMANDS.discover.run(bind(), []);
  assert.equal(staged.decision.name, "EVIDENCE_CHANGED");
  assert.ok(staged.gaps.some((g) => /1 evidence file\(s\) could not be read .*\(apps\/new\/package\.json\)/.test(g)), JSON.stringify(staged.gaps));
  assert.notEqual((await COMMANDS.status.run(bind(), [])).understanding.state, "CURRENT", "something could not be read, and a staged file is an uncommitted edit: not CURRENT");
  git(repo, "commit", "-qm", "add the app");
  const committed = await COMMANDS.discover.run(bind(), []);
  assert.equal(committed.decision.name, "EVIDENCE_CHANGED", "the commit moved, so what could not be read is asked again");
  assert.equal(committed.gaps.length, 0);
  const keys = (await COMMANDS.status.run(bind(), [])).plan.components.map((c) => c.key);
  assert.ok(keys.includes("node:apps/new"), keys.join(", "));
  assert.equal((await COMMANDS.discover.run(bind(), [])).decision.name, "CURRENT", "and the look after that costs nothing");
});

// A frontend kept in a git SUBMODULE: `ls-files` lists only the link, so discovery saw nothing there
// and a start had nothing to launch. Read under the path it has in the working tree, it is a component
// like any other -- and its directory is the one a start launches in, here and in a container.
test("a package that lives in a submodule is discovered as a component, where it sits in the working tree", { timeout: 60000 }, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-submodule-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const [ui, repo] = [join(base, "ui"), join(base, "shop")];
  mkdirSync(join(ui, "web"), { recursive: true });
  writeFileSync(join(ui, "web", "package.json"), JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { start: "node serve.js" } }));
  writeFileSync(join(ui, "web", "package-lock.json"), "{}");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "# shop\n");
  for (const [cwd, ...args] of [[ui, "init", "-q", "."], [ui, "add", "-A"], [ui, "commit", "-qm", "init"], [repo, "init", "-q", "."], [repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", ui, "external/ui"], [repo, "add", "-A"], [repo, "commit", "-qm", "init"]]) git(cwd, ...args);
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store") });
  await COMMANDS.discover.run(bindRuntime({ pluginRoot: ROOT, env, cwd: repo }), []);
  await COMMANDS.doctor.run(bindRuntime({ pluginRoot: ROOT, env, cwd: repo }), []);
  const seen = await COMMANDS.status.run(bindRuntime({ pluginRoot: ROOT, env, cwd: repo }), []);
  const web = seen.plan.components.find((c) => c.key === "node:external/ui/web");
  assert.ok(web, `the submodule's package is a component (found: ${seen.plan.components.map((c) => c.key).join(", ") || "none"})`);
  assert.deepEqual([web.command?.declaredAs, web.command?.cwd], ["start", "external/ui/web"]);
  assert.equal(spawnSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo, encoding: "utf8" }).stdout.trim(), "", "and nothing was written to it");
});

// A SANDBOX for real: a clone of the checkout the task edits (uncommitted), a server that is only in the task's version of the
// code, started from the workspace on a port the sandbox LEASED and told through PORT, answering for real -- and released with
// nothing left listening, no lease kept and the developer's checkout exactly as it was committed.
test("a task's sandbox runs the TASK's code on a leased port, and releasing it leaves the checkout and the machine as they were", { skip: starts, timeout: 120000 }, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-sandbox-real-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "shop");
  mkdirSync(join(repo, "web"), { recursive: true });
  writeFileSync(join(repo, "web", "package.json"), JSON.stringify({ name: "web", engines: { node: ">=18" } }));
  writeFileSync(join(repo, "web", "package-lock.json"), "{}");
  git(repo, "init", "-q", ".");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  const env = sealed({ ORBIT_STORE_DIR: join(base, "store") });
  const person = () => bindRuntime({ pluginRoot: ROOT, env, cwd: repo, host: "test-host" });
  const task = "tsk-0123456789ab";
  const first = person();
  const trees = createLocalClones(repo, createProcess(), { noHooks: join(first.storeRoot, "workspaces", ".no-hooks"), env: sealed({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }) });
  const made = createWorkspaces({ root: first.storeRoot, io: first.io, trees, host: "test-host", now: () => new Date().toISOString() }).prepare({ task, project: first.project.storeKey, checkout: first.checkout, baseRevision: trees.head() });
  const from = await freePort();
  const settings = first.readSettings();
  first.writeSettings({ next: { ...settings.settings, sandbox: { ...settings.settings.sandbox, restore: { mode: "manual", trusted: [] }, ports: { mode: "lease", from, to: from + 40 } }, components: { "node:web": { port: { override: { kind: "env", name: "PORT", format: "{port}" } } } } }, revision: settings.revision, by: "person" });
  // What the TASK did, uncommitted: gave the package a way to start, and wrote the server.
  writeFileSync(join(made.path, "web", "package.json"), JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { dev: "node serve.js" } }));
  writeFileSync(join(made.path, "web", "serve.js"), 'require("net").createServer((s) => s.on("error", () => {})).listen(Number(process.env.PORT), "127.0.0.1");\nsetInterval(() => {}, 1000);\n');
  const sandbox = () => bindSandbox({ pluginRoot: ROOT, env, cwd: repo, host: "test-host", task });
  let leased = null;
  try {
    const prepared = await COMMANDS["sandbox-prepare"].run(sandbox(), []);
    assert.equal(prepared.state, "READY", JSON.stringify(prepared));
    assert.deepEqual(prepared.placements, { "node:web": "native" }, "the dev script exists ONLY in the workspace's uncommitted edit: the sandbox read what the workspace holds");
    leased = prepared.endpoints[0].port;
    assert.ok(leased >= from && leased <= from + 40, "a leased port, not one a file declares");
    const started = await COMMANDS["sandbox-start"].run(sandbox(), ["--wait=30"]);
    assert.equal(started.started.length, 1, JSON.stringify(started));
    assert.equal((await createProbe().tcp(leased)).ok, true, "the task's server is really listening where the sandbox says");
    assert.equal((await COMMANDS.status.run(person(), [])).sessions.length, 0, "and none of it is the person's runtime");
    const view = await COMMANDS.sandbox.run(sandbox(), []);
    assert.deepEqual([view.state, view.stale, view.components[0].readiness.state, view.components[0].endpoint], ["READY", false, "READY", `127.0.0.1:${leased}`]);
    writeFileSync(join(made.path, "web", "serve.js"), "// the task changed the code\n");
    assert.equal((await COMMANDS.sandbox.run(sandbox(), [])).stale, true, "the moment the workspace moved, the sandbox was stale");
  } finally {
    const out = await COMMANDS["sandbox-release"].run(sandbox(), []).catch(() => null);
    assert.equal(out?.released, true);
  }
  for (let i = 0; i < 50 && (await createProbe().tcp(leased)).ok; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await createProbe().tcp(leased)).ok, false, "nothing is left listening");
  assert.deepEqual((await COMMANDS.sandboxes.run(person(), [])).leases, [], "and no lease is kept");
  assert.equal(spawnSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo, encoding: "utf8" }).stdout.trim(), "", "the developer's checkout is exactly as it was committed");
});
