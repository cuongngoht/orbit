// runObserved (1.8.5): run()'s answer, with the output handed to an observer AS IT ARRIVES. Real child processes,
// each its own fixture: a line is observed before the child exits (the observer releases it), the answer is run()'s to
// the byte for the same command, a deadline stops the child's whole group (a worker it started included), each stream
// keeps run()'s own cap, a child that cannot start says so in run()'s words, and an observer that throws changes
// nothing but `observerFailed`. No sleep decides a pass: the child waits on a file the test writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcess } from "../src/process/index.mjs";

const NODE = process.execPath;
const POSIX = process.platform !== "win32";

const dir = (t) => ((d) => (t.after(() => rmSync(d, { recursive: true, force: true })), d))(mkdtempSync(join(tmpdir(), "orbit-observed-")));

const script = (d, name, text) => ((f) => (writeFileSync(f, text), f))(join(d, name));

test("a line reaches the observer while the child is still running", async (t) => {
  const d = dir(t);
  const gate = join(d, "go");
  const child = script(d, "c.mjs", `import { existsSync } from "node:fs";\nprocess.stdout.write("ok 1 - first\\n");\nconst wait = () => (existsSync(${JSON.stringify(gate)}) ? process.stdout.write("ok 2 - second\\n") : setTimeout(wait, 20));\nwait();\n`);
  const seen = [];
  const answer = await createProcess().runObserved(NODE, [child], { timeoutMs: 20_000, observe: (stream, bytes) => {
    seen.push(`${stream}:${bytes.toString("utf8")}`);
    if (/first/.test(bytes.toString("utf8")) && !existsSync(gate)) writeFileSync(gate, "");
  } });
  assert.equal(answer.ok, true);
  assert.match(seen.join(""), /out:ok 1 - first[\s\S]*ok 2 - second/, "the first line was observed BEFORE the child could print its second -- it waited for the observer");
});

test("the answer is run()'s for the same command: output, status, error sentence", async (t) => {
  const d = dir(t);
  const child = script(d, "c.mjs", `process.stdout.write("out é ✓\\n".repeat(3));\nprocess.stderr.write("err line\\n");\nprocess.exit(3);\n`);
  const p = createProcess();
  const sync = p.run(NODE, [child], { timeoutMs: 20_000 });
  const observed = await p.runObserved(NODE, [child], { timeoutMs: 20_000, observe: () => {} });
  assert.deepEqual(observed, sync);
  assert.equal(observed.status, 3);
});

test("the end of the output is never lost: the last bytes before exit, with no newline, are in the answer and observed", async (t) => {
  const d = dir(t);
  const child = script(d, "c.mjs", `process.stdout.write("a".repeat(70000));\nprocess.stdout.write("THE-END");\n`);
  const got = [];
  const answer = await createProcess().runObserved(NODE, [child], { timeoutMs: 20_000, observe: (s, b) => got.push(b) });
  assert.ok(answer.out.endsWith("THE-END"));
  assert.ok(Buffer.concat(got).toString("utf8").endsWith("THE-END"));
  assert.equal(Buffer.concat(got).length, 70007);
});

test("a deadline stops the child's whole group -- a worker it started too -- and answers as run() does", { skip: POSIX ? false : "process groups are POSIX: NOT TESTED on Windows (taskkill /T is used there)" }, async (t) => {
  const d = dir(t);
  const pidFile = join(d, "worker.pid");
  const worker = script(d, "w.mjs", `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  const child = script(d, "c.mjs", `import { spawn } from "node:child_process";\nspawn(process.execPath, [${JSON.stringify(worker)}], { stdio: "inherit" });\nsetInterval(() => {}, 1000);\n`);
  const answer = await createProcess().runObserved(NODE, [child], { timeoutMs: 1500, observe: () => {} });
  assert.equal(answer.timedOut, true);
  assert.match(answer.error, /was killed after 1\.5s — it never answered/);
  const pid = Number(readFileSync(pidFile, "utf8"));
  // The answer comes when the child is gone; SIGKILL reached its worker at the same moment, but a loaded machine
  // delivers it and reaps the worker a moment later. Its own condition decides, never a sleep.
  assert.equal(await goneWithin(pid, 5000), true, "the worker the child started is gone too: nothing it left holds the pipes open");
});

function gone(pid) {
  try { process.kill(pid, 0); }
  catch (e) { return e.code === "ESRCH"; }
  return false;
}

async function goneWithin(pid, ms) {
  const end = Date.now() + ms;
  while (!gone(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return gone(pid);
}

test("each stream keeps run()'s own cap: past it the child is stopped and SAYS so", async (t) => {
  const d = dir(t);
  const child = script(d, "c.mjs", `const line = "x".repeat(1023) + "\\n";\nfunction write() { while (process.stdout.write(line)) {} process.stdout.once("drain", write); }
write();\n`);
  const answer = await createProcess().runObserved(NODE, [child], { timeoutMs: 20_000, maxBuffer: 64 * 1024, observe: () => {} });
  assert.equal(answer.overflow, true);
  assert.match(answer.error, /wrote more than 65536 bytes, so it was stopped/);
});

test("a command that cannot start is run()'s unstarted answer, and nothing is observed", async () => {
  const seen = [];
  const answer = await createProcess().runObserved("/nonexistent/orbit-no-such-binary", [], { timeoutMs: 5000, observe: (s, b) => seen.push(b) });
  assert.equal(answer.unstarted, true);
  assert.match(answer.error, /could not be started — ENOENT/);
  assert.deepEqual(seen, []);
});

test("an observer that throws is let go: the run goes on, the answer is whole, and it says observerFailed", async (t) => {
  const d = dir(t);
  const child = script(d, "c.mjs", `for (let i = 0; i < 50; i++) process.stdout.write("line " + i + "\\n");\n`);
  let calls = 0;
  const answer = await createProcess().runObserved(NODE, [child], { timeoutMs: 20_000, observe: () => {
    calls += 1;
    throw new Error("observer bug");
  } });
  assert.equal(answer.ok, true);
  assert.equal(answer.observerFailed, true);
  assert.equal(calls, 1, "called once, then never again");
  assert.match(answer.out, /line 49/);
});

test("argv only: a value with shell syntax is one argument, never a second command", async (t) => {
  const d = dir(t);
  const child = script(d, "c.mjs", `process.stdout.write(JSON.stringify(process.argv.slice(2)));\n`);
  const answer = await createProcess().runObserved(NODE, [child, "a; touch pwned", "$(id)"], { timeoutMs: 20_000, observe: () => {} });
  assert.deepEqual(JSON.parse(answer.out), ["a; touch pwned", "$(id)"]);
  assert.equal(existsSync(join(d, "pwned")), false);
  assert.match((await createProcess().runObserved(NODE, "not an array")).error, /arguments must be an array/);
});
