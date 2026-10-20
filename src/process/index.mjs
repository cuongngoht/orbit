// The Process PORT: the one door to a child process, for everything that is
// not the browser driver.
//
// It exists because a capability has to be able to reach a `psql`, a vendor CLI,
// a project's own test helper -- and because the alternative is every generated
// QC tool importing node:child_process itself. That alternative fails three ways
// at once: nothing could fake it, nothing could time it out, and the rule that
// only the adapters spawn anything would be true of src/ and false of everything
// a project generated into its store.
//
// So this is the one door, and it is deliberately narrow. No shell: `args` is an
// array and reaches the child as argv, so a value that happens to contain `;` or
// `$(…)` is an argument and never a second command. That is not a hardening pass,
// it is the only reason it is safe to hand this to generated code at all.
//
//   run(file, args, opts)     run to completion and answer { ok, out, … }. A
//                             command that could not start, exited non-zero or
//                             had to be killed is a FAILED PRECONDITION and says
//                             so in the same words the database port does --
//                             `ok: false` with a sentence. It never throws:
//                             whether that becomes Blocked or something else is
//                             the caller's judgement
//   runAsync(file, args, opts) the same, as a PROMISE, for a caller that must not
//                             stop the world while a child works -- a local HTTP
//                             server answering other requests (Orbit Control)
//   runObserved(file, args, opts)
//                             run()'s answer, as a promise, while `opts.observe(stream,
//                             bytes)` is handed every chunk AS IT ARRIVES -- what a
//                             check's live progress is read from (1.8.5). The answer is
//                             run()'s to the byte: the same per-stream cap (`maxBuffer`
//                             is spawnSync's, each stream on its own), the same words for
//                             a timeout, an overflow and a child that could not start.
//                             The observer is a guest: one that throws is let go and the
//                             output is still drained and answered (`observerFailed`).
//                             On POSIX the child leads a process GROUP of its own, so a
//                             deadline or an overflow stops what IT started (a runner's
//                             workers too) and nothing else; while it runs, a signal that
//                             ends this process ends that group first. It settles ONCE,
//                             after the child's streams closed: no byte of the end is lost
//   start(file, args, opts)   a LONG-LIVED child with piped stdin/stdout -- a
//                             stdio MCP server (src/mcp/runtime/stdio.mjs). Same
//                             rule: argv only, `shell: false` said out loud, the
//                             environment it gets is exactly `opts.env`. Its
//                             caller owns the deadline and must kill it
//   launch(file, args, opts)  a child that OUTLIVES its caller -- a development
//                             server a person asked Orbit to start. Detached, its
//                             output going to the two files `opts.out` and
//                             `opts.err` name, never held: the caller gets back
//                             { pid, startedAt } and nothing it has to keep open.
//                             `opts.input` is written to its stdin, which is then
//                             closed: the one way a value reaches a launched child
//                             without riding a command line anybody can list
//                             The opposite of start(): what it keeps is a
//                             RECEIPT, and who may stop it later is decided from
//                             that receipt (src/runtime/ownership.mjs), never from
//                             a handle this process could lose when it exits
//   alive(pid) · signal(pid, sig) · startedAtOf(pid) · ancestry(pid) -> [pid, its parent, …]
//                             the three questions a receipt is checked with. A pid
//                             alone proves nothing -- the OS reuses them -- so what
//                             a pid STARTED at is asked too, and a platform that
//                             cannot say answers null, which a caller reads as
//                             "cannot tell", never as a match
//
// On Windows, a command that a PATH names through an npm shim (`<bin>.cmd`, which Node will
// not spawn) is started as the script the shim forwards to, with the Node beside it
// (src/process/shim.mjs): still no shell, still exactly this argv. Anywhere else, and for
// anything that is not such a shim, the command is exactly what was asked for.
//
// `opts` for run and runAsync: `input` (stdin), `timeoutMs`, and -- only when the
// caller names them -- `env` (then EXACTLY that environment and nothing
// inherited: src/process/env.mjs says what a child needs to start), `cwd`, and
// `maxBuffer` (bytes of stdout + stderr; a child that writes more is stopped
// and SAYS so, never read as one that hung).
import { spawn as spawnAsync, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { baseEnv, childEnv } from "./env.mjs";
import { launchable } from "./shim.mjs";

export const DEFAULT_PROCESS_TIMEOUT_MS = 60000;

// What runAsync() keeps in memory at most, when a caller names no limit.
export const DEFAULT_OUTPUT_LIMIT = 16 * 1024 * 1024;

export function createProcess(deps = {}) {
  const { spawn = spawnSync, launch = spawnAsync, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS } = deps;
  const via = callerOf(deps);
  return { run: (file, args = [], opts = {}) => run(spawn, via, file, args, { timeoutMs, ...opts }), runAsync: (file, args = [], opts = {}) => runAsync(launch, via, file, args, { timeoutMs, ...opts }), runObserved: (file, args = [], opts = {}) => runObserved(observedOs(deps, via), file, args, { timeoutMs, ...opts }), start: (file, args = [], opts = {}) => started(launch, via, file, args, opts), ...outliving(deps, via) };
}

// What a launched child needs the OS for: a file to write to, a signal to send,
// a clock to ask. Each is injectable so nothing in the suite starts a process.
function outliving(deps, via) {
  const os = { via, launch: deps.launch ?? spawnAsync, spawn: deps.spawn ?? spawnSync, open: deps.open ?? openSync, close: deps.close ?? closeSync, kill: deps.kill ?? process.kill.bind(process), now: deps.now ?? Date.now, platform: deps.platform ?? process.platform, env: deps.env ?? process.env };
  return { launch: (file, args = [], opts = {}) => launched(os, file, args, opts), alive: (pid) => living(os, pid), signal: (pid, sig, opts = {}) => signalled(os, pid, sig, opts), startedAtOf: (pid) => startedAt(os, pid), ancestry: (pid) => ancestryOf(os, pid) };
}

// How this platform starts `file`: on Windows through the shim's own script, anywhere else as named.
function callerOf(deps) {
  const platform = deps.platform ?? process.platform;
  return (file, env) => (platform === "win32" ? launchable(file, env ?? process.env, deps) : { file, prefix: [] });
}

function run(spawn, via, file, args, opts) {
  const wrong = argvProblem(file, args);
  if (wrong) return wrong;
  const call = via(file, opts.env);
  const r = spawn(call.file, [...call.prefix, ...args.map(String)], { encoding: "utf8", timeout: opts.timeoutMs, killSignal: "SIGKILL", input: opts.input, windowsHide: true, ...placed(opts) });
  return answered(r, file, opts);
}

function argvProblem(file, args) {
  if (!file || typeof file !== "string") return { ok: false, out: "", error: "no command was named" };
  if (!Array.isArray(args)) return { ok: false, out: "", error: "arguments must be an array — this port never uses a shell, so one string is one argument" };
  return null;
}

// Only what the caller named. A caller that names no `env` keeps today's
// behaviour; one that does gets exactly that environment.
const placed = (opts) => Object.fromEntries([["env", opts.env], ["cwd", opts.cwd], ["maxBuffer", opts.maxBuffer]].filter(([, v]) => v !== undefined));

// ENOBUFS first: Node stops an over-talkative child with the kill signal, and
// reading that as "never answered" would send somebody to look for a hang.
// `timedOut` and `unstarted` say the same as the sentence, as facts a caller can
// branch on without reading the words.
function answered(r, file, opts) {
  if (r?.error?.code === "ENOBUFS") return overflowed(file, opts.maxBuffer);
  if (killed(r)) return { ok: false, out: "", error: `${file} was killed after ${opts.timeoutMs / 1000}s — it never answered`, timedOut: true };
  if (r?.error) return { ok: false, out: "", error: `${file} could not be started — ${r.error.code ?? r.error.message}`, unstarted: true };
  return exited(r, file);
}

const overflowed = (file, limit) => ({ ok: false, out: "", error: `${file} wrote more than ${limit} bytes, so it was stopped`, overflow: true });

function exited(r, file) {
  const out = String(r.stdout ?? "");
  const err = String(r.stderr ?? "");
  if (r.status !== 0) return { ok: false, out, err, error: (err + out).trim().split("\n")[0] || `${file} exited ${r.status}`, status: r.status };
  return { ok: true, out, err, status: 0 };
}

const killed = (r) => r?.signal === "SIGKILL" || r?.error?.code === "ETIMEDOUT";

// runAsync(): the same answers as run(), without blocking. stdout and stderr are
// kept up to the limit together, and a child that goes past it or past its
// deadline is killed -- then answered in run()'s own words.
function runAsync(launch, via, file, args, opts) {
  const wrong = argvProblem(file, args);
  if (wrong) return Promise.resolve(wrong);
  const limits = { ...opts, maxBuffer: opts.maxBuffer ?? DEFAULT_OUTPUT_LIMIT };
  const call = via(file, opts.env);
  return new Promise((resolve) => collect(launch(call.file, [...call.prefix, ...args.map(String)], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...placed(opts) }), file, limits, resolve));
}

function collect(child, file, opts, resolve) {
  const got = { chunks: { out: [], err: [] }, size: 0, child, file, opts, resolve, done: false };
  listen(got);
  got.timer = setTimeout(() => stop(got, "timeout"), opts.timeoutMs);
  feed(child, opts.input);
}

function listen(got) {
  got.child.stdout?.on("data", (bytes) => gathered(got, "out", bytes));
  got.child.stderr?.on("data", (bytes) => gathered(got, "err", bytes));
  got.child.on("error", (e) => finished(got, { ok: false, out: "", error: `${got.file} could not be started — ${e.code ?? e.message}`, unstarted: true }));
  got.child.on("close", (status) => finished(got, closed(got, status)));
}

function gathered(got, stream, bytes) {
  got.size += bytes.length;
  if (got.size > got.opts.maxBuffer) return stop(got, "overflow");
  got.chunks[stream].push(bytes);
}

function stop(got, why) {
  got.reason ??= why;
  got.child.kill("SIGKILL");
}

function closed(got, status) {
  if (got.reason === "overflow") return overflowed(got.file, got.opts.maxBuffer);
  if (got.reason === "timeout") return { ok: false, out: "", error: `${got.file} was killed after ${got.opts.timeoutMs / 1000}s — it never answered`, timedOut: true };
  return exited({ status, stdout: text(got.chunks.out), stderr: text(got.chunks.err) }, got.file);
}

const text = (chunks) => Buffer.concat(chunks).toString("utf8");

function finished(got, result) {
  if (got.done) return;
  got.done = true;
  clearTimeout(got.timer);
  got.resolve(result);
}

// ---- runObserved(): run()'s answer, the output handed out as it arrives --------------------------------------

// What an observed run needs of the OS, each injectable so a test can watch it happen: a way to start a child, to
// signal a process group, to kill a tree on Windows, the platform, and the process whose own signals end the
// child's group first.
function observedOs(deps, via) {
  return { via, launch: deps.launch ?? spawnAsync, spawn: deps.spawn ?? spawnSync, kill: deps.kill ?? process.kill.bind(process), platform: deps.platform ?? process.platform, host: deps.host ?? process };
}

const ENDING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

function runObserved(os, file, args, opts) {
  const wrong = argvProblem(file, args);
  if (wrong) return Promise.resolve(wrong);
  const w = { file, opts: { ...opts, maxBuffer: opts.maxBuffer ?? DEFAULT_OUTPUT_LIMIT }, group: os.platform !== "win32", call: os.via(file, opts.env) };
  return new Promise((resolve) => begunObserved(os, args, { ...w, resolve }));
}

// A child that cannot even be spawned (a bad working directory) throws here on some platforms and emits `error` on
// others; both are the same answer.
function begunObserved(os, args, w) {
  try { watched(os, os.launch(w.call.file, [...w.call.prefix, ...args.map(String)], { shell: false, windowsHide: true, detached: w.group, stdio: ["pipe", "pipe", "pipe"], ...placed(w.opts) }), w); }
  catch (e) { w.resolve({ ok: false, out: "", error: `${w.file} could not be started — ${e.code ?? e.message}`, unstarted: true }); }
}

function watched(os, child, w) {
  const got = { child, os, file: w.file, opts: w.opts, resolve: w.resolve, group: w.group, size: { out: 0, err: 0 }, chunks: { out: [], err: [] }, done: false, observe: w.opts.observe ?? null, observerFailed: false };
  listenedObserved(got);
  got.timer = setTimeout(() => halted(got, "timeout"), w.opts.timeoutMs);
  got.unguard = signalsGuarded(got);
  feed(child, w.opts.input);
}

// `error` after a child started is not "could not be started": the end is then `close`'s to say.
function listenedObserved(got) {
  got.child.stdout?.on("data", (bytes) => arrived(got, "out", bytes));
  got.child.stderr?.on("data", (bytes) => arrived(got, "err", bytes));
  got.child.on("error", (e) => (got.child.pid === undefined ? settledObserved(got, { ok: false, out: "", error: `${got.file} could not be started — ${e.code ?? e.message}`, unstarted: true }) : null));
  got.child.on("close", (status) => settledObserved(got, closed(got, status)));
}

// Each stream on its own cap, as spawnSync's maxBuffer is. Past it the child is stopped and nothing more is kept or
// observed; after a deadline the end of what it printed still reaches the observer (which test was running).
function arrived(got, stream, bytes) {
  if (got.reason === "overflow") return;
  got.size[stream] += bytes.length;
  if (got.size[stream] > got.opts.maxBuffer) return halted(got, "overflow");
  got.chunks[stream].push(bytes);
  observedChunk(got, stream, bytes);
}

// The observer is a guest: one that throws is let go, and the run goes on exactly as it would have without it.
function observedChunk(got, stream, bytes) {
  if (!got.observe || got.observerFailed) return;
  try { got.observe(stream, bytes); }
  catch { got.observerFailed = true; }
}

function halted(got, why) {
  got.reason ??= why;
  treeStopped(got);
}

// What THIS run started and nothing else: on POSIX the group the child leads (a runner's workers with it), on Windows
// its tree; a pid this port never started is never signalled, and one already gone is no error.
function treeStopped(got) {
  const pid = got.child.pid;
  if (!Number.isInteger(pid) || pid <= 1) return quietly(() => got.child.kill("SIGKILL"));
  if (got.group) return quietly(() => got.os.kill(-pid, "SIGKILL"));
  if (got.os.platform === "win32") return quietly(() => got.os.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { timeout: 10000, windowsHide: true }));
  quietly(() => got.child.kill("SIGKILL"));
}

function settledObserved(got, result) {
  if (got.done) return;
  got.done = true;
  clearTimeout(got.timer);
  got.unguard();
  got.resolve(got.observerFailed ? { ...result, observerFailed: true } : result);
}

// While the child runs, a signal that ends THIS process ends the child's group first: a group of its own does not
// hear the terminal's Ctrl+C. When no other listener is there to decide, the signal is raised again so this process
// ends exactly as it would have.
function signalsGuarded(got) {
  const host = got.os.host;
  if (!got.group || typeof host?.on !== "function") return () => {};
  const handlers = ENDING_SIGNALS.map((sig) => [sig, () => stoppedOnSignal(got, host, sig, handlers)]);
  handlers.forEach(([sig, fn]) => host.on(sig, fn));
  return () => handlers.forEach(([sig, fn]) => host.off(sig, fn));
}

function stoppedOnSignal(got, host, sig, handlers) {
  treeStopped(got);
  handlers.forEach(([s, fn]) => host.off(s, fn));
  if (host.listenerCount(sig) === 0) host.kill(host.pid, sig);
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

// A child that exits before reading its stdin makes the pipe fail; that is the
// child's answer, reported by `close`, and never a crash of this port.
function feed(child, input) {
  if (!child.stdin) return;
  child.stdin.on("error", () => {});
  child.stdin.end(input ?? "");
}

// A programming error, not a runtime one: a caller that hands a string of
// arguments has misunderstood what this port is for, so it is told at once.
function started(launch, via, file, args, opts) {
  if (!file || typeof file !== "string" || !Array.isArray(args)) throw new TypeError("start(file, args[]) takes a command and an argv array — never a shell string");
  const call = via(file, opts.env ?? {});
  return launch(call.file, [...call.prefix, ...args.map(String)], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: opts.env ?? {}, cwd: opts.cwd });
}

// What a dev server prints can carry anything -- a token in a URL, a stack trace with a path -- so its
// log is its owner's to read and nobody else's (on a platform that has modes).
const LOG_MODE = 0o600;

// Detached, unref'd, its stdin closed and its output in files: nothing about it
// is held by this process, which is what lets a person close the terminal the
// command was typed in and find the server still there. The files are opened
// here and closed here -- the child has its own copies by then.
function launched(os, file, args, opts) {
  if (!file || typeof file !== "string" || !Array.isArray(args)) throw new TypeError("launch(file, args[]) takes a command and an argv array — never a shell string");
  const fds = [opts.out, opts.err].map((path) => (path ? os.open(path, "a", LOG_MODE) : "ignore"));
  try {
    return detached(os, file, args, opts, fds);
  } finally {
    fds.filter((fd) => typeof fd === "number").forEach((fd) => os.close(fd));
  }
}

function detached(os, file, args, opts, fds) {
  const call = os.via(file, opts.env ?? {});
  const child = released(os.launch(call.file, [...call.prefix, ...args.map(String)], { shell: false, detached: true, windowsHide: true, stdio: [opts.input === undefined ? "ignore" : "pipe", fds[0], fds[1]], env: opts.env ?? {}, cwd: opts.cwd }), opts.input);
  return { pid: child.pid ?? null, startedAt: new Date(os.now()).toISOString() };
}

// Let go of a child that outlives this process. What it is handed is written and its stdin closed
// (a child that exits before reading it is no error of ours), and nothing keeps this process alive
// for it once that is done.
function released(child, input) {
  child.stdin?.on?.("error", () => {});
  child.stdin?.end?.(String(input));
  child.unref?.();
  child.on?.("error", () => {});
  return child;
}

// Signal 0 asks "is there such a process" without disturbing it. EPERM means
// there is one and it is not ours -- still alive, and still not ours to stop.
function living(os, pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    os.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

// `opts.tree` signals the whole process GROUP the child leads -- a launched child
// leads its own, so this reaches `npm`'s `node` and not only `npm`. On POSIX that
// is a negative pid; on Windows the OS has its own way, and it is asked for. A
// caller must have proved the pid is the one it launched BEFORE asking: a pid the
// OS has handed to somebody else is somebody else's group.
//
// Pid 1 is never asked, with or without `tree`: it is init, and its negation, -1, is "every process
// this user may signal". No child Orbit launched has that number, so a receipt that says it does is a
// corrupt receipt, and the last place to refuse it is here.
function signalled(os, pid, sig, opts) {
  if (!Number.isInteger(pid) || pid <= 1) return { ok: false, error: "no such process" };
  if (opts.tree && os.platform === "win32") return treeKilled(os, pid);
  try {
    os.kill(opts.tree ? -pid : pid, sig);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.code === "ESRCH" ? "no such process" : String(e?.message ?? e) };
  }
}

function treeKilled(os, pid) {
  const r = os.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { encoding: "utf8", timeout: 10000, windowsHide: true });
  return r?.status === 0 ? { ok: true } : { ok: false, error: "no such process" };
}

// When this pid STARTED, to the second, or null when the platform will not say.
// The comparison a receipt is held to: the same pid at a different start time is
// a different process that inherited the number.
const START_PROBES = {
  win32: (pid) => ["powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`]],
  posix: (pid) => ["ps", ["-o", "lstart=", "-p", String(Number(pid))]],
};

function startedAt(os, pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const [file, args] = START_PROBES[os.platform === "win32" ? "win32" : "posix"](pid);
  const r = os.spawn(file, args, { encoding: "utf8", timeout: 5000, windowsHide: true, env: { ...baseEnv(os.env), LC_ALL: "C", LANG: "C" } });
  return r?.status === 0 ? isoOf(String(r.stdout ?? "").trim()) : null;
}

// The chain from `pid` up through its parents (itself first, at most 32), read from ONE listing of every process --
// `ps` on POSIX, PowerShell's CIM on Windows -- so a viewer can be split beside the terminal a process runs in. Empty
// when the listing cannot be read: never a guess.
// 0.0.2: on Windows the listing asks only the two properties it reads and quotes with single quotes alone (no `"` for
// a command line to re-escape), and it is given the time a cold PowerShell and CIM take on a fresh machine -- five
// seconds was a listing that never answered there, and an empty chain.
// Windows is asked through CIM first and, where CIM does not answer, through WMI -- the same class, an older door --
// with the few names PowerShell itself needs to find its modules and the machine's drive (never a secret).
const LISTING = "| ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.ParentProcessId }";

const powershell = (command) => ["powershell", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], 30000];

const TREE_PROBES = {
  win32: () => [powershell(`Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId ${LISTING}`), powershell(`Get-WmiObject -Class Win32_Process ${LISTING}`)],
  posix: () => [["ps", ["-axo", "pid=,ppid="], 5000]],
};

const POWERSHELL_ENV = ["SystemDrive", "PSModulePath", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"];

const treeEnv = (os) => ({ ...childEnv(os.env, os.platform === "win32" ? POWERSHELL_ENV : []), LC_ALL: "C", LANG: "C" });

const listed = (os, [file, args, timeout]) => ((r) => (r?.status === 0 ? parentsOf(String(r.stdout ?? "")) : null))(os.spawn(file, args, { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: treeEnv(os) }));

// The first listing that answers with this pid in it; none, and the chain is empty.
const firstListing = (os, pid) => TREE_PROBES[os.platform === "win32" ? "win32" : "posix"]().reduce((got, probe) => got ?? ((m) => (m?.has(pid) ? m : null))(listed(os, probe)), null);

function ancestryOf(os, pid) {
  if (!Number.isInteger(pid) || pid < 1) return [];
  const parents = firstListing(os, pid);
  return parents ? chainOf(parents, pid) : [];
}

const parentsOf = (text) => new Map(text.split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number)).filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b)));

function chainOf(parents, pid) {
  const chain = [];
  for (let at = pid; Number.isInteger(at) && at > 0 && !chain.includes(at) && chain.length < 32; at = parents.get(at)) chain.push(at);
  return chain;
}

function isoOf(text) {
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}
