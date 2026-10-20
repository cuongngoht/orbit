// The task journal's door: what reaches the disk, in what shape, one writer at a time -- and
// what survives a process killed mid-line.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Blocked, Refused } from "../src/errors.mjs";
import { projectStoreRoot, repositoryPaths } from "../src/project/repository.mjs";
import { realIo } from "../src/store/io.mjs";
import { modelOf } from "../src/task/model.mjs";
import { createTasks, JOURNAL } from "../src/task/store.mjs";
import { KINDS, RECEIPT_DOMAINS, TASK_SCHEMA, isMaterial } from "../src/task/vocab.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { sealed } from "./home.mjs";

const BASE = mkdtempSync(join(tmpdir(), "orbit-task-store-"));
after(() => rmSync(BASE, { recursive: true, force: true }));

const ID = "tsk-0123456789ab";
const CHECKOUT = "c".repeat(64);
let room = 0;

// A fresh project store each time, on a clock that says when.
function tasksAt(now = () => "2026-10-06T21:03:00.000Z") {
  room += 1;
  return createTasks(join(BASE, `store-${room}`), realIo({ host: "laptop-a", now }));
}

const created = (extra = {}) => ({ id: ID, project: "repo-a", checkout: CHECKOUT, objective: "PBI-482 Refund validation", by: "session", schema: TASK_SCHEMA, ...extra });

const journalText = (tasks, id = ID) => readFileSync(join(tasks.dirOf(id), JOURNAL), "utf8");

test("a task begins once, and every line after it is appended in order with the store's own clock", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created());
  tasks.append(ID, "stage", { stage: "CONTEXT", because: "read what the project knows" });
  const lines = tasks.read(ID);
  assert.deepEqual(lines.map((l) => l.kind), ["created", "stage"]);
  assert.deepEqual(lines.map((l) => l.at), ["2026-10-06T21:03:00.000Z", "2026-10-06T21:03:00.000Z"]);
  assert.throws(() => tasks.begin(ID, created()), (e) => e instanceof Refused && /already exists/.test(e.message));
  assert.equal(tasks.read("tsk-ffffffffffff"), null, "a task nobody started is null, never an error");
});

test("a field nobody declared never reaches the disk, a caller cannot date a line, and `kind` cannot be overwritten", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created({ stdout: "build log", env: { SECRET: "x" }, prompt: "the whole prompt", at: "1999-01-01T00:00:00Z", kind: "completed" }));
  const [line] = tasks.read(ID);
  assert.equal(line.kind, "created");
  assert.equal(line.at, "2026-10-06T21:03:00.000Z");
  for (const k of ["stdout", "env", "prompt"]) assert.equal(k in line, false, k);
  assert.doesNotMatch(journalText(tasks), /build log|the whole prompt|SECRET/);
});

test("free text is scrubbed on the way in: a token pasted into an objective or a decision is masked on disk", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created({ objective: "fix login, header was Authorization: Bearer abc.def-ghi and API_TOKEN=s3cr3tvalue" }));
  tasks.append(ID, "decision", { id: "dec-1", observed: "the call sent token=hunter2hunter2 to the gateway", hypothesis: "h", nextAction: "inspect-gateway" });
  const text = journalText(tasks);
  assert.doesNotMatch(text, /abc\.def-ghi|s3cr3tvalue|hunter2hunter2/);
  assert.match(text, /\[redacted\]/);
});

test("a line torn by a killed process is dropped, and the next append ends it first so everything after it survives", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created());
  appendFileSync(join(tasks.dirOf(ID), JOURNAL), '{"at":"2026-10-06T21:04:00Z","stage":"WORKSP');
  assert.deepEqual(tasks.read(ID).map((l) => l.kind), ["created"], "the fragment is not a line");
  tasks.append(ID, "stage", { stage: "IMPLEMENTING" });
  assert.deepEqual(tasks.read(ID).map((l) => l.kind), ["created", "stage"]);
  assert.equal(tasks.read(ID)[1].stage, "IMPLEMENTING");
});

test("a kind the journal does not keep is refused, and so is an id that is not a task's", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created());
  assert.throws(() => tasks.append(ID, "status", { state: "DONE" }), (e) => e instanceof Refused && /keeps no "status" record/.test(e.message));
  assert.throws(() => tasks.read("../../etc"), Refused);
  assert.throws(() => tasks.append("w-0123456789ab", "stage", { stage: "CONTEXT" }), Refused);
});

test("a journal written by a newer engine is refused by the fold, never read with lines dropped", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created({ schema: TASK_SCHEMA + 1 }));
  assert.throws(() => modelOf(tasks.read(ID)), (e) => e instanceof Refused && /newer Orbit/.test(e.message));
});

test("one writer at a time: a task whose lock another session holds is BLOCKED, and nothing is written", () => {
  const io = fakeIo({ mkdirFails: 1000, backoff: [1, 1, 1] });
  const tasks = createTasks("/store/repo-a", io);
  let ran = false;
  assert.throws(() => tasks.transact(ID, () => { ran = true; }), (e) => e instanceof Blocked && /another session is writing this task/.test(e.message));
  assert.throws(() => tasks.creating(() => { ran = true; }), (e) => e instanceof Blocked && /starting a task in this project/.test(e.message));
  assert.equal(ran, false);
});

// What AGY's print-mode sandbox did to every task command in 1.7.7 and 1.7.8: the store refused the
// write, and the answer named a session that did not exist.
test("a lock the place REFUSES to make is BLOCKED as a refused write, at once -- never as another session holding it", () => {
  const io = fakeIo({ backoff: [1, 1, 1] });
  const denied = { ...io, mkdir: (p) => (p.endsWith(".lock") ? (() => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); })() : io.mkdir(p)) };
  const tasks = createTasks("/store/repo-a", denied);
  assert.throws(() => tasks.creating(() => {}), (e) => e instanceof Blocked && /cannot be written here \(EPERM\).*this is not another session/.test(e.message));
  assert.equal(io.state?.slept ?? 0, 0, "nothing waited for a writer that does not exist");
});

test("listing a project's tasks names only tasks: no lock, no stray file -- and a project with no tasks room lists nothing", () => {
  const tasks = tasksAt();
  assert.deepEqual(tasks.list(), []);
  tasks.begin(ID, created());
  tasks.creating(() => tasks.begin("tsk-aaaaaaaaaaaa", created({ id: "tsk-aaaaaaaaaaaa" })));
  assert.deepEqual(tasks.list(), ["tsk-0123456789ab", "tsk-aaaaaaaaaaaa"]);
});

test("a project's store root from its registry key is exactly the one its checkout resolves -- one definition, no git needed", () => {
  const repo = mkdtempSync(join(tmpdir(), "orbit-task-repo-"));
  after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  const store = join(BASE, "identity-store");
  const paths = repositoryPaths(repo, { ORBIT_STORE_DIR: store });
  assert.equal(projectStoreRoot(paths.storeBase, paths.storeKey), paths.storeRoot);
  assert.throws(() => projectStoreRoot(store, "../outside"), Refused, "a key cannot walk out of the store base");
});

test("a receipt keeps the environment and source tree it names, and an allow-list drops every other field: neither is material", () => {
  const tasks = tasksAt();
  tasks.begin(ID, created());
  assert.ok(RECEIPT_DOMAINS.includes("sandbox"));
  assert.ok(["environment", "sourceTree"].every((f) => KINDS.receipt.fields.includes(f)));
  assert.equal(isMaterial("receipt"), false, "evidence accruing never makes a person's decision stale");
  tasks.append(ID, "receipt", { domain: "sandbox", ref: "env-0123456789ab", outcome: "READY", environment: "env-0123456789ab", sourceTree: "c0de000000000000000000000000000000000001", path: "/home/dev/ws", port: 5173, url: "http://127.0.0.1:5173/" });
  const [, line] = tasks.read(ID);
  assert.deepEqual([line.environment, line.sourceTree, line.path, line.port, line.url], ["env-0123456789ab", "c0de000000000000000000000000000000000001", undefined, undefined, undefined]);
  const text = journalText(tasks);
  for (const leak of ["/home/dev", "5173", "127.0.0.1"]) assert.ok(!text.includes(leak), leak);
});
