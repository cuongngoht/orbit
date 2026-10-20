// The project registry: membership is the binding files, the rest is a summary
// kept beside them -- and nothing is ever scanned for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { CHECKOUT_PRESENT, createRegistry, REGISTRY_SCHEMA } from "../src/store/registry.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { fakeIo } from "./fakes/io.mjs";

const BASE = "/store";
const rooms = stateRooms(BASE);
const A1 = "a".repeat(64);
const A2 = "b".repeat(64);
const B1 = "c".repeat(64);

function seeded() {
  const io = fakeIo();
  io.write(join(rooms.checkouts, `${A1}.json`), JSON.stringify({ key: "repo-aaa", root: "/work/app" }));
  io.write(join(rooms.checkouts, `${A2}.json`), JSON.stringify({ key: "repo-aaa", root: "/work/app-release" }));
  io.write(join(rooms.checkouts, `${B1}.json`), JSON.stringify({ key: "repo-bbb", root: "/work/billing" }));
  return io;
}

test("the registry is the binding files, grouped by project and listed by name -- no scan", () => {
  const io = seeded();
  io.dirs.add("/work/app");
  const projects = createRegistry(rooms, io).list();
  assert.deepEqual(projects.map((p) => [p.key, p.name, p.checkouts.length]), [["repo-aaa", "app", 2], ["repo-bbb", "billing", 1]]);
  assert.deepEqual(projects[0].checkouts.map((c) => [c.root, c.exists]), [["/work/app", true], ["/work/app-release", false]]);
});

test("an empty or missing room is an empty registry, and reading creates nothing", () => {
  const io = fakeIo();
  assert.deepEqual(createRegistry(rooms, io).list(), []);
  assert.equal(io.files.size, 0);
  assert.equal(io.dirs.size, 0);
});

test("a binding that is not one is dropped, and costs only itself", () => {
  const io = seeded();
  io.write(join(rooms.checkouts, "notanid.json"), JSON.stringify({ key: "repo-x", root: "/x" }));
  io.write(join(rooms.checkouts, `${"d".repeat(64)}.json`), "{ torn");
  io.write(join(rooms.checkouts, `${"e".repeat(64)}.json`), JSON.stringify({ key: "../escape", root: "/x" }));
  assert.equal(createRegistry(rooms, io).list().length, 2);
});

test("a note is merged over what was said before, and names its own moment", () => {
  const io = seeded();
  const registry = createRegistry(rooms, io);
  registry.note("repo-aaa", A1, { name: "payments", host: "laptop-a", at: "2026-10-03T10:00:00.000Z", summary: { understanding: "CURRENT" } });
  registry.note("repo-aaa", A1, { host: "laptop-a", at: "2026-10-03T11:00:00.000Z", summary: { runtime: "STOPPED" } });
  const found = registry.find("repo-aaa", A1);
  assert.equal(found.project.name, "payments");
  assert.deepEqual(found.checkout.summary, { understanding: "CURRENT", runtime: "STOPPED" });
  assert.equal(found.checkout.lastSeen, "2026-10-03T11:00:00.000Z");
  assert.equal(JSON.parse(io.read(join(rooms.projects, "repo-aaa.json"))).schema, REGISTRY_SCHEMA);
});

test("a project's name is the first it was given: the other checkout running something later does not rename it", () => {
  const registry = createRegistry(rooms, seeded());
  registry.note("repo-aaa", A1, { name: "shop", host: "h", at: "2026-10-03T10:00:00.000Z", summary: {} });
  registry.note("repo-aaa", A2, { name: "shop-review", host: "h", at: "2026-10-03T11:00:00.000Z", summary: {} });
  assert.equal(registry.find("repo-aaa", A2).project.name, "shop", "not whichever directory ran last");
});

test("one checkout's note leaves its sibling and the other project untouched", () => {
  const io = seeded();
  const registry = createRegistry(rooms, io);
  registry.note("repo-aaa", A1, { host: "h", at: "t", summary: { runtime: "RUNNING" } });
  assert.equal(registry.find("repo-aaa", A2).checkout.summary, null);
  assert.equal(registry.find("repo-bbb", B1).checkout.summary, null);
  assert.equal(registry.find("repo-aaa", "f".repeat(64)), null);
});

test("a registry document from a newer engine is refused for writing, never overwritten", () => {
  const io = seeded();
  io.write(join(rooms.projects, "repo-aaa.json"), JSON.stringify({ schema: 99, key: "repo-aaa", checkouts: {} }));
  assert.throws(() => createRegistry(rooms, io).note("repo-aaa", A1, { host: "h", at: "t" }), /newer Orbit/);
});

test("a checkout whose directory is gone is forgotten -- its line and its binding, nothing else -- and one still there, or one nobody knows, is refused", () => {
  const io = seeded();
  io.dirs.add("/work/app");
  const registry = createRegistry(rooms, io);
  registry.note("repo-aaa", A1, { name: "app", host: "h", at: "t", summary: { runtime: "RUNNING" } });
  registry.note("repo-aaa", A2, { host: "h", at: "t", summary: { runtime: "STOPPED" } });
  assert.equal(registry.forget("repo-aaa", A2).checkout.root, "/work/app-release");
  assert.deepEqual(registry.list().map((p) => [p.key, p.checkouts.map((c) => c.root)]), [["repo-aaa", ["/work/app"]], ["repo-bbb", ["/work/billing"]]]);
  assert.deepEqual(Object.keys(JSON.parse(io.read(join(rooms.projects, "repo-aaa.json"))).checkouts), [A1], "the sibling's line is untouched");
  assert.throws(() => registry.forget("repo-aaa", A1), (e) => e.code === CHECKOUT_PRESENT && /its directory is still there/.test(e.message));
  assert.throws(() => registry.forget("repo-aaa", "f".repeat(64)), /no checkout ffffffffffff of repo-aaa is known/);
});

test("a project document from a newer engine refuses a forget, and the binding stays where it was", () => {
  const io = seeded();
  io.write(join(rooms.projects, "repo-bbb.json"), JSON.stringify({ schema: 99, key: "repo-bbb", checkouts: {} }));
  assert.throws(() => createRegistry(rooms, io).forget("repo-bbb", B1), /newer Orbit/);
  assert.equal(io.exists(join(rooms.checkouts, `${B1}.json`)), true);
});
