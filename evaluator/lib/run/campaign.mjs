// A CAMPAIGN: a declared list of runs (arm, task, trial) under one model, effort, set of limits and total USD budget.
// Its room is under the evaluator's home (never in a repository): campaign.json frozen when it begins (what every arm,
// task, tool and the evaluator itself were, by commit and digest), journal.jsonl, and one room per run attempt. It
// runs to its end from its journal alone, so a controller that dies (a worker restart) is resumed, never restarted:
// a held outcome is never run again, an attempt cut short is INTERRUPTED (charged its cap) and run again as a new
// attempt at most MAX_RERUNS times, and a run never starts when what the budget has left is below its cap, nor when
// the controller's environment lacks a credential its arm names (NOT_RUN, charged nothing, tried again on a resume).
//
//   loadCampaign(file) -> def      frozenCampaign(def, o) -> campaign      planOf(def) -> [{ key, arm, task, trial, track }]
//   startCampaign(file, o) · resumeCampaign(id, o) · campaignStatus(id, o)
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { armOf } from "../arms/index.mjs";
import { credentialValues } from "../core/credential.mjs";
import { docker, LABEL, listByLabel, removeContainer, removeNetwork } from "../core/docker.mjs";
import { git, headOf, isDirty } from "../core/git.mjs";
import { canStart, foldJournal, interruptedCount, ledgerOf, MAX_RERUNS, nextAttempt, openAttempts, readJournal } from "../core/journal.mjs";
import { ensureTools } from "../core/tools.mjs";
import { appendLine, EVALUATOR_DIR, ensureDir, evalHome, nowIso, readJson, seededShuffle, slug, writeJson } from "../core/util.mjs";
import { CLAUDE_CODE_VERSION } from "../core/versions.mjs";
import { taskOf } from "../tasks/index.mjs";
import { namesOf, runAttempt } from "./attempt.mjs";
import { writtenReport } from "./report.mjs";

const LIMIT_KEYS = ["usd", "turns", "minutes", "cpus", "memoryMb", "pids"];

export const campaignsDir = (home) => join(home, "campaigns");

export const roomOf = (home, id) => join(campaignsDir(home), id);

export function loadCampaign(file) {
  const def = JSON.parse(readFileSync(file, "utf8"));
  const problems = problemsOf(def);
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
  return def;
}

function problemsOf(def) {
  const arms = Object.entries(def.arms ?? {});
  const models = arms.some(([, a]) => a.kind !== "scripted" && !a.deterministic);
  return [
    ...(def.schema === 1 ? [] : ["schema must be 1"]),
    ...(/^[a-z0-9][a-z0-9._-]{0,63}$/.test(def.id ?? "") ? [] : ["id must be a short lowercase name"]),
    ...(arms.length ? [] : ["arms must name at least one arm"]),
    ...(models && !(def.model && def.effort) ? ["model and effort are required when an arm runs a coding host"] : []),
    ...(typeof def.budgetUsd === "number" && def.budgetUsd >= 0 ? [] : ["budgetUsd must be a number of dollars"]),
    ...LIMIT_KEYS.filter((k) => !(typeof def.limits?.[k] === "number" && def.limits[k] >= 0)).map((k) => `limits.${k} must be a number`),
    ...(Array.isArray(def.tasks) || Array.isArray(def.runs) || Array.isArray(def.tracks) ? [] : ["tasks (with arms and trials), runs or tracks must say what runs"]),
  ];
}

// The runs, in the order they run: explicit `runs`, or every arm on every task for `trials` trials -- shuffled with a
// seed when `order.shuffle` says so -- and then each memory track's tasks, in its declared order, one store kept.
export function planOf(def) {
  const matrix = def.runs ?? (def.tasks ?? []).flatMap((task) => Object.keys(def.arms).flatMap((arm) => Array.from({ length: def.trials ?? 1 }, (_, i) => ({ arm, task, trial: i + 1 }))));
  const ordered = def.order?.shuffle !== undefined ? seededShuffle(matrix, def.order.shuffle) : matrix;
  const tracked = (def.tracks ?? []).flatMap((t) => t.tasks.map((task, i) => ({ arm: t.arm, task, trial: 1, track: t.id, step: i + 1 })));
  return [...ordered, ...tracked].map((r) => ({ ...r, key: keyOf(r) }));
}

const keyOf = (r) => `${r.arm}__${r.task.replace(/[:/]/g, "_")}__t${r.trial}${r.track ? `__${r.track}-${r.step}` : ""}`;

const evaluatorOf = () => ({ commit: headOf(EVALUATOR_DIR), dirty: isDirty(EVALUATOR_DIR) });

const pluginRepoOf = (def) => resolve(def.pluginRepo ?? git(["rev-parse", "--show-toplevel"], { cwd: dirname(EVALUATOR_DIR) }).out.trim());

export function frozenCampaign(def, o) {
  const plan = planOf(def);
  const pluginRepo = pluginRepoOf(def);
  const arms = Object.fromEntries(Object.entries(def.arms).map(([id, a]) => [id, { ...a, frozen: armOf(id, a).freeze({ pluginRepo }) }]));
  const missing = plan.filter((r) => !arms[r.arm]).map((r) => r.arm);
  if (missing.length) throw new Error(`runs name arms nobody declared: ${[...new Set(missing)].join(", ")}`);
  const tasks = Object.fromEntries([...new Set(plan.map((r) => r.task))].map((ref) => ((t) => [ref, { digest: t.digest, image: t.image, ...(t.pin ? { pin: t.pin } : {}) }])(taskOf(ref, { home: o.home }))));
  return { ...def, arms, plan, tasks, pluginRepo, caFile: o.caFile ?? def.caFile ?? null, claudeCode: CLAUDE_CODE_VERSION, evaluator: evaluatorOf(), frozenAt: nowIso() };
}

// ---- the lock: one controller per campaign ------------------------------------------------------------------------------

const alive = (pid) => {
  try { return process.kill(pid, 0), true; }
  catch (e) { return e.code === "EPERM"; }
};

function locked(room) {
  const file = join(room, "lock");
  const held = existsSync(file) ? readJson(file) : null;
  if (held && held.pid !== process.pid && alive(held.pid)) throw new Error(`campaign is already being run by process ${held.pid}`);
  writeJson(file, { pid: process.pid, at: nowIso() });
  return () => rmSync(file, { force: true });
}

// ---- running it -----------------------------------------------------------------------------------------------------------

export async function startCampaign(file, o = {}) {
  const home = o.home ?? evalHome();
  const def = loadCampaign(file);
  const room = roomOf(home, def.id);
  if (existsSync(join(room, "campaign.json"))) throw new Error(`campaign ${def.id} has already begun: resume it (cli.mjs resume ${def.id})`);
  ensureDir(room);
  writeJson(join(room, "campaign.json"), frozenCampaign(def, { ...o, home }));
  return driven(home, def.id, o);
}

export const resumeCampaign = (id, o = {}) => driven(o.home ?? evalHome(), id, o);

async function driven(home, id, o) {
  const room = roomOf(home, id);
  if (!existsSync(join(room, "campaign.json"))) throw new Error(`no campaign ${id} under ${campaignsDir(home)}`);
  const unlock = locked(room);
  try { return await loop(home, room, readJson(join(room, "campaign.json")), o); }
  finally { unlock(); }
}

async function loop(home, room, campaign, o) {
  const journal = join(room, "journal.jsonl");
  const tools = ensureTools({ caFile: campaign.caFile });
  if (!tools.ok) throw new Error(`the tools volume could not be made: ${tools.why}`);
  if (tools.claudeCode !== campaign.claudeCode) throw new Error(`the campaign froze Claude Code ${campaign.claudeCode}, and the tools volume has ${tools.claudeCode}`);
  appendLine(journal, { kind: "begun", at: nowIso(), pid: process.pid, tools: { volume: tools.volume, claudeCode: tools.claudeCode, node: tools.node } });
  interruptedClosed(campaign, journal);
  for (const r of campaign.plan) await oneRun(home, room, campaign, journal, r, tools, o);
  if (!campaign.keepImages) appendLine(journal, { kind: "images-removed", at: nowIso(), images: imagesRemoved(campaign, journal) });
  appendLine(journal, { kind: "finished", at: nowIso() });
  return writtenReport(room);
}

// The task images this campaign pulled (a SWE-bench instance image is gigabytes), removed when it ends unless it says
// keepImages; an image that was already on the daemon is left as it was.
function imagesRemoved(campaign, journal) {
  const lines = readJournal(journal).filter((l) => l.kind === "ended" && l.images?.pulled && l.images?.taskRef);
  const refs = [...new Set(lines.map((l) => l.images.taskRef))].filter((ref) => ref !== campaign.tools?.nodeImage && !/^node:/.test(ref));
  return refs.map((ref) => ({ ref, removed: docker(["image", "rm", ref]).ok }));
}

// Every attempt a dead controller left open: its containers removed (only by its own labels), INTERRUPTED, its cap charged.
function interruptedClosed(campaign, journal) {
  for (const a of openAttempts(foldJournal(readJournal(journal)))) {
    const label = namesOf(campaign.id, a.run, a.attempt).label;
    const found = listByLabel("container", LABEL.run, label);
    found.forEach(removeContainer);
    listByLabel("network", LABEL.run, label).forEach(removeNetwork);
    appendLine(journal, { kind: "interrupted", run: a.run, attempt: a.attempt, at: nowIso(), chargedUsd: a.capUsd, found });
  }
}

// The credential names an arm needs that the controller's environment does not hold: checked by name, never by value.
export const missingCredentials = (arm, env = process.env) => arm.credentialNames.filter((n) => !(typeof env[n] === "string" && env[n].length > 0));

async function oneRun(home, room, campaign, journal, r, tools, o) {
  const fold = foldJournal(readJournal(journal));
  const s = fold.runs.get(r.key);
  if (s?.outcome) return;
  if (s && interruptedCount(s) > MAX_RERUNS) return appendLine(journal, { kind: "outcome", run: r.key, attempt: s.attempts.at(-1).n, at: nowIso(), word: "INFRA_ERROR", why: `INTERRUPTED: cut short ${interruptedCount(s)} times` });
  const { frozen, ...armDef } = campaign.arms[r.arm];
  const arm = armOf(r.arm, armDef);
  const cap = arm.charges ? campaign.limits.usd : 0;
  const missing = missingCredentials(arm);
  if (missing.length) return appendLine(journal, { kind: "skipped", run: r.key, at: nowIso(), reason: `credential: the controller's environment has no ${missing.join(", ")}` });
  const ledger = ledgerOf(fold, campaign.budgetUsd);
  if (!canStart(ledger, cap)) return appendLine(journal, { kind: "skipped", run: r.key, at: nowIso(), reason: `the budget has $${ledger.remainingUsd} left, below this run's cap of $${cap}` });
  const task = taskOf(r.task, { home, campaign });
  const trackStore = r.track ? join(room, "tracks", slug(r.track), "work", "orbit-store") : null;
  await runAttempt({ campaign, home, room, journal, run: r, attempt: nextAttempt(s), arm, armFrozen: frozen, task, tools, pluginRepo: campaign.pluginRepo, caFile: campaign.caFile, credentialValues: credentialValues(arm.credentialNames), trackStore, keepScratch: o.keepScratch === true });
}

// ---- reading it -----------------------------------------------------------------------------------------------------------

export function campaignStatus(id, o = {}) {
  const room = roomOf(o.home ?? evalHome(), id);
  const campaign = readJson(join(room, "campaign.json"));
  const fold = foldJournal(readJournal(join(room, "journal.jsonl")));
  const rows = campaign.plan.map((r) => ((s) => ({ key: r.key, arm: r.arm, task: r.task, trial: r.trial, state: s?.outcome ? s.outcome.word : s?.skipped && !s.attempts.length ? "NOT_RUN" : openAttempts(fold).some((a) => a.run === r.key) ? "RUNNING" : s?.attempts.length ? "INTERRUPTED" : "PLANNED", attempts: s?.attempts.length ?? 0, why: s?.outcome?.why ?? s?.skipped?.reason ?? null }))(fold.runs.get(r.key)));
  const lock = existsSync(join(room, "lock")) ? readJson(join(room, "lock")) : null;
  return { id, room, ledger: ledgerOf(fold, campaign.budgetUsd), controller: lock ? { pid: lock.pid, alive: alive(lock.pid) } : null, finished: Boolean(fold.finished), rows };
}

export const writeTextFile = (file, text) => writeFileSync(file, text);
