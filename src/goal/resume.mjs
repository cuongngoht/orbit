import { reconcileUnits, viewOf } from "./execute.mjs";
import { frontierOf, lifecycleOf } from "./model.mjs";
import { readSpec } from "./spec.mjs";
import { completionGate } from "./verification.mjs";

export function resumeView(records, taskViews = []) {
  const model = viewOf(records);
  const pending = reconcileUnits(model, taskViews);
  return { model, lifecycle: lifecycleOf(model), frontier: frontierOf(model), pending, revision: model.revision };
}

export function loadGoal(goals, io, id) {
  const records = goals.read(id);
  if (!records?.length) return null;
  const spec = readSpec(io, goals.dirOf(id));
  return { records, spec, model: viewOf(records) };
}

export function resumeSay(view) {
  const prog = view.model.units.size;
  const done = [...view.model.units.values()].filter((x) => x.state === "completed").length;
  return [`GOAL       ${view.model.meta.id} — ${view.model.meta.title}`, `STATE      ${view.lifecycle}`, `PROGRESS   ${done}/${prog} work units`, `NEXT       ${resumeNext(view)}`].join("\n");
}

// ---- what a resumed goal does next, said as the command that does it (0.6.0, Q7) ------------------------------------

const GOAL = "node <engine>/cli/orbit.mjs goal";

const idOf = (v) => v.model.meta.id;

const runningUnit = (v) => [...v.model.units.values()].find((u) => u.state === "running" && u.task) ?? null;

// A host that comes back to a goal is told HOW to go on and not only what is next: the first row that holds names the
// one command, read off the goal's own journal. A unit that runs is its workflow's, resumed through that workflow's own
// door; with nothing left to start, the completion gate decides, and a verified goal is reported.
export const RESUME_NEXT = [
  { id: "ANALYZE", when: (v) => !v.model.analyzed, say: (v) => `analyze it — the intent read from its spec, on stdin: ${GOAL} analyze ${idOf(v)} --stdin` },
  { id: "PLAN", when: (v) => !v.model.plan, say: (v) => `plan its work units: ${GOAL} plan ${idOf(v)}` },
  { id: "STEP", when: (v) => v.frontier.length > 0, say: (v) => `${v.frontier[0].id} — ${v.frontier[0].title}: ${GOAL} step ${idOf(v)}` },
  { id: "RUNNING", when: (v) => runningUnit(v) !== null, say: (v) => `${runningUnit(v).id} runs as workflow ${runningUnit(v).task}: node <engine>/cli/automation.mjs resume ${runningUnit(v).task}` },
  { id: "REPORT", when: (v) => Boolean(v.model.verified), say: (v) => `report it: ${GOAL} report ${idOf(v)}` },
  { id: "VERIFY", when: () => true, say: (v) => `verify it against its acceptance: ${GOAL} verify ${idOf(v)}, then ${GOAL} report ${idOf(v)}` },
];

export const resumeNext = (view) => RESUME_NEXT.find((r) => r.when(view)).say(view);

export function verifyOnResume(model) {
  return completionGate(model);
}
