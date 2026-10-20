// Trust is a standing permission, so it is a person's and only through Orbit Control -- the 1.7.7 rule for every grant --
// by the fingerprint of exactly what would run, through the same revisioned write as every other setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../src/errors.mjs";
import { COMMANDS, COMMAND_NAMES, governed } from "../src/runtime/index.mjs";
import { OPERATIONS, classOf, needsControl, needsHuman, needsTrust } from "../src/runtime/governance.mjs";
import { DEFINITION_TRUST, definitionFingerprint, definitionTrust, trust } from "../src/runtime/sandbox/trust.mjs";
import { SANDBOX_DEFAULTS, TRUST_KINDS, effectivePolicy, isTrusted, sandboxFilled, sandboxProblems } from "../src/runtime/sandbox/policy.mjs";
import { fakeRuntime } from "./fakes/runtime-ctx.mjs";

const FP = "a".repeat(64);
const OTHER = "b".repeat(64);

const control = () => ((rt) => ({ ...rt, ctx: { ...rt.ctx, door: "control" } }))(fakeRuntime({}, {}));

const grant = (rt, over = {}) => trust(rt.ctx, { kind: "restore", fingerprint: FP, revoke: false, revision: rt.ctx.readSettings().revision, ...over });

test("only Control's door grants it: a terminal's context is refused before a setting is read", () => {
  const { ctx } = fakeRuntime({}, {});
  const poked = new Proxy(ctx, { get: (t, k) => (k === "readSettings" || k === "writeSettings" ? () => { throw new Error("read or written before the door was checked"); } : t[k]) });
  assert.throws(() => trust(poked, { kind: "restore", fingerprint: FP, revoke: false, revision: null }), (e) => e instanceof Refused && /a terminal cannot prove one/.test(e.message));
});

test("a grant lands in the person's settings by kind, and revoking takes it away -- with every other setting exactly as it was", () => {
  const rt = control();
  const before = rt.ctx.readSettings().settings;
  const kept = grant(rt);
  assert.deepEqual(kept.settings.sandbox.restore.trusted, [FP]);
  assert.deepEqual({ ...kept.settings, sandbox: before.sandbox }, before);
  const also = grant(rt, { kind: "definition", fingerprint: OTHER, revision: kept.revision });
  assert.deepEqual([also.settings.sandbox.trustedDefinitions, also.settings.sandbox.restore.trusted], [[OTHER], [FP]]);
  const gone = grant(rt, { revoke: true, revision: also.revision });
  assert.deepEqual([gone.settings.sandbox.restore.trusted, gone.settings.sandbox.trustedDefinitions], [[], [OTHER]]);
});

test("a stale revision is refused and changes nothing; a kind or a fingerprint that is not one is refused first", () => {
  const rt = control();
  const first = grant(rt);
  assert.throws(() => grant(rt, { fingerprint: OTHER, revision: "0".repeat(16) }), /revision|changed|stale/i);
  assert.deepEqual(rt.ctx.readSettings().settings.sandbox.restore.trusted, [FP]);
  assert.throws(() => grant(rt, { kind: "shell", revision: first.revision }), /no kind of trust/);
  assert.throws(() => grant(rt, { fingerprint: "abc", revision: first.revision }), /64 lowercase hex/);
  assert.throws(() => grant(rt, { revision: undefined }), /name the revision/);
});

test("the policy refuses a fingerprint that is not a whole SHA-256, a mode nobody offers and a browser strategy this release does not have", () => {
  assert.deepEqual(sandboxProblems(sandboxFilled({})), []);
  const bad = (over) => sandboxProblems({ ...sandboxFilled({}), ...over })[0];
  assert.match(bad({ restore: { mode: "approved", trusted: ["a".repeat(16)] } }), /64-character/);
  assert.match(bad({ restore: { mode: "force", trusted: [] } }), /restore is/);
  assert.match(bad({ qa: { modes: [], entry: null, browser: "approved-profile-copy" } }), /not offered yet/);
  assert.match(bad({ ports: { mode: "lease", from: 80, to: 90 } }), /1024 to 65535/);
  assert.match(bad({ ports: { mode: "lease", from: 42000, to: 45000 } }), /at most 2000/);
  assert.match(bad({ limits: { active: 99 } }), /active: 1 to 10/);
  assert.match(bad({ surprise: true }), /unknown setting surprise/);
});

test("what a person left unsaid is filled by level, and the engine's hard rules ride over every block", () => {
  assert.deepEqual(sandboxFilled({ restore: { mode: "manual" } }).restore, { mode: "manual", trusted: [] });
  assert.deepEqual(sandboxFilled(undefined), SANDBOX_DEFAULTS);
  const { policy } = effectivePolicy({ sandbox: { network: { denyProductionWrites: false } }, revision: "r1" });
  assert.deepEqual([policy.hard.listen, policy.hard.reuseExternal, policy.hard.restoreCheckout, policy.hard.stopOnlyOwned], ["127.0.0.1", false, false, true], "nothing a person set can reach these");
  assert.equal(isTrusted({ ...SANDBOX_DEFAULTS, restore: { mode: "approved", trusted: [FP] } }, "restore", FP), true);
  assert.equal(isTrusted(SANDBOX_DEFAULTS, "nothing", FP), false);
  assert.deepEqual(TRUST_KINDS.map((k) => k.kind), ["restore", "definition"]);
});

test("a definition is trusted by the fingerprint of every file it is built from, so an edited one asks again", () => {
  const files = { ".devcontainer/devcontainer.json": "fp1", "Dockerfile": "fp2" };
  const fp = definitionFingerprint(files);
  assert.match(fp, /^[a-f0-9]{64}$/);
  assert.notEqual(definitionFingerprint({ ...files, Dockerfile: "fp3" }), fp);
  assert.equal(definitionFingerprint({}), null);
  const row = (c) => definitionTrust({ fingerprint: fp, policy: SANDBOX_DEFAULTS, ...c }).name;
  assert.deepEqual([row({ fingerprint: null }), row({ policy: { ...SANDBOX_DEFAULTS, trustedDefinitions: [fp] } }), row({})], ["NO_DEFINITION", "TRUSTED", "UNTRUSTED"]);
  assert.ok(DEFINITION_TRUST.every((r) => typeof r.say({ fingerprint: fp }) === "string") && DEFINITION_TRUST.at(-1).when({}));
  assert.match(definitionTrust({ fingerprint: fp, policy: SANDBOX_DEFAULTS }).say({ fingerprint: fp }), /initializeCommand|runs commands its own definition names/);
});

test("governance says what each sandbox command is and who may ask: a preparation under trust, a release nobody has to approve, and a grant only Control makes", () => {
  assert.equal(classOf("sandbox-prepare").class, "SANDBOX_PREPARE");
  assert.deepEqual([needsTrust("sandbox-prepare"), needsControl("trust"), needsHuman("trust"), needsControl("sandbox-prepare")], [true, true, false, false]);
  assert.deepEqual([classOf("sandbox-release").class, classOf("sandbox-start").class, classOf("sandbox-stop").class, classOf("sandboxes").class], ["RELEASE_SANDBOX", "START_RUNTIME", "STOP_OWNED_RUNTIME", "READ"]);
  assert.deepEqual(OPERATIONS.flatMap((o) => o.commands).filter((c) => !COMMAND_NAMES.includes(c)), [], "every governed command exists");
  assert.deepEqual(COMMAND_NAMES.filter((c) => !classOf(c)), [], "and every command is governed once");
  for (const { command, mutates } of governed()) assert.equal(COMMANDS[command].writes, mutates === "none" ? "nothing" : mutates, `${command} writes what its class says`);
});
