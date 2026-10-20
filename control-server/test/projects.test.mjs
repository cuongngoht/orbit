// The projects Orbit knows on this machine, over HTTP: listed from the registry and from nothing
// else, and a runtime route is ABOUT the project and checkout its path names -- never the directory
// Control was started in, and never one a body names. Real socket, real store, a real Git checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { repositoryPaths } from "../../src/project/repository.mjs";
import { sealed } from "../../test/home.mjs";
import { RUNTIME_COMMANDS, bindRuntime } from "../src/core.mjs";
import { fixture } from "./fixture.mjs";
import { gitCheckout, gitStatus, REPO, runtimeWorld, serve } from "./checkout.mjs";

const WEB = { "web/package.json": JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { dev: "node serve.js" } }), "web/package-lock.json": "{}", "web/serve.js": "setInterval(() => {}, 1000);\n" };

// What the CLI does when it is used from a checkout: it reads it, so it is KNOWN, and asks the machine.
async function used(world, cwd) {
  await RUNTIME_COMMANDS.discover.run(bindRuntime({ pluginRoot: REPO, env: world.env, cwd }), []);
  await RUNTIME_COMMANDS.doctor.run(bindRuntime({ pluginRoot: REPO, env: world.env, cwd }), []);
}

test("a machine Orbit was never used on has no projects, and listing them touches nothing", async (t) => {
  const { root } = fixture(t);
  const api = await serve(t, root);
  const got = await api.get("/api/v1/projects");
  assert.deepEqual([got.status, got.json], [200, { projects: [] }]);
});

test("a checkout Orbit was used from is listed with the line its last command left -- from the registry, with the repository untouched", async (t) => {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  gitCheckout(root.project, WEB);
  await used(world, root.project);
  const before = gitStatus(root.project);
  const api = await serve(t, root, world);
  const { projects } = (await api.get("/api/v1/projects")).json;
  assert.equal(projects.length, 1);
  const [checkout] = projects[0].checkouts;
  assert.deepEqual([checkout.exists, checkout.summary.understanding, checkout.summary.runtime], [true, "CURRENT", "STOPPED"]);
  assert.equal(gitStatus(root.project), before, "listing read no repository and wrote nothing in it");
  const one = await api.get(`/api/v1/projects/${encodeURIComponent(projects[0].key)}`);
  assert.deepEqual([one.status, one.json.project.checkouts.length], [200, 1]);
});

test("an unknown project is a 404 in its own words, and nothing is scanned to find it", async (t) => {
  const { root } = fixture(t);
  const api = await serve(t, root);
  const got = await api.get("/api/v1/projects/repo-nothing");
  assert.deepEqual([got.status, got.json.error.code], [404, "PROJECT_UNKNOWN"]);
});

test("a runtime route needs BOTH identities, and a well-formed one the registry does not know is a 404, whatever else is true", async (t) => {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  gitCheckout(root.project, WEB);
  await used(world, root.project);
  const api = await serve(t, root, world);
  const [project] = (await api.get("/api/v1/projects")).json.projects;
  const [checkout] = project.checkouts;
  const key = encodeURIComponent(project.key);
  assert.equal((await api.get(`/api/v1/projects/${key}/checkouts/${checkout.id}/runtime`)).status, 200);
  for (const path of [`/api/v1/projects/${key}/checkouts/${"0".repeat(64)}/runtime`, `/api/v1/projects/repo-other/checkouts/${checkout.id}/runtime`]) {
    const got = await api.get(path);
    assert.deepEqual([got.status, got.json.error.code], [404, "PROJECT_UNKNOWN"], path);
  }
});

test("a checkout whose directory is gone is shown as missing, and its routes say so rather than guess", async (t) => {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  gitCheckout(root.project, WEB);
  await used(world, root.project);
  const api = await serve(t, root, world);
  const [project] = (await api.get("/api/v1/projects")).json.projects;
  rmSync(root.project, { recursive: true, force: true });
  const listed = (await api.get("/api/v1/projects")).json.projects[0].checkouts[0];
  assert.equal(listed.exists, false, "the engine never deletes a checkout from the registry: a person decides");
  const got = await api.get(`/api/v1/projects/${encodeURIComponent(project.key)}/checkouts/${listed.id}/runtime`);
  assert.deepEqual([got.status, got.json.error.code], [409, "CHECKOUT_MISSING"]);
  assert.doesNotMatch(got.text, new RegExp(root.base.replace(/[\\/]/g, ".")), "the sentence carries no path");
});

test("a percent-encoded identity is decoded once and refused in its own kind's words when it is not valid encoding", async (t) => {
  const { root } = fixture(t);
  const api = await serve(t, root);
  const got = await api.get("/api/v1/projects/%E0%A4%A");
  assert.deepEqual([got.status, got.json.error.code], [400, "INVALID_PROJECT_ID"]);
  const two = await api.get("/api/v1/projects/x/checkouts/%E0%A4%A/runtime");
  assert.deepEqual([two.status, two.json.error.code], [400, "INVALID_CHECKOUT_ID"]);
});

test("a checkout whose directory is gone is forgotten for a person only, and only that one -- and one that is there again is a 409", async (t) => {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  gitCheckout(root.project, WEB);
  await used(world, root.project);
  const api = await serve(t, root, world);
  const [project] = (await api.get("/api/v1/projects")).json.projects;
  const path = `/api/v1/projects/${encodeURIComponent(project.key)}/checkouts/${project.checkouts[0].id}/forget`;
  const present = await api.post(path, { human: true });
  assert.deepEqual([present.status, present.json.error.code], [409, "CHECKOUT_PRESENT"], "the directory is there: Orbit would know it again");
  rmSync(root.project, { recursive: true, force: true });
  const unasked = await api.post(path, {});
  assert.deepEqual([unasked.status, unasked.json.error.code], [400, "HUMAN_REQUIRED"]);
  assert.equal((await api.get("/api/v1/projects")).json.projects.length, 1, "a refusal changed nothing");
  const done = await api.post(path, { human: true });
  assert.equal(done.status, 200);
  assert.doesNotMatch(present.text + unasked.text, new RegExp(root.base.replace(/[\\/]/g, ".")), "a refusal's sentence carries no path");
  assert.deepEqual((await api.get("/api/v1/projects")).json.projects, []);
  assert.deepEqual([(await api.post(path, { human: true })).status], [404], "forgotten is gone");
});

// Every file under a directory, with what it holds: two of these are equal when nothing was written.
const snapshot = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name)).map((p) => [p, readFileSync(p, "utf8")]));

const committed = (dir, files) => {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  for (const args of [["add", "-A"], ["commit", "-qm", "move"]]) spawnSync("git", args, { cwd: dir, stdio: "ignore", env: sealed({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }) });
};

test("Scenario I: many projects, each in its own state, listed from what each last said -- and opening Control discovers none of them", async (t) => {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  const at = (name) => join(root.base, name);
  gitCheckout(at("ready"), WEB);
  await used(world, at("ready"));
  gitCheckout(at("partial"), { ...WEB, "api/package.json": "{ torn" });
  await used(world, at("partial"));
  gitCheckout(at("stale"), WEB);
  await used(world, at("stale"));
  committed(at("stale"), { "web/package.json": JSON.stringify({ name: "web", engines: { node: ">=20" }, scripts: { dev: "node serve.js" } }) });
  await RUNTIME_COMMANDS.doctor.run(bindRuntime({ pluginRoot: REPO, env: world.env, cwd: at("stale") }), []);
  gitCheckout(at("never"), WEB);
  const bound = repositoryPaths(at("never"), world.env);
  mkdirSync(dirname(bound.bindingFile), { recursive: true });
  writeFileSync(bound.bindingFile, `${JSON.stringify({ key: bound.storeKey, root: bound.root })}\n`);
  const before = { store: snapshot(root.store), trees: ["ready", "partial", "stale", "never"].map((n) => gitStatus(at(n))) };
  const api = await serve(t, root, world);
  const { projects } = (await api.get("/api/v1/projects")).json;
  const said = Object.fromEntries(projects.map((p) => [p.checkouts[0].root.split(/[\\/]/).pop(), p.checkouts[0].summary && [p.checkouts[0].summary.understanding, p.checkouts[0].summary.runtime]]));
  assert.deepEqual(said, { ready: ["CURRENT", "STOPPED"], partial: ["PARTIAL", said.partial?.[1]], stale: ["STALE", said.stale?.[1]], never: null }, "each project in its own state, as its last command left it");
  assert.equal(new Set(projects.map((p) => p.key)).size, 4, "four projects, not one");
  assert.deepEqual({ store: snapshot(root.store), trees: ["ready", "partial", "stale", "never"].map((n) => gitStatus(at(n))) }, before, "listing wrote nothing in the store and touched no checkout");
});
