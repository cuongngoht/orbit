// The coordinator's whole world, for a test: the REAL task write door on a temp store (a terminal's, never
// Control's door), the REAL plan, policy and settings tables, and small fakes for every owner it asks --
// requirements, runtime, project context, the resolver, investigations, the skill factory. The child
// engineering task is a REAL task in the same store, created by the fake `child.start` and moved by a test
// through the same door (`w.op`), so the coordinator reads it back exactly as it would in a checkout.
import { effectiveOf } from "../../src/automation/settings.mjs";
import { contextOf, settle, start, step } from "../../src/automation/loop.mjs";
import { fingerprintOf } from "../../src/task/approvals.mjs";
import { loadTask } from "../../src/task/load.mjs";
import { apply, createTask } from "../../src/task/ops.mjs";
import { eventsView } from "../../src/task/views.mjs";
import { taskWorld } from "../task.harness.mjs";

export const ROOT = "req-0123456789ab";
export const WORK = "w-0123456789ab";
export const SNAPSHOT = { id: "rs-0123456789ab", digest: "a".repeat(64), clarity: "complete", authority: "accepted" };

const SKILLS = { "engineering.execution": "orbit-engineer", "qa.investigation": "orbit-qa", "requirement.snapshot": "orbit-requirements", "qa.planning": "orbit-test-plan", "qa.execution": "orbit-test-suite" };

const providedBy = (cap) => ({ capability: cap, outcome: "provided", status: "selected", provider: { kind: "skill", id: SKILLS[cap] ?? "orbit-develop", key: SKILLS[cap] ?? "orbit-develop", ownership: "plugin" }, why: "provided" });

// opts: settings (machine document) · project (project document) · intent · matched · requirement
// ({ latest, blocking }) · startable · resolved ({ cap: answer }) · gap · agents · investigations ({ id: outcome })
export function automationWorld(t, opts = {}) {
  const w = taskWorld(t, { door: null });
  const state = { requirement: { latest: SNAPSHOT, blocking: 0, ...opts.requirement }, investigations: new Map(Object.entries(opts.investigations ?? {})), rooms: new Map(), children: [], gathered: 0, running: null, factory: opts.factory ?? null };
  const room = (id) => (state.rooms.has(id) ? state.rooms.get(id) : state.rooms.set(id, new Map()).get(id));
  const docs = () => [{ by: "machine", content: opts.settings ?? {} }, ...(opts.project ? [{ by: "project", content: opts.project }] : [])];
  const childStart = (spec) => {
    const existing = state.children.find((c) => !w.view(c).terminal);
    if (existing) return { task: existing, created: false };
    w.tick(1);
    const id = createTask(w.ctx, { project: w.ctx.project, checkout: w.ctx.checkout, objective: spec.objective, work: WORK, root: ROOT, provider: "autonomous-engineering", ...(spec.parent ? { parent: spec.parent } : {}) }).task;
    state.children.push(id);
    return { task: id, created: true };
  };
  const ports = {
    task: { create: (g) => createTask(w.ctx, { project: w.ctx.project, checkout: w.ctx.checkout, ...g }), apply: (id, op, g) => apply(w.ctx, id, op, g), view: (id) => w.view(id), events: (id) => eventsView(loadTask(w.ctx, id).model).events, list: () => w.tasks.list(), fingerprint: (g) => fingerprintOf(g) },
    settings: () => effectiveOf(docs()),
    settingsView: () => ({ machine: docs()[0], project: docs()[1] ?? null, effective: effectiveOf(docs()) }),
    classify: () => ({ intent: { id: opts.intent ?? "development", confidence: "high" }, matched: opts.matched ?? [opts.intent ?? "development"], requirements: opts.requirements ?? ["development.implementation"] }),
    resolve: (cap) => opts.resolved?.[cap] ?? { ...providedBy(cap), status: opts.resourceApproval ? "approval" : "selected" },
    gapOf: () => opts.gap ?? null,
    requirements: { resolve: (ref) => ({ root: ROOT, identity: { id: ref } }), look: () => ({ latest: state.requirement.latest, blocking: state.requirement.blocking }) },
    runtime: { readiness: async () => ({ understanding: opts.understanding ?? "CURRENT", components: [{ key: "web" }], startable: opts.startable ?? ["web"], checks: [{ purpose: "build" }, { purpose: "test" }] }), startable: () => opts.startable ?? ["web"] },
    context: { gather: async () => ((state.gathered += 1), { sections: [{}, {}, {}], ...(opts.contextStatus ? { status: opts.contextStatus } : {}) }) },
    child: { start: async (spec) => childStart(spec), view: (id) => w.view(id) },
    investigations: { outcome: (id) => state.investigations.get(id) ?? null },
    factory: state.factory,
    host: { id: "claude", agents: opts.agents ?? true, statusLine: false },
    roomOf: (id) => ({ read: (name) => structuredClone(room(id).get(name) ?? null), write: (name, value) => room(id).set(name, structuredClone(value)), remove: (name) => room(id).delete(name) }),
    lock: (id, fn) => fn(),
    liveness: () => state.liveness ?? null,
    session: opts.session ?? "sess-1",
    now: () => w.now(),
    hostName: "laptop-a",
    pid: 4242,
  };
  return { w, ports, state, room };
}

let seq = 0;

export const decided = (step_, revision, extra = {}) => ({ schemaVersion: 1, decisionId: `d-${(seq += 1)}`, expectedRevision: revision, action: { kind: "run", step: step_ }, observed: `the ${step_} step is ready`, hypothesis: `running ${step_} moves the workflow on`, ...extra });

export const outcome = (answer, extra = {}) => ({ schemaVersion: 1, decisionId: answer.decisionId, expectedRevision: answer.revision, stepId: answer.step, executionState: "succeeded", evidenceRefs: [], ...extra });

// One step run the way a host runs it: read the context, decide the first ready step on its revision.
export async function next(o, id, extra = {}) {
  const c = contextOf(o.ports, id);
  const d = decided(extra.step ?? c.ready[0], c.revision, extra.decision);
  const r = await step(o.ports, id, d);
  return { ...r, decisionId: d.decisionId, decision: d };
}

// A child task taken to an end through its own door, as its own loop would have done.
export function childEnds(o, child, how = "complete") {
  const ops = { complete: [["stage", { stage: "REVIEWING" }], ["complete", { summary: "reviewed" }]], fail: [["fail", { stop: "NO_PROGRESS", because: "three attempts ended on one failure" }]], block: [["block", { stop: "ENVIRONMENT_BLOCKED", needs: "person", because: "a person trusts the sandbox" }]] }[how];
  for (const [op, given] of ops) o.w.op(child, op, given);
}

export { contextOf, settle, start, step };
