// THE AUTONOMOUS SHIP (skills/orbit-release/ship.mjs, ADR 0049), driven end to end through its own state machine over a
// world of its own (test/fakes/ship-world.mjs): a primary checkout with a defect planted in its source, the REAL git
// and the REAL release workspace, an in-memory task door holding the real door's rules, and a benchmark double that
// judges the tree it is pointed at. The twelve things a release must hold, one test each -- and through all of them,
// the person's checkout byte for byte as it was. Nothing here reaches Docker, a model or a network, and nothing here
// spawns ship.mjs (which runs `node --test` itself).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { shippable } from "../skills/orbit-release/gates.mjs";
import { acceptanceOf as backendAcceptanceOf } from "../skills/orbit-release/backend.mjs";
import { acceptanceOf as hostAcceptanceOf, optional } from "../skills/orbit-release/hosts.mjs";
import { AWAITED, ciVerdict, markOf } from "../skills/orbit-release/ship/ci.mjs";
import { begunShip, evidenceAsked, resumedShip, statusOf } from "../skills/orbit-release/ship/session.mjs";
import { driven } from "../skills/orbit-release/ship/steps.mjs";
import { authorize, isAuto } from "../src/protected/authorize.mjs";
import { INTEGRATION } from "../skills/orbit-release/ship/workspace.mjs";
import { adds, GIT_ENV, headOf, refsOf, shipWorldOf, statusOf as gitStatus } from "./fakes/ship-world.mjs";
import { sealed } from "./home.mjs";

const OPTS = { repair: true, failFast: true, limits: {}, version: "9.9.9" };

const ADDING = { "src/calc.mjs": "export const add = (a, b) => a + b;\n" };

const shipped = async (w, o = {}) => ((ctx) => driven(ctx).then((result) => ({ ctx, result })))(begunShip(w.world, { ...OPTS, ...o }));

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" }).trim();

// The person's checkout, as it must stay: its tree, its HEAD and every ref, unchanged by anything a ship does.
const untouched = (w) => ({ status: gitStatus(w.repo), head: headOf(w.repo), refs: refsOf(w.repo), calc: readFileSync(join(w.repo, "src", "calc.mjs"), "utf8") });

const evidenceOf = (ctx) => JSON.parse(readFileSync(ctx.room.at("evidence.json"), "utf8"));

const ran = (w, pred) => w.calls.filter((c) => c.verb === "run" && pred(c));

const allMatched = () => [{ id: "planted", variant: "controlled-fault", expect: "FAIL", got: "FAIL", matched: true }, { id: "allow-all", variant: "real", expect: "FAIL", got: "FAIL", matched: true }];

// ---- 1 --------------------------------------------------------------------------------------------------------------------

test("1. every mandatory row passes -> SHIPPABLE, its evidence names the very commit it ran on, and the checkout is untouched", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched } });
  w.repo && git(w.repo, "status");
  const before = untouched(w);
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  const ev = evidenceOf(ctx);
  assert.equal(ev.source.commit, before.head, "no repair: the release commit is the one the ship began from");
  assert.equal(ev.delivery.needed, false);
  assert.deepEqual(ev.rows.map((r) => [r.id, r.state]).sort(), ["CALC-001:controls", "CALC-001:real", "CALC-001:self-healing", "CALC-002:controls", "CALC-002:real", "QA-001:autonomous", "QA-001:controls"].map((id) => [id, "HELD"]).sort());
  assert.deepEqual(ev.rows.filter((r) => ["QA-001:autonomous", "CALC-001:self-healing"].includes(r.id)).map((r) => [r.basis, r.cli, r.model]), [["coding-host", "2.1.314", "claude-test"], ["coding-host", "2.1.314", "claude-test"]]);
  assert.deepEqual(w.calls.filter((c) => c.verb === "run" || c.verb === "controls").map((c) => (c.verb === "controls" ? "controls" : c.kind)), ["verify", "verify", "controls", "controls", "controls", "autonomous", "selfHealing"], "verifications, then controls, then the model-carried rows -- in the policy's order");
  assert.equal(w.door.show(ctx.task).lifecycle, "COMPLETED");
  assert.deepEqual(untouched(w), before, "the person's checkout is byte for byte as it was");
});

// ---- 2 --------------------------------------------------------------------------------------------------------------------

test("2. a source failure -> repair by the coding host -> integrated in the ship's own workspace -> rebuild and full retest -> SHIPPABLE", async (t) => {
  const w = shipWorldOf(t);
  const before = untouched(w);
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  const ev = evidenceOf(ctx);
  assert.notEqual(ev.source.commit, before.head, "the qualified commit carries the repair");
  assert.deepEqual(ev.repairs.map((r) => [r.case, r.paths.sort()]), [["CALC-002", ["src/calc.mjs", "test/calc-regression.test.mjs"]]]);
  assert.equal(ran(w, (c) => c.kind === "autonomous" && c.commit === before.head).length, 0, "no model-carried row ran on a cycle a repair invalidated");
  assert.ok(ran(w, (c) => c.kind === "repair" && c.case === "CALC-002").length === 1, "one repair, through the benchmark's repair path");
  assert.ok(["verify", "autonomous", "selfHealing"].every((k) => ran(w, (c) => c.kind === k && c.commit === ev.source.commit).length > 0), "the full retest ran every kind of row on the repaired commit");
  const repair = JSON.parse(readFileSync(join(ctx.room.dir, "steps", w.door.show(ctx.task).actions.find((a) => a.type === "release.repair").id + ".json"), "utf8")).settled.verdict;
  assert.deepEqual([repair.state, repair.basis, repair.cli, repair.model, repair.costUsd], ["VERIFIED", "coding-host", "2.1.314", "claude-test", 2.5]);
  assert.deepEqual(ev.superseded, [{ case: "CALC-002", controls: ["known-good"] }], "the known finding's known-good control is superseded once its real source passes; allow-all still held");
  assert.ok(existsSync(ev.delivery.patch) && existsSync(ev.delivery.bundle) && ev.delivery.needed);
  assert.deepEqual(untouched(w), before, "the repair went into the ship's workspace, never the person's checkout");
  const clone = join(mkdtempSync(join(w.base, "apply-")), "c");
  git(w.base, "clone", "-q", w.repo, clone);
  git(clone, "am", "-q", ev.delivery.patch);
  assert.equal(git(clone, "rev-parse", "HEAD^{tree}"), ev.source.tree, "the release patch, applied by a person, is exactly the qualified tree");
  assert.deepEqual(w.door.show(ctx.task).attempts.map((a) => [a.cause, a.outcome]), [["fresh", "failed"], ["retest", "succeeded"]]);
});

// ---- 3 and 4 --------------------------------------------------------------------------------------------------------------

test("3. the runner's Claude Code is unavailable -> BLOCKED, nothing is benchmarked and no other host is tried", async (t) => {
  const w = shipWorldOf(t, { play: { host: { ok: false, code: "CLI_UNAVAILABLE", says: "the runner image names no Claude Code version" } } });
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["BLOCKED", 3]);
  assert.match(result.summary, /CLI_UNAVAILABLE/);
  assert.equal(w.calls.filter((c) => c.verb === "run" || c.verb === "controls").length, 0);
  assert.equal(w.door.show(ctx.task).lifecycle, "BLOCKED");
});

test("4. no credential by name -> BLOCKED at preflight before anything is built; a refused credential -> BLOCKED at the host check", async (t) => {
  const none = shipWorldOf(t, { env: { ANTHROPIC_API_KEY: "" } });
  const a = await shipped(none);
  assert.deepEqual([a.result.outcome, a.result.code, a.result.exit], ["BLOCKED", "AUTH_MISSING", 3]);
  assert.equal(none.door.show(a.ctx.task).actions.filter((x) => x.type === "release.build").length, 0, "nothing was built");
  assert.equal((await statusOf(none.world, a.ctx.ship.id)).next, "PREFLIGHT", "a blocked ship's resume asks its preflight again first");
  const refused = shipWorldOf(t, { play: { host: { ok: false, code: "AUTH_REFUSED", says: "Invalid API key" } } });
  const b = await shipped(refused);
  assert.deepEqual([b.result.outcome, b.result.exit], ["BLOCKED", 3]);
  assert.match(b.result.summary, /AUTH_REFUSED/);
  assert.equal(refused.calls.filter((c) => c.verb === "run").length, 0);
});

// ---- 5 and 6 --------------------------------------------------------------------------------------------------------------

test("5. every scripted control holds, but a model-carried row was not carried by the real coding host -> NOT SHIPPABLE", async (t) => {
  const scripted = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, basis: (c, kind) => (kind === "autonomous" ? "scripted" : "coding-host") } });
  const a = await shipped(scripted);
  assert.deepEqual([a.result.outcome, a.result.exit], ["NOT_SHIPPABLE", 2]);
  assert.match(a.result.summary, /QA-001:autonomous cannot be evidence: .*basis scripted/);
  const anonymous = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous: () => ({ outcome: "PASS", summary: "PASS", host: { version: null, model: null, costUsd: 1 } }) } });
  const b = await shipped(anonymous);
  assert.equal(b.result.outcome, "NOT_SHIPPABLE", "a PASS with no Claude Code identity is no evidence of the coding host");
});

test("6. Grok, Antigravity and Codex unavailable, backend acceptance stale -> no effect on whether a release qualifies", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched } });
  w.world.optional = [optional(hostAcceptanceOf({ schema: 1, sourceDigest: "older", hosts: [{ id: "claude", version: "2.1.314", nativeDispatch: true, controlStopped: true, uninstallPreservedStore: true, sanitizedFixtures: true }] }, "now")), optional(backendAcceptanceOf(null, "now", [{ stack: "invoice-a", variant: "correct" }]))];
  assert.ok(w.world.optional.every((r) => r.ok === false && r.required === false), "no host record and no backend record here");
  const { ctx, result } = await shipped(w);
  assert.equal(result.outcome, "SHIPPABLE");
  assert.deepEqual(evidenceOf(ctx).optional.map((r) => r.required), [false, false]);
  const gates = [{ name: "the suite", ok: true }, ...w.world.optional];
  assert.equal(shippable(gates), true, "an optional row never stops a release");
  assert.deepEqual(gates.map(markOf), ["ok  ", "opt ", "opt "]);
});

// ---- 7, 11 and 12 ---------------------------------------------------------------------------------------------------------

test("7 + 11. the evidence is bound to the exact source: publishable on that tree, stale the moment the checkout moves", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched } });
  const { ctx } = await shipped(w);
  const ev = evidenceOf(ctx);
  for (const r of ev.rows.filter((x) => x.run && !x.id.endsWith(":controls"))) assert.equal(JSON.parse(readFileSync(join(w.store, "benchmark", r.run, "manifest.json"), "utf8")).source.commit, ev.source.commit, `${r.id} ran on the qualified commit`);
  assert.deepEqual(await publishable(w), [true, "PUBLISHABLE"]);
  writeFileSync(join(w.repo, "src", "calc.mjs"), "export const add = (a, b) => a + b + 0;\n");
  assert.deepEqual(await publishable(w), [false, "DIRTY"], "an uncommitted change is not what was qualified");
  git(w.repo, "commit", "-qam", "a change after the ship");
  assert.deepEqual(await publishable(w), [false, "TREE_MOVED"], "a new commit invalidates the evidence");
});

const publishable = async (w, id = null, artifact = null) => ((e) => [e.publishable, e.code])(await evidenceAsked(w.world, id, artifact));

test("11. the gate trusts no evidence as written: a run's room that no longer agrees, or another artifact, is refused", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched } });
  const { ctx } = await shipped(w);
  const ev = evidenceOf(ctx);
  assert.deepEqual(await publishable(w, null, ev.artifact.file), [true, "PUBLISHABLE"], "the very archive, by its content");
  const auto = ev.rows.find((r) => r.id === "QA-001:autonomous");
  const ending = join(w.store, "benchmark", auto.run, "ending.json");
  writeFileSync(ending, JSON.stringify({ ...JSON.parse(readFileSync(ending, "utf8")), outcome: "FAIL" }));
  assert.deepEqual(await publishable(w), [false, "UNTRUSTED"]);
  writeFileSync(ending, JSON.stringify({ ...JSON.parse(readFileSync(ending, "utf8")), outcome: "PASS" }));
  writeFileSync(ev.artifact.file, "not the archive");
  assert.deepEqual(await publishable(w), [false, "ARTIFACT_MISSING"]);
});

test("12. nothing is publishable while the ship's verification is pending, blocked or failed -- and a fast CI is never qualification", async (t) => {
  const pending = shipWorldOf(t, { files: { ...ADDING } });
  begunShip(pending.world, OPTS);
  assert.deepEqual(await publishable(pending), [false, "PENDING"]);
  const blocked = shipWorldOf(t, { env: { ANTHROPIC_API_KEY: "" } });
  await shipped(blocked);
  assert.deepEqual(await publishable(blocked), [false, "BLOCKED"]);
  const failed = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, basis: () => "scripted" } });
  await shipped(failed);
  assert.deepEqual(await publishable(failed), [false, "NOT_SHIPPABLE"]);
  const none = shipWorldOf(t);
  assert.deepEqual(await publishable(none), [false, "NO_SHIP"]);
  assert.equal(markOf(AWAITED), "wait");
  assert.match(ciVerdict([{ ok: true }, AWAITED]), /release qualification is awaited/);
  assert.doesNotMatch(ciVerdict([{ ok: true }, AWAITED]), /^shippable/i, "the fast tier never says a release qualified");
});

// ---- 8 and 9 --------------------------------------------------------------------------------------------------------------

test("8. a repair that breaks another case is never shipped: the full retest finds it and the release stops", async (t) => {
  const w = shipWorldOf(t, { play: { verify: (c, tree) => (c === "CALC-002" && !adds(tree) ? { outcome: "FAIL", cause: "ORBIT_SOURCE_DEFECT", class: "ORBIT_SOURCE_DEFECT", summary: "FAIL — add() subtracts" } : c === "CALC-001" && adds(tree) ? { outcome: "FAIL", cause: "GATE_UNEXPLAINED", class: "UNKNOWN", summary: "FAIL — a gate broke" } : { outcome: "PASS", summary: "PASS" }) } });
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["NOT_SHIPPABLE", 2]);
  assert.match(result.summary, /CALC-001:real/);
  assert.equal(existsSync(ctx.room.at("evidence.json")), false, "no evidence of a source that regressed");
  assert.equal(ran(w, (c) => c.kind === "autonomous").length, 0, "no model spent on a release that cannot ship");
});

test("9. a candidate that hides a defect by touching a test or the harness is never integrated, whatever its run says", async (t) => {
  const rejected = shipWorldOf(t, { play: { repair: () => ({ outcome: "REPAIR_REJECTED", summary: "REPAIR_REJECTED: scope TEST_WEAKENED test/calc.test.mjs", signature: `${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`, host: { version: "2.1.314", model: "claude-test", costUsd: 1 } }) } });
  const a = await shipped(rejected);
  assert.deepEqual([a.result.outcome, a.result.exit], ["NOT_SHIPPABLE", 2]);
  assert.match(a.result.summary, /no repair attempt is left/);
  assert.equal(rejected.door.show(a.ctx.task).actions.filter((x) => x.type === "release.integrate").length, 0);
  const weakening = { outcome: "REPAIRED_VERIFIED", summary: "REPAIRED_VERIFIED", host: { version: "2.1.314", model: "claude-test", costUsd: 1 }, patch: { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "test/calc.test.mjs": 'import { test } from "node:test";\ntest("adds", () => {});\n' } };
  for (const [name, said, code] of [["weakens a test", weakening, "TEST_WEAKENED"], ["touches the harness", { ...weakening, patch: { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "benchmark/run.mjs": "// rewritten\n" } }, "OUT_OF_SCOPE"], ["brings another patch", { ...weakening, patch: { "src/calc.mjs": "export const add = (a, b) => a + b;\n" }, patchDigest: "0".repeat(64) }, "PATCH_DIGEST"]]) {
    const w = shipWorldOf(t, { play: { repair: () => said } });
    const before = readFileSync(join(w.repo, "src", "calc.mjs"), "utf8");
    const { ctx, result } = await shipped(w);
    assert.ok(["NOT_SHIPPABLE", "NO_PROGRESS"].includes(result.outcome) && result.exit === 2, `${name}: ${result.outcome}`);
    const repairs = w.door.show(ctx.task).actions.filter((x) => x.type === "release.repair").map((x) => JSON.parse(readFileSync(ctx.room.at("steps", `${x.id}.json`), "utf8")).settled.verdict.code);
    assert.ok(repairs.every((c) => c === code), `${name}: refused by ${code}, got ${repairs}`);
    assert.equal(w.door.show(ctx.task).actions.filter((x) => x.type === "release.integrate").length, 0, `${name}: never integrated`);
    assert.equal(readFileSync(join(w.repo, "src", "calc.mjs"), "utf8"), before);
  }
});

// ---- 10 -------------------------------------------------------------------------------------------------------------------

test("10a. a spent budget blocks with the evidence kept; resumed with a higher limit, the ship goes on to SHIPPABLE", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched } });
  const { ctx, result } = await shipped(w, { limits: { usd: 1 } });
  assert.deepEqual([result.outcome, result.exit], ["BUDGET_EXHAUSTED", 3]);
  assert.equal(w.door.show(ctx.task).lifecycle, "BLOCKED");
  const again = await driven(resumedShip(w.world, ctx.ship.id, { limits: { usd: 50 } }));
  assert.deepEqual([again.outcome, again.exit], ["SHIPPABLE", 0]);
  assert.ok(existsSync(ctx.room.at("endings")), "the block it ended with is kept as history");
});

test("10b. two repairs of one case that fail with one signature are NO_PROGRESS, never a third try", async (t) => {
  const w = shipWorldOf(t, { policy: undefined, play: { repair: () => ({ outcome: "REPAIR_REJECTED", summary: "REPAIR_REJECTED: hidden checks still fail", signature: "bbbbbbbbbbbb", host: { version: "2.1.314", model: "claude-test", costUsd: 1 } }) } });
  const { result } = await shipped(w, { limits: { repairAttempts: 3 } });
  assert.deepEqual([result.outcome, result.exit], ["NO_PROGRESS", 2]);
  assert.equal(ran(w, (c) => c.kind === "repair").length, 2);
});

test("10c. a person's cancel while a row runs stops the child and removes its containers; the ship ends as the person held it", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, during: (world, r) => (r.kind === "autonomous" ? world.door.cancel(world.calls.ship) : null) } });
  const ctx = begunShip(w.world, OPTS);
  w.calls.ship = ctx.task;
  const result = await driven(ctx);
  assert.deepEqual([result.outcome, result.exit], ["CANCELLED", 4]);
  assert.equal(w.calls.filter((c) => c.verb === "cleanup").length, 1, "the child's containers removed by its label");
});

test("10d. paused mid-run, resumed in Control: the run is read back with resume, never sent again", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, during: (world, r) => (r.kind === "autonomous" && !world.paused ? ((world.paused = true), world.door.pause(world.calls.ship)) : null) } });
  const ctx = begunShip(w.world, OPTS);
  w.calls.ship = ctx.task;
  assert.deepEqual(((r) => [r.outcome, r.exit])(await driven(ctx)), ["PAUSED", 4]);
  w.door.resume(ctx.task);
  const result = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0]);
  assert.equal(ran(w, (c) => c.kind === "autonomous").length, 1, "the model-carried run was sent once");
  assert.equal(w.calls.filter((c) => c.verb === "resume").length, 1);
});

test("10e. a ship whose process died mid-run is carried on from its journal: the run is read back, never sent again", async (t) => {
  let died = false;
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, verify: (c) => (c === "CALC-001" && !died ? ((died = true), { outcome: "PASS", summary: "PASS", dies: true }) : { outcome: "PASS", summary: "PASS" }) } });
  const ctx = begunShip(w.world, OPTS);
  await assert.rejects(driven(ctx), /died/);
  const result = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0]);
  assert.equal(ran(w, (c) => c.case === "CALC-001" && c.kind === "verify").length, 1, "the verification that was running when the ship died ran once");
  assert.equal(w.calls.filter((c) => c.verb === "resume").length, 1);
});

// ---- the boundaries, and what a person reads ------------------------------------------------------------------------------

test("integrating is a write to the ship's own workspace -- AUTO -- and a ship never constructs a write to the person's checkout", () => {
  assert.ok(isAuto(authorize(INTEGRATION)));
  assert.equal(authorize({ ...INTEGRATION, home: "primary-checkout" }).decision, "deny", "the one write a ship could be tempted to make is the one the boundaries deny");
});

test("--status says where a ship stands, read from its journal, and writes nothing", async (t) => {
  const w = shipWorldOf(t);
  const { ctx } = await shipped(w);
  const s = await statusOf(w.world, null);
  assert.deepEqual([s.found, s.ship, s.lifecycle, s.cycle, s.repairs], [true, ctx.ship.id, "COMPLETED", 2, []]);
  assert.equal(s.ending.outcome, "SHIPPABLE");
  assert.equal((await statusOf(shipWorldOf(t).world, null)).found, false);
});
