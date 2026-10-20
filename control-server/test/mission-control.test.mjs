// Mission Control, end to end through a real socket: the machine-wide view and approval queue
// across several projects, read off the registry and the task journals -- and nothing a GET does
// moves a byte, and no row runs anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ROUTES } from "../src/router.mjs";
import { ASK } from "../../test/task.harness.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { fixture } from "./fixture.mjs";
import { machine, PAYMENTS, SHOP, snapshot } from "./machine.mjs";

test("GET /api/v1/mission-control is the machine: counters, every task with its project, and the approvals waiting", async (t) => {
  const m = machine(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const res = await api.get("/api/v1/mission-control");
  assert.equal(res.status, 200);
  const { counts, tasks, approvals, problems } = res.json;
  assert.deepEqual([counts.projects, counts.checkouts, counts.tasks, counts.running, counts.waitingApproval, counts.blocked, counts.completedToday], [3, 3, 3, 1, 1, 0, 1]);
  assert.deepEqual(tasks.map((r) => [r.projectName, r.lifecycle]).sort(), [["payments", "WAITING_APPROVAL"], ["shop", "COMPLETED"], ["shop", "VERIFYING"]]);
  assert.deepEqual(approvals.map((a) => [a.projectName, a.task, a.id, a.action, a.environment, a.attempt]), [["payments", m.waiting, "apr-1", "database.migrate", "dev", "att-3"]]);
  assert.deepEqual(problems, []);
  assert.doesNotMatch(res.text, new RegExp(m.root.store.replace(/[\\/]/g, ".")), "a page is shown which checkout, as the Projects page is -- never where the store keeps anything");
  assert.equal(tasks.find((r) => r.id === m.waiting).checkoutRoot, join(m.root.base, "work", "payments"));
});

test("GET /api/v1/mission-control/approvals is the machine's queue, with what a person needs to decide", async (t) => {
  const m = machine(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const res = await api.get("/api/v1/mission-control/approvals");
  assert.equal(res.status, 200);
  const [one] = res.json.approvals;
  assert.deepEqual([one.project, one.checkout, one.task, one.revision], [PAYMENTS.key, PAYMENTS.checkout, m.waiting, m.payments.view(m.waiting).revision]);
  assert.deepEqual([one.reason, one.risk], [ASK.reason, ASK.risk]);
});

test("a machine nobody used Orbit on says so with zeros, and is no error", async (t) => {
  const { root } = fixture(t);
  const api = await serve(t, root, runtimeWorld(root));
  const res = await api.get("/api/v1/mission-control");
  assert.deepEqual([res.status, res.json.counts.tasks, res.json.tasks, res.json.approvals], [200, 0, [], []]);
});

test("opening Mission Control and every task page moves not one byte of the store", async (t) => {
  const m = machine(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const before = snapshot(m.root.store);
  const base = `/api/v1/projects/${PAYMENTS.key}/checkouts/${PAYMENTS.checkout}/tasks`;
  for (const path of ["/api/v1/mission-control", "/api/v1/mission-control/approvals", base, `${base}/${m.waiting}`, `${base}/${m.waiting}/events?since=3`]) assert.equal((await api.get(path)).status, 200, path);
  assert.deepEqual(snapshot(m.root.store), before);
});

test("there is no command endpoint: no row runs, executes or shells anything, and such a path is a 404", async (t) => {
  assert.deepEqual(ROUTES.filter((r) => /run-command|shell|exec|command/.test(r.path.source)).map((r) => r.path.source), []);
  const { root } = fixture(t);
  const api = await serve(t, root, runtimeWorld(root));
  for (const path of ["/api/v1/exec", "/api/v1/shell", "/api/v1/run-command", `/api/v1/projects/${SHOP.key}/checkouts/${SHOP.checkout}/tasks/tsk-000000000000/exec`]) assert.equal((await api.post(path, { command: "rm -rf /" })).status, 404, path);
});
