// A session is a receipt written BEFORE a launch, and ownership is proven from the
// receipt, the pid and the pid's start time -- a pid alone proves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { EXTERNAL, OWNED, OWNERSHIP, UNKNOWN, judge, mayStop } from "../src/runtime/ownership.mjs";
import { KEEP_FINISHED, commandFingerprint, createSessions, sessionId } from "../src/runtime/sessions.mjs";
import { fakeIo } from "./fakes/io.mjs";

const LIVE = "/store/repo/runtime/laptop/checkouts/c";
const T0 = "2026-10-03T10:00:00.000Z";

const receipt = (over = {}) => ({ id: "rs-aaaaaaaaaaaa", env: "env-x", component: "node:web", state: "RUNNING", pid: 4321, requestedAt: T0, startedAt: T0, pidStartedAt: T0, ...over });

test("a receipt is judged by an ordered table, the last row always answering, a sentence per row", () => {
  assert.deepEqual(OWNERSHIP.map((r) => r.name), ["NO_RECEIPT", "UNSETTLED", "FINISHED", "GONE", "CANNOT_TELL_WHEN", "PID_REUSED", "PROVEN"]);
  assert.equal(OWNERSHIP.at(-1).when(), true);
  for (const row of OWNERSHIP) assert.equal(typeof row.answer(receipt(), { alive: true, startedAt: "2026-10-03T11:00:00.000Z" }).why, "string", row.name);
});

test("a receipt, a pid and a start time that agree make the process Orbit's -- and only then may it be stopped", () => {
  const j = judge(receipt(), { alive: true, startedAt: "2026-10-03T10:00:01.000Z" });
  assert.deepEqual([j.ownership, j.state, j.rule, mayStop(j)], [OWNED, "RUNNING", "PROVEN", true]);
});

test("the SAME pid at a different start time is another process: observed, never stopped", () => {
  const j = judge(receipt(), { alive: true, startedAt: "2026-10-03T12:30:00.000Z" });
  assert.deepEqual([j.ownership, j.state, j.rule, mayStop(j)], [UNKNOWN, "LOST", "PID_REUSED", false]);
  assert.match(j.why, /started at 2026-10-03T12:30:00.000Z, not the one Orbit launched/);
});

test("when the OS will not say when a process started, ownership cannot be proven and nothing is stopped", () => {
  assert.equal(mayStop(judge(receipt(), { alive: true, startedAt: null })), false);
  assert.equal(judge(receipt({ pidStartedAt: null }), { alive: true, startedAt: T0 }).rule, "CANNOT_TELL_WHEN");
});

test("something Orbit has no receipt for is EXTERNAL, whatever is running there", () => {
  const j = judge(null, { alive: true, startedAt: T0 });
  assert.deepEqual([j.ownership, mayStop(j)], [EXTERNAL, false]);
});

test("a start that never settled is AMBIGUOUS, and so is one marked so: read back, never resent, never stopped", () => {
  for (const s of [receipt({ state: "STARTING", pid: null }), receipt({ state: "AMBIGUOUS" })]) {
    const j = judge(s, { alive: true, startedAt: T0 });
    assert.deepEqual([j.ownership, j.state, mayStop(j)], [UNKNOWN, "AMBIGUOUS", false]);
  }
});

test("a process that is gone is gone, and one already stopped stays stopped", () => {
  assert.deepEqual([judge(receipt(), { alive: false }).state, judge(receipt({ state: "STOPPED" }), { alive: true, startedAt: T0 }).state], ["STOPPED", "STOPPED"]);
  assert.equal(mayStop(judge(receipt(), { alive: false })), false);
});

test("a session id is the same for the same request and different for another component or moment", () => {
  const base = { env: "env-x", component: "node:web", requestedAt: T0 };
  assert.equal(sessionId(base), sessionId({ ...base }));
  assert.match(sessionId(base), /^rs-[a-f0-9]{12}$/);
  assert.notEqual(sessionId(base), sessionId({ ...base, component: "dotnet:api" }));
  assert.notEqual(sessionId(base), sessionId({ ...base, requestedAt: "2026-10-03T10:00:00.001Z" }));
  assert.equal(commandFingerprint(["npm", "run", "dev"], "web"), commandFingerprint(["npm", "run", "dev"], "web"));
  assert.notEqual(commandFingerprint(["npm", "run", "dev"], "web"), commandFingerprint(["npm", "run", "dev", "x"], "web"));
});

test("sessions are written, read back and listed oldest first; a missing or foreign one is nothing", () => {
  const io = fakeIo();
  const sessions = createSessions(LIVE, io);
  sessions.write(receipt({ id: "rs-bbbbbbbbbbbb", requestedAt: "2026-10-03T11:00:00.000Z" }));
  sessions.write(receipt());
  assert.deepEqual(sessions.list().map((s) => s.id), ["rs-aaaaaaaaaaaa", "rs-bbbbbbbbbbbb"]);
  assert.equal(sessions.read("rs-aaaaaaaaaaaa").pid, 4321);
  assert.equal(sessions.read("rs-cccccccccccc"), null);
  assert.equal(sessions.read("../../etc/passwd"), null, "an id that is not an id is never a path");
  io.write(join(LIVE, "sessions", "rs-dddddddddddd.json"), JSON.stringify({ schema: 99, id: "rs-dddddddddddd" }));
  assert.throws(() => sessions.read("rs-dddddddddddd"), /newer Orbit/);
});

test("finished sessions beyond the newest few are pruned with their logs; running ones never are", () => {
  const io = fakeIo();
  const sessions = createSessions(LIVE, io);
  const ids = Array.from({ length: KEEP_FINISHED + 2 }, (_, i) => `rs-${String(i).repeat(12)}`);
  ids.forEach((id, i) => {
    sessions.write(receipt({ id, state: "STOPPED", requestedAt: `2026-10-03T10:0${i}:00.000Z` }));
    io.write(sessions.logs(id).out, "log");
  });
  sessions.write(receipt({ id: "rs-ffffffffffff", requestedAt: "2026-10-03T09:00:00.000Z" }));
  const dropped = sessions.prune("node:web");
  assert.deepEqual(dropped, ids.slice(0, 2));
  assert.equal(io.exists(sessions.logs(ids[0]).out), false);
  assert.equal(io.exists(sessions.logs(ids.at(-1)).out), true);
  assert.equal(sessions.read("rs-ffffffffffff").state, "RUNNING");
});

test("a damaged receipt is not read as a session -- and what is optional in a good one is made safe -- so one bad file takes nothing else down", () => {
  const io = fakeIo();
  const sessions = createSessions(LIVE, io);
  sessions.write(receipt({ id: "rs-bbbbbbbbbbbb", provider: "native", ports: "8080" }));
  sessions.write(receipt({ id: "rs-cccccccccccc", provider: "native", ports: [3000, "x", 4000.5] }));
  // Built as the engine builds them (join): on Windows that is `\`, and the fake keeps a file by the path it was given.
  const at = (id) => join(LIVE, "sessions", `${id}.json`);
  io.write(at("rs-dddddddddddd"), JSON.stringify({ schema: 1, id: "rs-dddddddddddd", component: "node:web", provider: "native", state: "TELEPORTING", requestedAt: T0, pid: 1 }));
  io.write(at("rs-eeeeeeeeeeee"), JSON.stringify({ schema: 1, id: "rs-eeeeeeeeeeee", component: "node:web", provider: "native", state: "RUNNING", pid: 1 }));
  io.write(at("rs-ffffffffffff"), "{ torn");
  assert.throws(() => sessions.list(), /corrupt Orbit state/);
  assert.equal(io.read(at("rs-ffffffffffff")), "{ torn");
  io.removeFile(at("rs-ffffffffffff"));
  const listed = sessions.list();
  assert.deepEqual(listed.map((s) => s.id).sort(), ["rs-bbbbbbbbbbbb", "rs-cccccccccccc"], "only the ones that are sessions");
  assert.deepEqual(listed.map((s) => s.ports), [[], [3000]], "ports are always a list of ports");
  assert.equal(sessions.read("rs-dddddddddddd"), null);
});
