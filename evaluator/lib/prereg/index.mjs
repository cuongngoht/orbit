// A PRE-REGISTRATION (prereg/<release>.json): what will be run and how it will be judged, written and committed BEFORE
// any model run it governs. This module re-derives what it can from its own rule (so a list is never taken on trust),
// and builds every campaign of a phase FROM it (so a campaign cannot quietly differ from what was registered): the
// tasks are the top `counts` of the registered order, the arms, model, effort and limits are the registered ones, the
// runs go task by task (a SWE-bench instance image is pulled once, used by every arm, and removed) with the arms of
// each task in a seeded order, and the budget is the phase's line of the ledger.
//
//   loadPrereg(file) -> prereg      verifyPrereg(prereg, o) -> [problem]      phaseTasks(prereg, phase) -> [task ref]
//   campaignOf(prereg, phase, o) -> campaign definition      verdictOf(rows, a, b, rule) -> { verdict, ... }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, EVALUATOR_DIR, seededShuffle, sha256 } from "../core/util.mjs";
import { packDigest, loadPack, packIds } from "../tasks/packs.mjs";
import { cacheFileOf, REVISION, rowDigest } from "../tasks/swebench.mjs";
import { CLOSING } from "../run/prompt.mjs";
import { selection } from "./select.mjs";

export const PREREG_DIR = join(EVALUATOR_DIR, "prereg");

export const loadPrereg = (file) => JSON.parse(readFileSync(file, "utf8"));

const ruleOf = (p) => ({ ...p.selection, repoImages: p.selection.repoImages });

const ids = (list) => list.map((x) => x.id);

// What the registered order must be: the rule re-run over the pinned rows (when they are cached here) and the packs.
export function verifyPrereg(p, o = {}) {
  const problems = [];
  const say = (ok, why) => (ok ? null : problems.push(why));
  say(p.dataset?.revision === REVISION, `the dataset revision is ${p.dataset?.revision}, the evaluator pins ${REVISION}`);
  say(p.prompt?.closing === CLOSING, "the registered closing paragraph is not the one the evaluator sends");
  const packs = selection([], packIds(), ruleOf(p), {});
  say(canonical(ids(p.order.dev.packs)) === canonical(packs.dev.packs), `the dev packs' order is not the rule's: ${packs.dev.packs.join(", ")}`);
  say(canonical(ids(p.order.heldOut.packs)) === canonical(packs.heldOut.packs), `the held-out packs' order is not the rule's: ${packs.heldOut.packs.join(", ")}`);
  for (const x of [...p.order.dev.packs, ...p.order.heldOut.packs]) say(packDigest(loadPack(x.id)) === x.digest, `pack ${x.id} is not the pack that was registered (digest)`);
  const file = cacheFileOf(o.home);
  if (!o.home || !existsSync(file)) return { problems, rowsChecked: false };
  const rows = JSON.parse(readFileSync(file, "utf8")).rows;
  const sel = selection(rows, packIds(), ruleOf(p), p.selection.instanceImages);
  say(canonical(p.order.dev.repos) === canonical(sel.repos.dev) && canonical(p.order.heldOut.repos) === canonical(sel.repos.heldOut), "the repositories' split is not the rule's");
  say(canonical(ids(p.order.dev.swebench)) === canonical(sel.dev.swebench), `the dev SWE-bench order is not the rule's: ${sel.dev.swebench.join(", ")}`);
  say(canonical(ids(p.order.heldOut.swebench)) === canonical(sel.heldOut.swebench), `the held-out SWE-bench order is not the rule's: ${sel.heldOut.swebench.join(", ")}`);
  for (const x of [...p.order.dev.swebench, ...p.order.heldOut.swebench]) say(((r) => r && rowDigest(r) === x.rowDigest)(rows.find((r) => r.instance_id === x.id)), `row ${x.id} is not the row that was registered (digest)`);
  return { problems, rowsChecked: true };
}

// ---- the phases ---------------------------------------------------------------------------------------------------------

const top = (list, n) => list.slice(0, n).map((x) => x.id);

// The tasks of a set: the top `counts` of its SWE-bench order, then of its packs.
export function setTasks(p, set) {
  const n = p.counts?.[set];
  if (!n || typeof n.swebench !== "number" || typeof n.packs !== "number") throw new Error(`the counts of ${set} are not fixed yet (the pilot fixes them)`);
  return [...top(p.order[set].swebench, n.swebench).map((id) => `swebench:${id}`), ...top(p.order[set].packs, n.packs).map((id) => `pack:${id}`)];
}

const PHASE_TASKS = {
  tasks: (p, ph) => ph.tasks,
  set: (p, ph) => setTasks(p, ph.set),
};

export const phaseTasks = (p, phase) => ((ph) => (ph.tasks ? PHASE_TASKS.tasks(p, ph) : ph.set ? PHASE_TASKS.set(p, ph) : []))(phaseOf(p, phase));

export function phaseOf(p, phase) {
  const ph = p.phases.find((x) => x.id === phase);
  if (!ph) throw new Error(`no phase ${phase} in the pre-registration (${p.phases.map((x) => x.id).join(", ")})`);
  return ph;
}

// An arm as the campaign declares it: an arm registered with no revision yet (the release candidate) takes the one
// given now, and it must be named.
function armDef(p, id, o) {
  const a = p.arms[id];
  if (!a) throw new Error(`the pre-registration declares no arm ${id}`);
  const { note, ...def } = a;
  if (def.rev === null) return o.rev ? { ...def, rev: o.rev } : (() => { throw new Error(`arm ${id} is run at the release candidate's commit: name it (--rev=<commit>)`); })();
  return def;
}

// Task by task, in the registered order; each task's arms in an order seeded by the registration's seed and the task's
// place, so no arm always goes first.
export const runsOf = (p, tasks, arms) => tasks.flatMap((task, i) => seededShuffle([...arms].sort(), p.selection.seed + i + 1).map((arm) => ({ arm, task, trial: 1 })));

export function campaignOf(p, phase, o = {}) {
  const ph = phaseOf(p, phase);
  const tasks = phaseTasks(p, phase);
  const arms = Object.fromEntries(ph.arms.map((id) => [id, armDef(p, id, o)]));
  const tracks = (ph.tracks ?? []).map((t) => ({ id: t.id, arm: t.arm, tasks: t.tasks.map((x) => `pack:${x}`) }));
  return { schema: 1, id: o.id ?? `${phase}-${p.release.replace(/\./g, "")}`, prereg: { release: p.release, phase, digest: sha256(canonical(p)) }, model: p.host.model, effort: p.host.effort, budgetUsd: ph.budgetUsd, limits: p.limits, arms, runs: runsOf(p, tasks, ph.arms), ...(tracks.length ? { tracks } : {}), ...(o.caFile ? { caFile: o.caFile } : {}) };
}

// ---- the verdict ----------------------------------------------------------------------------------------------------------

// One comparison of arm A against arm B over the tasks both have a rated word on: resolved difference, regressions and
// FALSE_DONE, judged by the registered tolerance. rows: [{ task, arm, word }] (one per task and arm).
export function verdictOf(rows, a, b, rule) {
  const wordOf = (arm, task) => rows.find((r) => r.arm === arm && r.task === task && !r.track)?.word ?? null;
  const tasks = [...new Set(rows.map((r) => r.task))].filter((t) => rule.rated.includes(wordOf(a, t)) && rule.rated.includes(wordOf(b, t)));
  const n = (arm, w) => tasks.filter((t) => wordOf(arm, t) === w).length;
  const d = n(a, "RESOLVED") - n(b, "RESOLVED");
  const reg = n(a, "REGRESSED") - n(b, "REGRESSED");
  const verdict = tasks.length < rule.minPaired ? "INCONCLUSIVE" : d <= -rule.margin || reg >= rule.margin ? "REGRESSED" : d >= rule.margin ? "IMPROVED" : d === 0 ? "NO_DIFFERENCE" : "INCONCLUSIVE";
  return { a, b, paired: tasks.length, resolved: { [a]: n(a, "RESOLVED"), [b]: n(b, "RESOLVED") }, regressed: { [a]: n(a, "REGRESSED"), [b]: n(b, "REGRESSED") }, falseDone: { [a]: n(a, "FALSE_DONE"), [b]: n(b, "FALSE_DONE") }, difference: d, verdict };
}

// The release's verdict over its comparisons: REGRESSED if any is, IMPROVED or NO_DIFFERENCE only if all are, else
// INCONCLUSIVE.
export const overallOf = (verdicts) => (verdicts.includes("REGRESSED") ? "REGRESSED" : verdicts.every((v) => v === "IMPROVED") ? "IMPROVED" : verdicts.every((v) => v === "NO_DIFFERENCE") ? "NO_DIFFERENCE" : "INCONCLUSIVE");
