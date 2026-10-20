// The Environment Writer and validation: a proposal is adopted by a person, only if
// it is still true, in exactly the approved form, and read back before anything is
// called adopted -- and an environment that was written is not one that was built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { devcontainer } from "../src/runtime/providers/devcontainer.mjs";
import { inspect } from "../src/runtime/environment/devcontainer.mjs";
import { design } from "../src/runtime/design/designer.mjs";
import { build, fingerprintOf, freshness, STALE_PROPOSAL, understandingDigest } from "../src/runtime/proposal.mjs";
import { requirementsOf } from "../src/runtime/requirements.mjs";
import { validate } from "../src/runtime/validate.mjs";
import { sayValidate } from "../src/runtime/views.mjs";
import { ADOPT_UNVERIFIED, adopt } from "../src/runtime/writer.mjs";
import { Refused } from "../src/errors.mjs";
import { ensure } from "../src/runtime/understanding.mjs";
import { DEVCONTAINER_JSONC, NODE_AND_DOTNET, SHIPPED_CATALOG, machineOf, FULL_TOOLS, viewOf } from "./fakes/runtime.mjs";
import { fakeRuntime } from "./fakes/runtime-ctx.mjs";
import { fakeWorktree } from "./fakes/worktree.mjs";

const NEWER = { ...NODE_AND_DOTNET, "api/Api.csproj": `<Project Sdk="Vendor.NET.Sdk.Web"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>` };

// Understand the checkout, design against its working tree, and keep the proposal.
function proposed(files, worktree = {}, opts = {}) {
  const rt = fakeRuntime(files, { worktree, ...opts });
  ensure(rt.ctx);
  const facts = rt.store.all();
  const view = viewOf(files);
  const body = design({ requirements: requirementsOf(view, SHIPPED_CATALOG), inspected: inspect(rt.tree), catalog: SHIPPED_CATALOG, name: "shop" });
  const rest = { checkout: rt.ctx.checkout, understanding: understandingDigest(facts, rt.store.model().model.readers), environment: envOf(rt.tree, body), now: rt.ctx.now() };
  const proposal = build(body, rest);
  rt.ctx.proposals.write(proposal);
  return { ...rt, proposal, now: () => ({ understanding: understandingDigest(rt.store.all(), rt.store.model().model.readers), environment: envOf(rt.tree, body) }) };
}

const envOf = (tree, body) => Object.fromEntries([...body.files.create.map((f) => [f.path, fingerprintOf(tree.read(f.path))]), ...body.files.patch.map((f) => [f.path, fingerprintOf(tree.read(f.path))])]);

test("adopting is a person's: refused before anything is read, written or checked", () => {
  const { ctx, proposal, now, tree } = proposed(NODE_AND_DOTNET);
  assert.throws(() => adopt(ctx, proposal, { human: false, now: now() }), (e) => e instanceof Refused && /a person's — relay it with --human/.test(e.message));
  assert.deepEqual(tree.state.writes, []);
});

test("Scenario B: a CREATE proposal is written, READ BACK, and the environment is ADOPTED -- not validated", () => {
  const { ctx, proposal, now, tree } = proposed(NODE_AND_DOTNET);
  assert.equal(proposal.state, "CREATE");
  const done = adopt(ctx, proposal, { human: true, now: now() });
  assert.deepEqual(done.files, [{ path: ".devcontainer/devcontainer.json", created: true }]);
  assert.deepEqual(tree.state.writes, [".devcontainer/devcontainer.json"]);
  assert.equal(tree.read(".devcontainer/devcontainer.json"), proposal.files.create[0].text);
  assert.deepEqual([done.instance.state, done.instance.provider, done.instance.proposal], ["ADOPTED", "devcontainer", proposal.id]);
  assert.equal(ctx.instances.list()[0].state, "ADOPTED");
  assert.equal(ctx.proposals.read(proposal.id).status, "adopted");
});

test("Scenario C: a PATCH is written by splicing -- every comment and customisation is still there when it is read back", () => {
  const { ctx, proposal, now, tree } = proposed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  assert.equal(proposal.state, "PATCH");
  adopt(ctx, proposal, { human: true, now: now() });
  const after = tree.read(".devcontainer/devcontainer.json");
  assert.equal(after, DEVCONTAINER_JSONC.replace('"version": "20"', '"version": "22"').replace('"version": "8.0"', '"version": "9.0"'));
  assert.ok(after.includes("// pinned: CI runs 20"), "the comment about WHY it was pinned is not lost");
  assert.deepEqual(tree.state.writes, [".devcontainer/devcontainer.json"], "one file, once");
});

test("a developer who edits devcontainer.json while a proposal is being read finds the proposal STALE -- and the file is never overwritten", () => {
  const { ctx, proposal, now, tree } = proposed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  const theirs = `${DEVCONTAINER_JSONC}// my own note\n`;
  tree.edit(".devcontainer/devcontainer.json", theirs);
  assert.throws(() => adopt(ctx, proposal, { human: true, now: now() }), (e) => e.code === STALE_PROPOSAL && /\.devcontainer\/devcontainer\.json changed since this was designed/.test(e.message));
  assert.equal(tree.read(".devcontainer/devcontainer.json"), theirs);
  assert.deepEqual(tree.state.writes, []);
  assert.equal(ctx.instances.list().length, 0);
});

test("a manifest that moved while a proposal was being read makes it STALE too: the understanding it rests on changed", () => {
  const { ctx, proposal, now, source } = proposed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  source.write("web/package.json", JSON.stringify({ engines: { node: ">=24" }, scripts: { dev: "vite" } }));
  ensure(ctx);
  assert.throws(() => adopt(ctx, proposal, { human: true, now: now() }), (e) => e.code === STALE_PROPOSAL && /runtime understanding changed/.test(e.message));
});

test("a CREATE proposal goes stale when somebody creates the file first: it is never written over", () => {
  const { ctx, proposal, now, tree } = proposed(NODE_AND_DOTNET);
  tree.edit(".devcontainer/devcontainer.json", "{}");
  assert.throws(() => adopt(ctx, proposal, { human: true, now: now() }), (e) => e.code === STALE_PROPOSAL);
  assert.equal(tree.read(".devcontainer/devcontainer.json"), "{}");
});

test("only CREATE and PATCH write; everything else has nothing to adopt, and says why", () => {
  const unsafe = proposed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": "{ not json" });
  assert.equal(unsafe.proposal.state, "UNSAFE");
  assert.throws(() => adopt(unsafe.ctx, unsafe.proposal, { human: true, now: unsafe.now() }), /nothing to adopt: this proposal is UNSAFE/);
  assert.deepEqual(unsafe.tree.state.writes, []);
});

test("a CREATE never lands on something that is already there, even when it reads as nothing", () => {
  const { ctx, proposal, now, tree } = proposed(NODE_AND_DOTNET);
  assert.equal(proposal.state, "CREATE");
  tree.state.symlinks.add(".devcontainer/devcontainer.json");
  assert.throws(() => adopt(ctx, proposal, { human: true, now: now() }), (e) => e instanceof Refused && /is already there, so it is not created over.*nothing was written/.test(e.message));
  assert.deepEqual(tree.state.writes, [], "not a byte was written");
  assert.equal(ctx.instances.list().length, 0);
});

test("a proposal adopted once cannot be adopted again", () => {
  const { ctx, proposal, now } = proposed(NODE_AND_DOTNET);
  adopt(ctx, proposal, { human: true, now: now() });
  assert.throws(() => adopt(ctx, ctx.proposals.read(proposal.id), { human: true, now: now() }), /already been adopted/);
});

test("a read-back that disagrees leaves the files as written, adopts nothing and says ADOPT_UNVERIFIED", () => {
  const { ctx, proposal, now, tree } = proposed(NODE_AND_DOTNET);
  const write = tree.write;
  tree.write = (rel, text) => write(rel, `${text}// something else touched it\n`);
  assert.throws(() => adopt(ctx, proposal, { human: true, now: now() }), (e) => e.code === ADOPT_UNVERIFIED && /reads back differently from what was written/.test(e.message));
  assert.equal(ctx.instances.list().length, 0, "the environment is not adopted");
  assert.equal(ctx.proposals.read(proposal.id).status, "open");
  assert.deepEqual(tree.state.writes, [".devcontainer/devcontainer.json"], "and nothing was written a second time");
});

test("an edit that would not be faithful is refused BEFORE a byte is written", () => {
  const { ctx, proposal, now, tree } = proposed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  const forged = { ...proposal, files: { create: [], patch: [{ path: ".devcontainer/devcontainer.json", edits: [{ op: "set", path: ["name"], value: "x" }, { op: "insert", path: ["name"], key: "k", value: 1 }] }] } };
  assert.throws(() => adopt(ctx, forged, { human: true, now: now() }), /cannot be edited as proposed \(.*is not an object\); nothing was written/);
  assert.deepEqual(tree.state.writes, []);
});

test("freshness compares both halves: the understanding digest and every environment file, with null meaning 'must not exist'", () => {
  const p = { understanding: "u1", environment: { "a.json": "h1", "b.json": null } };
  assert.deepEqual(freshness(p, { understanding: "u1", environment: { "a.json": "h1" } }), { fresh: true });
  assert.match(freshness(p, { understanding: "u2", environment: { "a.json": "h1" } }).why, /understanding changed/);
  assert.match(freshness(p, { understanding: "u1", environment: { "a.json": "h2" } }).why, /a\.json changed/);
  assert.match(freshness(p, { understanding: "u1", environment: { "a.json": "h1", "b.json": "now-exists" } }).why, /b\.json changed/);
});

test("a proposal's id is what it would do: the same inputs design the same proposal, and any change is another", () => {
  const a = proposed(NODE_AND_DOTNET).proposal;
  const b = proposed(NODE_AND_DOTNET).proposal;
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, proposed(NEWER).proposal.id);
  assert.match(a.id, /^ep-[a-f0-9]{12}$/);
});

// ---- validation ---------------------------------------------------------------------------------

function validating(upAnswer) {
  const rt = proposed(NODE_AND_DOTNET);
  adopt(rt.ctx, rt.proposal, { human: true, now: rt.now() });
  const process = Object.assign(rt.process, { run: (file, args) => (rt.process.calls.push({ file, args }), upAnswer) });
  const world = { view: viewOf(NODE_AND_DOTNET), machine: machineOf("darwin", FULL_TOOLS), catalog: SHIPPED_CATALOG, instances: [], checkout: rt.ctx.checkout, envId: "x" };
  return { ...rt, world, deps: { process, root: "/work/shop", env: {}, now: () => "2026-10-03T10:00:00.000Z" } };
}

test("validation brings the environment up, and only then is it VALIDATED -- with a receipt, never the output", () => {
  const { ctx, world, deps, process } = validating({ ok: true, out: "SECRET build output", status: 0 });
  const done = validate(ctx, devcontainer, world, deps);
  assert.deepEqual([done.state, done.validation.state], ["VALIDATED", "VALIDATED"]);
  assert.deepEqual(done.validation.receipt, { at: "2026-10-03T10:00:00.000Z", tool: "devcontainer", ok: true, status: 0 });
  assert.equal(JSON.stringify(done).includes("SECRET"), false);
  assert.equal(process.calls[0].file, "devcontainer");
  assert.ok(process.calls[0].args.includes("orbit.checkout=" + ctx.checkout));
});

test("Scenario M: files written, the container build FAILS -> ADOPTED with a FAILED validation, and a runtime that depends on it is not ready", () => {
  const { ctx, world, deps } = validating({ ok: false, out: "", error: "failed to solve: node:99 not found", status: 1 });
  const done = validate(ctx, devcontainer, world, deps);
  assert.deepEqual([done.state, done.validation.state], ["VALIDATION_FAILED", "VALIDATION_FAILED"]);
  assert.match(done.validation.because, /failed to solve/);
  const compat = devcontainer.compatibility(world.view.components.find((c) => c.key === "node:web"), { ...world, instances: [done] });
  assert.equal(compat.state, "needs-environment");
  assert.deepEqual(compat.blocking, ["validate the environment"]);
});

test("validating again after a failure is allowed, and a definition a person already had is validated without an adoption", () => {
  const { ctx, world, deps } = validating({ ok: false, out: "", error: "x", status: 1 });
  validate(ctx, devcontainer, world, deps);
  deps.process.run = () => ({ ok: true, out: "", status: 0 });
  assert.equal(validate(ctx, devcontainer, world, deps).state, "VALIDATED");
  const had = fakeRuntime(NODE_AND_DOTNET, { worktree: { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC } });
  const done = validate(had.ctx, devcontainer, world, { ...deps, process: Object.assign(had.process, { run: () => ({ ok: true, out: "", status: 0 }) }) });
  assert.deepEqual([done.state, done.proposal], ["VALIDATED", null]);
});

test("an adopted or edited definition is brought up AFRESH -- the old container is not what it describes -- and one validated as it is now, is not", () => {
  const { ctx, world, deps, process, tree } = validating({ ok: true, out: "", status: 0 });
  const afresh = () => process.calls.at(-1).args.includes("--remove-existing-container");
  validate(ctx, devcontainer, world, deps);
  assert.equal(afresh(), true, "adopted: whatever container there is predates the definition");
  validate(ctx, devcontainer, world, deps);
  assert.equal(afresh(), false, "validated, and unchanged since: brought up as it is");
  tree.edit(".devcontainer/devcontainer.json", `${tree.read(".devcontainer/devcontainer.json")}\n`);
  validate(ctx, devcontainer, world, deps);
  assert.equal(afresh(), true, "edited since it was validated");
});

// What a real run showed: validate replaced the container a running frontend lived in and said only
// "the environment came up". A fresh bring-up names what Orbit ran inside, which ended with it.
test("an environment brought up AFRESH says which of Orbit's sessions ended with the container it replaced -- and one brought up as it is says nothing", () => {
  const { ctx, world, deps, tree } = validating({ ok: true, out: "", status: 0 });
  validate(ctx, devcontainer, world, deps);
  ctx.sessions.write({ id: "rs-0123456789ab", component: "node:web", provider: "devcontainer", state: "RUNNING", pid: 4242, env: "env-x", checkout: ctx.checkout, requestedAt: "2026-10-03T10:00:00.000Z" });
  assert.equal(validate(ctx, devcontainer, world, deps).ended, undefined, "brought up as it is: the container, and what runs in it, stay");
  tree.edit(".devcontainer/devcontainer.json", `${tree.read(".devcontainer/devcontainer.json")}\n`);
  const done = validate(ctx, devcontainer, world, deps);
  assert.deepEqual(done.ended, [{ component: "node:web", session: "rs-0123456789ab" }]);
  assert.match(sayValidate(done), /ended with the container it replaced: node:web \(session rs-0123456789ab\) — `runtime start` launches it again/);
});

test("a compose file or Dockerfile the definition builds from is part of what came up: edited, the environment is brought up afresh", () => {
  const definition = JSON.stringify({ dockerComposeFile: ["../docker-compose.yml", "compose.dev.yml"], service: "app", features: { "ghcr.io/devcontainers/features/node:1": { version: "22" } } });
  const had = fakeRuntime(NODE_AND_DOTNET, { worktree: { ".devcontainer/devcontainer.json": definition, ".devcontainer/compose.dev.yml": "services:\n  app:\n    image: x\n", "docker-compose.yml": "services:\n  db:\n    image: postgres:16\n" } });
  const calls = [];
  const deps = { process: Object.assign(had.process, { run: (file, args) => (calls.push(args), { ok: true, out: "", status: 0 }) }), root: "/work/shop", env: {}, now: () => "2026-10-03T10:00:00.000Z" };
  const world = validatingWorld(had.ctx);
  const afresh = () => calls.at(-1).includes("--remove-existing-container");
  validate(had.ctx, devcontainer, world, deps);
  validate(had.ctx, devcontainer, world, deps);
  assert.equal(afresh(), false, "nothing moved since it came up");
  assert.deepEqual(Object.keys(had.ctx.instances.list()[0].files).sort(), [".devcontainer/compose.dev.yml", ".devcontainer/devcontainer.json", "docker-compose.yml"]);
  had.tree.edit(".devcontainer/compose.dev.yml", "services:\n  app:\n    image: y\n");
  validate(had.ctx, devcontainer, world, deps);
  assert.equal(afresh(), true, "the compose file it brings up was edited");
});

test("a lock file the Dev Containers CLI writes while bringing the environment up is SAID -- and one that was already there is not", () => {
  const { ctx, world, deps, tree } = validating({ ok: true, out: "", status: 0 });
  const up = deps.process.run;
  deps.process.run = (file, args) => (tree.edit(".devcontainer/devcontainer-lock.json", "{}\n"), up(file, args));
  const first = validate(ctx, devcontainer, world, deps);
  assert.deepEqual(first.validation.wrote, [".devcontainer/devcontainer-lock.json"]);
  assert.match(sayValidate(first), /the Dev Containers CLI wrote \.devcontainer\/devcontainer-lock\.json \(the features it resolved, by digest\) — commit it to pin them, or delete it; Orbit wrote nothing in the repository/);
  assert.equal(validate(ctx, devcontainer, world, deps).validation.wrote, undefined, "it was there before this one");
});

test("there is nothing to validate without a definition, and no environment is invented", () => {
  const { ctx, world, deps } = Object.assign(fakeRuntime(NODE_AND_DOTNET), { world: null, deps: null });
  assert.throws(() => validate(ctx, devcontainer, { ...validatingWorld(ctx) }, { process: ctx.process, root: "/", env: {}, now: ctx.now }), /no dev container definition here to validate/);
  assert.equal(ctx.instances.list().length, 0);
  assert.equal(world, null);
  assert.equal(deps, null);
});

const validatingWorld = (ctx) => ({ view: viewOf(NODE_AND_DOTNET), machine: machineOf("darwin", FULL_TOOLS), catalog: SHIPPED_CATALOG, instances: [], checkout: ctx.checkout, envId: "x" });

test("the writer is the ONLY module that writes through the working-tree port", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(import.meta.dirname, "..", "src", "runtime");
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const writers = walk(root).filter((p) => /\.tree\.write\(/.test(readFileSync(p, "utf8")));
  assert.deepEqual(writers.map((p) => p.slice(root.length + 1)), ["writer.mjs"]);
});

test("fakeWorktree edit is the developer's hand, and never counts as a write by the engine", () => {
  const tree = fakeWorktree({ a: "1" });
  tree.edit("a", "2");
  assert.deepEqual([tree.read("a"), tree.state.writes], ["2", []]);
});
