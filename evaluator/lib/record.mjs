// THE RECORD of a release's evaluation: what the plugin repository's publish gate reads
// (`node skills/orbit-release/ship.mjs --evidence --evaluation=<record.json>`). It is computed from the named campaigns'
// frozen campaign.json and journals alone -- never from an agent's word -- and only from campaigns made from the
// pre-registration it names (each campaign froze that pre-registration's digest when it began): every run's outcome word
// per arm, task and trial, the plugin commit every arm ran, the pre-registration's digest and path, and the
// pre-registered comparisons and verdict worked out by the pre-registration's own rule (lib/prereg/index.mjs). A
// campaign made under another pre-registration, an arm frozen at two commits, or a run named twice is refused: a record
// is one evaluation, never a mixture. The release candidate is one commit: every arm registered at it (`rev: null`) ran
// at the same one.
//
// An AMENDMENT beside the pre-registration (prereg/<release>-amendment-<n>.json) adds phases and comparisons the gate
// does not read: its campaigns froze its digest beside the registration's, and its comparisons -- by the registered
// verdict rule, over the same held-out runs -- are carried as the record's SECONDARY verdict, beside the primary one and
// never mixed into it (`comparisons` and `verdict` are the registration's alone).
//
//   recordOf({ prereg: <file>, campaigns: [id], home }) -> record      RECORD_KIND
//   record: { schema, kind, release, prereg: { file, digest }, evaluator, at, campaigns: [...], arms: { id: { kind, rev,
//             commit } }, runs: [{ campaign, phase, arm, task, trial, track?, word, why, costUsd, minutes }],
//             comparisons: [{ a, b, set, gate, paired, resolved, regressed, falseDone, difference, verdict,
//             medianCostUsd, medianMinutes }], verdict, missing: [run],
//             secondary: null | { amendments: [{ n, file, digest }], comparisons: [...], verdict,
//                                 memory: [{ phase, track, arm, task, kept, cold }], missing: [run] } }
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { git, headOf, isDirty } from "./core/git.mjs";
import { EVALUATOR_DIR, median, nowIso, readJson } from "./core/util.mjs";
import { amendedOf, amendmentProblems, amendmentsOf, digestOf, loadPrereg, overallOf, setTasks, verdictOf } from "./prereg/index.mjs";
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

function campaignOfRecord(home, id, prereg, digest, amendments) {
  const room = roomOf(home, id);
  if (!existsSync(join(room, "campaign.json"))) throw new Error(`no campaign ${id} under ${dirname(room)}`);
  const c = readJson(join(room, "campaign.json"));
  if (c.prereg?.digest !== digest || c.prereg?.release !== prereg.release) throw new Error(`campaign ${id} was not made from this pre-registration (it froze ${c.prereg?.digest?.slice(0, 12) ?? "none"}, the file is ${digest.slice(0, 12)}): make campaigns with prereg campaign <phase>`);
  const why = amendmentProblem(prereg, amendments, c.prereg);
  if (why) throw new Error(`campaign ${id}: ${why}`);
  return { id, room, campaign: c, report: reportOf(room) };
}

// A registered phase's campaign names no amendment; an amendment's phase's campaign names that amendment as it stands.
function amendmentProblem(p, amendments, frozen) {
  if (p.phases.some((ph) => ph.id === frozen.phase)) return frozen.amendment ? `phase ${frozen.phase} is the registration's, and the campaign names amendment ${frozen.amendment.n}` : null;
  const a = amendments.find((x) => (x.value.phases ?? []).some((ph) => ph.id === frozen.phase));
  if (!a) return `phase ${frozen.phase} is in neither the pre-registration nor an amendment beside it`;
  return frozen.amendment?.n === a.n && frozen.amendment?.digest === a.digest ? null : `phase ${frozen.phase} is amendment ${a.n}'s, and the campaign did not freeze that amendment as it stands (digest ${a.digest.slice(0, 12)})`;
}

// Every arm's plugin commit, one per arm across all the campaigns: the same arm at two commits is two arms.
function armsOf(loaded) {
  const arms = {};
  for (const l of loaded) for (const [id, a] of Object.entries(l.campaign.arms)) {
    const mine = { kind: a.kind, rev: a.rev ?? null, commit: a.frozen?.commit ?? null, ...(a.seat ? { seat: true } : {}) };
    if (arms[id] && arms[id].commit !== mine.commit) throw new Error(`arm ${id} ran at two commits (${arms[id].commit} and ${mine.commit}) across the campaigns named: a record is one evaluation`);
    arms[id] = mine;
  }
  return arms;
}

// The release candidate is one commit: every arm registered at it (rev null, in the registration or an amendment) that
// the record holds ran at the same one.
function oneCandidate(q, arms) {
  const ids = Object.entries(q.arms).filter(([id, a]) => a.rev === null && arms[id]).map(([id]) => id);
  const commits = [...new Set(ids.map((id) => arms[id].commit))];
  if (commits.length > 1) throw new Error(`the release candidate's arms ran at different commits (${ids.map((id) => `${id} ${arms[id].commit}`).join(", ")}): a record is one evaluation of one candidate`);
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
  const digest = digestOf(p);
  if (!o.campaigns?.length) throw new Error("name the campaigns the record is made from: --campaign=<id>[,<id>...]");
  const amendments = heldAmendments(p, o.prereg);
  const loaded = o.campaigns.map((id) => campaignOfRecord(o.home, id, p, digest, amendments));
  return assembled(p, digest, o.prereg, loaded, amendments);
}

// The amendments beside the pre-registration, each held to it first: a record never carries one that does not stand.
function heldAmendments(p, file) {
  const amendments = amendmentsOf(file);
  const problems = amendmentProblems(p, amendments, basename(file));
  if (problems.length) throw new Error(`an amendment beside ${file} does not hold: ${problems.join("; ")}`);
  return amendments;
}

function assembled(p, digest, file, loaded, amendments) {
  const arms = oneCandidate(amendedOf(p, amendments), armsOf(loaded));
  const runs = runsOf(loaded);
  const comparisons = (p.comparisons ?? []).filter((c) => c.set === HELD_OUT).map((c) => comparisonOf(p, heldOutRuns(p, runs), c));
  const verdict = overallOf(comparisons.filter((c) => c.gate).map((c) => c.verdict));
  return { schema: 1, kind: RECORD_KIND, release: p.release, prereg: { file: preregPath(file), digest }, evaluator: { commit: headOf(EVALUATOR_DIR), dirty: isDirty(EVALUATOR_DIR) }, at: nowIso(), campaigns: loaded.map(campaignSaid), arms, runs, comparisons, verdict, missing: missingOf(p, runs), secondary: secondaryOf(p, amendments, runs) };
}

// THE SECONDARY verdict: every amendment's comparisons, by the registered verdict rule over the same held-out runs, and
// their overall verdict -- reported beside the primary one and never part of it -- with what the amendments' held-out
// phases (and the registered arms they compare with) owe and the record does not hold.
function secondaryOf(p, amendments, runs) {
  if (!amendments.length) return null;
  const made = (kind) => amendments.flatMap((a) => (a.value.comparisons ?? []).filter((c) => (c.kind ?? HELD_OUT) === kind).map((c) => ({ a, c })));
  const comparisons = made(HELD_OUT).map(({ a, c }) => ({ ...comparisonOf(p, heldOutRuns(p, runs), c), amendment: a.n }));
  const memory = made("memory").map(({ a, c }) => ({ ...memoryOf(a, c, runs), amendment: a.n }));
  return { amendments: amendments.map((a) => ({ n: a.n, file: a.file, digest: a.digest })), comparisons, verdict: overallOf(comparisons.map((c) => c.verdict)), memory, missing: [...secondaryMissing(p, amendments, runs), ...memoryMissing(p, amendments, runs)] };
}

const saidOf = (r) => (r ? { word: r.word, costUsd: r.costUsd, minutes: r.minutes } : null);

// A memory track of an amendment: its last task's run with the store kept, beside that task's cold run on the same arm
// in the same phase. Reported, with no verdict, as the registered memory phase is.
function memoryOf(a, c, runs) {
  const track = a.value.phases.find((ph) => ph.id === c.phase).tracks.find((t) => t.id === c.track);
  const task = `pack:${track.tasks.at(-1)}`;
  const kept = runs.filter((r) => r.track === c.track && r.arm === track.arm && r.phase === c.phase).sort((x, y) => (y.step ?? 0) - (x.step ?? 0))[0];
  const cold = runs.find((r) => !r.track && r.arm === track.arm && r.task === task && r.phase === c.phase);
  return { kind: "memory", phase: c.phase, track: c.track, arm: track.arm, task, gate: false, kept: saidOf(kept?.task === task ? kept : null), cold: saidOf(cold) };
}

function secondaryMissing(p, amendments, runs) {
  const arms = [...new Set(amendments.flatMap((a) => [...(a.value.phases ?? []).filter((ph) => ph.set === HELD_OUT).flatMap((ph) => ph.arms), ...(a.value.comparisons ?? []).filter((c) => (c.kind ?? HELD_OUT) === HELD_OUT).flatMap((c) => [c.a, c.b])]))];
  const has = (arm, task) => runs.find((r) => !r.track && r.arm === arm && r.task === task && r.trial === 1 && p.outcomes.words.includes(r.word));
  return arms.flatMap((arm) => heldOutTasks(p).filter((task) => !has(arm, task)).map((task) => `${arm} on ${task}`));
}

// What an amendment's memory phases owe: every step of every track, and each cold run, with a word.
function memoryMissing(p, amendments, runs) {
  const phases = amendments.flatMap((a) => (a.value.phases ?? []).filter((ph) => ph.tracks));
  const worded = (f) => runs.some((r) => f(r) && p.outcomes.words.includes(r.word));
  const steps = phases.flatMap((ph) => ph.tracks.flatMap((t) => t.tasks.map((x, i) => ({ ph, t, task: `pack:${x}`, step: i + 1 }))));
  const cold = phases.flatMap((ph) => (ph.tasks ?? []).flatMap((task) => ph.arms.map((arm) => ({ ph, arm, task }))));
  return [...steps.filter((s) => !worded((r) => r.phase === s.ph.id && r.track === s.t.id && r.step === s.step && r.task === s.task)).map((s) => `${s.t.arm} on ${s.task} (track ${s.t.id}, step ${s.step})`), ...cold.filter((c) => !worded((r) => r.phase === c.ph.id && !r.track && r.arm === c.arm && r.task === c.task)).map((c) => `${c.arm} on ${c.task} (cold, ${c.ph.id})`)];
}
