#!/usr/bin/env node
// THE INSPECTION after a repair round: what the round left, read back in a container of its own -- no network, no
// credential, the subject and the runner's store mounted read-only -- so nothing a round wrote is ever read on the
// developer's machine but these outputs. It asks Orbit's own read commands what became of the engineering task and
// what the session trail attributed, walks the task's workspace and compares it with the subject file by file, and
// copies out the regular files that were added or changed. It executes nothing of the candidate's: no git in the
// workspace (whose configuration is the agent's to write), no test, no import.
//
// After a GOAL round (an engineering case) Orbit is the plugin at /work/orbit and /work/repo is the target; the goal
// started a workflow beside its engineering task, so the task is the one the round's own coordinated workflow names as
// its engineering step's (`automation.mjs context`, the workflow's own record) -- else the one engineering task the store
// holds -- however many a host left beside it, and each goal's latest plan is read back too -- as data: which units it
// planned, and which a missing prerequisite left unresolved.
//
// It also reads back what the session trail says turn by turn (`trace.mjs turns`, what the agreement rule holds the
// host's stream to) and every sandbox the runner store holds, with its operations journal (sandbox.json: what each
// sandbox step came to, for the tool-call failure metrics).
//
//   node /bench/inspect.mjs <tsk-…|-> [--plugin=<dir>] [--tree=/work/worktree] [--activation]
//                                   out: /work/out/inspect.json, task.json, tasks.json, trace.json, turns.json, goals.json,
//                                        sandbox.json, files/<rel>; with --activation also activation.json, views.json,
//                                        workflows.json, works.json, rooms.json, uitests.json, ledger.json, plans.json,
//                                        plancheck.json, check.json, workspace.json and ws-files/<rel>
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

// Where the inspection finds what it reads: the container's own mounts -- or, for a test that runs it outside any container,
// the directories its environment names. The controller fixes an inspection container's environment, and names none.
const OUTSIDE = { repo: "ORBIT_BENCH_REPO", store: "ORBIT_BENCH_STORE", out: "ORBIT_BENCH_OUT", plugin: "ORBIT_BENCH_PLUGIN", tree: "ORBIT_BENCH_TREE" };

const outside = (k) => process.env[OUTSIDE[k]] || null;

export const PATHS = { repo: outside("repo") ?? "/work/repo", store: outside("store") ?? "/work/store", out: outside("out") ?? "/work/out" };

export const LIMITS = { file: 2 * 1024 * 1024, read: 25 * 1024 * 1024, copied: 64 * 1024 * 1024, json: 8 * 1024 * 1024 };

const SKIPPED = new Set([".git"]);

const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

const kindOf = (st) => (st.isSymbolicLink() ? "link" : st.isFile() ? ((st.mode & 0o111) !== 0 ? "exec" : "file") : "other");

// Every entry under `root` but a `.git` and what `skip` names, as { rel, kind, size, digest } -- links never followed.
export function listed(root, skip = []) {
  const out = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => entered(root, join(dir, e.name), e, skip, out, walk));
  if (existsSync(root)) walk(root);
  return out;
}

function entered(root, path, e, skip, out, walk) {
  const rel = relative(root, path).split(sep).join("/");
  if (SKIPPED.has(e.name) || skip.includes(rel)) return;
  if (e.isDirectory() && !e.isSymbolicLink()) return walk(path);
  out.push(entryAt(path, rel));
}

function entryAt(path, rel) {
  const st = lstatSync(path);
  const kind = kindOf(st);
  const readable = (kind === "file" || kind === "exec") && st.size <= LIMITS.read;
  return { rel, kind, size: st.size, digest: readable ? digestOf(readFileSync(path)) : `${kind}:${st.size}` };
}

const byRel = (list) => new Map(list.map((e) => [e.rel, e]));

const changeOf = (b, w) => (!b ? "added" : !w ? "deleted" : b.digest !== w.digest || b.kind !== w.kind ? "modified" : null);

export function compared(baseline, tree) {
  const b = byRel(baseline);
  const w = byRel(tree);
  return [...new Set([...b.keys(), ...w.keys()])].sort().map((rel) => ({ rel, change: changeOf(b.get(rel), w.get(rel)), kind: (w.get(rel) ?? b.get(rel)).kind, size: w.get(rel)?.size ?? 0, digest: w.get(rel)?.digest ?? null })).filter((c) => c.change);
}

// Copied out: a regular file a change brought, small enough to be source, while the whole stays bounded -- into `files/`,
// or another directory of the out room (an activation round's engineering workspace: `ws-files/`).
function copiedOut(tree, changes, into = "files") {
  let total = 0;
  const copyable = (c) => c.change !== "deleted" && ["file", "exec"].includes(c.kind) && c.size <= LIMITS.file && (total += c.size) <= LIMITS.copied;
  return changes.map((c) => ({ ...c, copied: copyable(c) ? copied(tree, c.rel, into) : false }));
}

function copied(tree, rel, into) {
  const to = join(PATHS.out, into, rel);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(join(tree, rel)));
  return true;
}

// ---- Orbit's own read commands, run from the subject ---------------------------------------------------------------------

const pluginArg = (argv) => (argv.find((a) => /^--plugin=\/work\/(repo|orbit)$/.test(a)) ?? "--plugin=/work/repo").slice("--plugin=".length);

const PLUGIN = outside("plugin") ?? pluginArg(process.argv.slice(2));

// A round whose host was handed no Orbit (0.5.0, B23's `none` arm) changed a writable copy of the target, mounted here
// read-only; the round's changes are read off it instead of a task's workspace. One fixed path, never a value.
export const worktreeArg = (argv) => (argv.includes("--tree=/work/worktree") ? "/work/worktree" : null);

const WORKTREE = outside("tree") ?? worktreeArg(process.argv.slice(2));

const orbit = (cli, args) => spawnSync(process.execPath, [`${PLUGIN}/cli/${cli}`, ...args, "--json"], { cwd: PATHS.repo, env: process.env, encoding: "utf8", timeout: 120000, maxBuffer: LIMITS.json });

const answered = (r) => ({ exit: r.status, json: ((t) => (t ? jsonOr(t) : null))(String(r.stdout ?? "").trim()), why: r.status === 0 ? null : String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").at(-1)?.slice(0, 300) ?? null });

const jsonOr = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

// The task's workspace tree: <store>/<project>/workspaces/<task>/tree, the room the workspace owner keeps.
const treeOf = (task) => (existsSync(PATHS.store) ? readdirSync(PATHS.store).map((d) => join(PATHS.store, d, "workspaces", task, "tree")).find((p) => existsSync(p) && !lstatSync(p).isSymbolicLink()) ?? null : null);

const TASK = /^tsk-[a-f0-9]{12}$/;

// The task a round's start file named -- or, when the controller never read one (a round interrupted before its runner
// said), the ONE task the run's own runner store holds: only a round's runner starts one there, and it says which
// before its host runs, so a store without a start file holds that one task or none. Two are not guessed between.
const oneOf = (ids) => (ids.length === 1 ? ids[0] : null);

const idsOf = (tasks) => tasks.map((t) => t?.id).filter((id) => TASK.test(String(id)));

const listedTasks = (list) => list?.json?.tasks ?? [];

const ofProvider = (list, provider) => listedTasks(list).filter((t) => t?.provider === provider);

// A GOAL round's own coordinators say which engineering task is theirs: each coordinated workflow's child -- the task its
// engineering step dispatched, as `automation.mjs context` reads it off the workflow's own journal, which only its
// coordinator writes, so a task a host started by hand beside it is never one. Read through Orbit's own command, bounded;
// the round's task is the one they name, and two different ones are never guessed between.
const WORKFLOWS = 10;

const childOf = (id) => answered(orbit("automation.mjs", ["context", id])).json?.child?.task ?? null;

export const coordinatedTask = (list, child = childOf) => oneOf([...new Set(idsOf(ofProvider(list, "automation")).slice(0, WORKFLOWS).map(child).filter((t) => TASK.test(String(t))))]);

// The task a start file named; else the one the round's own coordinators name; else the one ENGINEERING task (a goal
// starts a workflow task beside it), else the one task the store holds -- never the newest of several: two are never
// guessed between.
export const taskFound = (asked, list, named = null) => asked ?? named ?? oneOf(idsOf(ofProvider(list, "autonomous-engineering"))) ?? oneOf(idsOf(listedTasks(list)));

// Which task a round left, and by whose word it was found: the start file's, the coordinators', or the only one there is.
function foundTask(asked, list) {
  const named = asked ? null : coordinatedTask(list);
  const task = taskFound(asked, list, named);
  return { task, found: asked ? "start" : named ? "coordinator" : task ? "only-task" : null };
}

// ---- the goals a round left, read back as data ------------------------------------------------------------------------

const GOAL = /^goal-[0-9a-f]{12}$/;

const latestPlan = (dir) => readdirSync(dir).filter((n) => /^plan-\d+\.json$/.test(n)).sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5))).at(-1) ?? null;

const goalDir = (id) => (existsSync(PATHS.store) ? readdirSync(PATHS.store).map((d) => join(PATHS.store, d, "goals", id)).find((p) => existsSync(p) && !lstatSync(p).isSymbolicLink()) ?? null : null);

const planOf = (dir) => ((name) => (name ? jsonOr(readFileSync(join(dir, name), "utf8")) : null))(dir ? latestPlan(dir) : null);

// A unit a missing prerequisite holds says so in its plan (`because: "missing: …"`): kept as a flag, never its words.
const unitOf = (u) => ({ kind: u.kind, state: u.state, missing: /^missing:/.test(String(u.because ?? "")) });

const goalOf = (id) => ((status, plan) => ({ id, lifecycle: status.json?.view?.lifecycle ?? null, completion: status.json?.view?.completion?.outcome ?? null, task: status.json?.projection?.currentTask ?? null, units: (plan?.units ?? []).map(unitOf), ...(ACTIVATION ? goalReadingOf(goalDir(id)) : {}) }))(answered(orbit("orbit.mjs", ["goal", "status", id])), planOf(goalDir(id)));

const goalsOf = () => ((r) => ({ exit: r.exit, json: { goals: (r.json?.goals ?? []).filter((id) => GOAL.test(String(id))).slice(0, 20).map(goalOf) } }))(answered(orbit("orbit.mjs", ["goal", "list"])));

// ---- the sandboxes a round left, read back as data --------------------------------------------------------------------
//
// Each sandbox the runner store holds, as runtime keeps it (src/runtime/rooms.mjs): its document under
// <store>/<project>/checkouts/<checkout>/sandboxes/<env>.json -- its state, its owner, why it was blocked -- and its
// operations journal under <store>/<project>/runtime/<host>/checkouts/<checkout>/sandboxes/<env>/operations/, one
// document per step it took (prepare, restore, a container up, a release ...), written BEFORE the step acted. Read as
// data: each operation's kind, state, times and the sentence its writer already scrubbed; never a log, a path or a
// command. A link is never followed, and what is read is bounded.
export const SANDBOX_LIMITS = { sandboxes: 50, operations: 2000, bytes: 1024 * 1024 };

const isDir = (p) => existsSync(p) && lstatSync(p).isDirectory();

const dirsIn = (p) => (isDir(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(p, e.name)) : []);

const docsIn = (p) => (isDir(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => join(p, e.name)) : []);

const docAt = (file) => (lstatSync(file).size <= SANDBOX_LIMITS.bytes ? jsonOr(readFileSync(file, "utf8")) : null);

const under = (roots, ...parts) => roots.flatMap((r) => dirsIn(join(r, ...parts)));

// <store>/<project>/checkouts/<checkout>/sandboxes/<env>.json
const sandboxDocs = (projects) => under(projects, "checkouts").flatMap((c) => docsIn(join(c, "sandboxes"))).map(docAt).filter((d) => d?.kind === "sandbox");

// <store>/<project>/runtime/<host>/checkouts/<checkout>/sandboxes/<env>/ -> its operations, by the sandbox's id
const opsRooms = (projects) => under(under(under(projects, "runtime"), "checkouts"), "sandboxes");

const OPERATION = (o) => ({ kind: String(o.kind), state: String(o.state), at: o.at ?? null, settledAt: o.settledAt ?? null, because: typeof o.because === "string" ? o.because.slice(0, 300) : null });

const opsOf = (room) => docsIn(join(room, "operations")).map(docAt).filter((o) => o?.kind && o?.state).map(OPERATION).sort((a, b) => String(a.at).localeCompare(String(b.at)));

const sandboxRow = (id, doc, ops) => ({ id, task: doc?.owner?.id ?? null, state: doc?.state ?? null, blocked: doc?.blocked ? { needs: doc.blocked.needs ?? null, because: String(doc.blocked.because ?? "").slice(0, 300) } : null, operations: ops });

export function sandboxesOf(store = PATHS.store) {
  const projects = dirsIn(store);
  const docs = new Map(sandboxDocs(projects).map((d) => [d.id, d]));
  const rooms = new Map(opsRooms(projects).map((r) => [r.split(sep).at(-1), r]));
  const ids = [...new Set([...docs.keys(), ...rooms.keys()])].sort().slice(0, SANDBOX_LIMITS.sandboxes);
  return { exit: 0, json: { sandboxes: ids.map((id) => sandboxRow(id, docs.get(id), rooms.has(id) ? opsOf(rooms.get(id)).slice(0, SANDBOX_LIMITS.operations) : [])) } };
}

// ---- what the activation judge reads back (0.5.0, B22 M4) -----------------------------------------------------------
//
// After an activation round (`--activation`): the activation chain the trail folds (`trace.mjs activation`), every
// task's own view (its provider, lifecycle, how many actions it took, its receipts' domains and outcomes, its approvals'
// boundaries and decisions -- never a reason's words), every coordinated workflow's plan with each step's state, this
// checkout's tracked works, how many records each owner's room holds, the project's test data (each file's digest, and
// what each case's steps say), the run ledger's verdicts, the plans and whether plan-check and query check are clean,
// each goal's reading of its specification, and the engineering task's workspace compared with the checkout. Each read
// through Orbit's own read commands or as data, bounded, and nothing it reads is ever run.
const ACTIVATION = process.argv.slice(2).includes("--activation");

const idsIn = (tasks, provider) => idsOf((tasks.json?.tasks ?? []).filter((t) => !provider || t?.provider === provider));

const viewOf = (v) => ({ id: v.task?.id ?? null, provider: v.task?.provider ?? null, lifecycle: v.lifecycle ?? null, terminal: v.terminal === true, stopReason: v.stopReason ?? null, actions: (v.actions ?? []).length, receipts: (v.receipts ?? []).map((r) => ({ domain: r.domain ?? null, outcome: r.outcome ?? null })), approvals: (v.approvals ?? []).map((a) => ({ boundary: a.boundary ?? null, state: a.state ?? null, open: a.open === true, decision: a.decision ?? null })) });

const viewsOf = (tasks) => ({ exit: 0, json: { views: idsIn(tasks).slice(0, 20).map((id) => answered(orbit("task.mjs", ["show", id])).json).filter(Boolean).map(viewOf) } });

const workflowOf = (id) => ((c) => ({ id, revision: c?.revision ?? null, lifecycle: c?.lifecycle ?? null, steps: (c?.plan?.steps ?? []).map((s) => ({ id: s.id ?? null, kind: s.kind ?? null, state: s.state ?? null })) }))(answered(orbit("automation.mjs", ["context", id])).json);

const workflowsOf = (tasks) => ({ exit: 0, json: { workflows: idsIn(tasks, "automation").slice(0, 10).map(workflowOf) } });

const worksOf = () => ((r) => ({ exit: r.exit, json: { works: (r.json?.works ?? []).slice(0, 50).map((w) => ({ work: w.work ?? null, ref: w.ref ?? null, standing: w.standing ?? null })) } }))(answered(orbit("track.mjs", ["list"])));

// Each owner's room, by where it keeps its records under a project's store: how many it holds, summed over the store.
// Architecture's is the scan's own state -- a project an ensure read keeps it whether or not the scan found a fact.
export const OWNER_ROOMS = { tasks: "tasks", work: "work", goals: "goals", requirements: "requirements", investigations: "autonomous-qa/investigations", missions: "satellite/missions", architecture: "architecture/state" };

const entriesIn = (p) => (isDir(p) ? readdirSync(p).length : 0);

const roomsOf = () => ({ exit: 0, json: Object.fromEntries(Object.entries(OWNER_ROOMS).map(([k, rel]) => [k, dirsIn(PATHS.store).reduce((n, p) => n + entriesIn(join(p, rel)), 0)])) });

// What a case's steps SAY: each step's values, sorted -- the same whichever key a value sits under, so a key spelled
// right where it was spelled wrong says the same, and a value changed says something else.
export const stepsMeaning = (steps) => (Array.isArray(steps) ? steps.map((st) => Object.values(st ?? {}).map((v) => JSON.stringify(v)).sort()) : null);

const caseFiles = (root) => dirsIn(join(root, "screens")).flatMap((d) => docsIn(join(d, "cases")));

const caseOf = (file) => ((c) => (c && typeof c.id === "string" ? [[c.id, stepsMeaning(c.steps)]] : []))(docAt(file));

// The project's test data: every file of its map and its screens by digest, and what each case's steps say.
export const uitestsOf = (root) => (root && isDir(root) ? { digests: Object.fromEntries(["graph", "screens"].flatMap((d) => listed(join(root, d)).map((e) => [`${d}/${e.rel}`, e.digest]))), cases: Object.fromEntries(caseFiles(root).flatMap(caseOf)) } : { digests: null, cases: null });

const jsonlIn = (dir) => (isDir(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")).flatMap((n) => readFileSync(join(dir, n), "utf8").split("\n").map(jsonOr).filter((l) => l && typeof l === "object")) : []);

const ledgerOf = (paths) => ({ exit: 0, json: { lines: jsonlIn(join(paths?.storeRoot ?? "/nowhere", "runs")).slice(-500).map((l) => ({ case: l.case ?? null, status: l.status ?? null, sql: l.proved?.sql ?? null })) } });

const plansOf = (paths) => ({ exit: 0, json: { plans: dirsIn(join(paths?.dataRoot ?? "/nowhere", "screens")).flatMap((d) => docsIn(d).filter((f) => f.endsWith(".plan.json")).map((f) => ({ screen: d.split(sep).at(-1), id: f.split(sep).at(-1).slice(0, -".plan.json".length) }))) } });

// ---- a goal's reading of its specification: its rows' kinds and the lines they cite, beside the specification's lines ---

const lineNo = (ref) => Number(/#L(\d+)$/.exec(String(ref ?? ""))?.[1] ?? 0);

const journalLines = (dir) => (existsSync(join(dir, "journal.jsonl")) ? readFileSync(join(dir, "journal.jsonl"), "utf8").split("\n").slice(-2000).map(jsonOr).filter((l) => l && typeof l === "object") : []);

const readingOf = (a) => (a ? { requirements: (a.requirements ?? []).slice(0, 200).map((r) => ({ kind: r.kind ?? null, kindDefaulted: r.kindDefaulted === true, line: lineNo(r.sourceRef) })), acceptance: (a.acceptance ?? []).slice(0, 200).map((x) => ({ line: lineNo(x.sourceRef) })) } : null);

const specLines = (dir) => String(docAt(join(dir, "spec.json"))?.body ?? "").split("\n").slice(0, 200).map((l) => l.slice(0, 300));

export const goalReadingOf = (dir) => (dir ? { analysis: readingOf(journalLines(dir).filter((l) => l.kind === "analyzed").at(-1)), lines: specLines(dir) } : { analysis: null, lines: [] });

// ---- the engineering task's workspace, compared with the checkout ------------------------------------------------------

const engineeringTask = (tasks) => oneOf(idsIn(tasks, "autonomous-engineering"));

function workspaceOf(tasks) {
  const task = engineeringTask(tasks);
  const tree = task ? treeOf(task) : null;
  const changes = tree ? copiedOut(tree, compared(listed(PATHS.repo, [".claude-plugin/types"]), listed(tree)), "ws-files") : [];
  return { task, workspace: Boolean(tree), changes };
}

function activationRead(tasks) {
  const paths = answered(orbit("query.mjs", ["storage"])).json;
  const plancheck = answered(orbit("plan-check.mjs", []));
  const docs = [["activation.json", answered(orbit("trace.mjs", ["activation", "--days=30", "--limit=200"]))], ["views.json", viewsOf(tasks)], ["workflows.json", workflowsOf(tasks)], ["works.json", worksOf()], ["rooms.json", roomsOf()], ["uitests.json", { exit: 0, json: uitestsOf(paths?.dataRoot ?? null) }], ["ledger.json", ledgerOf(paths)], ["plans.json", plansOf(paths)], ["plancheck.json", { exit: plancheck.exit, json: { errors: plancheck.json?.errors ?? null } }], ["check.json", { exit: answered(orbit("query.mjs", ["check"])).exit, json: null }], ["workspace.json", { exit: 0, json: workspaceOf(tasks) }]];
  return docs.forEach(([name, v]) => writeFileSync(join(PATHS.out, name), `${JSON.stringify(v)}\n`));
}

function main(asked) {
  const tasks = answered(orbit("task.mjs", ["list"]));
  const at = foundTask(asked, tasks);
  const shown = at.task ? answered(orbit("task.mjs", ["show", at.task])) : { exit: null, json: null, why: "no task was started" };
  [["task.json", shown], ["tasks.json", tasks], ["trace.json", answered(orbit("trace.mjs", ["usage"]))], ["turns.json", answered(orbit("trace.mjs", ["turns", "--days=30", "--limit=200"]))], ["goals.json", goalsOf()], ["sandbox.json", sandboxesOf()]].forEach(([name, v]) => writeFileSync(join(PATHS.out, name), `${JSON.stringify(v)}\n`));
  inspected(at, WORKTREE ?? (at.task ? treeOf(at.task) : null), ACTIVATION ? () => activationRead(tasks) : () => null);
}

function inspected(at, tree, more = () => null) {
  more();
  const changes = tree ? copiedOut(tree, compared(listed(PATHS.repo, [".claude-plugin/types"]), listed(tree))) : [];
  writeFileSync(join(PATHS.out, "inspect.json"), `${JSON.stringify({ task: at.task, found: at.found, workspace: Boolean(tree), changes, at: new Date().toISOString() }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(TASK.test(process.argv[2] ?? "") ? process.argv[2] : null);
