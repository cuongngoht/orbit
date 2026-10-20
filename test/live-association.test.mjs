// Which task a viewer shows when nobody named one: an ordered table over this checkout's candidates, where
// another session's or another checkout's task is never shown as this one's, and two candidates are AMBIGUOUS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSOCIATION, associate } from "../src/live/association.mjs";
import { hostSession, taskSessionMark } from "../src/memory/session.mjs";

const HERE = "c".repeat(64);
const THERE = "d".repeat(64);
const NOW = Date.parse("2026-10-08T10:00:00.000Z");
const MINE = taskSessionMark(hostSession("claude", "session-a"));
const OTHER = taskSessionMark(hostSession("claude", "session-b"));

const row = (id, over = {}) => ({ id, checkout: HERE, session: null, terminal: false, createdAt: "2026-10-08T09:00:00.000Z", endedAt: null, ...over });
const ask = (rows, over = {}) => associate({ explicit: null, pins: { session: null, checkout: null }, mark: MINE, checkout: HERE, rows, now: NOW, finishedForMs: 600_000, ...over });
const T = (n) => `tsk-${String(n).repeat(12)}`;

test("a session's own task wins over another session's newer one in the same checkout", () => {
  const got = ask([row(T(1), { session: MINE, createdAt: "2026-10-08T08:00:00.000Z" }), row(T(2), { session: OTHER, createdAt: "2026-10-08T09:30:00.000Z" })]);
  assert.deepEqual([got.how, got.task], ["session", T(1)]);
});

test("another checkout's task is never a candidate, however recent", () => {
  const got = ask([row(T(1), { checkout: THERE, session: MINE })]);
  assert.deepEqual([got.how, got.task], ["none", null]);
});

test("one task running in the checkout is shown as the checkout's; two are AMBIGUOUS, never a guess", () => {
  assert.deepEqual(((g) => [g.how, g.task])(ask([row(T(1), { session: OTHER })])), ["checkout", T(1)]);
  const two = ask([row(T(1), { session: OTHER }), row(T(2), { session: OTHER, createdAt: "2026-10-08T09:59:00.000Z" })]);
  assert.deepEqual([two.how, two.task, two.ids], ["ambiguous", null, [T(1), T(2)]]);
});

test("a pin chooses among the ambiguous: the session's pin before the checkout's", () => {
  const rows = [row(T(1)), row(T(2))];
  assert.equal(ask(rows, { pins: { session: null, checkout: T(2) } }).task, T(2));
  assert.deepEqual(((g) => [g.how, g.task])(ask(rows, { pins: { session: T(1), checkout: T(2) } })), ["pin", T(1)]);
});

test("a pin to another checkout's task, or to a task long finished, is not shown", () => {
  assert.equal(ask([row(T(1), { checkout: THERE })], { pins: { session: T(1), checkout: null } }).how, "none");
  const old = row(T(1), { terminal: true, endedAt: "2026-10-08T08:00:00.000Z" });
  assert.equal(ask([old], { pins: { session: T(1), checkout: null } }).how, "none");
});

test("a task that ended a moment ago is still shown as finished; one that ended long ago is not", () => {
  const just = row(T(1), { terminal: true, session: MINE, endedAt: "2026-10-08T09:58:00.000Z" });
  assert.deepEqual(((g) => [g.how, g.task])(ask([just])), ["finished", T(1)]);
  assert.equal(ask([{ ...just, endedAt: "2026-10-08T09:00:00.000Z" }]).how, "none");
});

test("a task another host created (no session mark) reaches this viewer only through the checkout or a pin", () => {
  const codex = row(T(3), { session: taskSessionMark(hostSession("codex", "x")) });
  assert.deepEqual(((g) => [g.how, g.task])(ask([codex])), ["checkout", T(3)]);
  assert.deepEqual(((g) => [g.how, g.task])(ask([codex], { mark: null })), ["checkout", T(3)]);
});

test("a named task is shown whatever the candidates say; a viewer with no mark matches no session", () => {
  assert.deepEqual(((g) => [g.how, g.task])(ask([], { explicit: T(9) })), ["explicit", T(9)]);
  assert.equal(ask([row(T(1), { session: null }), row(T(2), { session: null })], { mark: null }).how, "ambiguous");
});

test("the table's last row always answers, and 'newest on the machine' is not a row", () => {
  assert.equal(ASSOCIATION.at(-1).how, "none");
  assert.equal(ASSOCIATION.some((r) => /newest|latest|machine/.test(r.how)), false);
});

test("the mark a viewer computes from a host's session id is exactly the one a task's writer stores", () => {
  const hostSessionId = hostSession("claude", "f92e24f9-e7de-4477-891a-f5f3580d0ca7");
  assert.match(hostSessionId, /^claude:[0-9a-f]{16}$/);
  assert.match(taskSessionMark(hostSessionId), /^[0-9a-f]{16}$/);
  assert.equal(taskSessionMark(null), null);
});
