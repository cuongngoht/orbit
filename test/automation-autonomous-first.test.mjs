// Autonomous-first: a fresh install coordinates a named task with nothing turned on, a read-only question stays a
// navigator's answer, a restriction a person KEPT from before autonomy was the default is honoured until a person
// lifts it in Orbit Control, the migration from a schema-1 document is versioned, pure and idempotent, and nothing
// that gates an ACTION -- a denied class, a person's approval, a paused task -- is loosened by the new defaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTION_CLASSES, verdictOf } from "../src/automation/policy.mjs";
import { effectiveOf } from "../src/automation/settings.mjs";
import { workflowOf } from "../src/automation/workflows.mjs";
import { recommend } from "../src/help/vocab.mjs";
import { classify } from "../src/routing/classify.mjs";
import { realIo } from "../src/store/io.mjs";
import { automationWorld, contextOf, decided, next, start, step } from "./fakes/automation.mjs";
import { taskWorld } from "./task.harness.mjs";

const AT = "2026-10-17T08:00:00.000Z";
const PERSON = { revision: null, door: "control", at: AT };
const ADHOC = { objective: "Implement the refund validation rule and test it" };

function legacyFile(t, content) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-autonomous-first-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "automation", "settings.json");
  mkdirSync(join(dir, "automation"));
  if (content) writeFileSync(file, `${JSON.stringify({ ...content, schema: 1, updatedAt: "2026-10-01T00:00:00.000Z", updatedBy: "person" })}\n`);
  return { dir, file };
}

const values = (content) => effectiveOf([{ by: "machine", content }]).values;

// ---- T01 · a fresh install -------------------------------------------------------------------------

test("T01 a fresh install takes a supported task all the way to its engineering step with nothing turned on", async (t) => {
  const o = automationWorld(t, { settings: {} });
  const id = start(o.ports, ADHOC).task;
  assert.deepEqual(contextOf(o.ports, id).plan.steps.map((s) => s.id), ["context", "runtime", "engineering", "qa", "regression", "review"]);
  assert.equal((await next(o, id)).stepState, "reported");
  assert.equal((await next(o, id)).stepState, "succeeded");
  const eng = await next(o, id);
  assert.equal(eng.how.provider.id, "orbit-engineering-agent");
  assert.equal(o.state.children.length, 1);
  assert.equal(o.w.view(o.state.children[0]).task.parent, id, "the engineering task names the workflow that started it");
});

// ---- T02 / T03 · routing: a change is coordinated, a question is answered --------------------------

const automationFor = (task, content = {}) => {
  const c = classify(task);
  const e = effectiveOf([{ by: "machine", content }]);
  const workflow = workflowOf({ ref: null, intent: c.intent.id, matched: c.matched, startable: [], playbook: { capability: c.requirements[0] ?? null } });
  return { coordinates: workflow.id !== "none", workflow: workflow.id };
};

const KNOWN = { architecture: { total: 4, stale: 0 }, map: { screens: 2 }, qa: { plans: 1, errors: 0 }, work: { open: 0 } };

const routeFor = (task, content) => recommend({ ...KNOWN, task: { intent: classify(task).intent.id }, automation: automationFor(task, content) }).id;

test("T02 a development objective goes to the coordinator by default; T03 a read-only question does not", () => {
  assert.equal(routeFor("Fix the authentication timeout bug in the login middleware"), "automation");
  assert.equal(routeFor("Implement the refund validation rule"), "automation");
  assert.notEqual(routeFor("what MCP servers are configured here"), "automation", "a question about resources is answered, not coordinated");
  assert.equal(recommend({ ...KNOWN, task: null, automation: null }).id, "run-tests", "no task: the navigator's recommendation, as before");
});


// ---- T12 / T13 · security is per action, and no default loosens it --------------------------------

test("T12 every class a workflow may never take is deny under the new defaults, and an owner's gate stays the owner's", () => {
  const v = values({});
  for (const c of ACTION_CLASSES.filter((row) => row.default === "deny")) assert.equal(verdictOf(v, c.id), "deny", c.id);
  for (const c of ACTION_CLASSES.filter((row) => row.default === "owner")) assert.equal(verdictOf(v, c.id), "owner", c.id);
  assert.equal(verdictOf(v, "dispatch-skill", "deny"), "deny", "a resource's own deny is never widened by the defaults");
  assert.equal(verdictOf(v, "generate-instruction-skill", "approval"), "approval", "nor its approval");
});

test("T13 a kept supervised restriction asks a person, and the workflow cannot grant it to itself", async (t) => {
  const o = automationWorld(t, { resourceApproval: true });
  const id = start(o.ports, ADHOC).task;
  await next(o, id);
  await next(o, id);
  const asked = await next(o, id);
  assert.equal(asked.state, "waiting-approval");
  const view = o.w.view(id);
  const approval = view.approvals.find((a) => a.open).id;
  assert.throws(() => o.w.op(id, "approve", { approval, expected: view.revision, human: true }), (e) => e.code === "PERSON_UNPROVEN", "a terminal (or an agent) cannot approve");
  assert.equal(o.w.view(id).lifecycle, "WAITING_APPROVAL");
  await assert.rejects(step(o.ports, id, decided("engineering", o.w.view(id).revision)), (e) => e.code === "WAITING");
  assert.equal(o.state.children.length, 0, "nothing ran on the agent's own word");
});

test("T11 a viewer switched off never stops the work: live.open false is no restriction", async (t) => {
  const o = automationWorld(t, { settings: { live: { open: false, autoAttach: false } } });
  const id = start(o.ports, ADHOC).task;
  assert.equal((await next(o, id)).stepState, "reported");
  assert.equal("restrictions" in o.ports.settings(), false);
});

// ---- T16 · tasks are not settings: a paused task stays paused --------------------------------------

test("T16 a paused task stays paused whatever happens to the settings: only a person resumes it, in Control", (t) => {
  const w = taskWorld(t, { door: null });
  const id = w.create({ provider: "automation" });
  w.op(id, "pause", { expected: w.view(id).revision, human: true });
  assert.equal(w.view(id).lifecycle, "PAUSED");
  assert.throws(() => w.op(id, "resume", { expected: w.view(id).revision, human: true }), (e) => e.code === "PERSON_UNPROVEN");
});

test("a task's parent is an id of a task, refused otherwise", (t) => {
  const w = taskWorld(t);
  assert.throws(() => w.create({ parent: "../elsewhere" }), /parent/);
  const parent = w.create({ provider: "automation", objective: "the workflow" });
  const child = w.create({ provider: "autonomous-engineering", objective: "the change", parent });
  assert.equal(w.view(child).task.parent, parent);
  assert.equal(w.view(parent).task.parent, null);
});
