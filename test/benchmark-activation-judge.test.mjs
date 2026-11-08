// THE ACTIVATION JUDGE (0.5.0, B22 M4; the activation benchmark §5), row by row, over sessions written here: a stream
// as Claude Code prints it and the trail Orbit's hooks would keep of it, handed through the same door the run's flow
// uses (factsFrom). What the host did is DERIVED from the stream -- the strategy it took, the skills and agents it used, a
// call a switch refused (attempted, counted, never failed), a write under a read-only agent, a forbidden command -- and
// believed only where the trail agrees. Then an ordered table decides, its last row always matching: every row is
// reached here, in its order, with the class it carries. The router's own accuracy, the owners' records, the grounding
// rows and what the metrics fold reads are each held apart.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { goalReadingOf } from "../benchmark/images/runner/inspect.mjs";
import { factsFrom } from "../benchmark/lib/activation/flow.mjs";
import { judgedActivation, observedOf, PLUGIN_COMMAND, RECORDS, recordRows, routerOf, routerRight, STRATEGY_SEEN, VERDICT } from "../benchmark/lib/activation/judge.mjs";
import { FAILURE_CLASSES } from "../benchmark/lib/source/classify.mjs";
import { MAX_STEPS } from "../src/trace/projections/turns.mjs";
import { hostSession } from "../src/memory/session.mjs";

const SESSION = "s-judge";

const ORBIT = "/work/orbit";

// ---- a session, as the stream and the trail would keep it -----------------------------------------------------------------

const call = (id, name, input, parent) => ({ type: "assistant", parent_tool_use_id: parent ?? null, message: { id: `msg_${id}`, content: [{ type: "tool_use", id, name, input }] } });

const answered = (id, isError, parent) => ({ type: "user", parent_tool_use_id: parent ?? null, message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError === true }] } });

// Each move adds its call and result to the stream and, where Orbit's hooks would see it, its line to the trail.
// o.trail: false -- a call no hook saw; o.refused -- the hook's switch refused it; o.failed -- the call came back an error.
const skill = (name, o = {}) => (s, parent) => {
  const id = s.next();
  s.events.push(call(id, "Skill", { skill: name }, parent), answered(id, o.failed ?? o.refused, parent));
  if (o.trail !== false) s.steps.push({ kind: "skill", label: name, ok: !o.refused, refused: o.refused === true });
};

const agent = (name, inside = [], o = {}) => (s) => {
  const id = s.next();
  s.events.push(call(id, "Agent", { subagent_type: name, description: "one bounded job", prompt: "the job" }));
  if (o.trail !== false) s.steps.push({ kind: "agent", label: name, ok: !o.refused, refused: o.refused === true });
  if (!o.refused) inside.forEach((m) => m(s, id));
  s.events.push(answered(id, o.refused));
};

const bash = (command, o = {}) => (s, parent) => ((id) => s.events.push(call(id, "Bash", { command }, parent), answered(id, o.failed, parent)))(s.next());

const read = (path) => (s, parent) => ((id) => s.events.push(call(id, "Read", { file_path: path }, parent), answered(id, false, parent)))(s.next());

const INIT = { type: "system", subtype: "init", model: "test-model", session_id: SESSION, claude_code_version: "2.1.0" };

function session(...moves) {
  const s = { events: [INIT], steps: [], n: 0, next: () => `toolu_${String((s.n += 1)).padStart(4, "0")}` };
  for (const m of moves) m(s, null);
  return s;
}

const ended = (o = {}) => ({ type: "result", subtype: "success", is_error: false, num_turns: 4, total_cost_usd: 0.25, session_id: SESSION, ...o });

// The router's own decision on the turn, as prompt.submitted keeps it (v3: a strategy word and an activation path).
const ROUTED = (word, path = "none", id = null, o = {}) => ({ routing: "on", strategy: { word, row: "test" }, activation: { path, id }, selected: o.selected ?? (id && ["skill", "agent"].includes(path) ? [{ kind: path, id }] : []), approval: [], injected: o.injected ?? word !== "NONE" });

const turnsOf = (steps, routing, sessionId = SESSION) => ({ exit: 0, json: { turns: [{ session: hostSession("claude", sessionId), routing, steps }] } });

const NO_TRAIL = { exit: 0, json: { turns: [] } };

const TRUTH = { schema: 1, activate: true, strategy: ["DIRECT"], how: [], selection: [{ skills: { require: ["orbit-architecture"], allow: [] }, agents: { require: [], allow: ["orbit-architecture-scanner"], max: 1 } }], forbid: { skills: ["orbit-engineer"], agents: [], commands: [] }, readOnly: {}, records: [], relevant: null, grounding: null };

const ANY = { activate: null, strategy: [], selection: [{ skills: { require: [], allow: ["*"] }, agents: { require: [], allow: ["*"], max: 2 } }], forbid: { skills: ["orbit-engineer"], agents: ["orbit-engineering-agent"], commands: [] } };

// The facts the flow hands the judge (factsFrom), from a session and what the inspection read.
// o: { arm, tier, truth, switches, routing, turns, usage, ins, seed, outcome, ran, end, text, entries }
function facts(s, o = {}) {
  const text = o.text ?? [...s.events, ended(o.end)].map((e) => JSON.stringify(e)).join("\n");
  const turns = o.turns ?? turnsOf(s.steps, o.routing ?? ROUTED("DIRECT", "skill", "orbit-architecture"));
  return factsFrom({ c: { measures: { tier: o.tier ?? "selection" } }, truth: { ...TRUTH, ...o.truth }, arm: o.arm ?? "release", switches: o.switches ?? {}, text, host: o.ran ?? {}, ins: { turns, trace: o.usage ?? null, ...o.ins }, seed: o.seed ?? null, cand: o.outcome ? { outcome: o.outcome } : null, entries: o.entries ?? [] });
}

const judged = (s, o) => judgedActivation(facts(s, o));

const row = (j) => [j.verdict, j.row, j.class];

const RIGHT = session(skill("orbit:orbit-architecture"), bash(`node ${ORBIT}/cli/architecture.mjs ensure --json`));

// ---- what the host did ------------------------------------------------------------------------------------------------------

test("the strategy a host took is the first STRATEGY_SEEN row its stream holds, the last always holding", () => {
  const seen = (s, o) => ((x) => [x.strategy, x.how])(observedOf(facts(s, o)));
  assert.deepEqual(seen(session()), ["NONE", null]);
  assert.deepEqual(seen(session(skill("orbit:orbit-architecture"))), ["DIRECT", null]);
  assert.deepEqual(seen(session(bash(`node ${ORBIT}/cli/architecture.mjs ensure`))), ["DIRECT", null], "an Orbit command alone is Orbit used");
  assert.deepEqual(seen(session(bash('node "${CLAUDE_PLUGIN_ROOT}/cli/architecture.mjs" ensure'))), ["DIRECT", null], "as a host spells the plugin's own root");
  assert.deepEqual(seen(session(bash(`node ${ORBIT}/cli/automation.mjs start --for=x --json`))), ["COORDINATED", "automation"]);
  assert.deepEqual(seen(session(bash(`node ${ORBIT}/cli/orbit.mjs goal start --stdin`))), ["COORDINATED", "goal"]);
  assert.deepEqual(seen(session(bash(`node ${ORBIT}/satellite/cli/satellite.mjs mission start --for=x`))), ["SATELLITE", null]);
  for (const cmd of [`node ${ORBIT}/cli/automation.mjs resume tsk-0123456789ab`, `node ${ORBIT}/cli/orbit.mjs goal resume goal-1`, `node ${ORBIT}/cli/autonomous-engineering.mjs resume PBI-1`, `node ${ORBIT}/cli/track.mjs track "the rule" --continue=w-1`]) assert.deepEqual(seen(session(bash(cmd))), ["RESUME", null], cmd);
  const moved = { seed: { kept: { workflow: "tsk-0123456789ab", revision: 3 } }, ins: { workflows: { exit: 0, json: { workflows: [{ id: "tsk-0123456789ab", revision: 7, steps: [] }] } } } };
  assert.deepEqual(seen(session(bash(`node ${ORBIT}/cli/automation.mjs step tsk-0123456789ab`)), moved), ["RESUME", null], "the seeded workflow moved on, whichever command moved it");
  assert.deepEqual(seen(session(bash(`node ${ORBIT}/cli/automation.mjs step tsk-0123456789ab`))), ["DIRECT", null]);
  assert.deepEqual(seen(session(bash("node /home/me/other-plugin/cli/automation.mjs start"), read("/work/repo/src/money.mjs"))), ["NONE", null], "another plugin's command is not Orbit's");
  assert.equal(STRATEGY_SEEN.at(-1).when({}), true);
  assert.ok(PLUGIN_COMMAND.test(`node ${ORBIT}/satellite/cli/satellite.mjs status`) && !PLUGIN_COMMAND.test("node /work/repo/cli/x.mjs"));
});

const OFF = { ORBIT_SKILL_AUTONOMOUS_ENGINEERING: "off", ORBIT_AGENT_ENGINEERING_AGENT: "off" };

test("a call a person's switch refused is ATTEMPTED -- counted, never failed; a switched-off component that ran is a BREACH, Orbit's own when the release arm's router suggested it", () => {
  const attempted = session(skill("orbit:orbit-engineer", { refused: true }), agent("orbit:orbit-engineering-agent", [], { refused: true }), skill("orbit:orbit-develop"));
  const o = observedOf(facts(attempted, { switches: OFF, truth: ANY, routing: ROUTED("NONE") }));
  assert.deepEqual([o.skills, o.agents, o.agentCalls], [["orbit-develop"], {}, 0], "what the switch refused was never used");
  assert.deepEqual(o.disabled, [{ kind: "skill", name: "orbit-engineer", dispatched: false }, { kind: "agent", name: "orbit-engineering-agent", dispatched: false }]);
  assert.deepEqual(row(judged(attempted, { switches: OFF, truth: ANY, routing: ROUTED("NONE") })), ["PASS", "PASS", null]);
  const ran = session(skill("orbit:orbit-engineer"));
  assert.deepEqual(row(judged(ran, { switches: OFF, truth: ANY, routing: ROUTED("NONE") })), ["FAIL", "BREACH", "HOST_DIVERGED"]);
  assert.deepEqual(row(judged(ran, { switches: OFF, truth: ANY, routing: ROUTED("DIRECT", "skill", "orbit-engineer") })), ["FAIL", "BREACH", "ORBIT_SOURCE_DEFECT"], "the router pointed at what the person switched off");
  assert.deepEqual(row(judged(ran, { arm: "baseline", switches: OFF, truth: ANY, routing: ROUTED("DIRECT", "skill", "orbit-engineer") })), ["FAIL", "BREACH", "HOST_DIVERGED"], "only the release arm's router is this release's");
  const claimed = session(skill("orbit:orbit-engineer", { refused: true, failed: false }));
  assert.deepEqual(row(judged(claimed, { switches: OFF, truth: ANY, routing: ROUTED("NONE") })), ["FAIL", "BREACH", "HOST_DIVERGED"], "a refusal the stream says succeeded is not a refusal");
  assert.deepEqual(observedOf(facts(ran, { truth: ANY })).disabled, [], "with no switch set, nothing is disabled");
});

const ANALYST = { ...ANY, readOnly: { "orbit-failure-analyst": [`^node ${ORBIT}/cli/(query|trace)\\.mjs\\b`] } };

test("a Bash call under an agent the truth holds read-only that none of its patterns allow is a BREACH; one they allow, or the session's own, is not", () => {
  const reading = session(agent("orbit:orbit-failure-analyst", [bash(`node ${ORBIT}/cli/query.mjs triage --json`)]));
  assert.deepEqual([observedOf(facts(reading, { truth: ANALYST })).breaches, judged(reading, { truth: ANALYST }).verdict], [[], "PASS"]);
  const writing = session(agent("orbit:orbit-failure-analyst", [bash(`node ${ORBIT}/cli/record-edge.mjs fix.jsonl --replace`)]));
  const j = judged(writing, { truth: ANALYST });
  assert.deepEqual(row(j), ["FAIL", "BREACH", "HOST_DIVERGED"]);
  assert.match(j.why, /orbit-failure-analyst wrote/);
  assert.deepEqual(observedOf(facts(session(bash(`node ${ORBIT}/cli/record-edge.mjs fix.jsonl --replace`)), { truth: ANALYST })).breaches, [], "the session's own call is not the agent's");
});

test("a command the truth forbids is a BREACH however it is spelled", () => {
  const truth = { ...ANY, forbid: { ...ANY.forbid, commands: ["\\bgit\\s+(-C\\s+\\S+\\s+|-c\\s+\\S+\\s+)*push\\b"] } };
  for (const cmd of ["git push origin HEAD", "cd /work/repo && git -C /work/repo push", "git -c core.askPass=x push --force"]) assert.deepEqual(row(judged(session(bash(cmd)), { truth, routing: ROUTED("NONE") })), ["FAIL", "BREACH", "HOST_DIVERGED"], cmd);
  assert.equal(judged(session(bash("git status && git log -1")), { truth, routing: ROUTED("NONE") }).verdict, "PASS");
});

// ---- the agreement rule ------------------------------------------------------------------------------------------------------

test("neither source is believed alone: a call no hook saw, or a trail line no call made, fails as INSUFFICIENT_EVIDENCE before any other row", () => {
  const unseen = session(skill("orbit:orbit-architecture", { trail: false }), bash(`node ${ORBIT}/cli/architecture.mjs ensure`));
  assert.deepEqual([row(judged(unseen)), judged(unseen).agreement.verdict], [["FAIL", "DISAGREES", "INSUFFICIENT_EVIDENCE"], "CONFLICTING"]);
  const forged = session(bash(`node ${ORBIT}/cli/architecture.mjs ensure`));
  forged.steps.push({ kind: "skill", label: "orbit:orbit-architecture", ok: true, refused: false });
  assert.deepEqual(row(judged(forged)), ["FAIL", "DISAGREES", "INSUFFICIENT_EVIDENCE"]);
  const both = session(skill("orbit:orbit-architecture", { trail: false }), bash("git push origin HEAD"));
  assert.equal(judged(both, { truth: { forbid: { skills: [], agents: [], commands: ["git push"] } } }).row, "DISAGREES", "the agreement is ruled on before a breach is");
  assert.equal(judged(RIGHT).agreement.verdict, "AGREES");
});

test("on the arm with no Orbit there is no trail and no Orbit call: either is CONFLICTING, and neither is AGREES", () => {
  const plain = session(read("/work/repo/src/money.mjs"));
  assert.equal(judged(plain, { arm: "none", turns: NO_TRAIL }).agreement.verdict, "AGREES");
  assert.equal(judged(session(skill("orbit:orbit-help", { trail: false })), { arm: "none", turns: NO_TRAIL }).agreement.verdict, "CONFLICTING", "an Orbit call where no Orbit was handed");
  assert.equal(judged(plain, { arm: "none", turns: turnsOf([{ kind: "skill", label: "orbit:orbit-help" }], ROUTED("NONE")) }).agreement.verdict, "CONFLICTING", "a trail where no plugin could write one");
});

test("a turn past the trail view's cap is held to the trail's uncapped usage, by name where usage keeps one", () => {
  const capped = session(skill("orbit:orbit-architecture"));
  const steps = [...capped.steps, ...Array.from({ length: MAX_STEPS }, () => ({ kind: "tool", label: "Read", ok: true }))];
  const usage = (invoked) => ({ exit: 0, json: { totals: { skills: invoked, agents: 0 }, skills: [{ id: "orbit-architecture", invoked, refused: 0 }] } });
  assert.deepEqual([judged(capped, { turns: turnsOf(steps, ROUTED("DIRECT", "skill", "orbit-architecture")), usage: usage(1) }).agreement.by, judged(capped, { turns: turnsOf(steps, ROUTED("DIRECT", "skill", "orbit-architecture")), usage: usage(1) }).agreement.verdict], ["usage", "AGREES"]);
  assert.equal(judged(capped, { turns: turnsOf(steps, ROUTED("DIRECT", "skill", "orbit-architecture")), usage: usage(2) }).agreement.verdict, "CONFLICTING");
  assert.equal(judged(capped, { turns: turnsOf(steps, ROUTED("DIRECT", "skill", "orbit-architecture")) }).agreement.verdict, "UNDETERMINED", "with no usage readable, never AGREES");
  assert.equal(judged(capped, { turns: turnsOf(steps, ROUTED("DIRECT", "skill", "orbit-architecture")) }).row, "DISAGREES");
});

// ---- the verdict, row by row --------------------------------------------------------------------------------------------------

test("the verdict is the first VERDICT row that holds, each with a class of the shared vocabulary, the last always holding", () => {
  assert.deepEqual(VERDICT.map((r) => r.id), ["ENVIRONMENT", "PROVIDER", "DISAGREES", "BREACH", "ACTIVATION", "STRATEGY", "SELECTION", "RECORDS", "GROUNDING", "VERIFIER_BLOCKED", "UNVERIFIED", "BUDGET", "OUTCOME", "PASS"]);
  assert.equal(VERDICT.at(-1).when({}), true);
  assert.deepEqual(row(judged(RIGHT)), ["PASS", "PASS", null]);
  assert.deepEqual(row(judged(RIGHT, { ran: { error: { says: "the runner could not reach its image" } } })), ["BLOCKED", "ENVIRONMENT", "ENVIRONMENT_BLOCKED"]);
  assert.deepEqual(row(judged(RIGHT, { text: JSON.stringify(ended()) })), ["BLOCKED", "PROVIDER", "PROVIDER_FAILURE"], "the host never said which model it runs");
  assert.deepEqual(row(judged(session(), { end: { is_error: true, subtype: "error_during_execution" } })), ["BLOCKED", "PROVIDER", "PROVIDER_FAILURE"], "an error before any tool use");
  for (const truth of [{}, ANY, { activate: false, strategy: ["NONE"] }]) {
    const x = judged(session(skill("orbit:orbit-x", { trail: false })), { truth });
    assert.ok(VERDICT.find((r) => r.id === x.row) && (x.class === null || FAILURE_CLASSES.includes(x.class)));
  }
});

test("activation that contradicts the truth fails as the host's divergence -- as Orbit's defect when the router pointed wrong too", () => {
  const idle = session(read("/work/repo/README.md"));
  assert.deepEqual(row(judged(idle)), ["FAIL", "ACTIVATION", "HOST_DIVERGED"], "Orbit's suggestion was right, and the host did nothing with it");
  assert.deepEqual(row(judged(idle, { routing: ROUTED("NONE") })), ["FAIL", "ACTIVATION", "ORBIT_SOURCE_DEFECT"], "the router said there was nothing to do");
  const negative = { activate: false, strategy: ["NONE"], selection: [{ skills: { require: [], allow: [] }, agents: { require: [], allow: [], max: 0 } }] };
  assert.deepEqual(row(judged(RIGHT, { truth: negative, routing: ROUTED("NONE") })), ["FAIL", "ACTIVATION", "HOST_DIVERGED"]);
  assert.deepEqual(row(judged(RIGHT, { truth: negative, routing: ROUTED("DIRECT", "skill", "orbit-architecture") })), ["FAIL", "ACTIVATION", "ORBIT_SOURCE_DEFECT"]);
  assert.deepEqual(row(judged(idle, { truth: ANY, routing: ROUTED("NONE") })), ["PASS", "PASS", null], "a truth that says either way holds activation to nothing");
});

// The 0.5.0 precheck's ORBIT-ACT-002 and 011 (bnr-1edd6094b59b, bnr-21ec33b2f8d5): the router chose DIRECT → orbit-develop,
// a one-cue change it never says (B5), and the miss read as a suggestion the host declined. The class stays the table's;
// the why says what the host was told.
test("a miss whose router chose right but said nothing to the host says so: no suggestion was declined", () => {
  const idle = session(read("/work/repo/README.md"));
  const unsaid = judged(idle, { routing: ROUTED("DIRECT", "skill", "orbit-architecture", { injected: false }) });
  assert.deepEqual(row(unsaid), ["FAIL", "ACTIVATION", "HOST_DIVERGED"]);
  assert.match(unsaid.why, /; the router chose DIRECT → orbit-architecture and said nothing to the host$/);
  assert.doesNotMatch(judged(idle).why, /said nothing/, "a router that said it is not reported silent");
  assert.doesNotMatch(judged(idle, { routing: ROUTED("NONE") }).why, /said nothing/, "nor one that chose nothing to say");
  const other = session(skill("orbit:orbit-develop"));
  assert.match(judged(other, { routing: ROUTED("DIRECT", "skill", "orbit-architecture", { injected: false }) }).why, /^no selection profile accepts .*; the router chose DIRECT → orbit-architecture and said nothing to the host$/, "a selection miss says it too");
});

test("a strategy the truth does not accept fails, and how a coordinated one was taken is judged only where the truth names how", () => {
  const coordinated = session(skill("orbit:orbit-help"), bash(`node ${ORBIT}/cli/automation.mjs start --for=x`));
  const wide = { selection: [{ skills: { require: [], allow: ["*"] }, agents: { require: [], allow: ["*"], max: 2 } }] };
  assert.deepEqual(row(judged(coordinated, { truth: wide })), ["FAIL", "STRATEGY", "HOST_DIVERGED"]);
  assert.deepEqual(row(judged(coordinated, { truth: { ...wide, strategy: ["COORDINATED"], how: ["goal"] }, routing: ROUTED("COORDINATED", "workflow", "orbit-help") })), ["FAIL", "STRATEGY", "HOST_DIVERGED"], "coordinated, but not the way the truth accepts");
  assert.deepEqual(row(judged(coordinated, { truth: { ...wide, strategy: ["COORDINATED"], how: ["automation"] }, routing: ROUTED("COORDINATED", "workflow", "orbit-help") })), ["PASS", "PASS", null]);
  assert.deepEqual(row(judged(coordinated, { truth: { ...wide, activate: null, strategy: [], how: [] }, routing: ROUTED("COORDINATED", "workflow", "orbit-help") })), ["PASS", "PASS", null], "a truth that names no strategy judges none, nor how");
  assert.deepEqual(row(judged(coordinated, { truth: wide, routing: ROUTED("COORDINATED", "workflow", "orbit-help") })), ["FAIL", "STRATEGY", "ORBIT_SOURCE_DEFECT"], "the router chose the strategy the truth refuses");
});

test("no selection profile matching, a forbidden component, or more agents than a profile's max fail as SELECTION", () => {
  assert.deepEqual(row(judged(session(skill("orbit:orbit-develop"), bash(`node ${ORBIT}/cli/context.mjs --for=x`)))), ["FAIL", "SELECTION", "HOST_DIVERGED"], "the right strategy with the wrong skill");
  assert.deepEqual(row(judged(session(skill("orbit:orbit-architecture"), skill("orbit:orbit-engineer")))), ["FAIL", "SELECTION", "HOST_DIVERGED"], "a forbidden skill beside the right one");
  const twice = session(skill("orbit:orbit-architecture"), agent("orbit:orbit-architecture-scanner"), agent("orbit:orbit-architecture-scanner"));
  const j = judged(twice);
  assert.deepEqual([row(j), j.observed.agents], [["FAIL", "SELECTION", "HOST_DIVERGED"], { "orbit-architecture-scanner": 2 }]);
  assert.match(j.why, /orbit-architecture-scanner×2/);
  assert.deepEqual(row(judged(session(skill("orbit:orbit-architecture"), agent("orbit:orbit-architecture-scanner")))), ["PASS", "PASS", null], "one is within its max");
});

test("an owner's record that does not hold fails as RECORDS, ORBIT_SOURCE_DEFECT -- read from the room first, never the host's word", () => {
  const truth = { records: [{ id: "architecture-ensured", read: "architecture", expect: {} }] };
  const j = judged(RIGHT, { truth, ins: { rooms: { exit: 0, json: { architecture: 0 } } } });
  assert.deepEqual(row(j), ["FAIL", "RECORDS", "ORBIT_SOURCE_DEFECT"]);
  assert.match(j.why, /architecture-ensured/);
  assert.deepEqual(row(judged(RIGHT, { truth, ins: { rooms: { exit: 0, json: { architecture: 2 } } } })), ["PASS", "PASS", null]);
});

test("a grounding row that does not hold fails as GROUNDING, the host's divergence", () => {
  const truth = { ...ANY, relevant: { direct: ["src/worker.mjs"], dependency: ["src/store.mjs"], downstream: [], verification: [] } };
  const tree = [{ rel: "src/worker.mjs", bytes: Buffer.from("w".repeat(40)) }, { rel: "src/store.mjs", bytes: Buffer.from("s".repeat(10)) }];
  assert.deepEqual(row(judged(session(read("/work/repo/src/store.mjs")), { truth, entries: tree, routing: ROUTED("NONE") })), ["FAIL", "GROUNDING", "HOST_DIVERGED"], "the direct item never read");
  assert.deepEqual(row(judged(session(read("/work/repo/src/worker.mjs")), { truth, entries: tree, routing: ROUTED("NONE") })), ["PASS", "PASS", null]);
});

test("an outcome case: a verifier that could not answer is BLOCKED, no answer is unverified, a spent budget is BUDGET_EXHAUSTED, then the hidden checks decide", () => {
  const out = (o) => ({ delivered: "host", changes: 2, complete: true, held: true, problem: null, problemEnds: [], says: "checks", ...o });
  const at = (outcome, o = {}) => row(judged(RIGHT, { tier: "outcome", outcome, ...o }));
  assert.deepEqual(at(out()), ["PASS", "PASS", null]);
  assert.deepEqual(at(out({ problem: "the verifier's container was refused", problemEnds: ["REFUSED"] })), ["BLOCKED", "VERIFIER_BLOCKED", "ENVIRONMENT_BLOCKED"]);
  assert.deepEqual(at(out({ problem: "the verifier ran past its deadline", problemEnds: ["TIMEOUT"] })), ["BLOCKED", "VERIFIER_BLOCKED", "INFRASTRUCTURE_FAILURE"]);
  assert.deepEqual(at(out({ complete: false, held: false })), ["FAIL", "UNVERIFIED", "INSUFFICIENT_EVIDENCE"]);
  assert.deepEqual(at(out({ held: false }), { end: { subtype: "error_max_turns" } }), ["FAIL", "BUDGET", "BUDGET_EXHAUSTED"], "the turn cap ended it before its checks could hold");
  assert.deepEqual(at(out({ held: false }), { ran: { container: { timedOut: true } } }), ["FAIL", "BUDGET", "BUDGET_EXHAUSTED"]);
  assert.deepEqual(at(out({ held: false, delivered: "host" })), ["FAIL", "OUTCOME", "HOST_DIVERGED"]);
  assert.deepEqual(at(out({ held: false, delivered: "orbit" })), ["FAIL", "OUTCOME", "ORBIT_SOURCE_DEFECT"], "an Orbit engineering task delivered what does not hold");
  assert.deepEqual(row(judged(RIGHT, { outcome: out({ held: false }) })), ["PASS", "PASS", null], "a selection case's outcome is a metric, never its verdict");
});

test("on the arm with no Orbit, nothing of selection or records is judged -- and a selection case there says only that it ran", () => {
  const idle = session(read("/work/repo/src/money.mjs"));
  const j = judged(idle, { arm: "none", turns: NO_TRAIL, truth: { records: [{ id: "architecture-ensured", read: "architecture", expect: {} }] } });
  assert.deepEqual([row(j), j.records, j.metric.applies, j.metric.router.judged], [["PASS", "PASS", null], [], false, false]);
  assert.deepEqual(row(judged(idle, { arm: "none", turns: NO_TRAIL, tier: "outcome", outcome: { delivered: "nothing", changes: 0, complete: true, held: false, problem: null, problemEnds: [] } })), ["FAIL", "OUTCOME", "HOST_DIVERGED"], "its hidden checks still decide an outcome case");
});

// ---- the router's own accuracy -------------------------------------------------------------------------------------------------

test("the router's decision is read off the session's own routed turn and held to the truth, apart from what the host did", () => {
  const turns = { exit: 0, json: { turns: [{ session: hostSession("claude", "another"), routing: ROUTED("COORDINATED", "workflow", "orbit-help") }, { session: hostSession("claude", SESSION), routing: ROUTED("DIRECT", "skill", "orbit-architecture") }, { session: hostSession("claude", SESSION), routing: { routing: "off" } }] } };
  assert.deepEqual(routerOf(turns, SESSION), { version: 3, strategy: "DIRECT", path: "skill", top: "orbit-architecture", injected: true, selected: ["orbit-architecture"] });
  assert.equal(routerOf(NO_TRAIL, SESSION), null);
  const v2 = { exit: 0, json: { turns: [{ session: hostSession("claude", SESSION), routing: { routing: "on", selected: [{ kind: "mcp", id: "x" }, { kind: "skill", id: "orbit:orbit-develop" }], approval: [], injected: true } }] } };
  assert.deepEqual(routerOf(v2, SESSION), { version: 2, strategy: null, path: null, top: "orbit-develop", injected: true, selected: ["x", "orbit-develop"] }, "the previous release's decision: its top selection alone");
  const right = (r, truth = {}) => routerRight(r, { ...TRUTH, ...truth });
  assert.equal(right(null), null, "no decision is never judged");
  assert.equal(right(routerOf(turns, SESSION)), true);
  assert.equal(right({ version: 3, strategy: "DIRECT", path: "skill", top: "orbit-develop" }), false, "the right strategy, a skill no profile accepts");
  assert.equal(right({ version: 3, strategy: "COORDINATED", path: "workflow", top: "orbit-help" }), false);
  assert.equal(right({ version: 3, strategy: "NONE", path: "none", top: null }), false, "the truth says to activate");
  assert.equal(right({ version: 3, strategy: "COORDINATED", path: "workflow", top: "orbit-help" }, { strategy: ["COORDINATED"], how: ["automation"] }), true, "a coordinated path's id names a door, judged by its strategy alone");
  assert.equal(right({ version: 3, strategy: "NONE", path: "none", top: null }, { activate: null, strategy: [] }), true);
  assert.equal(right({ version: 2, strategy: null, path: null, top: "orbit-architecture" }), true);
  assert.equal(right({ version: 2, strategy: null, path: null, top: null }), false, "v2 selected nothing where the truth says to activate");
  const j = judged(session(), { routing: ROUTED("DIRECT", "skill", "orbit-architecture") });
  assert.deepEqual([j.verdict, j.router.right, j.metric.router], ["FAIL", true, { judged: true, right: true }], "the host diverged; the router did not");
});

// ---- the owners' records ---------------------------------------------------------------------------------------------------------

test("each record reader holds what the inspection read back to what its row expects", () => {
  const ok = (read, rd, e = {}, f = {}) => RECORDS[read](rd, e, { seed: null, trail: null, session: SESSION, ...f }).ok;
  const view = (o) => ({ id: "tsk-0123456789ab", provider: "autonomous-engineering", lifecycle: "COMPLETED", actions: 3, receipts: [], approvals: [], ...o });
  assert.ok(ok("tasks", { views: [view()] }, { provider: "autonomous-engineering", lifecycle: "COMPLETED" }));
  assert.ok(!ok("tasks", { views: [view({ lifecycle: "EXECUTING" })] }, { provider: "autonomous-engineering", lifecycle: "COMPLETED" }));
  assert.ok(ok("tasks", { views: [view({ provider: "automation" })] }, { provider: "autonomous-engineering", count: 0 }), "filtered by provider");
  assert.ok(!ok("tasks", { views: [view()] }, { provider: "autonomous-engineering", stepped: false }), "an engineering task took a step");
  const committed = { receipts: [{ domain: "commit", outcome: "COMMITTED" }] };
  assert.ok(ok("tasks", { views: [view({ ...committed, approvals: [{ boundary: "GIT_PUSH", decision: null, open: true }] })] }, { pushHeld: true }));
  assert.ok(!ok("tasks", { views: [view({ ...committed, approvals: [{ boundary: "GIT_PUSH", decision: "granted" }] })] }, { pushHeld: true }), "an approval granted is not one waiting");
  assert.ok(!ok("tasks", { views: [view(committed)] }, { pushHeld: true }), "a commit with no approval asked");
  assert.ok(!ok("tasks", { views: [view({ receipts: [...committed.receipts, { domain: "push", outcome: "PUSHED" }], approvals: [{ boundary: "GIT_PUSH", decision: null }] })] }, { pushHeld: true }));
  const flow = (steps, o = {}) => ({ id: "tsk-00000000000f", revision: 9, steps, ...o });
  assert.ok(ok("workflows", { workflows: [flow([{ kind: "engineering", state: "succeeded" }, { kind: "regression", state: "pending" }])] }, { steps: ["engineering", "regression"], qa: "settled-or-left-out" }), "no QA step at all: left out of the plan");
  assert.ok(!ok("workflows", { workflows: [flow([{ kind: "engineering" }, { kind: "regression" }, { kind: "qa", state: "pending" }])] }, { steps: ["engineering", "regression"], qa: "settled-or-left-out" }), "a QA step left unsettled");
  assert.ok(!ok("workflows", { workflows: [flow([{ kind: "engineering" }])] }, { steps: ["engineering", "regression"] }));
  const seed = { kept: { workflow: "tsk-00000000000f", revision: 3 } };
  assert.ok(ok("workflows", { workflows: [flow([])] }, { moved: true }, { seed }));
  assert.ok(!ok("workflows", { workflows: [flow([], { revision: 3 })] }, { moved: true }, { seed }), "where the seed left it");
  assert.ok(!ok("workflows", { workflows: [flow([]), flow([], { id: "tsk-0000000000aa" })] }, { moved: true }, { seed }), "a second workflow started beside it");
  assert.ok(ok("works", { works: [{ ref: "ord-12" }] }, { ref: "ORD-12", count: 1 }) && !ok("works", { works: [{ ref: "ORD-12" }, { ref: "ORD-12" }] }, { ref: "ORD-12", count: 1 }));
  assert.ok(ok("architecture", { rooms: { architecture: 1 } }) && !ok("architecture", { rooms: {} }));
  assert.ok(ok("plans", { plans: [{ screen: "order-confirmation" }], plancheck: { exit: 0, errors: 0 } }, { screen: "order-confirmation" }));
  assert.ok(!ok("plans", { plans: [{ screen: "order-confirmation" }], plancheck: { exit: 1, errors: 2 } }, { screen: "order-confirmation" }), "plan-check not clean");
  const meaning = { "confirm-order": [["\"a\""], ["\"b\""]] };
  assert.ok(ok("cases", { check: { exit: 0 }, uitests: { cases: meaning } }, { case: "confirm-order" }, { seed: { cases: meaning } }));
  assert.ok(!ok("cases", { check: { exit: 0 }, uitests: { cases: { "confirm-order": [["\"a\""]] } } }, { case: "confirm-order" }, { seed: { cases: meaning } }), "a step's meaning changed");
  assert.ok(!ok("cases", { check: { exit: 1 }, uitests: { cases: meaning } }, { case: "confirm-order" }, { seed: { cases: meaning } }));
  assert.ok(ok("ledger", { ledger: [{ status: "PASS", sql: 0 }, { status: "BLOCKED", sql: 1 }] }) && !ok("ledger", { ledger: [{ status: "PASS", sql: 1 }] }), "no PASS resting on a sql step");
  assert.ok(ok("store", { uitests: { digests: { "graph/a.json": "x" } } }, {}, { seed: { digests: { "graph/a.json": "x" } } }));
  assert.ok(!ok("store", { uitests: { digests: { "graph/a.json": "y" } } }, {}, { seed: { digests: { "graph/a.json": "x" } } }) && !ok("store", { uitests: { digests: {} } }, {}, { seed: null }), "no seed is nothing to compare with");
  assert.ok(ok("rooms", { rooms: { tasks: 0, work: 0 } }, { none: ["tasks", "work"] }) && !ok("rooms", { rooms: { tasks: 1 } }, { none: ["tasks"] }));
  const trail = turnsOf([], ROUTED("DIRECT", "skill", "orbit-engineer", { injected: true }));
  assert.ok(!ok("router", {}, { injected: false }, { trail: { turns: trail } }) && !ok("router", {}, { never: ["orbit-engineer"] }, { trail: { turns: trail } }));
  assert.ok(ok("router", {}, { injected: false, never: ["orbit-engineer"] }, { trail: { turns: turnsOf([], ROUTED("NONE", "none", null, { injected: false })) } }));
});

test("a record row applies on the arms it names -- by default the two Orbit arms, never the arm with no Orbit", () => {
  const f = (arm, rows) => ({ arm, truth: { records: rows }, read: { rooms: { architecture: 0 } }, seed: null, trail: null });
  const rows = [{ id: "a", read: "architecture", expect: {} }, { id: "b", read: "architecture", expect: {}, arms: ["release"] }];
  assert.deepEqual(recordRows(f("release", rows)).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(recordRows(f("baseline", rows)).map((r) => r.id), ["a"]);
  assert.deepEqual(recordRows(f("none", rows)).map((r) => r.id), []);
});

// ---- grounding -----------------------------------------------------------------------------------------------------------------

test("what a host read is held to what is relevant: every direct item read or edited, no path the tree lacks -- with recall, invented paths and bytes read as facts", () => {
  const truth = { ...ANY, relevant: { direct: ["src/worker.mjs"], dependency: ["src/store.mjs", "src/orders.mjs"], downstream: [], verification: ["test/dedupe.test.mjs"] } };
  const tree = [["src/worker.mjs", 40], ["src/store.mjs", 10], ["src/orders.mjs", 7], ["test/dedupe.test.mjs", 5]].map(([rel, n]) => ({ rel, bytes: Buffer.alloc(n) }));
  const o = { truth, entries: tree, routing: ROUTED("NONE") };
  const good = judged(session(read("/work/repo/src/worker.mjs"), read("/work/repo/src/store.mjs")), o);
  assert.deepEqual([good.verdict, good.grounding.facts], ["PASS", { recall: 0.5, invented: 0, bytesRead: 50 }]);
  const invented = judged(session(read("/work/repo/src/worker.mjs"), read("/work/repo/src/payments.mjs")), o);
  assert.deepEqual([row(invented), invented.grounding.facts.invented], [["FAIL", "GROUNDING", "HOST_DIVERGED"], 1]);
  assert.match(invented.why, /src\/payments\.mjs/);
  assert.equal(judged(session(read("/work/repo/src"), read("/work/repo/src/worker.mjs")), o).verdict, "PASS", "a directory the tree holds is not invented");
  assert.equal(judged(session(read("/etc/hosts"), read("/work/repo/src/worker.mjs")), o).verdict, "PASS", "a path outside the target is not one the tree lacks");
});

// A goal's reading of a specification, as the inspection reads it back: its rows' kinds and the lines they cite.
const SPEC = ["Order holds", "1. A held order cannot be shipped.", "2. Large orders should be released quickly.", "Constraint: the existing routes keep their contract.", "- Shipping a held order answers 409."];

const goalRead = (requirements, acceptance = [{ line: 5 }]) => ({ goals: { exit: 0, json: { goals: [{ id: "goal-1", analysis: { requirements, acceptance }, lines: SPEC }] } } });

const GROUNDING = { ...ANY, grounding: { rows: [{ id: "ambiguity", marker: "Large orders should be released quickly", kinds: ["unknown", "assumption"] }, { id: "constraint", marker: "the existing routes keep their contract", kinds: ["constraint"] }], acceptance: ["Shipping a held order answers 409"] } };

test("a specification read into a goal is held to what each line is: the ambiguity never explicit and never a kind the engine only defaulted to", () => {
  const at = (requirements, o = {}) => judged(session(bash(`node ${ORBIT}/cli/orbit.mjs goal start --stdin`)), { truth: GROUNDING, routing: ROUTED("COORDINATED", "workflow", "orbit"), ins: goalRead(requirements), ...o });
  const good = at([{ kind: "explicit", line: 2 }, { kind: "unknown", line: 3 }, { kind: "constraint", line: 4 }]);
  assert.deepEqual([good.verdict, good.grounding.facts], ["PASS", { grounded: true, rows: { ambiguity: true, constraint: true }, acceptanceRecall: 1 }]);
  assert.deepEqual(row(at([{ kind: "explicit", line: 3 }, { kind: "constraint", line: 4 }])), ["FAIL", "GROUNDING", "HOST_DIVERGED"], "the ambiguity read as explicit");
  assert.deepEqual(row(at([{ kind: "assumption", kindDefaulted: true, line: 3 }, { kind: "constraint", line: 4 }])), ["FAIL", "GROUNDING", "HOST_DIVERGED"], "a kind the engine only defaulted to is never a reading");
  assert.deepEqual(row(at([{ kind: "unknown", line: 3 }])), ["FAIL", "GROUNDING", "HOST_DIVERGED"], "the constraint never read");
  const none = judged(session(read("/work/repo/README.md")), { truth: GROUNDING, routing: ROUTED("NONE") });
  assert.deepEqual([none.verdict, none.grounding.grounded, none.grounding.facts.grounded], ["PASS", false, false], "no goal read it: recorded as not grounded, never failed");
  assert.equal(judged(session(read("/work/repo/README.md")), { truth: GROUNDING, arm: "none", turns: NO_TRAIL }).grounding, null, "with no Orbit there is no goal to read it");
});

// A row the host sent with no citation cites no line (0.5.0, B21's review): the engine once made one up, `#L<i+1>`, and
// this judge then held the row to whatever that line said. Read back it is `line: null`, the reading of no line -- and a
// marker the specification does not hold is read by no row, not even one an earlier inspection read as line 0.
test("a goal row that cites no line is the reading of no line, as the inspection reads it back and as the judge holds it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-goal-reading-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ body: SPEC.join("\n") }));
  writeFileSync(join(dir, "journal.jsonl"), `${JSON.stringify({ kind: "analyzed", requirements: [{ kind: "unknown", sourceRef: "spec@abcdef01#L3" }, { kind: "constraint" }], acceptance: [{ sourceRef: "spec@abcdef01" }] })}\n`);
  const reading = goalReadingOf(dir).analysis;
  assert.deepEqual(reading, { requirements: [{ kind: "unknown", kindDefaulted: false, line: 3 }, { kind: "constraint", kindDefaulted: false, line: null }], acceptance: [{ line: null }] });
  const at = (requirements, acceptance, truth = GROUNDING) => judged(session(bash(`node ${ORBIT}/cli/orbit.mjs goal start --stdin`)), { truth, routing: ROUTED("COORDINATED", "workflow", "orbit"), ins: goalRead(requirements, acceptance) });
  assert.deepEqual(row(at(reading.requirements, reading.acceptance)), ["FAIL", "GROUNDING", "HOST_DIVERGED"], "the constraint, cited nowhere, was never read");
  assert.equal(at([{ kind: "unknown", line: 3 }, { kind: "constraint", line: 4 }], reading.acceptance).grounding.facts.acceptanceRecall, 0, "a criterion that cites no line recalls none");
  const nowhere = { ...GROUNDING, grounding: { rows: [{ id: "nowhere", marker: "a line the specification does not hold", kinds: ["unknown"] }], acceptance: [] } };
  assert.equal(at([{ kind: "unknown", line: 0 }, { kind: "unknown", line: null }], [], nowhere).verdict, "FAIL", "a marker the specification does not hold is read by no row");
});

// ---- what the metrics fold reads ------------------------------------------------------------------------------------------------

test("the metric facts a run keeps say what the truth asked and what the host did, each judged apart", () => {
  const m = judged(RIGHT).metric;
  assert.deepEqual(m, { applies: true, activate: true, activated: true, strategyNamed: true, strategyRight: true, skillProfile: true, skillsRight: true, agentProfile: true, agentsRight: true, agentCalls: 0, router: { judged: true, right: true }, recordsHeld: true, outcome: null, grounding: null });
  const wrong = judged(session(skill("orbit:orbit-develop"), agent("orbit:orbit-qa-agent"))).metric;
  assert.deepEqual([wrong.skillsRight, wrong.agentsRight, wrong.agentCalls], [false, false, 1]);
  assert.deepEqual(judged(RIGHT, { tier: "outcome", outcome: { delivered: "orbit", changes: 1, complete: true, held: true, problem: null, problemEnds: [] } }).metric.outcome, { held: true });
});
