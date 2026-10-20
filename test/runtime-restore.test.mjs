// Restoring a task's dependencies: what is restored is the CATALOG's to say, what is TRUSTED is a person's by the
// fingerprint of exactly what would run, and it runs argv-only, only in the workspace, clipped and scrubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { Refused } from "../src/errors.mjs";
import { RESTORE_TRUST, fingerprintOf, planOf, restore, trustOf } from "../src/runtime/sandbox/restore.mjs";
import { SANDBOX_DEFAULTS } from "../src/runtime/sandbox/policy.mjs";
import { memorySource } from "./fakes/source.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const plan = { component: "node:web", argv: ["npm", "ci"], cwd: "web", requires: "npm", scope: ["web/package.json", "web/package-lock.json"] };
const FILES = { "web/package.json": '{"name":"web"}', "web/package-lock.json": "{}" };

test("the fingerprint is the whole SHA-256 of the arguments, where they run and the files they rest on -- and moves with any of them", () => {
  const source = memorySource(FILES);
  const fp = fingerprintOf(plan, source);
  assert.match(fp, /^[a-f0-9]{64}$/);
  assert.equal(fingerprintOf({ ...plan }, memorySource(FILES)), fp, "the same plan over the same files is the same fingerprint");
  assert.notEqual(fingerprintOf(plan, memorySource({ ...FILES, "web/package-lock.json": '{"lockfileVersion":3}' })), fp, "an edited lock file");
  assert.notEqual(fingerprintOf({ ...plan, argv: ["npm", "install"] }, source), fp, "another command");
  assert.notEqual(fingerprintOf({ ...plan, cwd: "." }, source), fp, "another place");
});

test("a plan the index cannot name -- a file it does not hold -- has NO fingerprint, and a plan with none is never trusted", () => {
  assert.equal(fingerprintOf(plan, memorySource({ "web/package.json": "{}" })), null);
  assert.equal(trustOf({ plan, fingerprint: null, policy: SANDBOX_DEFAULTS, done: null }).name, "NO_PRINT");
});

test("the trust rows in order: nothing to fingerprint, already done, manual, not trusted -- and only then run", () => {
  const c = (over) => ({ plan, fingerprint: "a".repeat(64), policy: SANDBOX_DEFAULTS, done: null, ...over });
  const manual = { ...SANDBOX_DEFAULTS, restore: { mode: "manual", trusted: [] } };
  const trusted = { ...SANDBOX_DEFAULTS, restore: { mode: "approved", trusted: ["a".repeat(64)] } };
  assert.deepEqual(["NO_PRINT", "SKIPPED", "MANUAL", "UNTRUSTED", "TRUSTED"], [c({ fingerprint: null }), c({ done: "a".repeat(64), policy: trusted }), c({ policy: manual }), c(), c({ policy: trusted })].map((x) => trustOf(x).name));
  assert.deepEqual(RESTORE_TRUST.filter((r) => r.run).map((r) => r.name), ["TRUSTED"], "exactly one row runs anything");
  assert.ok(RESTORE_TRUST.every((r) => typeof r.say(c()) === "string") && RESTORE_TRUST.at(-1).when({}));
  assert.equal(trustOf(c()).needs, "person");
  assert.equal(trustOf(c({ policy: manual })).needs, null, "manual is said, and waits on nobody");
});

test("the untrusted sentence names the fingerprint and the command, so a person can read what they would be trusting", () => {
  const said = trustOf({ plan, fingerprint: "b".repeat(64), policy: SANDBOX_DEFAULTS, done: null }).say({ plan, fingerprint: "b".repeat(64) });
  assert.match(said, /npm ci/);
  assert.match(said, new RegExp("b".repeat(64)));
  assert.match(said, /Orbit Control/);
});

function ctxOf(proc, root = join("/store", "workspaces", "tsk-aaaaaaaaaaaa", "tree")) {
  let ms = 1000;
  return { process: proc, root, env: { PATH: "/usr/bin", HOME: "/home/x", SECRET_TOKEN: "s3cr3t-value" }, clock: () => (ms += 7) };
}

test("a restore runs argv-only through the Process port, in the workspace, with the base environment and nothing a person did not name", () => {
  const proc = fakeProcess({ npm: { ok: true, out: "added 3 packages\n", err: "", status: 0 } });
  const ctx = ctxOf(proc);
  const out = restore(ctx, plan, ["NPM_TOKEN"]);
  assert.deepEqual([out.ok, out.status, out.durationMs], [true, 0, 7]);
  const [call] = proc.calls;
  assert.deepEqual([call.file, call.args, call.opts.cwd], ["npm", ["ci"], resolve(ctx.root, "web")]);
  assert.ok(!("SECRET_TOKEN" in call.opts.env), "a variable nobody named for the component is not handed to it");
  assert.ok(call.opts.timeoutMs > 0 && call.opts.maxBuffer > 0, "bounded in time and in output");
});

test("a plan can never run outside the workspace: a directory that climbs out is refused before anything is started", () => {
  const proc = fakeProcess();
  assert.throws(() => restore(ctxOf(proc), { ...plan, cwd: join("..", "..") }, []), Refused);
  assert.deepEqual(proc.calls, []);
});

test("what a restore printed is scrubbed and clipped before it is kept, and a failed one says it did not work", () => {
  const long = `${"x".repeat(300 * 1024)}\nPASSWORD=hunter2 token=ghp_abcdefghijklmnopqrstuvwxyz0123456789ab\n`;
  const out = restore(ctxOf(fakeProcess({ npm: { ok: false, out: long, err: "ERR!", status: 1 } })), plan, []);
  assert.equal(out.ok, false);
  assert.ok(out.log.length <= 256 * 1024);
  assert.ok(!/hunter2|ghp_abc/.test(out.log), "masked by shape, not by name");
});

test("a component with a restore command has a plan; one without has none", () => {
  assert.deepEqual(planOf({ key: "node:web", restore: { argv: ["npm", "ci"], cwd: "web", runner: "npm", scope: ["a"] } }), { component: "node:web", argv: ["npm", "ci"], cwd: "web", requires: "npm", scope: ["a"] });
  assert.equal(planOf({ key: "x", restore: null }), null);
});
