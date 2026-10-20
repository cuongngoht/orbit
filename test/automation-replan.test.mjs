// A plan is REVISED only on what a journal or an owner demonstrates (1.8.6): every trigger row reachable in its
// moment, each response building a revision that names the plan it replaced and why, structural revisions bounded
// by what a person allows -- and the loop applying them without losing a receipt: a playbook nothing provides gets
// its draft steps once a person lets the factory close the gap, a requirement that moved has what was built on it
// planned again, and a QA step goes in once discovery finds something to start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { digestOf, planOf, validate } from "../src/automation/plan.mjs";
import { RESPONSE_IDS, TRIGGERS, TRIGGER_IDS, respond, structuralOf } from "../src/automation/replan.mjs";
import { effectiveOf } from "../src/automation/settings.mjs";
import { automationWorld, contextOf, next, settle, start } from "./fakes/automation.mjs";

const values = (extra = {}) => effectiveOf([{ by: "machine", content: { ...extra } }]).values;

const provided = (capability) => ({ capability, outcome: "provided", generates: false, named: false });

const facts = (more = {}) => ((f) => ({ ...f, playbook: f.capabilities[0] ?? null }))({ objective: "o", ref: "PBI-1", intent: "development", confidence: "high", matched: ["development"], requirement: { root: "req-0123456789ab", identity: "PBI-1", ready: true }, startable: [], capabilities: [provided("development.implementation")], named: [], ...more });

const playbookPlan = () => planOf(facts({ ref: null, requirement: null, intent: "release", matched: ["release"], capabilities: [{ capability: "release.checklist.verification", outcome: "gap", generates: false, named: false }] }), values());

const stepOf = (plan, id, state = "pending") => ({ ...plan.steps.find((s) => s.id === id), state });

test("every trigger row is reachable in its moment, and each moment's last row always answers", () => {
  const plan = playbookPlan();
  const eng = planOf(facts(), values());
  const seen = new Set([
    respond({ at: "blocked", step: stepOf(plan, "playbook"), needs: "capability", generates: true, plan, values: values() }).trigger,
    respond({ at: "blocked", step: stepOf(plan, "playbook"), needs: "person", plan, values: values() }).trigger,
    respond({ at: "settled", step: stepOf(eng, "context", "reported"), linked: "rs-0123456789ab", latest: "rs-0123456789ac", plan: eng, values: values() }).trigger,
    respond({ at: "settled", step: stepOf(eng, "runtime", "succeeded"), runtimeDone: true, startable: 1, plan: eng, values: values() }).trigger,
    respond({ at: "settled", step: stepOf(eng, "context", "reported"), plan: eng, values: values() }).trigger,
    respond({ at: "failed", step: stepOf(eng, "engineering", "failed"), violated: true, plan: eng, values: values() }).trigger,
    respond({ at: "failed", step: stepOf(eng, "engineering", "failed"), plan: eng, values: values() }).trigger,
  ]);
  assert.deepEqual([...seen].sort(), [...TRIGGER_IDS].sort());
  for (const at of ["blocked", "settled", "failed"]) assert.equal(TRIGGERS.filter((t) => t.at === at).at(-1).when({}), true, `${at} ends in a row that always matches`);
  assert.ok(TRIGGERS.every((t) => RESPONSE_IDS.includes(t.response) && (!t.otherwise || RESPONSE_IDS.includes(t.otherwise))));
});

test("CAPABILITY_MISSING inserts the draft and register steps, as a revision that names the plan it replaced", () => {
  const plan = playbookPlan();
  assert.deepEqual(plan.steps.map((s) => s.id), ["context", "playbook"]);
  const r = respond({ at: "blocked", step: stepOf(plan, "playbook", "blocked"), needs: "capability", generates: true, plan, values: values() });
  assert.equal(r.trigger, "CAPABILITY_MISSING");
  assert.deepEqual(r.revision.steps.map((s) => s.id), ["context", "propose-skill", "register-skill", "playbook"]);
  assert.equal(r.revision.n, 2);
  assert.equal(r.revision.prev, plan.digest);
  assert.deepEqual(r.revision.replans.map((x) => [x.trigger, x.response, x.step]), [["CAPABILITY_MISSING", "insert-generation", "playbook"]]);
  assert.deepEqual(r.reset, ["playbook"]);
  validate(r.revision);
  assert.equal(structuralOf(r.revision), 1);
  const again = respond({ at: "blocked", step: stepOf(r.revision, "playbook", "blocked"), needs: "capability", generates: true, plan: r.revision, values: values() });
  assert.equal(again.trigger, "DEPENDENCY_BLOCKED", "a draft already planned is never planned twice");
});

test("a gap the factory may not close, or a step waiting for a person, is blocked -- nothing is planned around it", () => {
  const plan = playbookPlan();
  assert.equal(respond({ at: "blocked", step: stepOf(plan, "playbook"), needs: "capability", generates: false, plan, values: values() }).response, "block");
  assert.equal(respond({ at: "blocked", step: stepOf(plan, "playbook"), needs: "person", generates: true, plan, values: values() }).response, "block");
});

test("a structural revision past what a person allows is BUDGET_EXHAUSTED, and its fallback answers", () => {
  const plan = playbookPlan();
  const spent = respond({ at: "blocked", step: stepOf(plan, "playbook"), needs: "capability", generates: true, plan, values: values({ execution: { maxReplans: 0 } }) });
  assert.deepEqual([spent.trigger, spent.cause, spent.response], ["BUDGET_EXHAUSTED", "CAPABILITY_MISSING", "block"]);
  assert.match(spent.because, /maxReplans/);
  const tight = { ...plan, limit: 3 };
  const broken = respond({ at: "blocked", step: stepOf(tight, "playbook"), needs: "capability", generates: true, plan: tight, values: values() });
  assert.equal(broken.trigger, "BUDGET_EXHAUSTED");
  assert.match(broken.because, /PLAN_BOUNDED/, "a revision that would break the plan's own rules is never written");
  const eng = planOf(facts(), values());
  const moved = respond({ at: "settled", step: stepOf(eng, "context", "reported"), linked: "rs-0123456789ab", latest: "rs-0123456789ac", plan: eng, values: values({ execution: { maxReplans: 0 } }) });
  assert.deepEqual([moved.trigger, moved.response], ["BUDGET_EXHAUSTED", "fail"], "a requirement that moved with no revision left fails the workflow, never builds on the old one");
});

test("REQUIREMENT_CHANGED plans again everything built on the requirement, and nothing that is not", () => {
  const plan = planOf(facts(), values());
  const r = respond({ at: "settled", step: stepOf(plan, "runtime", "succeeded"), linked: "rs-0123456789ab", latest: "rs-0123456789ac", plan, values: values() });
  assert.equal(r.trigger, "REQUIREMENT_CHANGED");
  assert.deepEqual(r.reset, ["requirement", "engineering", "regression", "review"]);
  assert.deepEqual(r.revision.steps, plan.steps, "the steps stay: what changed is the evidence they stand on");
});

test("ENVIRONMENT_CHANGED adds a QA step once discovery finds something to start, and review waits for it", () => {
  const plan = planOf(facts(), values());
  assert.ok(!plan.steps.some((s) => s.kind === "qa"));
  const r = respond({ at: "settled", step: stepOf(plan, "runtime", "succeeded"), runtimeDone: true, startable: 2, ran: ["context", "runtime"], plan, values: values() });
  assert.equal(r.trigger, "ENVIRONMENT_CHANGED");
  assert.deepEqual(r.revision.steps.find((s) => s.id === "review").after, ["qa", "regression"]);
  assert.deepEqual(r.reset, []);
  assert.equal(r.revision.retries.qa, values().execution.retries.qa, "a step a revision adds gets the retries its kind is allowed");
  assert.equal(respond({ at: "settled", step: stepOf(plan, "context", "reported"), runtimeDone: false, startable: 2, plan, values: values() }).trigger, "NONE", "nothing is known to start until the runtime step read the checkout");
  const later = respond({ at: "settled", step: stepOf(plan, "review", "succeeded"), runtimeDone: true, startable: 2, ran: ["context", "runtime", "engineering", "regression", "review"], plan, values: values() });
  assert.deepEqual([later.trigger, later.reset], ["ENVIRONMENT_CHANGED", ["review"]], "read after ANY settle; a review that already ran is planned again behind the QA step");
});

// ---- through the loop ---------------------------------------------------------------------------------

const CAP = "release.checklist.verification";

const unprovided = (cap) => ({ capability: cap, outcome: "gap", remedy: "prepare", status: "unprovided", provider: null, why: "nothing here provides it" });

const fakeFactory = (o) => ({ scaffold: async (s) => ({ id: "release-checklist-verification", provides: s.provides, shape: "verification" }), verify: () => ({ ok: true, findings: [] }), register: async () => ({ ok: true, pin: "release-checklist-verification:0.1.0:0123abcd", status: "active", summary: "release checklist", reused: false }), pinned: () => ({ loadable: true, status: "active", summary: "release checklist" }), list: () => [], drafts: () => [], state: o });

test("dynamic generation DURING execution: a playbook step blocked by its budget is revised once a person raises the budget", async (t) => {
  const settings = { skillFactory: { maxSkillsPerTask: 0 } };
  const o = automationWorld(t, { settings, resourceApproval: true, intent: "release", matched: ["release"], requirements: [CAP], startable: [], resolved: { [CAP]: unprovided(CAP) } });
  o.ports.gapOf = (resolved) => (resolved?.outcome === "gap" && resolved.remedy === "prepare" ? { kind: "workflow", generates: true, word: "VERIFICATION_GAP", shape: "verification" } : null);
  o.ports.factory = fakeFactory(o);
  const id = start(o.ports, { objective: "Verify the release checklist" }).task;
  assert.deepEqual(contextOf(o.ports, id).plan.steps.map((s) => s.id), ["context", "playbook"]);
  await next(o, id);
  const blocked = await next(o, id);
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.trigger, "BUDGET_EXHAUSTED");
  settings.skillFactory.maxSkillsPerTask = 2;
  const revised = await next(o, id, { step: "playbook" });
  assert.equal(revised.state, "replanned");
  assert.equal(revised.trigger, "CAPABILITY_MISSING");
  assert.equal(revised.plan, "plan-2");
  const c = contextOf(o.ports, id);
  assert.notEqual(o.w.view(id).lifecycle, "BLOCKED", "the revision unblocked the workflow in the same breath");
  assert.deepEqual(c.ready, ["propose-skill"]);
  assert.deepEqual(c.plan.replans.map((r) => r.trigger), ["CAPABILITY_MISSING"]);
  assert.deepEqual(o.w.view(id).receipts.filter((r) => r.domain === "plan").map((r) => r.outcome), ["SUPERSEDED", "ACTIVE"]);
  assert.equal(o.w.view(id).receipts.find((r) => r.key === "step:playbook").outcome, "PENDING");
  const propose = await next(o, id);
  assert.match(propose.how.invoke, /a verification playbook: every check names the record/);
});

test("a requirement that moves under a running workflow has the steps built on it planned again, keeping every receipt", async (t) => {
  const o = automationWorld(t, { startable: [] });
  const id = start(o.ports, { objective: "Implement PBI-482 refund validation", ref: "PBI-482" }).task;
  assert.equal((await next(o, id)).stepState, "succeeded", "requirement read back");
  await next(o, id);
  o.state.requirement.latest = { id: "rs-0123456789ac", digest: "b".repeat(64), clarity: "complete", authority: "accepted" };
  const r = await next(o, id);
  assert.equal(r.step, "runtime");
  assert.equal(r.replan.trigger, "REQUIREMENT_CHANGED");
  assert.equal(r.plan, "plan-2");
  assert.deepEqual(contextOf(o.ports, id).ready, ["requirement"], "the requirement step reads the new snapshot first");
  const receipts = o.w.view(id).receipts;
  assert.equal(receipts.find((x) => x.key === "step:runtime").outcome, "SUCCEEDED", "what did not stand on the requirement keeps its result");
  assert.equal(receipts.find((x) => x.key === "requirement:rs-0123456789ab").outcome, "READY", "the evidence the first plan stood on is kept");
  assert.equal((await next(o, id)).stepState, "succeeded");
  assert.ok(o.w.view(id).receipts.some((x) => x.key === "requirement:rs-0123456789ac"));
});

test("discovery finding something to start adds a QA step after the runtime step settles", async (t) => {
  const opts = { startable: [] };
  const o = automationWorld(t, opts);
  const id = start(o.ports, { objective: "Implement the refund validation rule" }).task;
  assert.ok(!contextOf(o.ports, id).plan.steps.some((s) => s.kind === "qa"));
  await next(o, id);
  opts.startable = ["web"];
  const r = await next(o, id);
  assert.equal(r.replan.trigger, "ENVIRONMENT_CHANGED");
  const plan = contextOf(o.ports, id).plan;
  assert.deepEqual(plan.steps.map((s) => s.id), ["context", "runtime", "engineering", "qa", "regression", "review"]);
  assert.equal(plan.revisedOnEvidence, 1);
});


// ---- 1.8.6 review: what an independent read of this release found, each held here ---------------------------

import { apply } from "../src/task/ops.mjs";
import { decided, step } from "./fakes/automation.mjs";

test("an approval is for ONE step: a grant for one capability never allows another capability", async (t) => {
  const settings = {};
  const o = automationWorld(t, { settings, resourceApproval: true, intent: "release", matched: ["release"], requirements: ["a.check"], startable: [] });
  o.ports.gapOf = (resolved) => (resolved?.outcome === "gap" ? { kind: "workflow", generates: true, word: "VERIFICATION_GAP", shape: "verification" } : null);
  o.ports.factory = fakeFactory(o);
  const id = start(o.ports, { objective: "Check a and b", capabilities: ["b.check"] }).task;
  assert.ok(contextOf(o.ports, id).plan.steps.some((s) => s.id === "playbook.b.check"));
  await next(o, id);
  const asked = await next(o, id, { step: "playbook.a.check" });
  assert.equal(asked.state, "waiting-approval");
  apply({ ...o.w.ctx, door: "control" }, id, "approve", { approval: asked.approval, expected: o.w.view(id).revision, human: true });
  await assert.rejects(step(o.ports, id, decided("playbook.b.check", o.w.view(id).revision, { approval: asked.approval })), (e) => e.code === "OTHER_ACTION", "two drafts of one kind are two actions");
});

test("a revision never drafts more playbooks than one task may, and the draft steps it adds get their retries", () => {
  const plan = planOf(facts({ ref: null, requirement: null, intent: "release", matched: ["release"], named: ["b.check"], capabilities: [{ capability: "a.check", outcome: "gap", generates: true, named: false }, { capability: "b.check", outcome: "gap", generates: false, named: true }] }), values({ skillFactory: { maxSkillsPerTask: 1 } }));
  const blocked = respond({ at: "blocked", step: stepOf(plan, "playbook.b.check", "blocked"), needs: "capability", generates: true, plan, values: values({ skillFactory: { maxSkillsPerTask: 1 } }) });
  assert.deepEqual([blocked.trigger, blocked.cause, blocked.response], ["BUDGET_EXHAUSTED", "CAPABILITY_MISSING", "block"]);
  assert.match(blocked.because, /maxSkillsPerTask 1/);
  const open = playbookPlan();
  const r = respond({ at: "blocked", step: stepOf(open, "playbook", "blocked"), needs: "capability", generates: true, plan: open, values: values() });
  assert.equal(r.revision.retries["propose-skill"], values().skillFactory.maxGenerationAttempts - 1, "a refused draft can be written again, as one planned from the start can");
});

