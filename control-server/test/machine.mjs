// A machine with tasks in it, for the Mission Control and task routes: three projects bound the way
// Orbit binds a checkout it was used from, and journals written through the task subject's own door.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { ASK, pbi482, taskWorld } from "../../test/task.harness.mjs";
import { fixture } from "./fixture.mjs";

export const SHOP = { key: "repo-shop", checkout: "a".repeat(64), dir: "shop" };
export const PAYMENTS = { key: "repo-payments", checkout: "b".repeat(64), dir: "payments" };
export const ADMIN = { key: "repo-admin", checkout: "1".repeat(64), dir: "admin" };

// A checkout this machine knows, bound the way Orbit binds one it was used from.
export function bind(root, p, present = true) {
  const rooms = stateRooms(root.store);
  mkdirSync(rooms.checkouts, { recursive: true });
  writeFileSync(join(rooms.checkouts, `${p.checkout}.json`), JSON.stringify({ key: p.key, root: join(root.base, "work", p.dir) }));
  if (present) mkdirSync(join(root.base, "work", p.dir), { recursive: true });
}

export const tasksIn = (t, root, p) => taskWorld(t, { dir: projectStoreRoot(root.store, p.key), project: p.key, checkout: p.checkout });

// shop: one task working, one finished. payments: one waiting for a person. admin: none.
export function machine(t) {
  const { root } = fixture(t);
  for (const p of [SHOP, PAYMENTS, ADMIN]) bind(root, p);
  const shop = tasksIn(t, root, SHOP);
  const working = shop.create({ objective: "PBI-482 Refund validation" });
  shop.op(working, "stage", { stage: "TESTING" });
  const finished = shop.create({ objective: "BUG-218 Search crash" });
  shop.op(finished, "complete", { summary: "fixed" });
  const payments = tasksIn(t, root, PAYMENTS);
  const waiting = pbi482(payments);
  payments.op(waiting, "request-approval", ASK);
  return { root, shop, payments, working, finished, waiting };
}

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
export const snapshot = (dir) => Object.fromEntries(walk(dir).map((f) => [relative(dir, f), readFileSync(f, "utf8")]));
