// The plan vocabulary, the generated schema, the loader and the validator.
//
// Every test here is about a MISTAKE somebody makes writing a plan, not about
// the shape of an object -- the shapes are declared once in qa/fields.mjs and
// enforced by the same constraints.mjs a case is held to, so re-asserting them
// would only prove the table was copied into the test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LAYERS } from "../src/dsl/verbs.mjs";
import { loadCases } from "../src/dsl/load.mjs";
import { loadGraph } from "../src/graph/index.mjs";
import { capabilitiesOf } from "../src/qa/capability.mjs";
import { checkPlans, exitOf } from "../src/qa/check.mjs";
import { commitments, gaps } from "../src/qa/commit.mjs";
import { findPlan, loadPlans } from "../src/qa/load.mjs";
import { planMarkdown } from "../src/qa/markdown.mjs";
import { planSchema } from "../src/qa/schema.mjs";
import { ADVICE } from "../src/qa/finding.mjs";
import { securityFindings } from "../src/qa/rules/security.mjs";
import { skeletonPlan } from "../src/qa/skeleton.mjs";
import { MUTATIONS, NEEDS, REPEATS, RUN_STATES, TECHNIQUES, verifies } from "../src/qa/vocab.mjs";
import { planFindings } from "../src/qa/validate.mjs";
import { FIXTURES, UI_TESTS } from "./fakes/context.mjs";

const graph = loadGraph(join(UI_TESTS, "graph"));
const cases = new Map(loadCases(join(UI_TESTS, "screens")).map((c) => [c.id, c]));
const world = { cases, graph, caps: capabilitiesOf({ sql: { command: ["sqlcmd"] } }), head: "abc1234", env: "test" };
const PLANS = join(UI_TESTS, "screens");

const things = () => findPlan(PLANS, "things");
const bad = () => findPlan(PLANS, join(FIXTURES, "plan.bad.json"));

const says = (found, re) => found.some((f) => re.test(f.say));
const has = (found, re) => assert.ok(says(found, re), `expected a finding matching ${re}\n${found.map((f) => `${f.level} ${f.say}`).join("\n")}`);
const hasNot = (found, re) => assert.ok(!says(found, re), `did not expect a finding matching ${re}`);
const levelOf = (found, re) => found.find((f) => re.test(f.say))?.level;

test("the fixture plan is clean, and its advisories are advisories", () => {
  const found = planFindings(things(), world);
  assert.deepEqual(found.filter((f) => f.level === "error"), [], "the shipped fixture plan must have no errors");
  assert.ok(found.some((f) => f.level === "advice"), "it deliberately keeps a few things a person has to look at");
  assert.equal(exitOf(checkPlans([things()], world)), 0, "advisories never change the exit code");
});

// The whole point of the level split: a heuristic must not be able to fail a
// build, and a violation must not be filed as a suggestion.
test("errors and advisories are separated, and only errors decide the exit code", () => {
  const report = checkPlans([bad()], world);
  assert.ok(report.errors > 20, `the bad fixture should trip most families, got ${report.errors}`);
  assert.equal(exitOf(report), 1);
  assert.equal(exitOf(checkPlans([], world)), 0, "no plans is not a failure");
});

test("identity and reference: a dangling id, a duplicate and a cycle are all errors", () => {
  const found = planFindings(bad(), world);
  has(found, /covers AC7, which no criteria declares/);
  has(found, /hands over to M9, which no manual declares/);
  has(found, /cites source REQ9, which the plan does not list/);
  has(found, /S5 is used 2 times/);
  has(found, /dependsOn forms a cycle: S\d -> S\d -> S\d/);
  assert.equal(planFindings(bad(), world).filter((f) => /forms a cycle/.test(f.say)).length, 1, "one loop is reported once, however many members you start from");
});

// The confusion this vocabulary exists to end. notRoles says WHO is running.
test("notRoles alone is not a permission verdict, and REFUSED is not a product behaviour", () => {
  const found = planFindings(bad(), world);
  has(found, /S2: technique permission needs a denial block/);
  assert.equal(levelOf(found, /expects "REFUSED", which is a RUNNER outcome/), "advice", "a word in prose is a heuristic, so it advises");
  const stray = planFindings(withScenario({ id: "S9", name: "x", technique: "crud", actor: { as: "v", notRoles: ["App.Admin"] }, expect: ui() }), world);
  has(stray, /names notRoles but no denial — notRoles verifies WHO is running/);
});

test("a permission scenario owes an observable refusal, and evidence that nothing changed", () => {
  const naked = withScenario({ id: "S9", name: "x", technique: "permission", denial: {}, mutation: { kind: "delete" }, expect: ui() });
  const found = planFindings(naked, world);
  has(found, /denial says nothing about the screen/);
  has(found, /the refused action writes, but nothing states what must be UNCHANGED/);
  assert.equal(levelOf(found, /denial says nothing about the server/), "advice", "a hidden control need not produce a rejected request");
});

// The hole this family closes. `mutation.mjs` makes every witness layer
// compulsory for a scenario that WRITES, and `expect.mjs` refuses an
// `unverifiable` with no reason -- neither fires for a READ-ONLY scenario, so
// one that requires `ui` and quietly drops the integration it depends on used
// to pass clean.
test("a capability gap blocks automation, and is never a reason to drop the layer", () => {
  const found = planFindings(bad(), world);
  has(found, /S6: carries a capability blocker that does not say what is missing/);
  assert.equal(levelOf(found, /does not say what is missing/), "error", "an empty `says` is demonstrable");
  assert.equal(levelOf(found, /still commits every layer to `required`/), "advice", "which of the two is wrong is a judgement, so it advises");
});

// The word `capability` is read off the blocker vocabulary, and `required` off
// the needs table's own column -- so a fourth `need` next year is covered by
// its row rather than by editing this rule.
test("a capability blocker beside an honest unverifiable layer is accepted", () => {
  const honest = withScenario({ id: "S9", name: "x", readiness: "blocked", blockers: [{ id: "B9", kind: "capability", says: "no adapter reads that store; add one or check it by hand" }], expect: { ui: { need: "unverifiable", says: "nothing here can see it" } } });
  const found = planFindings(honest, world).filter((f) => /S9/.test(f.say) && /capability/.test(f.say));
  assert.deepEqual(found, [], `a correctly declared gap must be silent, got: ${found.map((f) => f.say).join(" · ")}`);
});

test("a scoping scenario must name whose record it is", () => {
  const found = planFindings(withScenario({ id: "S9", name: "x", technique: "scoping", denial: { ui: "not shown" }, expect: ui() }), world);
  has(found, /names no owner or tenant for the resource/);
});

// SKIP is the absence of a test, correctly reported. It is never evidence.
test("a skip guard is not idempotency, and a sequence is not concurrency", () => {
  const found = planFindings(bad(), world);
  has(found, /S3: repeat.kind is "none", so the action never happens twice/);
  has(found, /S3: repeat states no expected result for the second attempt/);
  has(found, /S3: links create-thing, which performs its action once. Its skip-if guard protects the re-RUN and makes the second attempt SKIP — a SKIP verifies nothing/);
  has(found, /S5: is a concurrency scenario with repeat.kind "resubmit" — that is a sequence/);
});

test("the case that really does it twice is accepted", () => {
  const found = planFindings(things(), world);
  hasNot(found, /performs its action once/);
  assert.ok(cases.get("resubmit-thing").steps.filter((st) => st.on === "dlg-thing/Save").length === 2, "the fixture case presses Save twice on purpose");
});

// Not only `creates`. An update that writes the wrong row is the same bug.
test("every kind of change owes the same five sentences, a data lifecycle and a witness", () => {
  const found = planFindings(bad(), world);
  for (const said of [/does not say the state before/, /does not say the state after/, /does not say what happens when it is refused/, /does not say what must be UNCHANGED/]) has(found, said);
  has(found, /S4: changes data but does not say how it is put back/);
  has(found, /S4: names no business key or record id/);
  has(found, /S4: changes data and says nothing about api/);
  has(found, /S4: changes data and says nothing about sql/);
});

test("a reload is not a commit, and a deadline needs a source", () => {
  const found = planFindings(bad(), world);
  has(found, /S4: waits 60s for completion with no reason given/);
  has(found, /S4: watches only the screen for completion/);
  has(found, /S4: is asynchronous but does not say what counts as finished/);
});

// A link is a claim about a file, and the claim is checked.
test("a case link has to exist, validate, and be able to rule on what the scenario committed to", () => {
  const found = planFindings(bad(), world);
  has(found, /links case no-such-case, which no screen folder holds/);
  has(found, /commits to api in expect.api .* but archive-thing, no-such-case rules on api nowhere. A link is not coverage/);
});

test("a scenario with no case yet is not an error — a plan is written before its cases", () => {
  const early = withScenario({ id: "S9", name: "x", technique: "crud", expect: ui(), cases: [] });
  hasNot(planFindings(early, world), /rules on ui nowhere/);
});

// A layer the engine has a verb for is not a layer this project can read.
test("a committed layer the project has no tool for is a reported gap, never a silent pass", () => {
  const none = { ...world, caps: capabilitiesOf({}) };
  const found = planFindings(things(), none);
  assert.equal(levelOf(found, /declares no sql.command/), "advice");
  has(found, /commits to sql in expect.sql .* declares no sql.command/);
});

test("a layer no verb proves is one finding, from the family that owns it", () => {
  const found = planFindings(bad(), world);
  has(found, /expect.queue is not a layer this engine can rule on — ui, api, sql/);
  hasNot(found, /commits to queue/);
});

test("a missing control blocks AUTOMATION and keeps the scenario in the plan", () => {
  const s = things().scenarios.find((x) => x.id === "S2");
  assert.equal(s.readiness, "blocked");
  assert.match(s.blockers[0].says, /record them with record-edge/i);
  assert.deepEqual(commitments(s).map((c) => c.layer), ["ui"], "it still commits to what CAN be seen");
  assert.deepEqual(gaps(s).map((g) => g.layer).sort(), ["api", "api", "sql"], "and records what cannot, with reasons");
});

test("a manual check is work somebody does: an owner, steps, an expected result", () => {
  const found = planFindings(bad(), world);
  for (const said of [/does not say why it is not automated/, /does not say what the person must see/, /does not say what the person does, in order/, /names nobody to do it/]) has(found, said);
  has(found, /is marked done but carries no evidence/);
});

// A person may overrule a score. Doing it in silence is what gets a word.
test("a priority that disagrees with the risk score in silence is advice, not an error", () => {
  const odd = withScenario({ id: "S9", name: "x", priority: "P1", risk: { impact: 1, likelihood: 1 }, expect: ui() });
  const found = planFindings(odd, world);
  assert.equal(levelOf(found, /bands it P3/), "advice");
  has(found, /is P1 while its risk score \(2 of 10, from impact, likelihood\) bands it P3/);
  const said = withScenario({ id: "S9", name: "x", priority: "P1", because: "the auditors ask for it every quarter", risk: { impact: 1, likelihood: 1 }, expect: ui() });
  hasNot(planFindings(said, world), /bands it P3/);
  hasNot(planFindings(things(), world), /bands it/, "the fixture's priorities and scores agree");
});

test("ready and blocked are held against each other, both ways round", () => {
  const found = planFindings(bad(), world);
  has(found, /S5: is ready but still lists 1 blocker\(s\)/);
  has(planFindings(withScenario({ id: "S9", name: "x", readiness: "blocked", expect: ui() }), world), /is blocked by nothing — name the blocker/);
});

// Everything in this family is ADVICE. Whether a requirement has moved is not
// something this tool can demonstrate, and a build that fails because a commit
// advanced is a build people learn to ignore.
test("how old the plan's references are is reported, and never as an error", () => {
  const found = planFindings(things(), { ...world, head: "def5678" });
  assert.equal(levelOf(found, /its PASS is history until it runs again/), "advice", "a case recorded at an older build");
  const undated = { ...things(), sources: [{ id: "REQ1", kind: "requirement", ref: "THING-1" }] };
  assert.equal(levelOf(planFindings(undated, world), /has no revision recorded/), "advice", "nothing can say whether it has changed since");
  const moved = planFindings(things(), { ...world, graph: { ...graph, meta: { ...graph.meta, fe_commit: "def5678" } } });
  has(moved, /was designed against frontend abc1234; the map is now at def5678/);
  assert.equal(levelOf(planFindings({ ...things(), at: undefined }, world), /records no `at`/), "advice");
  assert.ok(planFindings(things(), { ...world, head: "def5678" }).every((f) => f.level === "advice" || !/revision|frontend|history until/.test(f.say)));
});

test("every criterion is covered or disposed of, out loud", () => {
  const found = planFindings(bad(), world);
  has(found, /AC1: no scenario or manual check covers it, and it states no disposition/);
  const open = withCriterion({ id: "AC9", says: "x", disposition: { state: "open", because: "nobody has decided" } });
  assert.equal(levelOf(planFindings(open, world), /AC9: is not covered/), "advice", "an open gap said out loud is a gap, not a violation");
});

// The vocabulary is DATA, and the rules read columns off it.
test("the vocabularies are tables the rules read, not lists the rules repeat", () => {
  assert.deepEqual(TECHNIQUES.filter((t) => t.asks === "denial").map((t) => t.name), ["permission", "scoping"]);
  assert.deepEqual(TECHNIQUES.filter((t) => t.asks === "repeat").map((t) => t.name), ["idempotency", "concurrency"]);
  assert.deepEqual(MUTATIONS.filter((m) => m.writes).map((m) => m.name), ["create", "update", "delete", "transition", "side-effect"]);
  assert.deepEqual(REPEATS.filter((r) => r.parallel).map((r) => r.name), ["concurrent"]);
  assert.deepEqual(NEEDS.filter((n) => n.proves).map((n) => n.name), ["required"], "exactly one disposition counts as verification asked for");
  assert.deepEqual(RUN_STATES.filter((r) => r.verifies).map((r) => r.name), ["PASS"], "exactly one runner status verifies anything");
  for (const st of ["SKIP", "PARTIAL", "REFUSED", "BLOCKED", "INCONCLUSIVE", "FAIL"]) assert.equal(verifies(st), false, st);
});

test("the plan schema is generated from the field tables and knows every layer", () => {
  const s = planSchema();
  assert.deepEqual(s.required, ["schema", "id", "title", "criteria", "scenarios"]);
  assert.equal(s.additionalProperties, false);
  assert.ok(s.definitions.scenario.properties.expect.description.includes(LAYERS.join(", ")), "the layers come from the verb table");
  assert.ok(!JSON.stringify(s).includes('"doc":'), "doc becomes description; the engine's own keys never reach a published schema");
  assert.deepEqual(s.definitions.async.properties.observe.items.enum, LAYERS);
});

test("the schema on disk is what the generator produces", () => {
  const disk = readFileSync(join(UI_TESTS, "schema", "plan.schema.json"), "utf8").replace(/\r\n/g, "\n").trim();
  assert.equal(disk, JSON.stringify(planSchema(), null, 2).trim(), "schema/plan.schema.json has drifted — node cli/schema.mjs --write");
});

test("an unsupported schema version stops everything, and says which way to fix it", () => {
  const found = planFindings({ ...things(), schema: 99 }, world);
  assert.equal(found.length, 1, "a rule cannot say anything useful about a vocabulary it does not have");
  has(found, /is written to plan schema 99; this engine reads 1/);
  has(planFindings({ ...things(), schema: undefined }, world), /no schema version/);
});

test("a plan that will not parse becomes a finding, not a crash", () => {
  const broken = { _file: "/x/broken.plan.json", _broken: "is not valid JSON: Unexpected token" };
  has(planFindings(broken, world), /broken.plan.json: is not valid JSON/);
  has(planFindings({ ...things(), scenarios: {} }, world), /scenarios must be an array, not an object/);
});

// Compatibility: a plan written before this vocabulary is still somebody's plan.
test("a Markdown-only plan is found and reported, never rewritten", () => {
  assert.equal(findPlan(PLANS, "unsupported-plan"), null);
  assert.equal(exitOf(checkPlans(loadPlans(PLANS), world)), 0);

});

test("the Markdown is rendered from the plan, and says so", () => {
  const md = planMarkdown(things());
  assert.match(md, /^<!-- GENERATED from things.plan.json/);
  assert.match(md, /## Acceptance criteria/);
  assert.match(md, /### S1 — An administrator creates a thing {2}\[P1\] {2}MUST/);
  assert.match(md, /\*\*SQL:\*\* exactly one row in Things named \$\{NAME\}/);
  assert.match(md, /\*\*API:\*\* unverifiable — the map records no effect for detail\/Archive/, "a gap is rendered as a gap");
  assert.match(md, /## Manual checks/);
  assert.match(md, /Q1/);
});

test("a pipe or a newline in somebody's prose cannot break the table", () => {
  const nasty = withCriterion({ id: "AC9", says: "a | b\nc", disposition: { state: "excluded", because: "x" } });
  const row = planMarkdown(nasty).split("\n").find((l) => l.startsWith("| AC9"));
  assert.equal(row, "| AC9 | a \\| b c |  | excluded: x |");
});

test("the scaffold a project starts from is clean", () => {
  const found = planFindings(skeletonPlan("checkout"), world);
  assert.deepEqual(found.filter((f) => f.level === "error"), [], "a scaffold that arrives with errors teaches people to ignore the checker");
});

const ui = () => ({ ui: { need: "required", says: "something" } });

const withScenario = (s) => ({ schema: 1, id: "t", title: "t", at: "2026-01-01", criteria: [{ id: "AC1", says: "x", disposition: { state: "excluded", because: "y" } }], scenarios: [s] });

const withCriterion = (c) => ({ schema: 1, id: "t", title: "t", at: "2026-01-01", criteria: [c], scenarios: [] });

// A plan is asked what it OWES, from what it already declares about itself.
// The technique existed; nothing ever brought it up, so the test most likely to
// be missing was the one nothing was looking for.
test("a plan derives its own security obligations, and says which signal raised each", () => {
  const scenario = (over) => ({ id: "S1", technique: "crud", mutation: { kind: "none" }, ...over });
  const said = (p) => securityFindings(p).map((f) => f.say);

  const gated = said({ id: "p", scenarios: [scenario({ actor: { roles: ["Admin"] } })] });
  assert.equal(gated.length, 1);
  assert.match(gated[0], /p S1: scenarios here name roles, and no scenario is a permission one/);

  assert.match(said({ id: "p", scenarios: [scenario({ actor: { tenant: "other" } })] })[0], /name an owner or a tenant, and no scenario is a scoping one/);
  assert.match(said({ id: "p", scenarios: [scenario({ mutation: { kind: "create" } })] })[0], /scenarios here write, and no scenario is a permission one/);

  assert.ok(securityFindings({ id: "p", scenarios: [scenario({ actor: { roles: ["Admin"] } })] }).every((f) => f.level === ADVICE),
    "whether a feature needs a permission test is a judgement — it may never fail a build");
});

test("an obligation already discharged is not raised again, and a plan with nothing to protect is left alone", () => {
  const gatedAndTested = { id: "p", scenarios: [
    { id: "S1", technique: "crud", mutation: { kind: "create" }, actor: { roles: ["Admin"] } },
    { id: "S2", technique: "permission", mutation: { kind: "none" }, actor: { notRoles: ["Admin"] } },
  ] };
  assert.deepEqual(securityFindings(gatedAndTested), [], "roles and writes are both answered by the permission scenario");

  assert.deepEqual(securityFindings({ id: "p", scenarios: [{ id: "S1", technique: "boundary", mutation: { kind: "none" } }] }), [],
    "a read-only scenario with no actor declares no attack surface, and inventing one would be noise");
  assert.deepEqual(securityFindings({ id: "p" }), [], "and a plan with no scenarios is not yet a plan");
});

// The advice says "or put it in exclusions with a reason"; an exclusion naming the technique is that decision.
test("an exclusion naming a technique answers the obligation it decides against", () => {
  const writes = [{ id: "S1", technique: "crud", mutation: { kind: "create" }, actor: { owner: "the actor" } }];
  assert.equal(securityFindings({ id: "p", scenarios: writes }).length, 2, "owned data and a write: scoping and permission are owed");
  const decided = { id: "p", scenarios: writes, exclusions: [
    { id: "X1", says: "Permission.", because: "one kind of user", technique: "permission" },
    { id: "X2", says: "Tenant scoping.", because: "no tenants", technique: "scoping" },
  ] };
  assert.deepEqual(securityFindings(decided), []);
  assert.equal(securityFindings({ ...decided, exclusions: [{ id: "X1", says: "Permission.", because: "one kind of user" }] }).length, 2,
    "an exclusion that names no technique decides nothing a rule can read");
});
