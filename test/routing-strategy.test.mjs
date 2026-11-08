// HOW MUCH ORBIT a prompt needs (0.5.0, B22, ADR 0050): src/routing/strategy.mjs, one ordered table over facts the
// composition root hands in. Every row is reached here from the facts that should reach it, the last row always
// matches, RESUME needs an open work some owner governs, and SATELLITE is never inferred from anything but Satellite's
// own words. The end-to-end answers, through the classifier and the resolver, are test/routing-corpus.test.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVATION_PATHS, DOORS, RESUMES, SPEC_ITEMS, STRATEGY, STRATEGY_WORDS, strategyOf } from "../src/routing/strategy.mjs";

const CLAUDE = { id: "claude", capabilities: { nativeAgents: true } };
const CODEX = { id: "codex", capabilities: { nativeAgents: false } };
const WORK = "w-0123456789ab";
const TASK = "tsk-0123456789ab";

const skill = (id, requirement, over = {}) => ({ kind: "skill", id, key: id, ownership: "plugin", requirement, via: [], gated: false, ...over });
const agent = (id, requirement, over = {}) => ({ kind: "agent", id, key: id, ownership: "plugin", requirement, via: [], gated: false, ...over });
const asked = (over = {}) => ({ intent: { id: "development", confidence: "high" }, matched: ["development"], marks: ["change"], shape: { chars: 40, items: 0, refs: 0 }, requirements: ["development.implementation"], ...over });
const open = (what = "workflow", over = {}) => ({ id: WORK, open: true, owner: { what, id: TASK }, ...over });

// One change asked for directly, on Claude Code, in a project whose coordinator and goal entry may be used.
const facts = (over = {}) => ({ synthetic: false, asked: asked(), chosen: [skill("orbit-develop", "development.implementation")], doors: { automation: "orbit-help", goal: "orbit" }, workflow: "engineering", host: CLAUDE, work: { named: [], current: null }, settings: { trigger: { arbitraryPrompt: true } }, plugin: "orbit", ...over });

const answered = (over) => strategyOf(facts(over));
const rowOf = (over) => answered(over).strategy.row;

test("every row is reached from the facts that mean it, and answers its own word and path", () => {
  const cases = [
    [{ asked: asked({ marks: ["command", "change", "continue"] }), work: { named: [open()], current: open() } }, "invoked", "NONE", "none"],
    [{ synthetic: true, work: { named: [open()], current: null } }, "envelope", "NONE", "none"],
    [{ asked: asked({ marks: ["opt-out", "continue"] }), work: { named: [], current: open() } }, "opted-out", "NONE", "none"],
    [{ work: { named: [open()], current: null } }, "resume", "RESUME", "resume"],
    [{ chosen: [] }, "conversational", "NONE", "none"],
    [{ asked: asked({ intent: { id: "development", confidence: "low" }, marks: ["status"] }) }, "conversational", "NONE", "none"],
    [{ chosen: [skill("satellite", "mission.orchestration", { gated: true }), skill("orbit-develop", "development.implementation")] }, "mission", "SATELLITE", "mission"],
    [{ asked: asked({ requirements: ["development.implementation", DOORS.goal] }) }, "specification", "COORDINATED", "goal"],
    [{ asked: asked({ matched: ["development", "security"] }) }, "several-owners", "COORDINATED", "workflow"],
    [{ asked: asked({ intent: { id: "qa", confidence: "high" }, matched: ["qa"] }), chosen: [agent("orbit-failure-analyst", "failure.classification"), skill("orbit-test-suite", "qa.execution")] }, "one-agent", "DIRECT", "agent"],
    [{}, "one-skill", "DIRECT", "skill"],
  ];
  for (const [over, row, word, path] of cases) {
    const a = answered(over);
    assert.deepEqual([a.strategy.row, a.strategy.word, a.activation.path], [row, word, path], JSON.stringify(over));
  }
  assert.deepEqual(STRATEGY.map((r) => r.row), ["invoked", "envelope", "opted-out", "resume", "conversational", "mission", "specification", "several-owners", "one-agent", "one-skill", "nothing"], "the table's order is the design's (§5.5), behind the person's own slash command (B22 M3)");
});

test("the last row always matches, and it is the only row that does whatever the facts", () => {
  const last = STRATEGY.at(-1);
  for (const f of [{}, null, facts(), facts({ chosen: [] }), { synthetic: true }]) assert.equal(last.when(f ?? {}), true);
  assert.deepEqual([last.row, last.word], ["nothing", "NONE"]);
  for (const row of STRATEGY.slice(0, -1)) assert.equal(row.when({ chosen: [skill("x", "y")], asked: asked() }) && row.when({ synthetic: true, chosen: [] }) && row.when({ chosen: [] }), false, `${row.row} is no catch-all`);
  assert.deepEqual(strategyOf(null).strategy.word, "NONE", "no facts at all is nothing to say");
});

test("every answer is one of the five words and one of the seven paths, with a reason made of table words and ids", () => {
  const all = [{ synthetic: true }, { work: { named: [open("task")], current: null } }, { chosen: [] }, { asked: asked({ matched: ["development", "requirements"] }) }, {}, { chosen: [skill("satellite", "mission.orchestration")] }];
  for (const over of all) {
    const a = answered(over);
    assert.ok(STRATEGY_WORDS.includes(a.strategy.word) && ACTIVATION_PATHS.includes(a.activation.path), JSON.stringify(a));
    assert.equal(typeof a.strategy.because, "string");
    assert.deepEqual(Object.keys(a.activation).sort(), ["how", "id", "invoke", "path"]);
  }
});

test("RESUME needs an open work some owner governs: closed, ungoverned, or merely current without a continue cue is not one", () => {
  assert.notEqual(rowOf({ work: { named: [open("workflow", { open: false })], current: null } }), "resume", "a closed work is not resumed");
  assert.notEqual(rowOf({ work: { named: [open("workflow", { owner: null })], current: null } }), "resume", "a work nobody governs is the host's own");
  assert.notEqual(rowOf({ work: { named: [open("goal")], current: null } }), "resume", "an owner with no resume read is not one");
  assert.notEqual(rowOf({ work: { named: [], current: open() } }), "resume", "this session's work, but the prompt did not say continue");
  assert.equal(rowOf({ asked: asked({ marks: ["continue"] }), work: { named: [], current: open() } }), "resume", "this session's work, and continue");
  assert.equal(rowOf({ asked: asked({ marks: ["continue"] }), work: { named: [], current: null }, chosen: [] }), "conversational", "continue with nothing open is nothing to resume");
  assert.equal(rowOf({ asked: asked({ marks: ["continue"] }), work: null, chosen: [] }), "conversational", "no work could be read: nothing is invented");
  assert.equal(rowOf({ asked: asked({ marks: ["status"] }), work: { named: [open()], current: null } }), "resume", "how an open work stands is its owner's read");
});

test("each owner is picked up through its own read: a workflow, an engineering task, an investigation", () => {
  for (const [what, command] of [["workflow", `automation.mjs resume ${TASK}`], ["task", `autonomous-engineering.mjs resume ${TASK}`], ["investigation", `autonomous-qa.mjs context --investigation=${TASK}`]]) {
    const a = answered({ work: { named: [open(what)], current: null } });
    assert.deepEqual([a.activation.path, a.activation.id, a.activation.how], ["resume", WORK, what]);
    assert.ok(a.activation.invoke.endsWith(command), a.activation.invoke);
  }
  assert.deepEqual(Object.keys(RESUMES), ["workflow", "task", "investigation"]);
  for (const make of Object.values(RESUMES)) assert.doesNotMatch(make(TASK), /--human|\bstep\b|\bstart\b|approve/, "a resume reads where the work stands; it never un-pauses or resends");
});

test("SATELLITE is never inferred: several intents, a long list, a work item and every owner still are not a mission", () => {
  const busy = asked({ intent: { id: "development", confidence: "high" }, matched: ["development", "qa", "investigation", "security", "requirements", "architecture", "documentation"], shape: { chars: 9000, items: 12, refs: 3 }, requirements: ["development.implementation", DOORS.goal, "qa.execution"] });
  const many = [skill("orbit-develop", "development.implementation"), skill("orbit-test-suite", "qa.execution"), skill("orbit-qa", "qa.investigation"), skill("orbit", DOORS.goal), agent("orbit-qa-agent", "qa.investigation")];
  for (const over of [{ asked: busy, chosen: many }, { asked: busy, chosen: many, settings: null }, { asked: busy, chosen: many, workflow: "none" }]) assert.notEqual(answered(over).strategy.word, "SATELLITE", JSON.stringify(over).slice(0, 80));
  assert.equal(answered({ asked: busy, chosen: [...many, skill("satellite", "mission.orchestration")] }).strategy.word, "SATELLITE", "only Satellite's own words, which chose it, make a mission");
});

test("COORDINATED needs a workflow that fits, the skill that opens it usable here, and a person's leave to say so", () => {
  const several = asked({ matched: ["development", "requirements"] });
  assert.equal(rowOf({ asked: several }), "several-owners");
  assert.equal(rowOf({ asked: several, workflow: "none" }), "one-skill", "no workflow fits");
  assert.equal(rowOf({ asked: several, workflow: null }), "one-skill", "nobody could say which workflow fits");
  assert.equal(rowOf({ asked: several, doors: { automation: null, goal: "orbit" } }), "one-skill", "orbit-help is switched off");
  assert.equal(rowOf({ asked: several, settings: { trigger: { arbitraryPrompt: false } } }), "one-skill", "a person kept the router from saying a workflow would fit");
  assert.equal(rowOf({ asked: several, settings: null }), "one-skill", "settings that could not be read say nothing on a person's behalf");
  assert.equal(rowOf({ asked: asked({ matched: ["development"], shape: { chars: 40, items: 0, refs: 1 } }) }), "several-owners", "a change to a work item it names by reference");
  assert.equal(rowOf({ asked: asked({ matched: ["development", "qa"] }) }), "one-skill", "a change and its tests is one specialist's job");
  assert.equal(rowOf({ asked: asked({ matched: ["requirements", "investigation"] }) }), "one-skill", "nothing to change: no workflow of owners in turn");
});

// Development's cues name code as well as ask for a change (an endpoint, a handler, a feature), so a development intent
// is a change only where the prompt asks for one: the `change` mark. Autonomous engineering's own words ask for one.
test("a change counts toward several owners only where it is asked for: a verb of change, or autonomous engineering's own words", () => {
  const ask = (over) => asked({ marks: [], ...over });
  assert.equal(rowOf({ asked: ask({ intent: { id: "investigation", confidence: "high" }, matched: ["investigation", "development"] }) }), "one-skill", "an investigation that names code asks for no change");
  assert.equal(rowOf({ asked: ask({ matched: ["development", "security"] }) }), "one-skill", "a security question that names an endpoint asks for no change");
  assert.equal(rowOf({ asked: ask({ shape: { chars: 40, items: 0, refs: 1 } }) }), "one-skill", "a question about the code a work item names");
  assert.equal(rowOf({ asked: ask({ matched: ["development", "security"], marks: ["change"] }) }), "several-owners", "a change asked for, and a verifier to prove it");
  assert.equal(rowOf({ asked: ask({ intent: { id: "autonomous-engineering", confidence: "high" }, matched: ["autonomous-engineering", "requirements"] }) }), "several-owners", "autonomously IS a change asked for");
});

test("a list is a specification only when it asks for a change or states a work item; acceptance criteria are one by their words", () => {
  const list = (over) => asked({ marks: [], shape: { chars: 600, items: SPEC_ITEMS, refs: 0 }, ...over });
  assert.equal(rowOf({ asked: list() }), "one-skill", "observations or questions that name code are no specification");
  assert.equal(rowOf({ asked: list({ marks: ["change"] }) }), "specification");
  assert.equal(rowOf({ asked: list({ intent: { id: "requirements", confidence: "low" }, matched: ["requirements"] }) }), "specification", "a list of what a work item requires");
  assert.equal(rowOf({ asked: asked({ marks: [], requirements: ["development.implementation", DOORS.goal] }) }), "specification", "acceptance criteria are a specification's own words");
});

// B22 M3: `/orbit-help fix the refund rule` was the person's own choice of what runs, and the router must never answer
// it with another skill for the words after the command -- nor resume, coordinate or start a mission past it.
test("a prompt the person opened with a slash command answers NONE before every other row, whatever its words would have chosen", () => {
  const command = (over = {}) => ({ asked: asked({ marks: ["command", "change"], ...over }) });
  const everything = { work: { named: [open()], current: open() }, chosen: [skill("satellite", "mission.orchestration", { gated: true }), agent("orbit-failure-analyst", "failure.classification"), skill("orbit-develop", "development.implementation")] };
  for (const over of [{}, { matched: ["development", "requirements"] }, { requirements: ["development.implementation", DOORS.goal] }, { marks: ["command", "continue"] }]) {
    const a = answered({ ...command(over), ...everything });
    assert.deepEqual([a.strategy.word, a.strategy.row, a.activation.path, a.activation.invoke], ["NONE", "invoked", "none", null], JSON.stringify(over));
    assert.match(a.strategy.because, /invoked a command themselves/);
  }
  assert.equal(rowOf({ synthetic: true, ...command() }), "invoked", "first of all: the host never writes a prompt that opens with a command");
  assert.equal(rowOf({}), "one-skill", "no command mark: the same prompt's words decide, as before");
});

test("a status question is the session's to answer only when it asks for nothing else", () => {
  const status = (over) => asked({ intent: { id: "development", confidence: "low" }, marks: ["status"], ...over });
  assert.equal(rowOf({ asked: status() }), "conversational");
  assert.equal(rowOf({ asked: status({ intent: { id: "development", confidence: "high" } }) }), "one-skill", "two words of a request make it a request, whatever else it asks");
  assert.equal(rowOf({ asked: status({ marks: ["status", "change"] }) }), "one-skill", "a change asked for beside it");
});

test("a specification goes to the goal domain only for a change or a work item, and a list counts from three items", () => {
  assert.equal(rowOf({ asked: asked({ shape: { chars: 600, items: SPEC_ITEMS, refs: 0 } }) }), "specification");
  assert.equal(rowOf({ asked: asked({ shape: { chars: 600, items: SPEC_ITEMS - 1, refs: 0 } }) }), "one-skill");
  assert.equal(rowOf({ asked: asked({ intent: { id: "requirements", confidence: "low" }, matched: ["requirements"], requirements: ["requirement.snapshot", DOORS.goal] }) }), "specification");
  assert.equal(rowOf({ asked: asked({ intent: { id: "qa", confidence: "high" }, matched: ["qa"], requirements: ["qa.execution", "qa.planning", DOORS.goal] }), chosen: [skill("orbit-test-plan", "qa.planning")] }), "one-skill", "a test plan that mentions acceptance criteria is a test plan");
  const goal = answered({ asked: asked({ requirements: ["development.implementation", DOORS.goal] }) });
  assert.deepEqual([goal.activation.id, goal.activation.how], ["orbit", "goal"]);
  assert.match(goal.activation.invoke, /orbit\.mjs goal start --stdin$/);
});

test("an agent is DIRECT only where the host dispatches agents, and never one only a parent dispatches", () => {
  const top = (a) => ({ asked: asked({ intent: { id: "qa", confidence: "low" }, matched: ["qa"] }), chosen: [a, skill("orbit-test-suite", "qa.execution")] });
  assert.deepEqual(answered(top(agent("orbit-failure-analyst", "failure.classification"))).activation, { path: "agent", id: "orbit-failure-analyst", how: null, invoke: "Agent orbit:orbit-failure-analyst" });
  assert.equal(rowOf({ ...top(agent("orbit-failure-analyst", "failure.classification")), host: CODEX }), "one-skill", "no native agents: the skill's own loop, in the session");
  assert.equal(rowOf({ ...top(agent("orbit-failure-analyst", "failure.classification")), host: null }), "one-skill", "an unknown host is never assumed to have agents");
  assert.equal(rowOf(top(agent("orbit-map-healer", "ui.map-repair", { via: ["orbit-ui-map"] }))), "one-skill", "a healer follows its parent's step");
});

test("DIRECT names the one specialist: a shipped skill by its plugin name, a generated playbook through the factory, else nothing", () => {
  assert.equal(answered({}).activation.invoke, "Skill orbit:orbit-develop");
  assert.equal(answered({ plugin: "acme" }).activation.invoke, "Skill acme:orbit-develop");
  const playbook = answered({ chosen: [skill("release-notes", "release.notes", { key: "project:release-notes", ownership: "project" })] });
  assert.deepEqual([playbook.activation.path, playbook.activation.invoke], ["skill", "node <engine>/cli/skill-factory.mjs show release-notes"]);
  const server = answered({ chosen: [{ kind: "mcp", id: "docs", key: "managed:docs", ownership: "orbit-managed", requirement: "documentation.search", via: [], gated: false }] });
  assert.deepEqual([server.strategy.word, server.activation.path], ["DIRECT", "none"], "a server Orbit manages is listed, and no skill or agent is named for it");
});

test("the reason a strategy gives names table words, requirements and ids -- nothing a prompt said", () => {
  const several = answered({ asked: asked({ matched: ["development", "security"] }) });
  assert.equal(several.strategy.because, "a change several owners take in turn (development, security): orbit-help starts the workflow");
  assert.equal(answered({}).strategy.because, "one specialist provides development.implementation");
  assert.equal(answered({ work: { named: [open()], current: null } }).strategy.because, `open work ${WORK} is governed by workflow ${TASK}`);
});
