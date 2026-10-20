// Health in Orbit Control, end to end through a real socket: every area answers, what needs a person is a row with
// where to act, a restriction a person kept from before autonomy was the default is lifted only with the token and
// on the revision read, a workflow that ended while its engineering task did not is named, and a look moves not one
// byte of the store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStoreRoot } from "../src/core.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { fixture } from "./fixture.mjs";
import { bind, machine, SHOP, snapshot, tasksIn } from "./machine.mjs";

const legacy = (file, content) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...content, schema: 1 })}\n`);
};

const areaRows = (json, area) => json.checks.filter((c) => c.area === area);

test("GET /api/v1/mission-control/health answers every area, names what waits for a person, and moves nothing", async (t) => {
  const m = machine(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const before = snapshot(m.root.store);
  const res = await api.get("/api/v1/mission-control/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.areas, ["automation", "tasks", "resources", "hosts"]);
  for (const area of res.json.areas) assert.ok(areaRows(res.json, area).length > 0, `${area} always answers`);
  assert.deepEqual(areaRows(res.json, "automation").map((c) => c.level), ["ok"], "a fresh install keeps no restriction");
  const waiting = areaRows(res.json, "tasks").find((c) => /approval/.test(c.title));
  assert.deepEqual([waiting.level, waiting.link.to], ["attention", "approvals"]);
  assert.notEqual(res.json.status, "ok");
  assert.deepEqual(snapshot(m.root.store), before, "a look writes nothing");
});


test("an engineering task whose workflow ended while it did not is named, with its task to open", async (t) => {
  const { root } = fixture(t);
  bind(root, SHOP);
  const shop = tasksIn(t, root, SHOP);
  const workflow = shop.create({ objective: "Implement the refund rule", provider: "automation" });
  const child = shop.create({ objective: "Implement the refund rule (engineering)", provider: "autonomous-engineering", parent: workflow });
  shop.op(workflow, "cancel", { expected: shop.view(workflow).revision, human: true });
  const api = await serve(t, root, runtimeWorld(root));
  const rows = areaRows((await api.get("/api/v1/mission-control/health")).json, "tasks");
  const orphan = rows.find((c) => /workflow ended/.test(c.title));
  assert.ok(orphan, JSON.stringify(rows));
  assert.deepEqual(orphan.link.task, { key: SHOP.key, checkout: SHOP.checkout, task: child });
});
