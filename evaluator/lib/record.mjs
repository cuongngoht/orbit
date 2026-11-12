// THE RECORD of a release's evaluation: what the plugin repository's publish gate reads
// (`node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json>`). It is computed from the named campaigns'
// frozen campaign.json and journals alone -- never from an agent's word -- and only from campaigns made from the
// pre-registration it names (each campaign froze that pre-registration's digest when it began): every run's outcome word
// per arm, task and trial, the plugin commit every arm ran, the pre-registration's digest and path, and the
// pre-registered comparisons and verdict worked out by the pre-registration's own rule (lib/prereg/index.mjs). A
// campaign made under another pre-registration, an arm frozen at two commits, or a run named twice is refused: a record
// is one evaluation, never a mixture.
//
//   recordOf({ prereg: <file>, campaigns: [id], home }) -> record      RECORD_KIND
//   record: { schema, kind, release, prereg: { file, digest }, evaluator, at, campaigns: [...], arms: { id: { kind, rev,
//             commit } }, runs: [{ campaign, phase, arm, task, trial, track?, word, why, costUsd, minutes }],
//             comparisons: [{ a, b, set, gate, paired, resolved, regressed, falseDone, difference, verdict,
//             medianCostUsd, medianMinutes }], verdict, missing: [run] }
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { git, headOf, isDirty } from "./core/git.mjs";
import { canonical, EVALUATOR_DIR, median, nowIso, readJson, sha256 } from "./core/util.mjs";
import { loadPrereg, overallOf, setTasks, verdictOf } from "./prereg/index.mjs";
import { roomOf } from "./run/campaign.mjs";
import { reportOf } from "./run/report.mjs";

export const RECORD_KIND = "orbit-evaluation-record";

const HELD_OUT = "heldOut";

// The pre-registration's path as the repository names it: the gate reads the committed file there.
function preregPath(file) {
  const repo = resolve(git(["rev-parse", "--show-toplevel"], { cwd: dirname(EVALUATOR_DIR) }).out.trim());
  const rel = relative(repo, resolve(file));
  if (rel.startsWith("..") || resolve(rel) === rel) throw new Error(`the pre-registration ${file} is not a file of the repository the gate reads (${repo})`);
  return rel.split(sep).join("/");
}

function campaignOfRecord(home, id, prereg, digest) {
  const room = roomOf(home, id);
  if (!existsSync(join(room, "campaign.json"))) throw new Error(`no campaign ${id} under ${dirname(room)}`);
  const c = readJson(join(room, "campaign.json"));
  if (c.prereg?.digest !== digest || c.prereg?.release !== prereg.release) throw new Error(`campaign ${id} was not made from this pre-registration (it froze ${c.prereg?.digest?.slice(0, 12) ?? "none"}, the file is ${digest.slice(0, 12)}): make campaigns with prereg campaign <phase>`);
  return { id, room, campaign: c, report: reportOf(room) };
}

// Every arm's plugin commit, one per arm across all the campaigns: the same arm at two commits is two arms.
function armsOf(loaded) {
  const arms = {};
  for (const l of loaded) for (const [id, a] of Object.entries(l.campaign.arms)) {
    const mine = { kind: a.kind, rev: a.rev ?? null, commit: a.frozen?.commit ?? null };
    if (arms[id] && arms[id].commit !== mine.commit) throw new Error(`arm ${id} ran at two commits (${arms[id].commit} and ${mine.commit}) across the campaigns named: a record is one evaluation`);
    arms[id] = mine;
  }
  return arms;
}

const runOf = (l) => (r) => ({ campaign: l.id, phase: l.campaign.prereg.phase, arm: r.arm, task: r.task, trial: r.trial, ...(r.track ? { track: r.track, step: r.step } : {}), word: r.word, why: r.why, costUsd: r.costUsd, minutes: r.minutes });

const keyOf = (r) => [r.arm, r.task, r.trial, r.track ?? ""].join("\u0000");

function runsOf(loaded) {
  const runs = loaded.flatMap((l) => l.report.runs.map(runOf(l)));
  const seen = new Set();
  for (const r of runs) {
    if (seen.has(keyOf(r))) throw new Error(`${r.arm} on ${r.task} (trial ${r.trial}${r.track ? `, track ${r.track}` : ""}) is in two campaigns named: a record is one evaluation`);
    seen.add(keyOf(r));
  }
  return runs;
}

const heldOutTasks = (p) => (p.counts?.[HELD_OUT] ? setTasks(p, HELD_OUT) : []);

const heldOutRuns = (p, runs) => ((tasks) => runs.filter((r) => !r.track && tasks.has(r.task)))(new Set(heldOutTasks(p)));

const medians = (runs, tasks, c, key) => Object.fromEntries([c.a, c.b].map((arm) => [arm, median(tasks.map((t) => runs.find((r) => r.arm === arm && r.task === t)?.[key]))]));

function comparisonOf(p, runs, c) {
  const v = verdictOf(runs.map((r) => ({ task: r.task, arm: r.arm, word: r.word })), c.a, c.b, p.verdictRule);
  const paired = [...new Set(runs.map((r) => r.task))].filter((t) => ["a", "b"].every((k) => p.verdictRule.rated.includes(runs.find((r) => r.arm === c[k] && r.task === t)?.word)));
  return { ...v, set: c.set, gate: c.gate !== false, medianCostUsd: medians(runs, paired, c, "costUsd"), medianMinutes: medians(runs, paired, c, "minutes") };
}

const gatingArms = (p) => new Set((p.comparisons ?? []).filter((c) => c.gate !== false && c.set === HELD_OUT).flatMap((c) => [c.a, c.b]));

// What the pre-registration owes on the held-out set and the record does not hold: a run absent or without a word, or
// NOT_RUN on an arm the verdict rests on. Said for the person; the gate works it out again for itself.
function missingOf(p, runs) {
  const owed = (p.phases ?? []).filter((ph) => ph.set === HELD_OUT).flatMap((ph) => ph.arms.flatMap((arm) => heldOutTasks(p).map((task) => ({ arm, task }))));
  const has = (w) => runs.find((r) => !r.track && r.arm === w.arm && r.task === w.task && r.trial === 1);
  const ok = (r) => Boolean(r) && (p.outcomes.words.includes(r.word) || (r.word === "NOT_RUN" && !gatingArms(p).has(r.arm)));
  return [...(p.counts?.[HELD_OUT] ? [] : ["the held-out counts are not fixed"]), ...owed.filter((w) => !ok(has(w))).map((w) => `${w.arm} on ${w.task}`)];
}

const campaignSaid = (l) => ({ id: l.id, phase: l.campaign.prereg.phase, finished: l.report.finished, model: l.campaign.model ?? null, effort: l.campaign.effort ?? null, claudeCode: l.campaign.claudeCode ?? null, evaluator: l.campaign.evaluator ?? null, frozenAt: l.campaign.frozenAt ?? null, ledger: l.report.ledger });

export function recordOf(o) {
  const p = loadPrereg(o.prereg);
  const digest = sha256(canonical(p));
  if (!o.campaigns?.length) throw new Error("name the campaigns the record is made from: --campaign=<id>[,<id>...]");
  const loaded = o.campaigns.map((id) => campaignOfRecord(o.home, id, p, digest));
  return assembled(p, digest, o.prereg, loaded);
}

function assembled(p, digest, file, loaded) {
  const arms = armsOf(loaded);
  const runs = runsOf(loaded);
  const comparisons = (p.comparisons ?? []).filter((c) => c.set === HELD_OUT).map((c) => comparisonOf(p, heldOutRuns(p, runs), c));
  const verdict = overallOf(comparisons.filter((c) => c.gate).map((c) => c.verdict));
  return { schema: 1, kind: RECORD_KIND, release: p.release, prereg: { file: preregPath(file), digest }, evaluator: { commit: headOf(EVALUATOR_DIR), dirty: isDirty(EVALUATOR_DIR) }, at: nowIso(), campaigns: loaded.map(campaignSaid), arms, runs, comparisons, verdict, missing: missingOf(p, runs) };
}
