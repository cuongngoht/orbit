// The Process port's 1.6.0 options -- env, cwd, maxBuffer -- and runAsync(),
// held to the rules the port was written for: argv only, and a child is given
// EXACTLY the environment a caller names, never this process's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createProcess } from "../src/process/index.mjs";
import { BASE_ENV, baseEnv, childEnv } from "../src/process/env.mjs";
import { extensionContextV1 } from "../src/extensions/context-v1.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { sealed } from "./home.mjs";

const NODE = process.execPath;
const printEnv = ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => k.startsWith('ORBIT_T_'))))"];

test("a named env is the WHOLE environment of the child; no env keeps the old inheritance", () => {
  const port = createProcess();
  process.env.ORBIT_T_SECRET = "canary-value";
  try {
    assert.deepEqual(JSON.parse(port.run(NODE, printEnv, { env: { ORBIT_T_OWN: "1" } }).out), ["ORBIT_T_OWN"]);
    assert.ok(JSON.parse(port.run(NODE, printEnv).out).includes("ORBIT_T_SECRET"), "a caller that names no env is unchanged");
  } finally {
    delete process.env.ORBIT_T_SECRET;
  }
});

test("cwd is where the child starts", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-proc-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = createProcess().run(NODE, ["-e", "process.stdout.write(process.cwd())"], { cwd: dir });
  assert.equal(realpathSync(r.out), dir);
});

test("a child that writes past maxBuffer is stopped and SAYS so -- never read as one that hung", () => {
  const r = createProcess().run(NODE, ["-e", "process.stdout.write('x'.repeat(200000))"], { maxBuffer: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.overflow, true);
  assert.match(r.error, /wrote more than 1000 bytes/);
  assert.doesNotMatch(r.error, /never answered/);
});

test("a killed child is reported as never answering (a fake spawn, so nothing waits)", () => {
  const port = createProcess({ spawn: () => ({ signal: "SIGKILL", status: null }), timeoutMs: 5000 });
  assert.match(port.run("slow", []).error, /killed after 5s/);
});

test("runAsync answers like run: stdout, stdin, a non-zero exit and an exact env", async () => {
  const port = createProcess();
  assert.equal((await port.runAsync(NODE, ["-e", "process.stdin.pipe(process.stdout)"], { input: "piped" })).out, "piped");
  const failed = await port.runAsync(NODE, ["-e", "process.stderr.write('bad thing'); process.exit(4)"]);
  assert.deepEqual([failed.ok, failed.status, failed.error], [false, 4, "bad thing"]);
  assert.deepEqual(JSON.parse((await port.runAsync(NODE, printEnv, { env: { ORBIT_T_ONLY: "1" } })).out), ["ORBIT_T_ONLY"]);
});

test("runAsync stops a child past its limit or its deadline, in run's own words", async () => {
  const over = await createProcess().runAsync(NODE, ["-e", "process.stdout.write('y'.repeat(500000))"], { maxBuffer: 2000 });
  assert.deepEqual([over.ok, over.overflow], [false, true]);
  const late = await createProcess({ launch: hanging, timeoutMs: 5 }).runAsync("hangs", []);
  assert.match(late.error, /hangs was killed after 0.005s/);
});

test("runAsync refuses a string of arguments, like run", async () => {
  const r = await createProcess().runAsync(NODE, "-e 1");
  assert.equal(r.ok, false);
  assert.match(r.error, /never uses a shell/);
});

test("BASE_ENV carries what a Windows child needs, and childEnv adds only DECLARED names", () => {
  assert.ok(BASE_ENV.includes("SystemRoot") && BASE_ENV.includes("SYSTEMROOT"));
  const env = { PATH: "/bin", SECRET_TOKEN: "x", PROXY_URL: "http://p" };
  assert.deepEqual(baseEnv(env), { PATH: "/bin" });
  assert.deepEqual(childEnv(env, ["PROXY_URL", "NOT_SET"]), { PATH: "/bin", PROXY_URL: "http://p" });
});

test("the v1 facade forwards only input and timeoutMs: a capability cannot give its child an env or a cwd", () => {
  const proc = fakeProcess();
  const ext = extensionContextV1({ process: proc, tools: {}, browser: {} }, { values: {} }, { id: "demo.cap", from: "demo", timeoutSec: 7 });
  ext.process.run("psql", ["-c", "select 1"], { input: "x", env: { LEAK: "1" }, cwd: "/", maxBuffer: 1 });
  assert.deepEqual(proc.calls[0].opts, { timeoutMs: 7000, input: "x", by: proc.calls[0].opts.by });
});

// A child that never exits on its own: only kill() closes it.
function hanging() {
  const child = new EventEmitter();
  Object.assign(child, { stdin: null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => queueMicrotask(() => child.emit("close", null)) });
  return child;
}

// ---- 1.7.6: a child that outlives its caller, and the questions a receipt is checked with ----

test("launch starts a detached, unref'd child: argv only, its output in files, an exact env, nothing held", () => {
  const seen = { opened: [], closed: [], unref: 0 };
  const port = createProcess({ open: (p) => (seen.opened.push(p), seen.opened.length + 100), close: (fd) => seen.closed.push(fd), now: () => Date.parse("2026-10-03T10:00:00.000Z"), launch: (file, args, opts) => (seen.call = { file, args, opts }, { pid: 4321, unref: () => seen.unref++, on: () => {} }) });
  const got = port.launch("serve", ["--port", 8080, "a;b"], { cwd: "/work/app", env: { ONLY: "1" }, out: "/log/out", err: "/log/err" });
  assert.deepEqual(got, { pid: 4321, startedAt: "2026-10-03T10:00:00.000Z" });
  assert.deepEqual(seen.call.args, ["--port", "8080", "a;b"], "a value with a ; is one argument, never a second command");
  assert.equal(seen.call.opts.shell, false);
  assert.equal(seen.call.opts.detached, true);
  assert.deepEqual(seen.call.opts.env, { ONLY: "1" });
  assert.equal(seen.call.opts.cwd, "/work/app");
  assert.deepEqual(seen.call.opts.stdio, ["ignore", 101, 102]);
  assert.deepEqual([seen.opened, seen.closed, seen.unref], [["/log/out", "/log/err"], [101, 102], 1]);
});

test("launch hands `input` to the child's stdin and closes it -- never on its command line -- and a child that does not read it is no error", () => {
  const seen = { written: [], handlers: [] };
  const stdin = { on: (event) => seen.handlers.push(event), end: (data) => seen.written.push(data) };
  const port = createProcess({ open: () => 101, close: () => {}, now: () => 0, launch: (file, args, opts) => (seen.call = { args, opts }, { pid: 9, stdin, unref: () => {}, on: () => {} }) });
  port.launch("devcontainer", ["exec", "--", "sh"], { env: {}, input: "API_URL=http://x\n\n" });
  assert.deepEqual([seen.call.opts.stdio[0], seen.written, seen.handlers], ["pipe", ["API_URL=http://x\n\n"], ["error"]]);
  assert.equal(seen.call.args.join(" ").includes("http://x"), false);
});

test("a real detached child reads what it was handed on stdin", { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-input-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const got = join(dir, "got.txt");
  createProcess().launch(process.execPath, ["-e", `const fs=require("fs");let d="";process.stdin.on("data",(c)=>d+=c).on("end",()=>{fs.writeFileSync(${JSON.stringify(`${got}.part`)},d);fs.renameSync(${JSON.stringify(`${got}.part`)},${JSON.stringify(got)})})`], { env: sealed({}), input: "NAME=value with spaces\n\n" });
  for (let i = 0; i < 100 && !existsSync(got); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(readFileSync(got, "utf8"), "NAME=value with spaces\n\n");
});

test("launch is told when it is handed a shell string, and a missing log is not opened", () => {
  const port = createProcess({ launch: () => ({ pid: 1, unref: () => {}, on: () => {} }), open: () => assert.fail("nothing to open") });
  assert.throws(() => port.launch("serve --port 1", "x"), TypeError);
  assert.equal(port.launch("serve", [], {}).pid, 1);
});

// npm 9+'s own shim, as Node's Windows installer writes it: the script named in a variable.
const NPM_CMD = '@ECHO OFF\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%NODE_EXE%" "%NPM_CLI_JS%" %*\r\n';

function windowsPort(files, calls) {
  const fake = (file, args, opts) => (calls.push({ file, args, opts }), { pid: 77, unref: () => {}, on: () => {}, status: 0, stdout: "10.9.8\n", stderr: "" });
  return createProcess({ platform: "win32", exists: (p) => p in files, read: (p) => files[p], launch: fake, spawn: fake, now: () => 0 });
}

test("on Windows a command PATH names through an npm shim starts as the script the shim forwards to, with the Node beside it -- no shell, the same argv", () => {
  const shim = join("/nodejs", "npm.cmd");
  const script = join("/nodejs", "node_modules\\npm\\bin\\npm-cli.js");
  const beside = join("/nodejs", "node.exe");
  const calls = [];
  const port = windowsPort({ [shim]: NPM_CMD, [script]: "", [beside]: "" }, calls);
  port.launch("npm", ["run", "dev", "a;b"], { env: { PATH: "/nodejs" }, cwd: "/work/app" });
  assert.deepEqual([calls[0].file, calls[0].args, calls[0].opts.shell], [beside, [script, "run", "dev", "a;b"], false]);
  assert.equal(port.run("npm", ["--version"], { env: { PATH: "/nodejs" } }).out.trim(), "10.9.8");
  assert.deepEqual([calls[1].file, calls[1].args], [beside, [script, "--version"]]);
});

test("without a Node beside the shim the one on PATH runs it; a real executable, and every other platform, start exactly as named", () => {
  const shim = join("/nodejs", "npm.cmd");
  const script = join("/nodejs", "node_modules\\npm\\bin\\npm-cli.js");
  const calls = [];
  windowsPort({ [shim]: NPM_CMD, [script]: "" }, calls).launch("npm", ["ci"], { env: { PATH: "/nodejs" } });
  windowsPort({}, calls).launch("dotnet", ["run"], { env: { PATH: "/nodejs" } });
  const posix = createProcess({ platform: "linux", exists: () => true, read: () => NPM_CMD, launch: (file, args) => (calls.push({ file, args }), { pid: 1, unref: () => {}, on: () => {} }), now: () => 0 });
  posix.launch("npm", ["ci"], { env: { PATH: "/nodejs" } });
  assert.deepEqual(calls.map((c) => [c.file, c.args]), [["node", [script, "ci"]], ["dotnet", ["run"]], ["npm", ["ci"]]]);
});

test("alive: a pid that is there, one that is not, and one that is there but not ours (EPERM)", () => {
  const kill = (pid) => {
    if (pid === 2) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    if (pid === 3) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
  };
  const port = createProcess({ kill });
  assert.deepEqual([port.alive(1), port.alive(2), port.alive(3), port.alive(0), port.alive("x"), port.alive(-4)], [true, true, false, false, false, false]);
});

test("signal says what happened, and an absent process is an answer rather than a throw", () => {
  const port = createProcess({ kill: (pid, sig) => { if (pid === 9) throw Object.assign(new Error("gone"), { code: "ESRCH" }); } });
  assert.deepEqual(port.signal(2, "SIGTERM"), { ok: true });
  assert.deepEqual(port.signal(9, "SIGTERM"), { ok: false, error: "no such process" });
  assert.equal(port.signal("x", "SIGTERM").ok, false);
});

test("signal never reaches pid 1 or a broadcast: -1 would be every process this user may signal", () => {
  const sent = [];
  const port = createProcess({ platform: "linux", kill: (pid, sig) => sent.push([pid, sig]) });
  for (const pid of [1, 0, -1, -4321, 1.5, null, undefined, "2"]) {
    assert.deepEqual(port.signal(pid, "SIGKILL"), { ok: false, error: "no such process" }, String(pid));
    assert.deepEqual(port.signal(pid, "SIGKILL", { tree: true }), { ok: false, error: "no such process" }, `${pid} as a group`);
  }
  assert.deepEqual(sent, [], "not one signal was sent");
});

test("startedAtOf asks ps in the C locale on POSIX and PowerShell on Windows, and reads the answer as an instant", () => {
  const calls = [];
  const answer = (out) => (file, args, opts) => (calls.push({ file, args, opts }), { status: 0, stdout: out });
  const posix = createProcess({ platform: "linux", env: { PATH: "/bin" }, spawn: answer("Fri Oct  3 21:59:46 2026\n") });
  assert.equal(posix.startedAtOf(77), new Date("Fri Oct  3 21:59:46 2026").toISOString());
  assert.deepEqual(calls[0].args, ["-o", "lstart=", "-p", "77"]);
  assert.equal(calls[0].opts.env.LC_ALL, "C");
  const windows = createProcess({ platform: "win32", env: {}, spawn: answer("2026-10-03T14:59:46.0000000Z\n") });
  assert.equal(windows.startedAtOf(77), "2026-10-03T14:59:46.000Z");
  assert.equal(calls[1].file, "powershell");
});

test("startedAtOf is null -- cannot tell -- when the platform will not say, never a guess", () => {
  const failing = createProcess({ platform: "linux", spawn: () => ({ status: 1, stdout: "" }) });
  assert.equal(failing.startedAtOf(77), null);
  assert.equal(createProcess({ platform: "linux", spawn: () => ({ status: 0, stdout: "not a date" }) }).startedAtOf(77), null);
  assert.equal(failing.startedAtOf("x"), null);
});

function removedIfFree(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  catch (e) { if (e?.code !== "EBUSY" && e?.code !== "EPERM") throw e; }
}

test("a REAL launched child outlives the call, answers alive and a start time near launch, and is stoppable by its pid", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-launch-")));
  // Windows releases a killed process's files a moment after it is gone, and a process's working directory is locked
  // while it runs: the child starts in the temp root, the removal retries, and a folder Windows still holds is left to
  // the runner rather than failing a test about processes.
  t.after(() => removedIfFree(dir));
  const port = createProcess();
  const got = port.launch(NODE, ["-e", "setInterval(() => {}, 1000)"], { cwd: tmpdir(), env: baseEnv(process.env), out: join(dir, "out.log"), err: join(dir, "err.log") });
  t.after(() => port.signal(got.pid, "SIGKILL"));
  assert.equal(port.alive(got.pid), true);
  if (process.platform !== "win32") assert.deepEqual([statSync(join(dir, "out.log")).mode & 0o777, statSync(join(dir, "err.log")).mode & 0o777], [0o600, 0o600], "a log is its owner's to read");
  const started = port.startedAtOf(got.pid);
  if (started) assert.ok(Math.abs(Date.parse(started) - Date.parse(got.startedAt)) < 5000, `${started} vs ${got.startedAt}`);
  assert.equal(port.signal(got.pid, "SIGKILL").ok, true);
  for (let i = 0; i < 100 && port.alive(got.pid); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(port.alive(got.pid), false);
});

// Whether npm is on the PATH, asked of the file system and not of the port under test: on Windows it is
// `npm.cmd`, which Node will not start -- and the port must start the script it forwards to.
const npmOnPath = String(process.env.PATH ?? process.env.Path ?? "").split(delimiter).some((d) => existsSync(join(d, process.platform === "win32" ? "npm.cmd" : "npm")));

test("npm is asked for REAL through the Process port wherever it is installed -- on Windows as the script its shim forwards to, with no shell", { skip: npmOnPath ? false : "needs npm on the PATH" }, () => {
  const answer = createProcess().run("npm", ["--version"], { timeoutMs: 60000 });
  assert.equal(answer.ok, true, answer.error);
  assert.match(answer.out.trim(), /^\d+\.\d+\.\d+/);
});

test("signal with tree reaches the whole process GROUP -- a negative pid on POSIX, taskkill on Windows", () => {
  const sent = [];
  const posix = createProcess({ platform: "linux", kill: (pid, sig) => sent.push([pid, sig]) });
  assert.deepEqual(posix.signal(4321, "SIGTERM", { tree: true }), { ok: true });
  posix.signal(4321, "SIGTERM");
  assert.deepEqual(sent, [[-4321, "SIGTERM"], [4321, "SIGTERM"]]);
  const asked = [];
  const windows = createProcess({ platform: "win32", spawn: (file, args) => (asked.push([file, ...args]), { status: 0 }) });
  assert.deepEqual(windows.signal(4321, "SIGTERM", { tree: true }), { ok: true });
  assert.deepEqual(asked, [["taskkill", "/pid", "4321", "/T", "/F"]]);
  const gone = createProcess({ platform: "win32", spawn: () => ({ status: 128 }) });
  assert.deepEqual(gone.signal(4321, "SIGTERM", { tree: true }), { ok: false, error: "no such process" });
});

test("on Windows the ancestry is one CIM listing, quoted without a double quote, given a cold machine's time; CRLF lines are read", () => {
  const asked = [];
  const spawn = (file, args, opts) => {
    asked.push({ file, args, opts });
    return { status: 0, stdout: "4321 4000\r\n4000 1200\r\n1200 4\r\n4 0\r\n" };
  };
  const proc = createProcess({ spawn, platform: "win32", env: { SystemRoot: "C:\\Windows", SECRET: "x" } });
  assert.deepEqual(proc.ancestry(4321), [4321, 4000, 1200, 4]);
  assert.equal(asked[0].file, "powershell");
  assert.ok(!asked[0].args.at(-1).includes('"'), "a single-quoted command: nothing for a command line to re-escape");
  assert.match(asked[0].args.at(-1), /Win32_Process -Property ProcessId,ParentProcessId/);
  assert.ok(asked[0].opts.timeout >= 30000, "a cold PowerShell and CIM have time to answer");
  assert.deepEqual([asked[0].opts.env.SystemRoot, asked[0].opts.env.SECRET], ["C:\\Windows", undefined]);
  assert.deepEqual(createProcess({ spawn: () => ({ status: 1, stdout: "" }), platform: "win32" }).ancestry(4321), [], "no listing, no guess");
});

test("on Windows a CIM listing that does not answer -- or does not hold the pid -- is asked again through WMI, with PowerShell's own names", () => {
  const asked = [];
  const spawn = (file, args, opts) => {
    asked.push({ args, opts });
    return /Get-WmiObject/.test(args.at(-1)) ? { status: 0, stdout: "4321 4000\r\n4000 4\r\n" } : { status: 0, stdout: "" };
  };
  const proc = createProcess({ spawn, platform: "win32", env: { SystemRoot: "C:\\Windows", SystemDrive: "C:", PSModulePath: "C:\\m", SECRET: "x" } });
  assert.deepEqual(proc.ancestry(4321), [4321, 4000, 4]);
  assert.equal(asked.length, 2, "CIM first, then WMI");
  assert.deepEqual([asked[1].opts.env.SystemDrive, asked[1].opts.env.PSModulePath, asked[1].opts.env.SECRET], ["C:", "C:\\m", undefined]);
});
