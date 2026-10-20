// A plan is a GRAPH the tables draw (1.8.6): DEPENDS says what waits for what, a capability the objective names
// gets a step of its own, a workflow gap the skill factory may close gets its draft and register steps first, and
// the order is deterministic and topological -- so a plan an earlier release made still reads the same, and a
// cycle, an unpaired draft or a revision with no parent is refused before anything runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPENDS, BECAUSE, topo, withSteps } from "../src/automation/graph.mjs";
import { digestOf, downstreamOf, planOf, readyOf, replanOf, RULE_IDS, stateOf, validate } from "../src/automation/plan.mjs";
import { effectiveOf } from "../src/automation/settings.mjs";
import { KIND_IDS } from "../src/automation/steps.mjs";

const values = (extra = {}) => effectiveOf([{ by: "machine", content: { ...extra } }]).values;

const cap = (capability, more = {}) => ({ capability, outcome: "provided", provider: { id: "x" }, gap: null, word: "NO_GAP", generates: false, named: false, ...more });

const gapCap = (capability, more = {}) => cap(capability, { outcome: "gap", gap: "workflow", word: "WORKFLOW_GAP", generates: true, ...more });

const facts = (more = {}) => ((f) => ({ ...f, playbook: f.capabilities[0] ?? null }))({ objective: "o", ref: null, intent: "development", confidence: "high", matched: ["development"], requirement: null, startable: ["web"], capabilities: [cap("development.implementation")], named: [], ...more });

const ids = (plan) => plan.steps.map((s) => s.id);

const afterOf = (plan, id) => plan.steps.find((s) => s.id === id).after;

test("DEPENDS names only kinds, every kind has a row, and the whole table orders without a cycle", () => {
  assert.deepEqual(Object.keys(DEPENDS).sort(), [...KIND_IDS].sort());
  assert.deepEqual(Object.keys(BECAUSE).sort(), [...KIND_IDS].sort());
  for (const deps of Object.values(DEPENDS)) assert.ok(deps.every((k) => KIND_IDS.includes(k)));
  const all = KIND_IDS.map((kind) => ({ id: kind, kind, after: DEPENDS[kind] }));
  const ordered = topo(all);
  assert.equal(ordered.length, KIND_IDS.length);
  ordered.forEach((s, i) => assert.ok(s.after.every((a) => ordered.slice(0, i).some((e) => e.id === a)), `${s.id} waits for a later step`));
});

test("the engineering workflow: requirement and context wait for nothing, QA and regression both follow engineering, review waits for both", () => {
  const plan = planOf(facts({ ref: "PBI-1", requirement: { root: "req-0123456789ab", identity: "PBI-1", ready: true } }), values());
  assert.equal(plan.schema, 2);
  assert.deepEqual(ids(plan), ["requirement", "context", "runtime", "engineering", "qa", "regression", "review"]);
  assert.deepEqual(afterOf(plan, "requirement"), []);
  assert.deepEqual(afterOf(plan, "context"), []);
  assert.deepEqual(afterOf(plan, "engineering"), ["requirement", "context", "runtime"]);
  assert.deepEqual(afterOf(plan, "qa"), ["context", "runtime", "engineering"]);
  assert.deepEqual(afterOf(plan, "review"), ["qa", "regression"]);
  const states = stateOf(plan, { receipts: [] });
  assert.deepEqual(readyOf(states).map((s) => s.id), ["requirement", "context"], "several steps ready at once; the host picks one");
});

test("an edge joins only steps that are in the plan: no QA and no requirement leaves no edge to either", () => {
  const plan = planOf(facts({ startable: [] }), values());
  assert.deepEqual(ids(plan), ["context", "runtime", "engineering", "regression", "review"]);
  assert.deepEqual(afterOf(plan, "engineering"), ["context", "runtime"]);
  assert.deepEqual(afterOf(plan, "review"), ["regression"]);
  const inv = planOf(facts({ intent: "investigation", matched: ["investigation"], capabilities: [cap("qa.investigation")] }), values());
  assert.deepEqual(ids(inv), ["context", "runtime", "qa"]);
  assert.deepEqual(afterOf(inv, "qa"), ["context", "runtime"]);
});

test("a playbook workflow with a workflow gap keeps the ids and the order an earlier release gave it", () => {
  const plan = planOf(facts({ intent: "release", matched: ["release"], capabilities: [gapCap("release.checklist.verification")] }), values());
  assert.deepEqual(ids(plan), ["context", "propose-skill", "register-skill", "playbook"]);
  assert.deepEqual(plan.steps.map((s) => s.for ?? null), [null, "release.checklist.verification", "release.checklist.verification", "release.checklist.verification"]);
  assert.equal(plan.steps.find((s) => s.id === "playbook").provides, "release.checklist.verification");
  assert.equal(plan.steps.find((s) => s.id === "propose-skill").provides, null, "a draft step names no capability the resolver would look for");
  assert.deepEqual(afterOf(plan, "playbook"), ["context", "register-skill"]);
});

test("named capabilities get steps of their own; each one's generation waits only for its own draft", () => {
  const f = facts({ intent: "release", matched: ["release"], named: ["notes.verification", "deps.audit"], capabilities: [cap("release.gate"), gapCap("notes.verification", { named: true }), gapCap("deps.audit", { named: true })] });
  const plan = planOf(f, values());
  validate(plan);
  assert.deepEqual(ids(plan), ["context", "propose-skill.notes.verification", "propose-skill.deps.audit", "register-skill.notes.verification", "register-skill.deps.audit", "playbook.release.gate", "playbook.notes.verification", "playbook.deps.audit"]);
  assert.deepEqual(afterOf(plan, "register-skill.deps.audit"), ["propose-skill.deps.audit"]);
  assert.deepEqual(afterOf(plan, "playbook.notes.verification"), ["context", "register-skill.notes.verification"]);
  assert.deepEqual(afterOf(plan, "playbook.release.gate"), ["context"], "a provided capability waits for no draft");
  assert.deepEqual(plan.steps.find((s) => s.id === "propose-skill.notes.verification").needs, ["release.gate"], "a draft composes the capabilities the objective needs that ARE provided");
});

test("a named capability a kind of the plan already provides gets no second step", () => {
  const plan = planOf(facts({ named: ["qa.investigation"], capabilities: [cap("development.implementation"), cap("qa.investigation", { named: true })] }), values());
  assert.ok(!ids(plan).some((id) => id.startsWith("playbook")));
});

test("in an engineering workflow a named verification is drafted beside the change and review waits for it", () => {
  const plan = planOf(facts({ named: ["tenant.isolation.verification"], capabilities: [cap("development.implementation"), gapCap("tenant.isolation.verification", { named: true })] }), values());
  assert.deepEqual(afterOf(plan, "playbook"), ["context", "engineering", "register-skill"]);
  assert.deepEqual(afterOf(plan, "review"), ["qa", "regression", "playbook"]);
});

test("how many playbooks one task may draft bounds the generation planned; the rest are plain steps that block honestly", () => {
  const f = facts({ intent: "release", matched: ["release"], named: ["b.check", "c.check"], capabilities: [gapCap("a.check"), gapCap("b.check", { named: true }), gapCap("c.check", { named: true })] });
  const one = planOf(f, values({ skillFactory: { maxSkillsPerTask: 1 } }));
  assert.equal(one.steps.filter((s) => s.kind === "propose-skill").length, 1);
  assert.equal(one.steps.filter((s) => s.kind === "playbook").length, 3);
  const none = planOf(f, values({ skillFactory: { maxSkillsPerTask: 0 } }));
  assert.equal(none.steps.filter((s) => s.kind === "propose-skill").length, 0);
});

test("an id stays short enough for the journal's next-action slug, whatever the capability", () => {
  const long = `qa.${"tenant-isolation-".repeat(6)}verification`;
  const plan = planOf(facts({ intent: "release", matched: ["release"], named: [long, "x.check"], capabilities: [gapCap(long, { named: true }), gapCap("x.check", { named: true })] }), values());
  for (const s of plan.steps) assert.match(`step.${s.id}`, /^[a-z][a-z0-9.-]{0,63}$/, s.id);
  assert.equal(new Set(ids(plan)).size, plan.steps.length);
});

test("the same facts always plan the same, and every step says why it is there in one short sentence", () => {
  const f = facts({ ref: "PBI-7", requirement: { root: "req-0123456789ab", identity: "PBI-7", ready: false } });
  assert.equal(planOf(f, values()).digest, planOf(f, values()).digest);
  for (const s of planOf(f, values()).steps) assert.ok(s.because.length > 0 && s.because.length <= 120, s.id);
  assert.match(planOf(f, values()).steps.find((s) => s.id === "qa").because, /PBI-7/);
});

test("execution.maxPlanSteps bounds a plan: one that would need more is refused before it is written", () => {
  const plan = planOf(facts(), values({ execution: { maxPlanSteps: 3 } }));
  assert.throws(() => validate(plan), (e) => e.code === "PLAN_BOUNDED");
});

const bad = {
  BOUNDED: (p) => ({ ...p, steps: [] }),
  KNOWN_KIND: (p) => ({ ...p, steps: [...p.steps, { id: "deploy", kind: "deploy", after: [] }] }),
  UNIQUE_ID: (p) => ({ ...p, steps: [...p.steps, { ...p.steps[0] }] }),
  NO_FORWARD_REF: (p) => ({ ...p, steps: p.steps.map((s, i) => (i === 0 ? { ...s, after: [p.steps.at(-1).id] } : s)) }),
  GENERATION_PAIRED: (p) => ({ ...p, steps: p.steps.filter((s) => s.kind !== "register-skill").map((s) => (s.kind === "playbook" ? { ...s, after: ["context"] } : s)) }),
  REVISION: (p) => ({ ...p, n: 2 }),
};

test("each plan rule refuses on its own, by name", () => {
  const plan = planOf(facts({ intent: "release", matched: ["release"], capabilities: [gapCap("release.checklist.verification")] }), values());
  validate(plan);
  assert.deepEqual(Object.keys(bad).sort(), [...RULE_IDS].sort());
  for (const [id, breakIt] of Object.entries(bad)) assert.throws(() => validate(breakIt(plan)), (e) => e.code === `PLAN_${id}`, id);
});

// A plan an earlier release wrote: no schema, a chain, ids that are kinds.
const OLD = { n: 1, workflow: "engineering", intent: "development", objective: "o", steps: [["context", []], ["runtime", ["context"]], ["engineering", ["runtime"]], ["regression", ["engineering"]], ["review", ["regression"]]].map(([id, after]) => ({ id, kind: id, provides: null, after })), retries: { context: 1, runtime: 1, engineering: 1, regression: 0, review: 0 } };

test("a plan without the current schema is refused", () => {
  const old = { ...OLD, digest: digestOf(OLD) };
  assert.throws(() => validate(old), /unsupported workflow plan schema/);
});

test("planning again resets only what waits on the failed step: one playbook failing never resets another", () => {
  const f = facts({ intent: "release", matched: ["release"], named: ["b.check"], capabilities: [cap("a.gate"), cap("b.check", { named: true })] });
  const plan = planOf(f, values({ execution: { retries: { playbook: 1 } } }));
  const next = replanOf(plan, plan.steps.find((s) => s.id === "playbook.a.gate"));
  assert.deepEqual(next.reset, ["playbook.a.gate"]);
  assert.deepEqual(downstreamOf(plan, ["context"]).map((s) => s.id), ids(plan));
});

test("a revision keeps every id a step had, draws every edge again, and stays in order", () => {
  const plan = planOf(facts({ intent: "release", matched: ["release"], capabilities: [cap("release.gate")] }), values());
  const steps = withSteps(plan, [{ kind: "propose-skill", for: "release.gate" }, { kind: "register-skill", for: "release.gate" }]);
  assert.deepEqual(steps.map((s) => s.id), ["context", "propose-skill", "register-skill", "playbook"]);
  assert.deepEqual(steps.find((s) => s.id === "playbook").after, ["context", "register-skill"]);
});
