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
import { INTERRUPTED_RUNS } from "../skills/orbit-release/ship/diagnose.mjs";
import { saidStatus } from "../skills/orbit-release/ship/report.mjs";
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

test("10d. a model-carried row a person allowed one more run is run again -- the row waiting for it never blocks its own retry", async (t) => {
  let runs = 0;
  const autonomous = () => (++runs === 1 ? { outcome: "FAIL", summary: "FAIL — a planted defect was not found", host: { version: "2.1.314", model: "claude-test", costUsd: 1 } } : { outcome: "PASS", summary: "PASS — the investigation found what was planted", host: { version: "2.1.314", model: "claude-test", costUsd: 1 } });
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous } });
  const { result } = await shipped(w, { limits: { autonomousRetries: 1 } });
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0]);
  assert.equal(runs, 2, "the missed row ran once more, and its PASS is what holds");
});

test("10e. with no retry allowed a model-carried miss still ends the ship NOT SHIPPABLE", async (t) => {
  const autonomous = () => ({ outcome: "FAIL", summary: "FAIL — a planted defect was not found", host: { version: "2.1.314", model: "claude-test", costUsd: 1 } });
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous } });
  const { result } = await shipped(w, {});
  assert.deepEqual([result.outcome, result.exit], ["NOT_SHIPPABLE", 2]);
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

// ---- 13: a restart interrupts a model-carried run -------------------------------------------------------------------------

const HOST = { version: "2.1.314", model: "claude-test", costUsd: 1.25 };

// What a run's resume reads back of a round a restart killed: what the investigation came to, and no host at all.
const READ_BACK = { outcome: "PASS", summary: "PASS — found 1/1 · false alarms 0 · coverage 78%", interrupted: true };

const rowDocs = (w, ctx, id) => w.door.show(ctx.task).actions.filter((a) => a.type === "release.row").map((a) => JSON.parse(readFileSync(ctx.room.at("steps", `${a.id}.json`), "utf8"))).filter((d) => d.row === id);

test("13. a worker restart interrupts a model-carried run: read back with no identity it is never evidence and never the model's miss -- the row runs again, fresh, and holds on that run's own PASS", async (t) => {
  let n = 0;
  // 1: the run the restart killed mid-round · 2: its read-back on resume (run.mjs resume) · 3: the row's fresh run.
  const autonomous = () => [{ outcome: "PASS", summary: "PASS", dies: true }, READ_BACK, { outcome: "PASS", summary: "PASS — the investigation found what was planted", host: HOST }][n++];
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous } });
  const ctx = begunShip(w.world, OPTS);
  await assert.rejects(driven(ctx), /died/, "the worker restarted: every process is gone, the files survive");
  const result = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  assert.equal(w.calls.filter((c) => c.verb === "resume").length, 1, "the interrupted run was read back once, never sent again");
  const docs = rowDocs(w, ctx, "QA-001:autonomous");
  assert.deepEqual(docs.map((d) => d.settled.verdict.code), ["INTERRUPTED", "HELD"], "INTERRUPTED -- never UNTRUSTED/WRONG_HOST ending the release -- then a fresh run");
  assert.notEqual(docs[0].planned.run, docs[1].planned.run, "a new run, never the interrupted one again");
  assert.equal(w.door.show(ctx.task).verification.find((v) => v.subject === "QA-001:autonomous").state, "not-verified", "an interrupted run proved nothing either way: not verified, never violated");
  const row = evidenceOf(ctx).rows.find((r) => r.id === "QA-001:autonomous");
  assert.deepEqual([row.run, row.basis, row.cli, row.model, row.runs], [docs[1].planned.run, "coding-host", "2.1.314", "claude-test", 2], "what holds the row is the fresh run's own PASS, with its identity proven");
  assert.equal(ran(w, (c) => c.kind === "autonomous").length, 2, "with --retries 0: the interruption spent none of the model's retries");
});

test("14. an interrupted run that says another host stays WRONG_HOST: never run again into evidence, and the release stops", async (t) => {
  const scripted = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous: () => READ_BACK, basis: (c, kind) => (kind === "autonomous" ? "scripted" : "coding-host") } });
  const a = await shipped(scripted, { limits: { autonomousRetries: 3 } });
  assert.deepEqual([a.result.outcome, a.result.exit], ["NOT_SHIPPABLE", 2]);
  assert.match(a.result.summary, /QA-001:autonomous cannot be evidence: .*basis scripted/);
  assert.equal(ran(scripted, (c) => c.kind === "autonomous").length, 1, "never run again, whatever --retries allows");
  const otherCli = { outcome: "REPAIRED_VERIFIED", summary: "REPAIRED_VERIFIED", rounds: [{ interrupted: true, host: null }, { host: { started: true, version: "2.1.300", model: "claude-test", costUsd: 1 } }] };
  const mixed = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, selfHealing: () => otherCli } });
  const b = await shipped(mixed, { limits: { autonomousRetries: 3 } });
  assert.deepEqual([b.result.outcome, b.result.exit], ["NOT_SHIPPABLE", 2]);
  assert.deepEqual(rowDocs(mixed, b.ctx, "CALC-001:self-healing").map((d) => d.settled.verdict.code), ["WRONG_HOST"], "a round that says another Claude Code is another host, interrupted round or not");
});

test("15. a row a restart interrupts every time runs again INTERRUPTED_RUNS times, then BLOCKS the ship with every run kept; a person's resume runs it once more", async (t) => {
  let n = 0;
  const autonomous = () => (++n <= INTERRUPTED_RUNS + 1 ? READ_BACK : { outcome: "PASS", summary: "PASS", host: HOST });
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous } });
  const { ctx, result } = await shipped(w, { limits: { autonomousRetries: 3 } });
  assert.deepEqual([result.outcome, result.exit], ["BLOCKED", 3], result.summary);
  assert.match(result.summary, new RegExp(`QA-001:autonomous: a restart interrupted ${INTERRUPTED_RUNS + 1} runs of it`));
  assert.equal(ran(w, (c) => c.kind === "autonomous").length, INTERRUPTED_RUNS + 1, "bounded by its own constant, never by --retries: no loop");
  assert.deepEqual([w.door.show(ctx.task).lifecycle, w.door.show(ctx.task).stopReason], ["BLOCKED", "ENVIRONMENT_BLOCKED"], "the environment, never the release, is what failed");
  assert.equal((await statusOf(w.world, ctx.ship.id)).rows.failed[0], "QA-001:autonomous INTERRUPTED");
  const again = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([again.outcome, again.exit], ["SHIPPABLE", 0], again.summary);
  assert.equal(ran(w, (c) => c.kind === "autonomous").length, INTERRUPTED_RUNS + 2, "one more run for the person's resume, and it held on its own PASS");
});

test("16. a row its environment blocked runs again when a person resumes the ship -- 'fix it and --resume' -- as a new run", async (t) => {
  let n = 0;
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, verify: (c) => (c === "CALC-001" && ++n === 1 ? { outcome: "BLOCKED", summary: "BLOCKED — Docker did not answer", class: "ENVIRONMENT_BLOCKED" } : { outcome: "PASS", summary: "PASS" }) } });
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["BLOCKED", 3]);
  const again = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([again.outcome, again.exit], ["SHIPPABLE", 0], again.summary);
  assert.equal(ran(w, (c) => c.case === "CALC-001" && c.kind === "verify").length, 2, "the blocked row was asked again, once");
  assert.equal(w.door.show(ctx.task).actions.filter((a) => a.type === "release.resume").length, 1, "the resume is in the ship's journal, where the fold reads it");
});

test("17. a restart between a run's ending and its report: the room is carried on by resume -- never judged without the report that says its host and its leaks", async (t) => {
  let n = 0;
  const autonomous = (leaks) => () => (n++ === 0 ? { outcome: "PASS", summary: "PASS", host: HOST, diesAfterEnding: true } : { outcome: "PASS", summary: "PASS", host: HOST, leaks });
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous: autonomous([]) } });
  const ctx = begunShip(w.world, OPTS);
  await assert.rejects(driven(ctx), /died/);
  const result = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  assert.deepEqual([w.calls.filter((c) => c.verb === "resume").length, ran(w, (c) => c.kind === "autonomous").length], [1, 1], "its tail done again by resume, the run itself never sent again");
  n = 0;
  const leaked = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous: autonomous(["rounds/1/out/host.jsonl (masked)"]) } });
  const c2 = begunShip(leaked.world, OPTS);
  await assert.rejects(driven(c2), /died/);
  assert.match((await driven(resumedShip(leaked.world, c2.ship.id, {}))).summary, /credential was found in 1 file/, "a leak the tail's scan finds is still a person's to look at");
});

// ---- the resume dead ends ship 14 found (0.5.0 backlog B6), each probed, then fixed -----------------------------------------

const actsOf = (w, ctx, type) => w.door.show(ctx.task).actions.filter((a) => a.type === type);

test("B6-1. images that could not be built are built again on resume -- a row never runs on images the cycle did not build", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, images: false } });
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["BLOCKED", 3], result.summary);
  w.play.images = true;
  const again = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([again.outcome, again.exit], ["SHIPPABLE", 0], again.summary);
  assert.equal(actsOf(w, ctx, "release.build").length, 2, "the resume asked for the images again, once");
  assert.ok(evidenceOf(ctx).harness.images?.length > 0, "the evidence names the images the rows ran on");
});

test("B6-2. a ship blocked at the host check asks the host again when a person resumes it -- once per resume, never in a loop", async (t) => {
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, host: { ok: false, code: "AUTH_REFUSED", says: "Invalid API key" } } });
  const { ctx, result } = await shipped(w);
  assert.deepEqual([result.outcome, result.exit], ["BLOCKED", 3]);
  const still = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([still.outcome, actsOf(w, ctx, "release.host").length], ["BLOCKED", 2], "a resume asks again; a host still refused blocks again, after one question");
  w.play.host = undefined;
  const again = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([again.outcome, again.exit], ["SHIPPABLE", 0], again.summary);
  assert.equal(actsOf(w, ctx, "release.host").length, 3);
});

test("B6-3. a run read back on resume is held to this cycle's content digest like any other -- the catalog is read before anything is reconciled", async (t) => {
  let died = false;
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, verify: (c) => (c === "CALC-002" && !died ? ((died = true), { outcome: "PASS", summary: "PASS", dies: true }) : { outcome: "PASS", summary: "PASS" }) } });
  const ctx = begunShip(w.world, OPTS);
  await assert.rejects(driven(ctx), /died/);
  const cut = ran(w, (c) => c.case === "CALC-002")[0].run;
  const manifest = join(w.store, "benchmark", cut, "manifest.json");
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  writeFileSync(manifest, JSON.stringify({ ...m, source: { ...m.source, digest: "d-content-the-cycle-never-froze" } }));
  const result = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([result.outcome, result.exit], ["NOT_SHIPPABLE", 2], result.summary);
  assert.deepEqual(rowDocs(w, ctx, "CALC-002:real").map((d) => d.settled.verdict.code), ["WRONG_TREE"], "the content digest CALC-001:real froze is what the read-back run is held to");
});

test("B6-4. after a resume the rows run in the cycle's testing stage, never in the ENVIRONMENT stage the preflight set", async (t) => {
  let died = false;
  const stages = [];
  const during = (world, r) => stages.push([r.kind, world.door.show(world.calls.ship).stage]);
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, during, verify: (c) => (c === "CALC-002" && !died ? ((died = true), { outcome: "PASS", summary: "PASS", dies: true }) : { outcome: "PASS", summary: "PASS" }) } });
  const ctx = begunShip(w.world, OPTS);
  w.calls.ship = ctx.task;
  await assert.rejects(driven(ctx), /died/);
  stages.length = 0;
  const result = await driven(resumedShip(w.world, ctx.ship.id, {}));
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  assert.deepEqual(stages, [["verify", "TESTING"], ["autonomous", "TESTING"], ["selfHealing", "TESTING"]], "Orbit Live shows the rows a resumed ship runs -- the one it reads back first among them -- as testing");
});

test("B6-5. a run a restart interrupted is never charged its whole allowance: its cost is said as unknown, and interruptions do not spend --usd", async (t) => {
  let n = 0;
  const autonomous = () => (++n <= 2 ? READ_BACK : { outcome: "PASS", summary: "PASS", host: HOST });
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous } });
  const { ctx, result } = await shipped(w, { limits: { usd: 12 } });
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  const docs = rowDocs(w, ctx, "QA-001:autonomous");
  assert.deepEqual(docs.map((d) => [d.settled.verdict.code, d.settled.cost.basis]), [["INTERRUPTED", "UNKNOWN"], ["INTERRUPTED", "UNKNOWN"], ["HELD", "REPORTED"]]);
  const s = await statusOf(w.world, ctx.ship.id);
  assert.deepEqual([s.spent.usd, s.spent.unknown], [2.01, 2], "what the hosts reported (the host check's cent among it), and how many runs' cost nobody could know");
  assert.match(saidStatus(s), /2 run\(s\) a restart interrupted/);
  assert.equal(evidenceOf(ctx).totals.unknownCost, 2, "the evidence says it too");
});

// ---- the boundaries, and what a person reads ------------------------------------------------------------------------------

test("integrating is a write to the ship's own workspace -- AUTO -- and a ship never constructs a write to the person's checkout", () => {
  assert.ok(isAuto(authorize(INTEGRATION)));
  assert.equal(authorize({ ...INTEGRATION, home: "primary-checkout" }).decision, "deny", "the one write a ship could be tempted to make is the one the boundaries deny");
});

test("a ship refused for a limit out of bounds says the flag a person typed, and starts no task and keeps no room", (t) => {
  const w = shipWorldOf(t);
  assert.throws(() => begunShip(w.world, { ...OPTS, limits: { autonomousRetries: 7 } }), /out of bounds: --retries is 0\.\.3/);
  assert.equal(w.door.tasks.size, 0, "nothing journaled for a ship that never began");
  assert.equal(existsSync(join(w.store, "release")), false, "no room for it either");
});

test("--status says where a ship stands, read from its journal, and writes nothing", async (t) => {
  const w = shipWorldOf(t);
  const { ctx } = await shipped(w);
  const s = await statusOf(w.world, null);
  assert.deepEqual([s.found, s.ship, s.lifecycle, s.cycle, s.repairs], [true, ctx.ship.id, "COMPLETED", 2, []]);
  assert.equal(s.ending.outcome, "SHIPPABLE");
  assert.deepEqual([s.cycleOpen, s.rows.held, s.rows.total, s.rows.failed], [false, 7, 7, []], "a ship that shipped says every row it held in the cycle it shipped from");
  assert.equal((await statusOf(shipWorldOf(t).world, null)).found, false);
});

test("--status of a ship that ended on a failed row says which rows held and which did not, in the cycle it ended in", async (t) => {
  const autonomous = () => ({ outcome: "FAIL", summary: "FAIL — a planted defect was not found", host: HOST });
  const w = shipWorldOf(t, { files: { ...ADDING }, play: { controls: allMatched, autonomous } });
  const { ctx } = await shipped(w);
  const s = await statusOf(w.world, ctx.ship.id);
  assert.deepEqual([s.lifecycle, s.cycle, s.cycleOpen], ["FAILED", 1, false]);
  assert.deepEqual([s.rows.held, s.rows.total, s.rows.failed], [5, 7, ["QA-001:autonomous FAILED"]], "never 0 held and nothing failed");
  assert.deepEqual(s.rows.heldRows.sort(), ["CALC-001:controls", "CALC-001:real", "CALC-002:controls", "CALC-002:real", "QA-001:controls"]);
  assert.match(saidStatus(s), /rows {6}5\/7 held in cycle 1, which closed; not held: QA-001:autonomous FAILED/);
});

test("--status names a repair the ship is making, diagnosed from each case's own declaration as the ship diagnoses it", async (t) => {
  const w = shipWorldOf(t, { play: { repair: (c, tree) => (adds(tree) ? { outcome: "PASS", summary: "PASS" } : { outcome: "BLOCKED", summary: "BLOCKED — the runner could not start", class: "ENVIRONMENT_BLOCKED" }) } });
  const { ctx, result } = await shipped(w);
  assert.equal(result.outcome, "BLOCKED");
  const s = await statusOf(w.world, ctx.ship.id);
  assert.deepEqual([s.cycleOpen, s.repairs], [true, ["CALC-002 BLOCKED"]], "the repair a case declares is read from its case, as the ship reads it");
});
