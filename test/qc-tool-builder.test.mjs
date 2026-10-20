// The builder's lifecycle: scaffold → verify → register → status.
//
// The rule every test here defends: a candidate is held to EXACTLY the contract a
// registered tool is held to, by the same loader, before it is anywhere the
// runtime would find it. And the one that matters for a plugin upgrade: what a
// project generated lives outside every repository, and outside the plugin.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { registerTool, setStatus, verifyTool } from "../src/extensions/lifecycle.mjs";
import { scaffold } from "../src/extensions/scaffold.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { createQcTools, qcToolPaths } from "../src/extensions/store.mjs";
import { Refused } from "../src/errors.mjs";
import { realIo } from "../src/store/io.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const io = realIo();
const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");

const scratch = () => mkdtempSync(join(tmpdir(), "orbit-scratch-"));
const store = () => mkdtempSync(join(tmpdir(), "orbit-store-"));

const ctxOver = (root) => ({ ...fakeContext(), store: () => root, process: fakeProcess() });

const gone = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

test("a scaffold is a DRAFT, so nothing can go live by being left somewhere", () => {
  const dir = scratch();
  const made = scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["psql"] });
  assert.deepEqual(made.files, ["extension.json", "capabilities.mjs", "test.mjs"]);
  const manifest = JSON.parse(readFileSync(join(dir, "acme-probe", "extension.json"), "utf8"));
  assert.equal(manifest.status, "draft");
  assert.equal(manifest.apiVersion, "orbit.extension/v2");
  assert.deepEqual(manifest.tools, ["psql"]);
  gone(dir);
});

test("the scaffold's own contract test passes as generated — a tool starts provable", () => {
  const dir = scratch();
  scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["echo"] });
  assert.ok(existsSync(join(dir, "acme-probe", "test.mjs")));
  gone(dir);
});

test("verify asks whether it WOULD load if trusted, and leaves the draft a draft on disk", async () => {
  const dir = scratch();
  const at = join(dir, "acme-probe");
  scaffold(at, "acme-probe", io, { tools: ["echo"] });
  const verdict = await verifyTool(ctxOver(store()), at, io);
  assert.equal(verdict.ok, true, verdict.findings?.join("; "));
  assert.deepEqual(verdict.loaded.capabilities, ["acmeprobe.read"]);
  assert.equal(JSON.parse(readFileSync(join(at, "extension.json"), "utf8")).status, "draft", "untouched");
  gone(dir);
});

test("verify never leaves anything registered in the context it was given", async () => {
  const dir = scratch();
  scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["echo"] });
  const ctx = ctxOver(store());
  await verifyTool(ctx, join(dir, "acme-probe"), io);
  assert.deepEqual(ctx.capabilities.ids(), [], "it loaded into a throwaway, not into this");
  gone(dir);
});

test("a candidate that would not load is refused, with the loader's own words", async () => {
  const dir = scratch();
  const at = join(dir, "bad");
  scaffold(at, "bad", io);
  writeFileSync(join(at, "capabilities.mjs"), `export default [{ id: "nodots", apiVersion: "orbit.capability/v1", doc: "x", invoke: () => 1 }];`);
  const verdict = await verifyTool(ctxOver(store()), at, io);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.findings.some((f) => /id does not look like/.test(f)), verdict.findings.join("; "));
  gone(dir);
});

test("a manifest problem is reported as a manifest problem, before anything is imported", async () => {
  const dir = scratch();
  const at = join(dir, "bad");
  scaffold(at, "bad", io);
  writeFileSync(join(at, "extension.json"), JSON.stringify({ id: "bad", version: "1.0.0", apiVersion: "orbit.extension/v9", status: "draft" }));
  const verdict = await verifyTool(ctxOver(store()), at, io);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.findings.some((f) => /apiVersion must be/.test(f)));
  gone(dir);
});

// A builder that could register an unproved tool is a builder whose verification
// step is decoration.
test("registering something that does not verify is REFUSED, and keeps the store empty", async () => {
  const dir = scratch();
  const root = store();
  const at = join(dir, "bad");
  scaffold(at, "bad", io);
  writeFileSync(join(at, "capabilities.mjs"), `export default [{ id: "nodots", apiVersion: "orbit.capability/v1", doc: "x", invoke: () => 1 }];`);
  await assert.rejects(() => registerTool(ctxOver(root), at, io), (e) => e instanceof Refused && /not verified, so it is not registered/.test(e.message));
  assert.ok(!existsSync(join(qcToolPaths(root).root, "bad")));
  gone(dir, root);
});

test("registering promotes it to verified, records the line, and puts it outside every repo", async () => {
  const dir = scratch();
  const root = store();
  scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["echo"] });
  const kept = await registerTool(ctxOver(root), join(dir, "acme-probe"), io);
  assert.equal(kept.id, "acme-probe");
  assert.equal(kept.entry.kind, "capability", "read off what it actually registered");
  assert.equal(kept.entry.status, "verified");
  assert.ok(kept.entry.engine, "which engine verified it");
  assert.equal(JSON.parse(readFileSync(join(kept.at, "extension.json"), "utf8")).status, "verified");
  assert.ok(kept.at.startsWith(root) && !kept.at.startsWith(ENGINE), "in the store, not in the plugin");
  assert.deepEqual(createQcTools(root, io).entries().map((e) => e.id), ["acme-probe"]);
  gone(dir, root);
});

test("a registered tool is there on the next load — an upgrade replaces the engine, not this", async () => {
  const dir = scratch();
  const root = store();
  scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["echo"] });
  await registerTool(ctxOver(root), join(dir, "acme-probe"), io);
  const fresh = await withExtensions(ctxOver(root));
  assert.deepEqual(fresh.extensions.loaded.map((e) => e.id), ["acme-probe"]);
  assert.ok(fresh.capabilities.has("acmeprobe.read"));
  gone(dir, root);
});

test("a stale tool stops being loaded, and the reason says which status it is in", async () => {
  const dir = scratch();
  const root = store();
  scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["echo"] });
  await registerTool(ctxOver(root), join(dir, "acme-probe"), io);
  assert.deepEqual(setStatus(ctxOver(root), "acme-probe", "stale", io), { id: "acme-probe", status: "stale" });
  const after = await withExtensions(ctxOver(root));
  assert.deepEqual(after.extensions.loaded, []);
  assert.match(after.extensions.refused[0].why, /status is stale — only verified or active is loaded/);
  gone(dir, root);
});

test("changing the status of something that is not there says so", () => {
  const root = store();
  assert.throws(() => setStatus(ctxOver(root), "nonesuch", "stale", io), (e) => e instanceof Refused && /no QC tool "nonesuch"/.test(e.message));
  gone(root);
});

// The invariant a plugin upgrade has to keep, asserted as a path rather than as a
// promise in a comment.
test("nothing a project generates is written inside the engine's own tree", async () => {
  const dir = scratch();
  const root = store();
  scaffold(join(dir, "acme-probe"), "acme-probe", io, { tools: ["echo"] });
  const kept = await registerTool(ctxOver(root), join(dir, "acme-probe"), io);
  for (const forbidden of [join(ENGINE, "src"), join(ENGINE, "skills"), join(ENGINE, "cli")]) {
    assert.ok(!kept.at.startsWith(forbidden), forbidden);
  }
  gone(dir, root);
});

// ---- a scaffold that says what it provides and which connection it needs -----------------

test("a scaffold that names neither is what it always was: no provides, no connection", () => {
  const dir = scratch();
  scaffold(join(dir, "plain"), "plain", io, { tools: ["echo"] });
  const text = readFileSync(join(dir, "plain", "capabilities.mjs"), "utf8");
  assert.doesNotMatch(text, /provides|connection/);
  assert.match(text, /key: \{ type: "string"/);
  gone(dir);
});

test("a scaffold that provides an acquisition is a READER of requirements, and it loads as generated", async () => {
  const dir = scratch();
  const at = join(dir, "tracker-reader");
  scaffold(at, "tracker-reader", io, { tools: ["echo"], provides: ["workitem.read", "workitem.comments.read"], connection: "tracker-a" });
  const text = readFileSync(at + "/capabilities.mjs", "utf8");
  assert.match(text, /provides: \["workitem.read","workitem.comments.read"\]/);
  assert.match(text, /connection: "tracker-a"/);
  assert.match(text, /capability: \{ type: "string"/, "asked which acquisition, since it answers more than one");
  const verdict = await verifyTool(ctxOver(store()), at, io);
  assert.equal(verdict.ok, true, verdict.findings?.join("; "));
  assert.deepEqual(verdict.loaded.capabilities, ["trackerreader.read"]);
  gone(dir);
});

test("the reader's own contract test passes as generated -- a reader starts provable", () => {
  const dir = scratch();
  const at = join(dir, "tracker-reader");
  scaffold(at, "tracker-reader", io, { tools: ["echo"], provides: ["workitem.read"] });
  const ran = spawnSync(process.execPath, ["--test", join(at, "test.mjs")], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.doesNotMatch(readFileSync(join(at, "capabilities.mjs"), "utf8"), /capability: \{ type/, "one acquisition needs no way to say which");
  gone(dir);
});

test("a scaffold asked to declare something that does not hold is refused, and writes nothing", () => {
  const dir = scratch();
  assert.throws(() => scaffold(join(dir, "a"), "a", io, { provides: ["Not An Id"] }), /provides "Not An Id" is not a capability id/);
  assert.throws(() => scaffold(join(dir, "b"), "b", io, { connection: "Tracker A" }), /is not a provider slug/);
  assert.equal(existsSync(join(dir, "a")) || existsSync(join(dir, "b")), false);
  gone(dir);
});

test("a scaffold that ships a reader carries no secret and asks the engine for none", () => {
  const dir = scratch();
  scaffold(join(dir, "r"), "r", io, { tools: ["echo"], provides: ["workitem.read"], connection: "tracker-a" });
  const text = ["capabilities.mjs", "test.mjs", "extension.json"].map((f) => readFileSync(join(dir, "r", f), "utf8")).join("\n");
  assert.doesNotMatch(text, /process\.env|token|password|secret|credential/i);
  gone(dir);
});
