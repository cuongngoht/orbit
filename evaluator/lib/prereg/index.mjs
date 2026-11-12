// A PRE-REGISTRATION (prereg/<release>.json): what will be run and how it will be judged, written and committed BEFORE
// any model run it governs. This module re-derives what it can from its own rule (so a list is never taken on trust),
// and builds every campaign of a phase FROM it (so a campaign cannot quietly differ from what was registered): the
// tasks are the top `counts` of the registered order, the arms, model, effort and limits are the registered ones, the
// runs go task by task (a SWE-bench instance image is pulled once, used by every arm, and removed) with the arms of
// each task in a seeded order, and the budget is the phase's line of the ledger.
//
// An AMENDMENT (prereg/<release>-amendment-<n>.json) is a file of its own beside the registration, committed before
// any run of its own phases: it names the registration's digest and only ADDS -- arms, phases, comparisons that the
// release gate does not read (`gate: false`) and a ledger of its own. Nothing registered can be changed by one: a field
// an amendment does not declare is refused, and so is an id that is already the registration's. A campaign of an
// amendment's phase freezes the registration's digest as every campaign does, and the amendment's beside it.
//
//   loadPrereg(file) -> prereg      verifyPrereg(prereg, o) -> [problem]      phaseTasks(prereg, phase) -> [task ref]
//   campaignOf(prereg, phase, o) -> campaign definition      verdictOf(rows, a, b, rule) -> { verdict, ... }
//   amendmentsOf(file) -> [{ n, file, value, digest }]      verifyAmendment(prereg, a, file, earlier) -> [problem]
//   amendmentProblems(prereg, amendments, file) -> [problem]   (each held to the registration and the ones before it)
//   amendedOf(prereg, amendments) -> the registration with every amendment's arms, phases and comparisons added
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

// A phase's campaign. `o.amendments` (amendmentsOf) makes an amendment's phases buildable; the campaign of one freezes
// the registration's digest, as every campaign does, and that amendment's beside it.
export function campaignOf(registered, phase, o = {}) {
  const p = amendedOf(registered, o.amendments ?? []);
  const ph = phaseOf(p, phase);
  const tasks = phaseTasks(p, phase);
  const arms = Object.fromEntries(ph.arms.map((id) => [id, armDef(p, id, o)]));
  const tracks = (ph.tracks ?? []).map((t) => ({ id: t.id, arm: t.arm, tasks: t.tasks.map((x) => `pack:${x}`) }));
  return { schema: 1, id: o.id ?? `${phase}-${p.release.replace(/\./g, "")}`, prereg: { release: p.release, phase, digest: digestOf(registered), ...amendmentOf(ph, o.amendments ?? []) }, model: p.host.model, effort: p.host.effort, budgetUsd: ph.budgetUsd, limits: p.limits, arms, runs: runsOf(p, tasks, ph.arms), ...(tracks.length ? { tracks } : {}), ...(o.caFile ? { caFile: o.caFile } : {}) };
}

export const digestOf = (value) => sha256(canonical(value));

const amendmentOf = (ph, amendments) => ((a) => (a ? { amendment: { n: a.n, file: a.file, digest: a.digest } } : {}))(amendments.find((x) => x.n === ph.amendment));

// ---- amendments -------------------------------------------------------------------------------------------------------------

export const AMENDMENT_KIND = "orbit-prereg-amendment";

// What an amendment may say, and nothing else: it adds, and it says why.
const AMENDMENT_FIELDS = ["schema", "kind", "release", "amendment", "amends", "builds", "date", "committed", "reason", "unchanged", "condition", "arms", "phases", "comparisons", "verdict", "memory", "budget"];

const AMENDMENT_FILE = (base) => new RegExp(`^${base.replace(/\./g, "\\.")}-amendment-(\\d+)\\.json$`);

// Every amendment beside a registration, in its number's order.
export function amendmentsOf(file) {
  const re = AMENDMENT_FILE(basename(file, ".json"));
  const names = existsSync(dirname(file)) ? readdirSync(dirname(file)).filter((n) => re.test(n)) : [];
  return names.map((name) => ((value) => ({ n: Number(re.exec(name)[1]), file: name, value, digest: digestOf(value) }))(loadPrereg(join(dirname(file), name)))).sort((a, b) => a.n - b.n);
}

// The registration with every amendment's arms, phases (each marked with its amendment's number) and comparisons added.
export function amendedOf(p, amendments) {
  const arms = Object.assign({}, p.arms, ...amendments.map((a) => a.value.arms ?? {}));
  const phases = [...p.phases, ...amendments.flatMap((a) => (a.value.phases ?? []).map((ph) => ({ ...ph, amendment: a.n })))];
  return { ...p, arms, phases, comparisons: [...(p.comparisons ?? []), ...amendments.flatMap((a) => (a.value.comparisons ?? []).map((c) => ({ ...c, amendment: a.n })))] };
}

const sum = (xs) => Math.round(xs.reduce((t, x) => t + x, 0) * 100) / 100;

// What an amendment must be to stand beside the registration it names: its kind and number, the registration's own
// digest and every earlier amendment's (`builds`, as each stands), nothing but what an amendment may say, ids of its own,
// and a ledger that adds up. `earlier`: the amendments numbered before it.
export function verifyAmendment(p, a, registeredFile = `${p.release}.json`, earlier = []) {
  const v = a.value;
  const base = amendedOf(p, earlier);
  const problems = [];
  const say = (ok, why) => (ok ? null : problems.push(`amendment ${a.n}: ${why}`));
  say(v.kind === AMENDMENT_KIND && v.schema === 1, `kind is not ${AMENDMENT_KIND} (schema 1)`);
  say(v.release === p.release && v.amendment === a.n, `it says release ${v.release}, amendment ${v.amendment}; its file says ${p.release}, ${a.n}`);
  say(v.amends?.file === registeredFile && v.amends?.digest === digestOf(p), `it does not name the registration as it stands (${registeredFile}, digest ${digestOf(p).slice(0, 12)})`);
  say(canonical(v.builds ?? []) === canonical(earlier.map((x) => ({ file: x.file, digest: x.digest }))), `it does not name every earlier amendment as it stands (builds: ${earlier.map((x) => `${x.file} ${x.digest.slice(0, 12)}`).join(", ") || "none"})`);
  for (const k of Object.keys(v).filter((x) => !AMENDMENT_FIELDS.includes(x))) say(false, `${k} is not something an amendment may say`);
  for (const id of Object.keys(v.arms ?? {}).filter((x) => base.arms[x])) say(false, `arm ${id} is ${p.arms[id] ? "the registration's" : "an earlier amendment's"}: an amendment adds arms, never changes one`);
  for (const ph of (v.phases ?? []).filter((x) => base.phases.some((y) => y.id === x.id))) say(false, `phase ${ph.id} is ${p.phases.some((y) => y.id === ph.id) ? "the registration's" : "an earlier amendment's"}`);
  return [...problems, ...amendmentBody(p, a, earlier)];
}

// The arms an amendment's phases may run: its own and an earlier amendment's -- never one the registration declares.
const amendmentArms = (a, earlier) => new Set([...Object.keys(a.value.arms ?? {}), ...earlier.flatMap((x) => Object.keys(x.value.arms ?? {}))]);

// A phase runs a set (dev or heldOut), or its own tasks and memory tracks, on amendment arms only.
const phaseHolds = (ph, arms) => ph.arms.every((id) => arms.has(id)) && (ph.set === "dev" || ph.set === "heldOut" || (!ph.set && (Array.isArray(ph.tasks) || Array.isArray(ph.tracks)) && (ph.tracks ?? []).every((t) => ph.arms.includes(t.arm) && t.tasks.length >= 2)));

function amendmentBody(p, a, earlier) {
  const v = a.value;
  const q = amendedOf(p, [...earlier, a]);
  const arms = amendmentArms(a, earlier);
  const problems = [];
  const say = (ok, why) => (ok ? null : problems.push(`amendment ${a.n}: ${why}`));
  for (const ph of v.phases ?? []) say(phaseHolds(ph, arms) && ph.budgetUsd === v.budget?.ledger?.find((l) => l.phase === ph.id)?.usd, `phase ${ph.id} runs only an amendment's arms, on dev or heldOut or its own tasks and tracks, with its ledger line as its budget`);
  for (const c of v.comparisons ?? []) say(c.gate === false && COMPARISON_FORMS[c.kind ?? "heldOut"]?.(q, c, v) === true, `comparison ${c.kind === "memory" ? `of track ${c.track}` : `${c.a} against ${c.b}`} is not one an amendment may make: a held-out comparison of held-out arms, or a memory track of its own phase, that the gate does not read (gate: false)`);
  say(sum((v.budget?.ledger ?? []).map((l) => l.usd)) === v.budget?.usd, "its ledger lines do not add up to its budget");
  return problems;
}

// The comparisons an amendment may make: two held-out arms by the registered verdict rule, or a memory track's kept run
// against its own cold run (reported, no verdict, as the registered memory phase is).
const COMPARISON_FORMS = {
  heldOut: (q, c) => c.set === "heldOut" && [c.a, c.b].every((id) => heldOutArm(q, id)),
  memory: (q, c, v) => (v.phases ?? []).some((ph) => ph.id === c.phase && (ph.tracks ?? []).some((t) => t.id === c.track) && memoryCold(ph, c.track)),
};

// A memory track's last task has its cold run in the same phase: the same arm, on that task, with no store kept.
const memoryCold = (ph, track) => ((t) => (ph.tasks ?? []).includes(`pack:${t.tasks.at(-1)}`) && ph.arms.includes(t.arm))(ph.tracks.find((x) => x.id === track));

const heldOutArm = (q, id) => q.phases.some((ph) => ph.set === "heldOut" && ph.arms.includes(id));

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

// Every amendment held to the registration and to the amendments numbered before it.
export const amendmentProblems = (p, amendments, file) => amendments.flatMap((a) => verifyAmendment(p, a, file, amendments.filter((x) => x.n < a.n)));
