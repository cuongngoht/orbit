import { flag, has } from "../learn/args.mjs";
import { analyzeGoal, goalId, planGoal, readAnalysis, resumeGoal, startFromArgs, statusGoal, stepGoal, verifyGoal } from "./commands.mjs";
import { sayReport } from "./report.mjs";

export { startGoal, analyzeGoal, planGoal, statusGoal, resumeGoal, stepGoal, verifyGoal } from "./commands.mjs";

// The requirements of each kind, as the analysis counted them: "(3 explicit · 1 constraint)".
const kindsSaid = (kinds) => (Object.keys(kinds ?? {}).length ? ` (${Object.entries(kinds).map(([kind, n]) => `${n} ${kind}`).join(" · ")})` : "");

const caps = (args) => {
  const t = flag(args, "capability");
  return t ? String(t).split(",").map((s) => s.trim()).filter(Boolean) : [];
};

export const OPS = {
  start: (p, a) => startFromArgs(p, a),
  analyze: (p, a) => analyzeGoal(p, goalId(a), readAnalysis(a)),
  plan: (p, a) => planGoal(p, goalId(a)),
  status: (p, a) => statusGoal(p, goalId(a)),
  resume: (p, a) => resumeGoal(p, goalId(a)),
  step: (p, a) => stepGoal(p, goalId(a), { capabilities: caps(a), dry: has(a, "dry") }),
  verify: (p, a) => verifyGoal(p, goalId(a)),
  report: (p, a) => statusGoal(p, goalId(a)),
  list: (p) => ({ goals: p.goals.list() }),
  doctor: (p) => ({ store: p.goals.paths.root, count: p.goals.list().length }),
};

export const sayOps = {
  start: (r) => `GOAL       ${r.id} started\nTITLE      ${r.title}\nDIGEST     ${r.specDigest}`,
  analyze: (r) => `GOAL       ${r.id} analyzed · ${r.requirements} requirements${kindsSaid(r.kinds)} · ${r.acceptance} acceptance criteria`,
  plan: (r) => `GOAL       ${r.id} · ${r.plan} · ${r.units} work unit(s)`,
  status: (r) => sayReport(r.view),
  resume: (r) => r.say,
  step: (r) => (r.dry ? `DRY        would start automation for ${r.unit}` : `GOAL       ${r.id} · unit ${r.unit} → task ${r.task}`),
  verify: (r) => `GOAL       ${r.id} · ${r.outcome} — ${r.because}`,
  report: (r) => sayReport(r.view),
  list: (r) => r.goals.map((g) => `  ${g}`).join("\n") || "  (none)",
  doctor: (r) => `ORBIT      goals at ${r.store}\nCOUNT      ${r.count}`,
};
