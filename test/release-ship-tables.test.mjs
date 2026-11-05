// The release ship's tables (skills/orbit-release/ship/, ADR 0049), each row reached on its own and the order between
// the rows that could both match: NEXT (the state machine), DIAGNOSE (what a failed row leads to), ROW_VERDICT,
// CONTROL_RULES and REPAIR_CHECK (what a run's own room proves), PUBLISH (the publish gate) and PREFLIGHT.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";
import { DIAGNOSE, diagnosed, INTERRUPTED_RUNS } from "../skills/orbit-release/ship/diagnose.mjs";
import { PUBLISH, publishableOf } from "../skills/orbit-release/ship/evidence.mjs";
import { NEXT, nextOf } from "../skills/orbit-release/ship/machine.mjs";
import { gateEnvOf } from "../skills/orbit-release/ship/ports.mjs";
import { PREFLIGHT, preflightOf } from "../skills/orbit-release/ship/preflight.mjs";
import { CONTROL_RULES, CONTROL_VERDICT, REPAIR_CHECK, ROW_VERDICT, controlVerdict, interruptedOf, repairVerdict, rowVerdict } from "../skills/orbit-release/ship/rows.mjs";
import { POLICY } from "./fakes/ship-world.mjs";

// ---- NEXT ---------------------------------------------------------------------------------------------------------------

const ROW = { id: "A:real", case: "A", run: "verify", kind: "source", variant: "real", expect: ["PASS"], autonomous: false };

const held = (row = ROW) => ({ row, v: { state: "HELD" }, diag: null });
const failed = (then, row = ROW) => ({ row, v: { state: "FAILED", says: "x" }, diag: { then, says: "x" } });

// Facts at the point a cycle's rows are all in, and every other condition clear.
const settled = (over = {}) => ({ ended: false, held: false, running: [], workspace: { path: "/w" }, spent: { minutes: 0, usd: 0 }, limits: { minutes: 60, usd: 10, cycles: 3 }, open: { id: "att-1" }, attempts: 1, cycle: { artifact: { refused: [] } }, host: { ok: true }, gates: { ok: true }, rows: new Map([[ROW.id, held()]]), pending: null, repairs: [], ...over });

const CTX = { preflighted: true, options: { failFast: true }, rows: [ROW] };

const repairs = (state) => [{ case: "A", state }];

const REACH = {
  ENDED: [settled({ ended: true })],
  HELD_BY_PERSON: [settled({ held: true })],
  PREFLIGHT: [settled(), { ...CTX, preflighted: false }],
  RECONCILE: [settled({ running: [{}] })],
  WORKSPACE: [settled({ workspace: null })],
  OVER_LIMIT: [settled({ spent: { minutes: 61, usd: 0 } })],
  CYCLE_DONE: [settled({ repairs: repairs("INTEGRATED") })],
  CYCLES_SPENT: [settled({ open: null, attempts: 3 })],
  NO_CYCLE: [settled({ open: null })],
  NOT_BUILT: [settled({ cycle: null })],
  ARCHIVE_REFUSED: [settled({ cycle: { artifact: { refused: ["a symbolic link"] } } })],
  NO_HOST: [settled({ host: null })],
  HOST_REFUSED: [settled({ host: { ok: false } })],
  NO_GATES: [settled({ gates: null })],
  GATES_FAILED: [settled({ gates: { ok: false } })],
  ROW_BLOCKED: [settled({ rows: new Map([[ROW.id, failed("BLOCK")]]) })],
  FAIL_FAST: [settled({ rows: new Map([[ROW.id, failed("STOP")]]) })],
  ROW: [settled({ pending: ROW })],
  ROW_STOPPED: [settled({ rows: new Map([[ROW.id, failed("STOP")]]) }), { ...CTX, options: { failFast: false } }],
  REPAIR_BLOCKED: [settled({ repairs: repairs("BLOCKED") })],
  NO_PROGRESS: [settled({ repairs: repairs("NO_PROGRESS") })],
  REPAIRS_SPENT: [settled({ repairs: repairs("SPENT") })],
  INTEGRATE: [settled({ repairs: repairs("VERIFIED") })],
  REPAIR: [settled({ repairs: repairs("TO_REPAIR") })],
  SHIPPABLE: [settled()],
  UNKNOWN: [settled({ rows: new Map() })],
};

test("NEXT: every row is reached, and only by the facts it names", () => {
  assert.deepEqual(Object.keys(REACH), NEXT.map((r) => r.id), "a reach for every row, in the table's order");
  for (const [id, [f, ctx]] of Object.entries(REACH)) assert.equal(nextOf(f, ctx ?? CTX).id, id, id);
});

test("NEXT: a person's hold outranks everything a ship would do, and a model-carried row never runs on a cycle that failed", () => {
  assert.equal(nextOf(settled({ held: true, running: [{}], pending: ROW }), CTX).id, "HELD_BY_PERSON");
  assert.equal(nextOf(settled({ rows: new Map([[ROW.id, failed("BLOCK")]]), pending: ROW }), CTX).id, "ROW_BLOCKED", "a blocked row stops the cycle before another row is sent");
  assert.equal(nextOf(settled({ repairs: repairs("INTEGRATED"), pending: ROW }), CTX).id, "CYCLE_DONE", "a cycle whose repairs are all in is over: its rows are stale");
  assert.equal(nextOf(settled({ rows: new Map() }), { ...CTX, rows: [] }).id, "UNKNOWN", "an empty catalog is never SHIPPABLE");
  assert.equal(nextOf(settled({ running: [{}] }), { ...CTX, preflighted: false }).id, "PREFLIGHT", "a resumed ship reads its catalog before it reads back what was running");
});

// ---- DIAGNOSE ------------------------------------------------------------------------------------------------------------

const SRC = { measures: { repairable: ["ORBIT_SOURCE_DEFECT"] } };

const D = (v, over = {}) => diagnosed({ row: ROW, v: { state: "FAILED", says: "it failed", ...v }, case: SRC, repair: true, flakyLeft: 1, autonomousLeft: 0, interruptedLeft: 1, ...over });

const AUTO_ROW = { ...ROW, id: "Q:autonomous", run: "autonomous", kind: "qa", autonomous: true };

const CUT = { state: "INTERRUPTED", code: "INTERRUPTED", outcome: "PASS", says: "a round of its run was interrupted" };

test("DIAGNOSE: every row is reached, and a repair is only what a source case declares repairable on its real source", () => {
  const got = [D({ state: "HELD_BY_PERSON" }), diagnosed({ row: AUTO_ROW, v: CUT, case: {}, repair: true, flakyLeft: 1, autonomousLeft: 0, interruptedLeft: 1 }), D({ cause: "CREDENTIALS", state: "BLOCKED" }), D({ state: "BLOCKED" }), D({ class: "PROVIDER_FAILURE" }), D({ class: "NON_DETERMINISTIC" }), D({ state: "REFUSED" }), D({ state: "UNTRUSTED" }), D({ class: "HUMAN_APPROVAL_REQUIRED" }), D({ class: "ORBIT_SOURCE_DEFECT", cause: "ORBIT_SOURCE_DEFECT" }), diagnosed({ row: AUTO_ROW, v: { state: "FAILED", outcome: "FAIL", says: "missed" }, case: {}, repair: true, flakyLeft: 1, autonomousLeft: 0 }), D({ class: "UNKNOWN" })];
  assert.deepEqual(got.map((d) => d.id), DIAGNOSE.map((r) => r.id));
  assert.deepEqual(got.map((d) => d.then), ["HELD", "RETRY", "BLOCK", "BLOCK", "BLOCK", "RETRY", "STOP", "STOP", "STOP", "REPAIR", "STOP", "STOP"]);
  assert.equal(D({ class: "ORBIT_SOURCE_DEFECT", cause: "ORBIT_SOURCE_DEFECT" }, { repair: false }).then, "STOP", "--no-repair: a repairable failure stands");
  assert.equal(D({ class: "ORBIT_SOURCE_DEFECT", cause: "CAPABILITY_MISSING" }).then, "STOP", "a cause the case does not declare repairable is not repaired");
  assert.equal(diagnosed({ row: { ...ROW, kind: "qa" }, v: { state: "FAILED", class: "ORBIT_SOURCE_DEFECT", cause: "ORBIT_SOURCE_DEFECT", says: "x" }, case: SRC, repair: true }).then, "STOP", "a QA case is never repaired against its hidden truth");
  assert.equal(D({ class: "NON_DETERMINISTIC" }, { flakyLeft: 0 }).then, "STOP", "a retry spent is a stop");
  assert.equal(diagnosed({ row: AUTO_ROW, v: { state: "FAILED", outcome: "FAIL", says: "m" }, case: {}, repair: true, autonomousLeft: 1 }).then, "RETRY", "a person may allow a model-carried row another run");
});

test("DIAGNOSE: a run a restart interrupted runs again on its own bound -- never --retries -- and a spent bound BLOCKS the ship, never fails the release", () => {
  const cut = (over) => diagnosed({ row: AUTO_ROW, v: CUT, case: {}, repair: true, flakyLeft: 0, autonomousLeft: 0, ...over });
  assert.equal(cut({ interruptedLeft: 1 }).then, "RETRY", "with no retry a person allowed the model, an interrupted run still runs again: it was never the model's miss");
  assert.match(cut({ interruptedLeft: 1 }).says, /spending none of --retries/);
  assert.deepEqual(((d) => [d.then, d.needs, d.stop])(cut({ interruptedLeft: 0, autonomousLeft: 3 })), ["BLOCK", "environment", "ENVIRONMENT_BLOCKED"], "spent: the environment cannot hold a run to its end -- a block, resumable, whatever --retries allows");
  assert.match(cut({ interruptedLeft: 0 }).says, new RegExp(`interrupted ${INTERRUPTED_RUNS + 1} runs of it`));
  assert.equal(diagnosed({ row: AUTO_ROW, v: { ...CUT, state: "UNTRUSTED", code: "WRONG_HOST" }, case: {}, repair: true, autonomousLeft: 3, interruptedLeft: 2 }).then, "STOP", "a run on another host is never run again into evidence");
});

test("DIAGNOSE: a row its environment blocked runs again once a person resumed the blocked ship after its run -- nothing else is lifted", () => {
  const blocked = (over) => D({ state: "BLOCKED", says: "Docker did not answer" }, over);
  assert.equal(blocked({}).then, "BLOCK");
  assert.deepEqual(((d) => [d.then, d.needs, d.stop])(blocked({ resumed: true })), ["RETRY", null, null], "fix it and --resume: the row is asked again, as a new run");
  assert.equal(diagnosed({ row: AUTO_ROW, v: CUT, case: {}, repair: true, interruptedLeft: 0, resumed: true }).then, "RETRY", "an interruption bound spent, then resumed by a person: one more run");
  assert.equal(D({ state: "UNTRUSTED" }, { resumed: true }).then, "STOP", "a stop stays a stop: a resume lifts what blocked, never what failed");
  assert.equal(D({ state: "HELD_BY_PERSON" }, { resumed: true }).then, "HELD");
});

// ---- ROW_VERDICT ---------------------------------------------------------------------------------------------------------

const CYCLE = { commit: "c1", tree: "/", digest: "d1" };
const SHIP = { harness: "h1", caseDigest: "k1" };
const roomOf = (over = {}) => ({ manifest: { run: "bnr-000000000001", source: { commit: "c1", repo: "/", digest: "d1" }, benchmark: { harness: "h1", digest: "k1" }, images: { claudeCode: "2.1.314" }, ...over.manifest }, ending: { outcome: "PASS", ...over.ending }, report: { hostBasis: "coding-host", rounds: [{ host: { started: true, version: "2.1.314", model: "m", costUsd: 1 } }], leaks: [], ...over.report } });
const V = (over = {}, row = ROW) => rowVerdict({ row, answer: { code: 0, json: {} }, room: roomOf(over), cycle: CYCLE, ship: SHIP, ...over.f });
const AUTO = { ...ROW, run: "autonomous", autonomous: true, expect: ["PASS"] };

test("ROW_VERDICT: every row is reached -- a run is held only on the tree, harness, case and host it must have had", () => {
  const got = [rowVerdict({ row: ROW, answer: { code: null, json: null }, room: { manifest: { source: {} } }, cycle: CYCLE, ship: SHIP }), rowVerdict({ row: ROW, answer: { code: 2, json: null, err: "FIXTURE_DRIFT" }, room: {}, cycle: CYCLE, ship: SHIP }), V({ ending: { outcome: "BLOCKED" } }), V({ ending: { outcome: "PAUSED" } }), V({ manifest: { source: { commit: "c0", repo: "/", digest: "d1" } } }), V({ manifest: { benchmark: { harness: "h2", digest: "k1" } } }), V({ manifest: { benchmark: { harness: "h1", digest: "k2" } } }), V({ report: { leaks: ["out/host.jsonl"] } }), V({ report: { rounds: [{ interrupted: true, host: null }] } }, AUTO), V({ ending: { outcome: "FAIL" } }), V({ report: { hostBasis: "scripted" } }, AUTO), V()];
  assert.deepEqual(got.map((v) => v.code), ROW_VERDICT.map((r) => r.code));
  assert.equal(V({ manifest: { source: { commit: "c1", repo: "/", digest: "d2" } } }).code, "WRONG_TREE", "one cycle, one content digest");
  assert.equal(V({ report: { rounds: [{ host: { started: true, version: "2.1.300", model: "m" } }] } }, AUTO).code, "WRONG_HOST", "the Claude Code the image pins, and no other");
  assert.equal(V({ report: { rounds: [{ host: { started: true, version: "2.1.314", model: null } }] } }, AUTO).code, "WRONG_HOST", "a model the host never named is no evidence");
  assert.equal(V({ report: { hostBasis: "none" } }).code, "HELD", "a verification needs no host at all");
  assert.equal(V({ ending: { outcome: "FAIL" }, report: { hostBasis: "scripted" } }, AUTO).code, "UNEXPECTED", "a failure is a failure, whoever carried it");
});

// A QA run's report names its one round; a run a restart interrupted says it of that round, with no host.
const QA_CUT = { rounds: undefined, round: { driver: null, interrupted: true } };

test("ROW_VERDICT: a model-carried run a restart interrupted is INTERRUPTED -- never held, never the model's FAIL -- and one that says another host stays WRONG_HOST", () => {
  const cut = V({ report: QA_CUT }, AUTO);
  assert.deepEqual([cut.code, cut.state, cut.outcome, cut.basis, cut.cli, cut.model], ["INTERRUPTED", "INTERRUPTED", "PASS", "coding-host", null, null], "the incident: PASS read back, basis coding-host, no Claude Code and no model");
  assert.match(cut.says, /interrupted before the controller saw it end/);
  assert.equal(V({ ending: { outcome: "FAIL" }, report: QA_CUT }, AUTO).code, "INTERRUPTED", "a run cut short is not the model's miss either");
  assert.equal(V({ report: { rounds: [{ interrupted: true, host: null }, { host: { started: true, version: "2.1.314", model: "m" } }] } }, AUTO).code, "INTERRUPTED", "a later round's identity does not make a run with an interrupted round evidence: what that round did is nobody's to show");
  assert.equal(V({ report: { ...QA_CUT, hostBasis: "scripted" } }, AUTO).code, "WRONG_HOST", "a scripted run is never run again into evidence");
  assert.equal(V({ report: { ...QA_CUT, hostBasis: "session" } }, AUTO).code, "WRONG_HOST");
  assert.equal(V({ report: { rounds: [{ interrupted: true, host: null }, { host: { started: true, version: "2.1.300", model: "m" } }] } }, AUTO).code, "WRONG_HOST", "a round that says another Claude Code than the image pins");
  assert.equal(V({ report: { ...QA_CUT, leaks: ["out/host.jsonl"] } }, AUTO).code, "LEAK", "a credential in the room is a person's to look at first");
  assert.equal(V({ ending: { outcome: "BLOCKED" }, report: QA_CUT }, AUTO).code, "BLOCKED");
  assert.equal(V({ report: { ...QA_CUT, round: { driver: null, interrupted: false } } }, AUTO).code, "WRONG_HOST", "no interruption on record: an anonymous PASS stays no evidence of the coding host");
  assert.equal(V({ report: { hostBasis: "none", rounds: [{ interrupted: true }] } }).code, "HELD", "only a model-carried row is held to a host");
  assert.equal(interruptedOf({ round: { interrupted: true } }) && interruptedOf({ rounds: [{}, { interrupted: true }] }) && !interruptedOf({ rounds: [{ interrupted: false }] }) && !interruptedOf(null), true);
});

// Windows, as the file system answers there: the JavaScript realpath keeps a temporary path's 8.3 short name, while git
// and the native call name the long one (test/checkout-identity.test.mjs). A ship's tree and the tree its run recorded
// are one tree however each is spelled -- and another tree stays another tree.
test("ROW_VERDICT: a run is never WRONG_TREE for how its tree is spelled -- a short name (RUNNER~1) and the long one git answers are one tree", (t) => {
  const native = realpathSync.native;
  t.after(() => (realpathSync.native = native));
  realpathSync.native = (p) => p.replace("RUNNER~1", "runneradmin");
  const at = (repo) => rowVerdict({ row: ROW, answer: { code: 0, json: {} }, room: roomOf({ manifest: { source: { commit: "c1", repo, digest: "d1" } } }), cycle: { ...CYCLE, tree: "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\o\\release\\trees\\c1" }, ship: SHIP }).code;
  assert.equal(at("C:\\Users\\runneradmin\\AppData\\Local\\Temp\\o\\release\\trees\\c1"), "HELD");
  assert.equal(at("C:\\Users\\runneradmin\\AppData\\Local\\Temp\\o\\elsewhere"), "WRONG_TREE");
  assert.equal(at(undefined), "WRONG_TREE", "a run that names no tree is never this cycle's");
});

test("the definition of done runs without the coding host's credential or endpoint -- it needs neither, and a suite could print one", () => {
  const env = { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_AUTH_TOKEN: "a", ANTHROPIC_BASE_URL: "https://api.anthropic.com" };
  assert.deepEqual(gateEnvOf(env), { PATH: "/bin", HOME: "/h" });
});

// ---- CONTROL_RULES -------------------------------------------------------------------------------------------------------

const C = (rows, over = {}) => controlVerdict({ row: { ...ROW, id: "A:controls", run: "controls" }, answer: { code: 0, json: { run: "bnr-000000000001", rows } }, rooms: [{ manifest: { source: { commit: "c1" } } }], cycle: CYCLE, case: { baseline: "FAIL" }, realHeld: true, ...over });

test("CONTROL_RULES: a known finding's control that presupposes its defect is superseded once its real source passes -- nothing else is", () => {
  const known = { id: "known-good", variant: "real", expect: "PASS", got: "DRIFTED", matched: false };
  const allow = { id: "allow-all", variant: "real", expect: "FAIL", got: "FAIL", matched: true };
  assert.deepEqual(CONTROL_RULES.map((r) => r.id), ["MATCHED", "SUPERSEDED", "DRIFTED", "MISMATCHED"]);
  assert.deepEqual([C([known, allow]).state, C([known, allow]).superseded], ["HELD", ["known-good"]]);
  assert.equal(C([known], { realHeld: false }).state, "FAILED", "not while the real source still fails");
  assert.equal(C([known], { case: { baseline: "PASS" } }).state, "FAILED", "never for a case that declared no finding");
  assert.equal(C([{ ...allow, got: "DRIFTED", matched: false }]).code, "NOT_HELD", "a control that must FAIL and drifted proves nothing on this source");
  assert.equal(C([{ id: "reference", variant: "real", expect: "REPAIRED_VERIFIED", got: "PASS", matched: false }]).state, "HELD", "a repair control has nothing left to repair");
  assert.equal(C([{ id: "planted", variant: "controlled-fault", expect: "FAIL", got: "PASS", matched: false }]).class, "VERIFIER_DEFECT");
  assert.deepEqual([controlVerdict({ row: ROW, answer: { code: 2, json: null }, rooms: [], cycle: CYCLE }).code, controlVerdict({ row: ROW, answer: { code: 3, json: null }, rooms: [], cycle: CYCLE }).code, C([allow], { rooms: [{ manifest: { source: { commit: "c0" } } }] }).code], ["REFUSED", "BLOCKED", "WRONG_TREE"]);
  assert.deepEqual(CONTROL_VERDICT.map((r) => r.code), ["REFUSED", "BLOCKED", "WRONG_TREE", "NOT_HELD", "HELD"]);
});

// ---- REPAIR_CHECK --------------------------------------------------------------------------------------------------------

const REPAIRED = { ending: { outcome: "REPAIRED_VERIFIED" } };
const VERIFIED = { run: "bnr-000000000001", case: { id: "A" }, variant: "real", source: { commit: "c1" }, host: { basis: "coding-host" }, candidate: { patchDigest: "p1" } };
const PATCH = { digest: "p1", touched: [{ path: "src/a.mjs", added: 1, removed: 1, existed: true }, { path: "test/a-regression.test.mjs", added: 5, removed: 0, existed: false }] };
const R = (over = {}) => repairVerdict({ row: { ...ROW, id: "A:real" }, answer: { code: 0, json: {} }, room: roomOf({ ...REPAIRED, ...over.room }), cycle: { ...CYCLE, digest: null }, ship: SHIP, verified: over.verified === undefined ? VERIFIED : over.verified, patch: over.patch === undefined ? PATCH : over.patch, policy: { protected: ["benchmark/**", "skills/orbit-release/**", "package.json"] }, case: { scope: { allow: over.allow ?? ["src/*.mjs", "test/*.test.mjs"] } } });

test("REPAIR_CHECK: a verified candidate is held again by the ship before a byte of it is applied", () => {
  const got = [R({ room: { report: { rounds: [{ interrupted: true, host: null }] } } }), R({ room: { ending: { outcome: "REPAIR_REJECTED" } } }), R({ verified: null }), R({ patch: { ...PATCH, digest: "p2" } }), R({ verified: { ...VERIFIED, host: { basis: "scripted" } } }), R({ patch: { digest: "p1", touched: [] } }), R({ patch: { digest: "p1", touched: [{ path: "src/deep/b.mjs", added: 1, removed: 0, existed: false }] } }), R({ allow: ["**"], patch: { digest: "p1", touched: [{ path: "benchmark/lib/x.mjs", added: 1, removed: 0, existed: true }] } }), R({ patch: { digest: "p1", touched: [{ path: "test/a.test.mjs", added: 0, removed: 2, existed: true }] } }), R()];
  assert.deepEqual(got.map((v) => v.code), REPAIR_CHECK.slice(7).map((r) => r.code));
  assert.deepEqual(got.map((v) => v.state), ["INTERRUPTED", "REJECTED", "REFUSED_BY_SHIP", "REFUSED_BY_SHIP", "UNTRUSTED", "REFUSED_BY_SHIP", "REFUSED_BY_SHIP", "REFUSED_BY_SHIP", "REFUSED_BY_SHIP", "VERIFIED"]);
  assert.equal(R({ room: { ending: { outcome: "REPAIR_REJECTED" }, report: { rounds: [{ interrupted: true, host: null }] } } }).code, "INTERRUPTED", "a repair cut short is not the model's rejected candidate either");
  assert.equal(R({ room: { report: { hostBasis: "scripted", rounds: [{ interrupted: true, host: null }] } } }).code, "WRONG_HOST", "a repair whose run says another host stays WRONG_HOST, interrupted or not -- never run again into an integration");
  assert.equal(R({ verified: { ...VERIFIED, source: { commit: "c0" } } }).code, "NO_VERIFIED_RECORD", "a candidate verified against another source");
  assert.equal(R({ allow: ["**"], patch: { digest: "p1", touched: [{ path: "skills/orbit-release/ship/policy.json", added: 1, removed: 1, existed: true }] } }).code, "PROTECTED", "the release policy is never a candidate's to change");
  assert.equal(R({ patch: { digest: "p1", touched: [{ path: "test/a.test.mjs", added: 3, removed: 0, existed: true }] } }).code, "VERIFIED", "a test may gain lines");
});

// ---- PUBLISH ------------------------------------------------------------------------------------------------------------

const EV = { source: { commit: "c1", tree: "t1", protected: "p", digest: "d1" }, policy: { digest: "y" }, rows: [{ id: "A:real", run: "bnr-000000000001", state: "HELD", outcome: "PASS" }], artifact: { sha256: "a".repeat(64) }, delivery: { needed: false } };
const G = (over = {}) => ({ ship: { id: "shp-000000000001" }, view: { lifecycle: "COMPLETED" }, evidence: EV, ending: null, head: { tree: "t1", dirty: [] }, now: { protected: "p", policy: "y", rows: ["A:real"], autonomous: new Set(), single: new Set(["A:real"]) }, rooms: () => ({ manifest: { source: { commit: "c1" } }, ending: { outcome: "PASS" }, report: {} }), artifact: { ok: true }, ...over });

test("PUBLISH: every row is reached, and only PUBLISHABLE lets a release be published", () => {
  const got = [G({ ship: null }), G({ view: { lifecycle: "EXECUTING" } }), G({ view: { lifecycle: "BLOCKED" } }), G({ view: { lifecycle: "FAILED" } }), G({ head: { tree: "t2", dirty: [] } }), G({ head: { tree: "t1", dirty: ["src/a.mjs"] } }), G({ now: { ...G().now, protected: "q" } }), G({ now: { ...G().now, policy: "z" } }), G({ now: { ...G().now, rows: ["A:real", "B:real"] } }), G({ rooms: () => ({ manifest: { source: { commit: "c0" } }, ending: { outcome: "PASS" } }) }), G({ artifact: { ok: false, says: "gone" } }), G()].map(publishableOf);
  assert.deepEqual(got.map((x) => x.code), PUBLISH.map((r) => r.code));
  assert.deepEqual(got.map((x) => x.publishable), [...PUBLISH.slice(0, -1).map(() => false), true]);
  assert.equal(publishableOf(G({ view: { lifecycle: "PAUSED" } })).code, "PENDING", "a paused ship's verification is still pending");
});

// ---- PREFLIGHT -----------------------------------------------------------------------------------------------------------

const P = (over = {}) => preflightOf({ harness: true, node: 22, protectedDirty: [], listed: { suites: [] }, drift: [], doctor: { docker: { version: "27" } }, env: { ANTHROPIC_API_KEY: "set" }, policy: POLICY, ...over });

test("PREFLIGHT: every row is reached; a credential is asked by name only, and a model behind another endpoint is refused", () => {
  const got = [P({ harness: false }), P({ node: 18 }), P({ protectedDirty: ["benchmark/run.mjs"] }), P({ listed: null }), P({ drift: ["X is in the policy and no suite holds it"] }), P({ doctor: { docker: { missing: "no daemon" } } }), P({ env: {} }), P({ env: { ANTHROPIC_API_KEY: "set", ANTHROPIC_BASE_URL: "http://localhost:9999" } }), P()];
  assert.deepEqual(got.map((p) => p.code), [...PREFLIGHT.map((r) => r.code), "OK"]);
  assert.deepEqual(got.map((p) => p.state), ["BLOCKED", "BLOCKED", "REFUSED", "BLOCKED", "REFUSED", "BLOCKED", "BLOCKED", "BLOCKED", "OK"]);
  assert.equal(P({ env: { CLAUDE_CODE_OAUTH_TOKEN: "set" } }).ok, true, "an OAuth token, by name");
  assert.equal(P({ env: { ANTHROPIC_API_KEY: "set", ANTHROPIC_BASE_URL: "https://api.anthropic.com" } }).ok, true, "the endpoint the policy names");
  assert.doesNotMatch(JSON.stringify(P({ env: { ANTHROPIC_API_KEY: "sk-ant-secret-value" } })), /sk-ant-secret-value/, "a value is never said");
});
