// THE ACTIVATION SUITE's cases (0.5.0, B22 M4), held without Docker, a network or a model: every case loads under its
// kind's sections; no prompt names a skill, an agent or a command; a selection case keeps to its caps and a case hands the
// runner only a component's switch; every truth holds its shape and its own coherence, and never reaches a plugin or a
// target a host is handed. And every control a case declares -- PLAYED here: its scripted host delivering every hook to
// Orbit's own entry points and running Orbit's own CLIs over the case's target and seed, the real inspection reading back
// what it left, the case's own probe over what was delivered -- comes to the verdict and the class it declares when the
// activation judge reads the stream it recorded. A reference that does not PASS is a case nobody can pass; a cheating,
// idle, half or escalating control that does not FAIL with its class is a judge that would wave a model through.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, test } from "node:test";
import { HARNESS } from "../benchmark/lib/core/freeze.mjs";
import { matchesAny } from "../benchmark/lib/core/paths.mjs";
import { activationTruthFindings, activationTruthOf, caseFindings, casesOf, NAMES_A_COMPONENT, SELECTION_CAPS } from "../benchmark/lib/core/suites.mjs";
import { FAILURE_CLASSES } from "../benchmark/lib/source/classify.mjs";
import { entriesOf, playedApart } from "./benchmark-activation-play.mjs";
import { ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

const CASES = casesOf(ROOT, "orbit-activation");

const byId = (id) => CASES.find((c) => c.id === id);

const raw = (c) => JSON.parse(readFileSync(join(c.dir, "case.json"), "utf8"));

const SPEC_DOC = "docs/backlog/0.5.0-activation-benchmark.md";

// ---- the cases, as they load ----------------------------------------------------------------------------------------------

test("the suite holds fifteen activation cases and three grounding cases, each loading under the activation kind, in English or Vietnamese, on three arms", () => {
  const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}`);
  assert.deepEqual(CASES.map((c) => c.id), [...ids("ORBIT-ACT", 11), ...ids("ORBIT-NEG", 4), ...ids("ORBIT-CTX", 3)]);
  assert.ok(CASES.every((c) => c.kind === "activation" && c.measures.kind === "activation" && c.suite.id === "orbit-activation"));
  assert.deepEqual(CASES.filter((c) => c.language === "vi").map((c) => c.id), ["ORBIT-ACT-006", "ORBIT-NEG-001", "ORBIT-CTX-003"], "one of each family is asked in Vietnamese");
  assert.deepEqual(CASES.filter((c) => c.measures.tier === "outcome").map((c) => c.id), ["ORBIT-ACT-002", "ORBIT-ACT-005", "ORBIT-ACT-006", "ORBIT-ACT-011", "ORBIT-NEG-004"]);
  assert.ok(CASES.filter((c) => c.measures.tier === "outcome").every((c) => c.acceptance.spec && c.acceptance.probe && c.checks && c.scope && c.limits.verifier), "an outcome case is decided by its hidden checks");
  assert.ok(CASES.every((c) => c.arms.join() === "none,baseline,release"), "with no Orbit, the previous release, and this one");
  assert.deepEqual(CASES.filter((c) => c.fixture.id === "none").map((c) => c.id), ["ORBIT-NEG-001"], "a greeting in a project with nothing in it");
  assert.deepEqual(CASES.filter((c) => c.seed).map((c) => c.id), ["ORBIT-ACT-003", "ORBIT-ACT-004", "ORBIT-ACT-007", "ORBIT-ACT-010"]);
});

// A case's directory copied where its fixture still resolves (benchmark/suites/<suite>/<case> beside benchmark/fixtures/).
function copied(t, c) {
  const base = mkdtempSync(join(tmpdir(), "orbit-act-case-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "benchmark", "suites", "orbit-activation", c.id.toLowerCase());
  cpSync(c.dir, dir, { recursive: true });
  cpSync(join(ROOT, "benchmark", "fixtures", c.fixture.id), join(base, "benchmark", "fixtures", c.fixture.id), { recursive: true });
  return dir;
}

const NAMES_ONE = /a prompt that names a skill, an agent, a slash command or a command line/;

test("no prompt names a skill, an agent, a slash command or a command line -- and a case whose prompt does is refused when it loads", (t) => {
  for (const c of CASES) assert.doesNotMatch(readFileSync(join(c.dir, c.request), "utf8"), NAMES_A_COMPONENT, c.id);
  const c = byId("ORBIT-ACT-001");
  const dir = copied(t, c);
  assert.deepEqual(caseFindings(raw(c), dir), [], "the copy loads as the case does");
  for (const prompt of ["Use orbit-architecture to say where payments belong.\n", "/orbit-help where do payments belong?\n", "Ask /orbit where payments belong.\n", "Run node cli/architecture.mjs ensure and tell me.\n", "Run cli/architecture.mjs ensure.\n"]) {
    writeFileSync(join(dir, "request.md"), prompt);
    assert.ok(caseFindings(raw(c), dir).some((f) => NAMES_ONE.test(f)), prompt);
  }
  writeFileSync(join(dir, "request.md"), "Put an order on hold with POST /orders/<id>/hold, and let it be released again.\n");
  assert.deepEqual(caseFindings(raw(c), dir), [], "an API path in a pasted specification names nothing of Orbit's");
});

test("a selection case keeps to about three dollars and twenty-five turns, and a case hands the runner only a component's switch or the router's, on or off", () => {
  for (const c of CASES.filter((x) => x.measures.tier === "selection")) assert.ok(c.limits.usd <= SELECTION_CAPS.usd && c.limits.maxTurns <= SELECTION_CAPS.maxTurns, c.id);
  const sel = byId("ORBIT-ACT-001");
  for (const limits of [{ ...sel.limits, usd: 3.5 }, { ...sel.limits, maxTurns: 26 }]) assert.ok(caseFindings({ ...raw(sel), limits }, sel.dir).some((f) => /past its caps: at most 3 USD and 25 turns/.test(f)), JSON.stringify(limits));
  const off = byId("ORBIT-ACT-008");
  assert.deepEqual(off.switches, { ORBIT_SKILL_AUTONOMOUS_ENGINEERING: "off", ORBIT_AGENT_ENGINEERING_AGENT: "off" }, "the skill and the agent that carry autonomous engineering");
  assert.deepEqual(CASES.filter((c) => c.switches).map((c) => c.id), ["ORBIT-ACT-008"]);
  for (const switches of [{ PATH: "/tmp" }, { ORBIT_STORE_DIR: "/tmp" }, { ANTHROPIC_BASE_URL: "on" }, { ORBIT_SKILL_AUTONOMOUS_ENGINEERING: "maybe" }, { orbit_skill_x: "off" }]) assert.ok(caseFindings({ ...raw(off), switches }, off.dir).some((f) => /hands the runner a switch it may not/.test(f)), JSON.stringify(switches));
  assert.deepEqual(caseFindings({ ...raw(off), switches: { ORBIT_PROMPT_ROUTER: "off", ORBIT_AGENT_QA_AGENT: "on" } }, off.dir), [], "the router's switch, and a component's on or off");
});

// ---- the truth -------------------------------------------------------------------------------------------------------------

test("every truth holds its shape and its own coherence, and a truth that contradicts itself or speaks outside its vocabulary is refused", () => {
  for (const c of CASES) assert.deepEqual(activationTruthFindings(activationTruthOf(c)), [], c.id);
  const t = activationTruthOf(byId("ORBIT-ACT-001"));
  const refused = (over, re) => assert.ok(activationTruthFindings({ ...t, ...over }).some((f) => re.test(f)), `${JSON.stringify(over)}: ${activationTruthFindings({ ...t, ...over }).join("; ")}`);
  refused({ activate: false }, /a truth that says not to activate accepts only the strategy NONE/);
  refused({ strategy: ["DIRECT", "NONE"] }, /a truth that says to activate never accepts the strategy NONE/);
  refused({ strategy: ["COORDINATED"], how: [] }, /a coordinated strategy says how it is coordinated/);
  refused({ strategy: ["SOMETIMES"] }, /truth\.strategy: SOMETIMES is not one of NONE, DIRECT, COORDINATED, SATELLITE, RESUME/);
  refused({ records: [{ id: "a", read: "tasks", expect: {} }, { id: "a", read: "works", expect: {} }] }, /a record id is used once/);
  refused({ records: [{ id: "a", read: "my-own-reading", expect: {} }] }, /truth\.records\[0\]/);
  refused({ records: [{ id: "a", read: "tasks", expect: {}, arms: ["somewhere"] }] }, /truth\.records\[0\]\.arms: somewhere is not one of none, baseline, release/);
  refused({ forbid: { ...t.forbid, commands: ["(unclosed"] } }, /not a pattern this judge can compile/);
  refused({ readOnly: { "orbit-failure-analyst": ["[a-"] } }, /truth\.readOnly\.orbit-failure-analyst/);
  refused({ selection: [{ skills: { require: ["*"], allow: [] }, agents: { require: [], allow: [], max: 0 } }] }, /truth\.selection\[0\]\.skills\.require: \* is not a component's bare name/);
  refused({ selection: [{ skills: { require: ["orbit:orbit-architecture"], allow: [] }, agents: { require: [], allow: [], max: 0 } }] }, /is not a component's bare name/);
  refused({ verdict: "PASS" }, /verdict/);
  assert.deepEqual(activationTruthFindings([]), ["truth: the truth file must hold one object"]);
});

// Every file the repository holds (tracked or about to be), as `git ls-files` lists it.
const repositoryFiles = () => spawnSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], { cwd: ROOT, env: sealed(), encoding: "utf8" }).stdout.split("\0").filter(Boolean);

const textOf = (rel) => {
  try { return readFileSync(join(ROOT, rel), "utf8"); }
  catch { return ""; }
};

test("the hidden truth never reaches a plugin or a target: the harness is never frozen into either, and every case withholds the document that restates the truths", () => {
  const files = repositoryFiles();
  const harnessOwn = files.filter((f) => f.startsWith("benchmark/suites/orbit-activation/"));
  assert.ok(harnessOwn.filter((f) => /\/verifier\/truth\.json$/.test(f)).length === CASES.length && harnessOwn.every((f) => matchesAny(HARNESS, f)), "every truth, spec, probe, control and seed is the harness's own, and HARNESS strips it from every plugin and checkout");
  const recordIds = [...new Set(CASES.flatMap((c) => activationTruthOf(c).records.map((r) => r.id)))];
  for (const c of CASES) {
    const plugin = files.filter((f) => !matchesAny([...HARNESS, ...c.withheld], f));
    assert.deepEqual(c.withheld, [SPEC_DOC], c.id);
    assert.ok(plugin.length > 500 && !plugin.some((f) => f.startsWith("benchmark/") || f === SPEC_DOC), c.id);
    assert.ok(entriesOf(c).every((e) => !/(^|\/)(verifier|controls|seed)\/|truth\.json$/.test(e.rel)), `${c.id}: the target is the fixture and its variant, nothing of the case`);
  }
  const plugin = files.filter((f) => !matchesAny([...HARNESS, SPEC_DOC], f)).map((f) => [f, textOf(f)]);
  assert.deepEqual(plugin.filter(([, text]) => recordIds.some((id) => text.includes(`"${id}"`))).map(([f]) => f), [], "no file a host is handed quotes a truth's own record");
  assert.ok(recordIds.some((id) => textOf(SPEC_DOC).includes(`"${id}"`)), "the document withheld is the one that would");
});

// ---- the controls ------------------------------------------------------------------------------------------------------------

test("each case carries the controls that discriminate for it: a reference that must PASS, a forger that must FAIL as INSUFFICIENT_EVIDENCE, and every other failure with its class", () => {
  for (const c of CASES) {
    assert.ok(c.controls.some((k) => k.id === "reference" && k.host === "reference" && k.expect === "PASS" && k.file), c.id);
    assert.ok(c.controls.some((k) => k.host === "forging" && k.expect === "FAIL" && k.class === "INSUFFICIENT_EVIDENCE"), c.id);
    assert.ok(c.controls.filter((k) => k.expect === "FAIL").every((k) => FAILURE_CLASSES.includes(k.class)), c.id);
    assert.ok(c.controls.filter((k) => k.expect === "FAIL").length >= 2, `${c.id}: more than one way to fail`);
  }
  const negatives = CASES.filter((c) => activationTruthOf(c).activate === false);
  assert.deepEqual(negatives.map((c) => c.id), ["ORBIT-NEG-001", "ORBIT-NEG-002", "ORBIT-NEG-003", "ORBIT-NEG-004"]);
  assert.ok(negatives.every((c) => c.controls.some((k) => k.host === "over-eager" && k.class === "HOST_DIVERGED")), "a negative's discriminating control is the over-eager host");
  assert.deepEqual(CASES.filter((c) => c.controls.some((k) => k.host === "idle" && k.expect === "PASS")).map((c) => c.id), ["ORBIT-NEG-001", "ORBIT-NEG-002", "ORBIT-NEG-003"], "doing nothing is right only where nothing was asked of the code");
  assert.ok(CASES.filter((c) => activationTruthOf(c).activate === true).every((c) => c.controls.filter((k) => k.host === "idle").every((k) => k.expect === "FAIL")), "a host that does nothing is not a host that chose well");
  assert.deepEqual(CASES.filter((c) => c.controls.some((k) => k.id === "forged-trail")).map((c) => c.id), ["ORBIT-ACT-001", "ORBIT-NEG-001"], "a trail line no call made, beside a call no hook saw");
});

const declared = (k) => `${k.expect}${k.class ? ` (${k.class})` : ""}`;

// Each control in a process of its own, two at a time: a play waits on Orbit's processes and nothing else.
describe("every control comes to the verdict and the class it declares when the judge reads the stream its scripted host recorded", { concurrency: 2 }, () => {
  for (const c of CASES) {
    for (const k of c.controls) {
      it(`${c.id} ${k.id}: ${declared(k)}`, async () => {
        const r = await playedApart(c, k);
        assert.deepEqual([r.verdict, k.class ? r.class : null], [k.expect, k.class ?? null], `${r.row}: ${r.why}`);
        if (k.expect === "PASS") assert.deepEqual([r.agreement, r.problems], ["AGREES", []], "a reference is believed only where the stream and the trail say the same");
      });
    }
  }
});
