import { readFileSync } from "node:fs";
import { Refused } from "../errors.mjs";
import { flag, has, words } from "../learn/args.mjs";
import { validateAnalysis } from "./analyze.mjs";
import { viewOf } from "./execute.mjs";
import { startFromArgs } from "./start-args.mjs";
import { stepGoal } from "./step.mjs";
import { startGoal } from "./start-goal.mjs";
import { nextId } from "./model.mjs";
import { goalProjection } from "./live.mjs";
import { orphanAcceptance, planArtifact, planUnits } from "./plan.mjs";
import { loadGoal, resumeSay, resumeView, verifyOnResume } from "./resume.mjs";
import { reportOf, sayReport } from "./report.mjs";
import { completionGate } from "./verification.mjs";

const GOAL = /^goal-[0-9a-f]{12}$/;

export function goalId(args) {
  const word = words(args)[0];
  if (!GOAL.test(String(word ?? ""))) throw new Refused("name the goal: its goal- id (start and list show it)");
  return word;
}

export { startGoal };

export function analyzeGoal(ports, id, raw) {
  const loaded = loadGoal(ports.goals, ports.io, id);
  if (!loaded) throw new Refused(`no goal ${id}`);
  const analysis = validateAnalysis(raw, loaded.spec.digest);
  return ports.goals.transact(id, () => appendAnalyzed(ports, id, analysis));
}

function appendAnalyzed(ports, id, analysis) {
  const model = viewOf(ports.goals.read(id));
  ports.goals.append(id, "analyzed", { id: nextId(model, "analyzed"), ...analysis });
  return { id, digest: analysis.digest, requirements: analysis.requirements.length, acceptance: analysis.acceptance.length };
}

export function planGoal(ports, id) {
  const loaded = loadGoal(ports.goals, ports.io, id);
  if (!loaded?.model.analyzed) throw new Refused("analyze the goal before planning");
  const units = planUnits(loaded.model.analyzed, loaded.spec.digest);
  refuseOrphans(units, loaded.model.analyzed.acceptance);
  return ports.goals.transact(id, () => writePlan(ports, id, units));
}

function refuseOrphans(units, acceptance) {
  const orphans = orphanAcceptance(units, acceptance);
  if (orphans.length) throw new Refused(`acceptance criteria have no work unit: ${orphans.join(", ")}`);
}

// Planning again (after a person answered what a unit was missing, and the goal was analyzed again) is plan-2, plan-3
// ...: an earlier plan's artifact is never written over.
const planNumber = (model) => model.records.filter((r) => r.kind === "planned" || r.kind === "replanned").length + 1;

function writePlan(ports, id, units) {
  const artifact = planArtifact(units, planNumber(viewOf(ports.goals.read(id))));
  ports.io.write(`${ports.goals.dirOf(id)}/${artifact.plan}.json`, `${JSON.stringify(artifact.body, null, 2)}\n`);
  ports.goals.append(id, "planned", { id: nextId(viewOf(ports.goals.read(id)), "planned"), plan: artifact.plan, digest: artifact.digest, units, because: "initial plan" });
  return { id, plan: artifact.plan, units: units.length };
}

export function statusGoal(ports, id) {
  const loaded = loadGoal(ports.goals, ports.io, id);
  if (!loaded) throw new Refused(`no goal ${id}`);
  return { view: reportOf(loaded.model), projection: goalProjection(loaded.model) };
}

// Resuming settles every unit whose task ended, and KEEPS the settlement in the goal's journal, so every later look
// reads it back; a second resume finds nothing left to settle.
export function resumeGoal(ports, id) {
  if (!loadGoal(ports.goals, ports.io, id)) throw new Refused(`no goal ${id}`);
  const tasks = ports.taskSummaries?.() ?? [];
  const settled = ports.goals.transact(id, () => settleEnded(ports, id, tasks));
  const view = resumeView(ports.goals.read(id), tasks);
  return { ...view, settled, say: resumeSay(view), verify: verifyOnResume(view.model) };
}

function settleEnded(ports, id, tasks) {
  const lines = resumeView(ports.goals.read(id), tasks).pending;
  for (const line of lines) ports.goals.append(id, "unit", line);
  return lines;
}

export { stepGoal };

export function verifyGoal(ports, id, opts = {}) {
  const loaded = loadGoal(ports.goals, ports.io, id);
  if (!loaded) throw new Refused(`no goal ${id}`);
  const gate = completionGate(loaded.model, opts);
  return ports.goals.transact(id, () => maybeVerified(ports, id, gate));
}

function maybeVerified(ports, id, gate) {
  if (gate.outcome === "completed") ports.goals.append(id, "verified", { id: nextId(viewOf(ports.goals.read(id)), "verified"), outcome: "completed", summary: gate.because, gaps: null, because: "completion gate" });
  return { id, ...gate };
}

export { startFromArgs };

export function readAnalysis(args) {
  const file = flag(args, "file");
  if (file) return jsonOf(readFileSync(file, "utf8"));
  if (has(args, "stdin") || !process.stdin.isTTY) return jsonOf(readFileSync(0, "utf8"));
  throw new Refused("analysis JSON on stdin or --file");
}

const jsonOf = (text) => {
  try { return JSON.parse(text); }
  catch { throw new Refused("analysis is one JSON object, on stdin or in a file"); }
};
