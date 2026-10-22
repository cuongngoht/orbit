// THE COMPOSITION ROOT: the one place Satellite's engine is bound to a real machine -- the project's store (asked of
// Orbit: runtimeProject, then machineContext, so no path or key is computed here), a person's limits (Orbit's own
// automation settings and Satellite's policy), the host and what native acceptance proved of it, and the OWNERS every
// piece of evidence is read back from: Orbit's engineering tasks and QA investigations, the checkout's own git, and the
// Orbit commands a provider is asked through (argv only, never a shell). Nothing under satellite/src/ reads an
// environment, a working directory or a child process; everything it needs is handed in from here.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveOf, readAutomation } from "../../src/automation/settings.mjs";
import { sha, shaBytes } from "../../src/hash.mjs";
import { modelOf as investigationModel } from "../../src/investigation/model.mjs";
import { createInvestigations } from "../../src/investigation/store.mjs";
import { OUTCOMES } from "../../src/investigation/vocab.mjs";
import { taskSessionMark } from "../../src/memory/session.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { contained } from "../../src/project/boundary.mjs";
import { storeBase } from "../../src/project/repository.mjs";
import { runtimeProject } from "../../src/runtime/context.mjs";
import { machineContext } from "../../src/store/context.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { modelOf as taskModel } from "../../src/task/model.mjs";
import { createTasks } from "../../src/task/store.mjs";
import { resolved } from "../../src/knowledge/verify.mjs";
import { effectiveResourcesOf } from "../../src/resources/compose.mjs";
import { realWorld } from "../../skills/orbit-control/world.mjs";
import { factoryPort, projectSkillsOf } from "../../skills/orbit-help/factory.mjs";
import { taskView } from "../../src/task/views.mjs";
import { ACCEPTANCE_FILE, passedOn, sourceDigestOf, staleReceipts } from "../src/hosts/acceptance.mjs";
import { hostOf } from "../src/hosts/detect.mjs";
import { hostRowOf } from "../src/hosts/matrix.mjs";
import { definitionsPort } from "../src/store/port.mjs";
import { readPolicy } from "../src/store/policy.mjs";
import { roomsOf } from "../src/store/rooms.mjs";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

// ---- a person's limits ----------------------------------------------------------------------------------------

function limitsOf(env, paths) {
  const io = realIo();
  const machine = readAutomation(io, join(stateRooms(storeBase(env)).automation, "settings.json"));
  const project = readAutomation(io, join(paths.storeRoot, "automation", "settings.json"));
  return effectiveOf([{ by: "machine", content: machine.content }, { by: "project", content: project.content }]);
}

// ---- what native acceptance proved, for this very source ------------------------------------------------------

const walked = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => ((p) => (statSync(p).isDirectory() ? walked(p) : [p]))(join(dir, n))) : []);

const ACCEPTED_SOURCES = [["satellite", "src"], ["satellite", "cli"], ["skills", "satellite"]];

export const sourceFilesOf = (root) => [...ACCEPTED_SOURCES.flatMap((parts) => walked(join(root, ...parts))), ...(existsSync(join(root, "agents")) ? readdirSync(join(root, "agents")).filter((n) => n.startsWith("satellite-")).map((n) => join(root, "agents", n)) : [])].filter((p) => /\.(mjs|md|json)$/.test(p)).map((p) => ({ rel: relative(root, p), text: readFileSync(p, "utf8") }));

function acceptanceOf(root) {
  const doc = parsed(existsSync(join(root, "satellite", "acceptance", ACCEPTANCE_FILE)) ? readFileSync(join(root, "satellite", "acceptance", ACCEPTANCE_FILE), "utf8") : "null");
  if (!doc) return { passed: new Set(), receipts: 0, stale: 0, digest: null };
  const digest = sourceDigestOf(sourceFilesOf(root));
  return { passed: passedOn(doc, digest), receipts: (doc.receipts ?? []).length, stale: staleReceipts(doc, digest), digest };
}

// ---- the owners evidence is read back from ----------------------------------------------------------------------

const DEFECT = new Set(OUTCOMES.filter((o) => o.defect).map((o) => o.id));

const summarized = (m) => ({ lifecycle: m.lifecycle, ended: ["completed", "cancelled"].includes(m.lifecycle), reason: m.completed.at(-1)?.reason ?? null, findings: m.findings.length, defects: m.findings.filter((f) => DEFECT.has(f.outcome)).length, task: m.meta?.runtime?.task ?? null });

const taskViewOf = (tasks, io, id) => ((records) => (records ? taskView(taskModel(records), io.now()) : null))(tasks.read(id));

const createdOf = (tasks, id) => (tasks.read(id) ?? []).find((r) => r.kind === "created") ?? null;

const tasksSince = (tasks, at) => tasks.list().map((id) => ({ id, created: createdOf(tasks, id) })).filter((t) => t.created && t.created.at >= at).map((t) => ({ id: t.id, objective: t.created.objective, createdAt: t.created.at }));

const fileOf = (root, p) => ((full) => (existsSync(full) && statSync(full).isFile() ? { exists: true, digest: shaBytes(readFileSync(full)).slice(0, 16) } : { exists: false }))(contained(root, join(root, String(p))));

function snapshotOf(proc, root) {
  const git = (args) => proc.run("git", args, { cwd: root, timeoutMs: 15000 });
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  return { head: head.ok ? head.out.trim() : null, dirty: status.ok ? status.out.split("\n").filter(Boolean).length : null, digest: sha(`${head.ok ? head.out.trim() : ""}\0${status.ok ? status.out : "unreadable"}`) };
}

const ownersOf = (b) => ((tasks) => ({ owners: { task: (id) => taskViewOf(tasks, b.io, id), tasksSince: (at) => tasksSince(tasks, at), investigation: (id) => summarized(investigationModel(createInvestigations(b.paths.storeRoot, b.io).read(id))), file: (p) => fileOf(b.paths.root, p) }, checkout: { snapshot: () => snapshotOf(b.proc, b.paths.root) } }))(createTasks(b.paths.storeRoot, b.io));

// ---- the providers: Orbit's own commands, argv only, the live viewer they would open switched off ----------------

const orbitCli = (b, cli, args, input) => b.proc.runAsync(b.node, [join(b.roots.orbit, "cli", cli), ...args], { cwd: b.paths.root, env: { ...b.env, ORBIT_LIVE: "off" }, input, timeoutMs: 180000, maxBuffer: 8 * 1024 * 1024 });

const asked = async (b, cli, args, input) => ((r) => (r.ok ? { ok: true, answer: parsed(r.out) ?? r.out.trim().slice(0, 4000) } : { ok: false, error: r.error }))(await orbitCli(b, cli, args, input));

async function engineeringStart(b, spec) {
  const r = await orbitCli(b, "autonomous-engineering.mjs", ["start", spec.objective, "--json"]);
  const answer = r.ok ? parsed(r.out) : null;
  return answer?.task ? { task: answer.task, created: answer.created !== false } : { error: r.ok ? "autonomous engineering answered no task id" : r.error };
}

const providersOf = (b) => ({ providers: { engineering: { start: (spec) => engineeringStart(b, spec) }, context: (text) => asked(b, "context.mjs", ["--for-stdin", "--json"], text), knowledge: (text) => asked(b, "knowledge.mjs", ["claims", `--for=${text}`, "--json"]) } });

// ---- the resolver and Orbit's skill factory, over the same effective registry the prompt router and Control build --

const lazily = (fn) => {
  const kept = { done: false, value: undefined };
  return () => (kept.done ? kept.value : Object.assign(kept, { done: true, value: fn() }).value);
};

// Orbit's factory port, narrowed to what a mission may do: a person's moves (status, archive, rollback) are not here.
export const narrowedFactory = (f) => ({ scaffold: f.scaffold, put: f.put, verify: f.verify, register: f.register, pinned: f.pinned, playbook: f.playbook, list: f.list, current: f.current, workflow: f.workflow });

function resolverOf(b) {
  const h = { paths: b.paths, io: b.io };
  const effective = lazily(() => effectiveResourcesOf({ ...realWorld({ pluginRoot: b.roots.orbit, projectRoot: b.paths.root, env: b.env }), capabilities: () => [], projectSkills: projectSkillsOf(h, b.limits.values) }));
  const resolve = (cap) => resolved([{ capability: cap, proves: { subject: cap } }], effective()).results[0] ?? null;
  return { resolve, factory: narrowedFactory(factoryPort(h, () => b.limits.values, resolve, { pluginRoot: b.roots.orbit })) };
}

const livenessOf = (b) => (lease) => (lease.host !== b.io.host ? null : !b.proc.alive(lease.pid) ? false : (b.proc.startedAtOf(lease.pid) ?? null) === (lease.pidStartedAt ?? null));

const inputPort = () => ({ input: (file) => readFileSync(file ?? 0, "utf8"), file: (p) => readFileSync(p, "utf8") });

function baseOf(env, found, io, opts) {
  const rooms = roomsOf(found.paths.storeRoot);
  const policy = readPolicy(io, rooms.policyFile);
  const acceptance = acceptanceOf(opts.pluginRoot ?? PLUGIN_ROOT);
  const proc = opts.proc ?? createProcess();
  return { env, paths: found.paths, io, rooms, policy, acceptance, proc, hostId: hostOf(env), limits: limitsOf(env, found.paths), definitions: definitionsPort(io, rooms, policy), project: { key: found.paths.storeKey, checkout: found.paths.checkoutId, root: found.paths.root }, session: taskSessionMark(env.ORBIT_SESSION), now: () => io.now(), nowMs: () => io.nowMs(), host: io.host, pid: io.pid, pidStartedAt: () => proc.startedAtOf(process.pid) ?? null, roots: { orbit: opts.pluginRoot ?? PLUGIN_ROOT, satellite: join(opts.pluginRoot ?? PLUGIN_ROOT, "satellite") }, input: opts.input ?? inputPort(), node: opts.node ?? process.execPath };
}

// env: the command environment (commandEnvironment); cwd: where the command runs; opts: { pluginRoot, proc, node, input }
export function bindPorts(env, cwd, opts = {}) {
  const found = runtimeProject(env, cwd);
  const machine = machineContext({ project: found.paths, config: found.config ?? {} }, env);
  const b = baseOf(env, found, machine.io, opts);
  return { ...b, hostRow: hostRowOf(b.hostId, b.acceptance.passed), liveness: livenessOf(b), ...ownersOf(b), ...providersOf(b), ...resolverOf(b) };
}
