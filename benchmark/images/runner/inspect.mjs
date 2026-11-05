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
// It also reads back what the session trail says turn by turn (`trace.mjs turns`, what the agreement rule holds the
// host's stream to) and every sandbox the runner store holds, with its operations journal (sandbox.json: what each
// sandbox step came to, for the tool-call failure metrics).
//
//   node /bench/inspect.mjs <tsk-…|-> [--plugin=<dir>] [--tree=/work/worktree]
//                                   out: /work/out/inspect.json, task.json, tasks.json, trace.json, turns.json, goals.json,
//                                        sandbox.json, files/<rel>
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

// A round whose host was handed no Orbit (0.5.0, B23's `none` arm) changed a writable copy of the target, mounted here
// read-only; the round's changes are read off it instead of a task's workspace. One fixed path, never a value.
export const worktreeArg = (argv) => (argv.includes("--tree=/work/worktree") ? "/work/worktree" : null);

const WORKTREE = worktreeArg(process.argv.slice(2));

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

function main(asked) {
  const tasks = answered(orbit("task.mjs", ["list"]));
  const task = taskFound(asked, tasks);
  const shown = task ? answered(orbit("task.mjs", ["show", task])) : { exit: null, json: null, why: "no task was started" };
  [["task.json", shown], ["tasks.json", tasks], ["trace.json", answered(orbit("trace.mjs", ["usage"]))], ["turns.json", answered(orbit("trace.mjs", ["turns", "--days=30", "--limit=200"]))], ["goals.json", goalsOf()], ["sandbox.json", sandboxesOf()]].forEach(([name, v]) => writeFileSync(join(PATHS.out, name), `${JSON.stringify(v)}\n`));
  inspected(asked, task, WORKTREE ?? (task ? treeOf(task) : null));
}

function inspected(asked, task, tree) {
  const changes = tree ? copiedOut(tree, compared(listed(PATHS.repo, [".claude-plugin/types"]), listed(tree))) : [];
  writeFileSync(join(PATHS.out, "inspect.json"), `${JSON.stringify({ task, found: asked ? "start" : task ? "only-task" : null, workspace: Boolean(tree), changes, at: new Date().toISOString() }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(TASK.test(process.argv[2] ?? "") ? process.argv[2] : null);
