// SELF-IMPROVEMENT's whole world, for a test (0.3.0): a declared playbook's REAL world (test/fakes/skill-run.mjs: the
// task door, the skill factory, the registry, the resolver, the capability pipeline and the MCP broker, real), the
// improvement store on the same disk, the evaluation task's door (`improvement`), the coordinator's own skill runner,
// and the real learn port. What a test makes up is only what answers on the far end, the clock and the session.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start as startWorkflow } from "../../src/automation/loop.mjs";
import { improvementSubject } from "../../skills/orbit-help/factory.mjs";
import { effectiveOf } from "../../src/automation/settings.mjs";
import { interruptedRunOps, interruptedStepOps, runIdOf, skillRun } from "../../src/automation/skill-run.mjs";
import { createImprovement } from "../../src/improvement/store.mjs";
import { createLessons } from "../../src/learn/lessons.mjs";
import { promote } from "../../src/learn/promote.mjs";
import { skillRunsOf } from "../../src/live/plan.mjs";
import { projectionOf } from "../../src/skill-factory/source.mjs";
import { realIo } from "../../src/store/io.mjs";
import { fingerprintOf } from "../../src/task/approvals.mjs";
import { loadTask } from "../../src/task/load.mjs";
import { apply, createTask } from "../../src/task/ops.mjs";
import { eventsView } from "../../src/task/views.mjs";
import { next } from "./automation.mjs";
import { declared, skillWorld, spec, workflowOf } from "./skill-run.mjs";

// The playbook's first version reads its notes' hits from a path the notes server never answers with: its own
// declared contract cannot hold, whatever the server says. Its successor reads them where they are.
export const BROKEN = () => workflowOf({ notes: { outputs: { hits: { type: "count", path: "results" } } } });

export const FIXED = () => workflowOf();

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const projections = (factory, pins) => Object.fromEntries(pins.map((pin) => [pin, quietly(() => projectionOf(factory.workflow(pin)))]).filter(([, v]) => v));

function closedDead(task, id) {
  const view = task.view(id);
  const open = view.actions.filter((a) => a.state === "running");
  open.forEach((act) => [...interruptedRunOps(view, act), ...interruptedStepOps(view, act)].forEach(([op, given]) => task.apply(id, op, given)));
  return open.length;
}

// opts: everything skillWorld takes, and `improvement` (the machine's improvement settings)
export function improvementWorld(t, opts = {}) {
  const s = skillWorld(t, { ...opts, settings: { ...(opts.settings ?? {}), ...(opts.improvement ? { improvement: opts.improvement } : {}) } });
  const io = realIo({ host: "laptop-a", now: s.w.now });
  const lessonsRoot = mkdtempSync(join(tmpdir(), "orbit-improve-lessons-"));
  t.after(() => rmSync(lessonsRoot, { recursive: true, force: true }));
  const state = { session: "sess-A", traced: [], learned: [], liveness: false, pid: 4242, settings: null };
  const ictx = { ...s.w.ctx, door: "improvement" };
  const task = { apply: (id, op, given) => apply(ictx, id, op, given), view: (id) => s.w.view(id), events: (id) => eventsView(loadTask(ictx, id).model).events, fingerprint: (g) => fingerprintOf(g) };
  const skillPorts = { task, resolve: s.resolve, invoke: s.ports.invoke, factory: s.factory, investigations: { outcome: () => null }, child: { view: (id) => s.w.view(id) }, requirements: { look: () => null }, now: s.w.now };
  const store = createImprovement(s.w.dir, io);
  const values = () => (state.settings ? effectiveOf([{ by: "machine", content: state.settings }]).values : s.ports.settings().values);
  const lessons = createLessons(lessonsRoot, io);
  const ports = {
    store,
    ctx: { store, door: "improvement", get session() { return state.session; }, host: "laptop-a", get pid() { return state.pid; }, now: s.w.now },
    values,
    now: s.w.now,
    nowMs: () => Date.parse(s.w.now()),
    records: () => s.factory.list().filter((r) => r.runs === "declared").flatMap((r) => s.factory.runs(r.id)),
    history: (subject) => s.factory.runs(subject.id),
    inputsOf: (tasks) => (tasks ?? []).map((id) => quietly(() => s.w.view(id))).filter(Boolean).map((v) => ({ task: v.task.id, objective: v.task.objective, ref: v.task.root ?? null })),
    subjects: { skill: improvementSubject(s.factory) },
    evaluation: { create: (x) => createTask(ictx, { project: ictx.project, checkout: ictx.checkout, objective: x.objective, provider: "improvement", actions: x.actions, attempts: 1 }).task, apply: task.apply, view: task.view, events: task.events, run: (lw, step, dispatch) => skillRun(skillPorts, lw, step, dispatch), runIdOf, runsOf: (id, pins) => skillRunsOf(null, task.view(id), task.events(id), projections(s.factory, pins)), closeDead: (id) => closedDead(task, id) },
    missions: { read: () => null, runs: () => [] },
    liveness: () => state.liveness,
    learn: (finding) => ((r) => (state.learned.push({ finding, r }), r.written.length ? { id: r.written[0].id, state: r.written[0].state, kept: true, because: `kept (${r.written[0].state})` } : { id: r.observations[0]?.id ?? null, kept: false, because: r.observations[0]?.why ?? "nothing" }))(promote(lessons, [finding], { now: s.w.now })),
    trace: (type, data) => state.traced.push([type, data]),
    reuse: () => null,
    doctor: () => [],
    readJson: () => ({}),
  };
  return { ...s, io, imp: ports, state, store, lessons, ictx };
}

// One coordinated workflow taken to its playbook step, the way a host takes it: its own task, its own objective.
export async function coordinated(w, objective) {
  const st = startWorkflow(w.ports, { ...spec, objective });
  await next(w, st.task);
  await next(w, st.task);
  return st.task;
}

// The playbook registered as its first, broken version, and run in two independent sessions (two UTC days): three
// runs on the first day -- one sitting, however many runs -- and one on the second.
export async function brokenHistory(w, { runs = [3, 1], wf = BROKEN() } = {}) {
  const v1 = await declared(w, { wf });
  const tasks = [];
  for (const [day, n] of runs.entries()) {
    for (let i = 0; i < n; i += 1) tasks.push(await coordinated(w, `Check the release is ready (day ${day + 1}, run ${i + 1})`));
    w.w.tick(24 * 60);
  }
  return { v1, tasks };
}
