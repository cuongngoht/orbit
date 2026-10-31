#!/usr/bin/env node
// THE INSPECTION after a repair round: what the round left, read back in a container of its own -- no network, no
// credential, the subject and the runner's store mounted read-only -- so nothing a round wrote is ever read on the
// developer's machine but these outputs. It asks Orbit's own read commands what became of the engineering task and
// what the session trail attributed, walks the task's workspace and compares it with the subject file by file, and
// copies out the regular files that were added or changed. It executes nothing of the candidate's: no git in the
// workspace (whose configuration is the agent's to write), no test, no import.
//
// After a GOAL round (an engineering case) Orbit is the plugin at /work/orbit and /work/repo is the target; the goal
// started a workflow beside its engineering task, so the task is the one engineering task the store holds, and each
// goal's latest plan is read back too -- as data: which units it planned, and which a missing prerequisite left
// unresolved.
//
//   node /bench/inspect.mjs <tsk-…|-> [--plugin=<dir>]
//                                   out: /work/out/inspect.json, task.json, tasks.json, trace.json, goals.json, files/<rel>
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const PATHS = { repo: "/work/repo", store: "/work/store", out: "/work/out" };

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

// Copied out: a regular file a change brought, small enough to be source, while the whole stays bounded.
function copiedOut(tree, changes) {
  let total = 0;
  const copyable = (c) => c.change !== "deleted" && ["file", "exec"].includes(c.kind) && c.size <= LIMITS.file && (total += c.size) <= LIMITS.copied;
  return changes.map((c) => ({ ...c, copied: copyable(c) ? copied(tree, c.rel) : false }));
}

function copied(tree, rel) {
  const to = join(PATHS.out, "files", rel);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(join(tree, rel)));
  return true;
}

// ---- Orbit's own read commands, run from the subject ---------------------------------------------------------------------

const pluginArg = (argv) => (argv.find((a) => /^--plugin=\/work\/(repo|orbit)$/.test(a)) ?? "--plugin=/work/repo").slice("--plugin=".length);

const PLUGIN = pluginArg(process.argv.slice(2));

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

// The one ENGINEERING task (a goal starts a workflow task beside it), else the one task the store holds; two are never
// guessed between.
export const taskFound = (asked, list) => asked ?? ((tasks) => oneOf(idsOf(tasks.filter((t) => t?.provider === "autonomous-engineering"))) ?? oneOf(idsOf(tasks)))(list?.json?.tasks ?? []);

// ---- the goals a round left, read back as data ------------------------------------------------------------------------

const GOAL = /^goal-[0-9a-f]{12}$/;

const latestPlan = (dir) => readdirSync(dir).filter((n) => /^plan-\d+\.json$/.test(n)).sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5))).at(-1) ?? null;

const goalDir = (id) => (existsSync(PATHS.store) ? readdirSync(PATHS.store).map((d) => join(PATHS.store, d, "goals", id)).find((p) => existsSync(p) && !lstatSync(p).isSymbolicLink()) ?? null : null);

const planOf = (dir) => ((name) => (name ? jsonOr(readFileSync(join(dir, name), "utf8")) : null))(dir ? latestPlan(dir) : null);

// A unit a missing prerequisite holds says so in its plan (`because: "missing: …"`): kept as a flag, never its words.
const unitOf = (u) => ({ kind: u.kind, state: u.state, missing: /^missing:/.test(String(u.because ?? "")) });

const goalOf = (id) => ((status, plan) => ({ id, lifecycle: status.json?.view?.lifecycle ?? null, completion: status.json?.view?.completion?.outcome ?? null, task: status.json?.projection?.currentTask ?? null, units: (plan?.units ?? []).map(unitOf) }))(answered(orbit("orbit.mjs", ["goal", "status", id])), planOf(goalDir(id)));

const goalsOf = () => ((r) => ({ exit: r.exit, json: { goals: (r.json?.goals ?? []).filter((id) => GOAL.test(String(id))).slice(0, 20).map(goalOf) } }))(answered(orbit("orbit.mjs", ["goal", "list"])));

function main(asked) {
  const tasks = answered(orbit("task.mjs", ["list"]));
  const task = taskFound(asked, tasks);
  const shown = task ? answered(orbit("task.mjs", ["show", task])) : { exit: null, json: null, why: "no task was started" };
  [["task.json", shown], ["tasks.json", tasks], ["trace.json", answered(orbit("trace.mjs", ["usage"]))], ["goals.json", goalsOf()]].forEach(([name, v]) => writeFileSync(join(PATHS.out, name), `${JSON.stringify(v)}\n`));
  inspected(asked, task, task ? treeOf(task) : null);
}

function inspected(asked, task, tree) {
  const changes = tree ? copiedOut(tree, compared(listed(PATHS.repo, [".claude-plugin/types"]), listed(tree))) : [];
  writeFileSync(join(PATHS.out, "inspect.json"), `${JSON.stringify({ task, found: asked ? "start" : task ? "only-task" : null, workspace: Boolean(tree), changes, at: new Date().toISOString() }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(TASK.test(process.argv[2] ?? "") ? process.argv[2] : null);
