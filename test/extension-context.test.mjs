// What a project's own code can reach, and — the half that matters — what it
// cannot.
//
// Generated QC code is code nobody reviewed line by line. The list of absences
// below is the security argument for the whole seam, so it is asserted by NAME:
// a future refactor that spreads `ctx` into the facade for convenience fails
// here rather than in somebody's incident review.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CONTEXT_API_VERSION, extensionContextV1 } from "../src/extensions/context-v1.mjs";
import { Refused } from "../src/errors.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";

const CAP = { id: "acme.rows", apiVersion: "orbit.capability/v1", from: "acme-probe", timeoutSec: 20 };

function facade({ store, run, cap = CAP, extra = {} } = {}) {
  const base = fakeContext();
  const proc = fakeProcess();
  const logged = [];
  const ctx = { ...base, process: proc, tools: fakeTools({ psql: { ok: true } }), warn: (m) => logged.push(m), ...(store ? { store: () => store } : {}), ...extra };
  return { ext: extensionContextV1(ctx, run ?? { values: { NAME: "demo" }, log: { record: (r) => logged.push(r) } }, cap), proc, logged, ctx };
}

// The list, by name. Everything absent here is absent on purpose.
const FORBIDDEN = ["memory", "store", "identity", "graph", "env", "config", "project", "db", "executors", "dsl", "capabilities", "validators", "warn", "now", "connections", "connectionEnv", "secrets", "credentials"];

test("the facade offers exactly the seven surfaces, and carries its own version", () => {
  const { ext } = facade();
  assert.equal(ext.apiVersion, CONTEXT_API_VERSION);
  assert.equal(ext.capability, "acme.rows");
  assert.deepEqual(Object.keys(ext).sort(), ["apiVersion", "bindings", "browser", "capability", "evidence", "log", "process", "storage", "tools"]);
});

// A capability that could reach the memory store could write the ledger, and a
// capability that could write the ledger could write a PASS.
test("nothing an extension must not see is reachable from it", () => {
  const { ext } = facade();
  for (const key of FORBIDDEN) assert.equal(ext[key], undefined, `${key} must not be on the public surface`);
});

test("the browser surface is three methods, not the browser port", () => {
  const { ext } = facade();
  assert.deepEqual(Object.keys(ext.browser).sort(), ["click", "evaluate", "fill", "truthy"]);
  for (const gone of ["open", "dir", "requestList", "shot", "session"]) assert.equal(ext.browser[gone], undefined, gone);
});

test("a spawn is argv-only, named with the capability, and carries its declared timeout", () => {
  const { ext, proc } = facade();
  ext.process.run("psql", ["-c", "SELECT 1; DROP TABLE x"]);
  assert.deepEqual(proc.calls[0].args, ["-c", "SELECT 1; DROP TABLE x"], "one argument, never a second command");
  assert.equal(proc.calls[0].opts.by, "acme.rows");
  assert.equal(proc.calls[0].opts.timeoutMs, 20000, "the capability's own declared budget");
});

test("a caller may shorten the timeout but the capability's is the default", () => {
  const { ext, proc } = facade();
  ext.process.run("psql", [], { timeoutMs: 500 });
  assert.equal(proc.calls[0].opts.timeoutMs, 500);
});

test("bindings are readable and not writable — a run may not rewrite its own question", () => {
  const { ext } = facade();
  assert.equal(ext.bindings.get("NAME"), "demo");
  assert.deepEqual(ext.bindings.names(), ["NAME"]);
  assert.equal(ext.bindings.set, undefined);
  assert.equal(ext.bindings.bind, undefined);
});

// An extension echoing a connection string into evidence is exactly the accident
// src/scrub.mjs exists for, and an extension cannot be trusted to have remembered.
test("what an extension records is scrubbed on the way in, and marked as its own", () => {
  const { ext, logged } = facade();
  ext.evidence.record("connected with password=hunter2 ok");
  assert.equal(logged[0].kind, "capability");
  assert.equal(logged[0].by, "acme.rows");
  assert.doesNotMatch(logged[0].note, /hunter2/);
  ext.log.warn("token=abc.def.ghi expired");
  assert.doesNotMatch(logged[1], /abc\.def\.ghi/);
  assert.match(logged[1], /^acme\.rows: /);
});

// Whatever string it builds, an extension's scratch space is its own.
test("scratch storage cannot reach outside the extension's own directory", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-scratch-"));
  const { ext } = facade({ store: root });
  const mine = ext.storage.temp("probe.json");
  assert.ok(mine.startsWith(join(root, "scratch", "acme.rows")), mine);
  for (const escape of ["../../../etc/passwd", "../other/secret"]) {
    assert.throws(() => ext.storage.temp(escape), Refused, escape);
  }
  // An absolute-looking name is not a traversal: join() reads a leading slash as
  // a segment, so "/etc/passwd" becomes a file INSIDE the scratch directory. The
  // guard still holds, which is the only thing that matters — but it holds by
  // landing the write somewhere harmless rather than by refusing it.
  assert.ok(ext.storage.temp("/etc/passwd").startsWith(join(root, "scratch")));
  rmSync(root, { recursive: true, force: true });
});

test("two capabilities get two scratch directories", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-scratch-"));
  const mine = facade({ store: root }).ext.storage.temp("x");
  const base = fakeContext();
  const theirs = extensionContextV1({ ...base, store: () => root, process: fakeProcess() }, {}, { id: "other.thing" }).storage.temp("x");
  assert.notEqual(mine, theirs);
  rmSync(root, { recursive: true, force: true });
});

// ---- the credential of a connection -------------------------------------------------------

const CONNECTED = { ...CAP, id: "tracker.read", connection: "tracker-a" };
const ENV = { PATH: "/usr/bin", TRACKER_TOKEN: "SENTINEL-VALUE" };
const connectionEnv = (provider) => (provider === "tracker-a" ? ENV : undefined);

test("a capability that declared a connection has its credential in the environment of the command it spawns, and nowhere it can read", () => {
  const { ext, proc } = facade({ cap: CONNECTED, extra: { connectionEnv } });
  ext.process.run("tracker", ["--id", "88"]);
  assert.deepEqual(proc.calls[0].opts.env, ENV);
  assert.equal(JSON.stringify(Object.keys(ext)).includes("token"), false);
  for (const surface of Object.values(ext)) assert.doesNotMatch(JSON.stringify(surface ?? null), /SENTINEL-VALUE/, "no surface holds the value");
});

test("an extension cannot supply or override the environment its command runs in", () => {
  const { ext, proc } = facade({ cap: CONNECTED, extra: { connectionEnv } });
  ext.process.run("tracker", [], { env: { TRACKER_TOKEN: "attacker" }, cwd: "/" });
  assert.deepEqual(proc.calls[0].opts.env, ENV, "the engine's environment wins");
  assert.equal("cwd" in proc.calls[0].opts, false, "and options the facade never offered still are not forwarded");
  const plain = facade({ extra: { connectionEnv } });
  plain.ext.process.run("psql", [], { env: { X: "1" } });
  assert.equal("env" in plain.proc.calls[0].opts, false, "no connection declared, so no environment reaches it, and its own is dropped");
});

test("with no connection declared, or none bound, nothing is added -- exactly what it was before", () => {
  const none = facade({ cap: CONNECTED });
  none.ext.process.run("tracker", []);
  assert.equal("env" in none.proc.calls[0].opts, false);
  const other = facade({ cap: { ...CONNECTED, connection: "tracker-b" }, extra: { connectionEnv } });
  other.ext.process.run("tracker", []);
  assert.equal("env" in other.proc.calls[0].opts, false, "a connection nobody bound gives no environment");
});
