// ONE ATTEMPT of one run (arm, task, trial): a fresh internal network, an egress proxy that lets out only the model's
// API, a fresh task container of the task's image with the tools volume mounted read-only, the task's starting
// repository, the arm's files and the entry; the agent runs to its end, its wall time or a kill; the patch is taken by
// the controller as a diff of trees; the room is scanned for the credential; the patch is graded in a container of
// its own; and the outcome is ONE word from what was observed. Every container and network carries this attempt's
// labels and is removed at the end, all of them, whatever happened -- and a cleanup never replaces the error that
// stopped the attempt.
//
//   runAttempt(ctx) -> { ended, outcome }   (ctx.execute and ctx.dockerAnswers: the Docker-bound steps, faked in checks)      namesOf(campaignId, key, n) -> { net, egress, task, grader, label }
//   infraAfter(ctx, entry, state, summary, ran) -> null | { code, says }   (what the entry and the container say went wrong)
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { connect, copyIn, copyOut, createContainer, createNetwork, docker, ensureImage, imagePath, kill, labelsOf, logsOf, removeContainer, removeNetwork, startAttached, startDetached, stateOf, version } from "../core/docker.mjs";
import { changedPaths, diffTrees, endOfWork } from "../core/git.mjs";
import { scrubbedRoom } from "../core/credential.mjs";
import { chargeOf } from "../core/journal.mjs";
import { outcomeOf } from "../core/outcome.mjs";
import { summaryOf } from "../core/stream.mjs";
import { runToFile } from "../core/proc.mjs";
import { appendLine, EVALUATOR_DIR, ensureDir, nowIso, readJson, sha256, slug, writeJson, writeText } from "../core/util.mjs";
import { API_HOST, REFUSED_PROBE_HOST, TOOLS_MOUNT } from "../core/versions.mjs";
import { promptOf } from "./prompt.mjs";

export const EGRESS_PORT = 3128;

const short = (s) => sha256(String(s)).slice(0, 8);

export function namesOf(campaignId, key, n) {
  const p = `evl-${short(campaignId)}-${short(key)}-a${n}`;
  return { net: `${p}-net`, egress: `${p}-egress`, task: `${p}-task`, grader: `${p}-grader`, label: `${campaignId}/${key}/a${n}` };
}

const infra = (code, says) => ({ code, says: String(says).slice(0, 400) });

// ---- a run's failure is that run's outcome ----------------------------------------------------------------------------------
//
// What throws while a run's start is built (START), while it runs (RUN) or while its patch is taken (PATCH) ends THAT
// run INFRA_ERROR with the code and one line of why, and what throws while it is graded ends it UNGRADABLE: journaled
// like any outcome, and the campaign goes on to its next run. The whole error is kept in the run's room (error.txt).
// Only what is the campaign's -- Docker no longer answering at all -- leaves the attempt open and ends the campaign.

const oneLine = (e) => String(e?.message ?? e).replace(/\s+/g, " ").trim().slice(0, 400);

// The phase a throw happened in, carried on the error so the run's outcome can name it.
export async function inPhase(code, fn) {
  try { return await fn(); }
  catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { phase: e?.phase ?? code }); }
}

function thrownAt(room, e, fallback) {
  writeText(join(room, "error.txt"), `${e?.phase ?? fallback}: ${e?.stack ?? e}\n`);
  return { code: e?.phase ?? fallback, says: oneLine(e) };
}

// Docker answering at all: when it does not, a failed run says nothing about the run, and the campaign stops.
const dockerAnswers = () => version() !== null;

const limitsOf = (ctx) => ({ ...ctx.campaign.limits, ...(ctx.arm.control.minutes ? { minutes: ctx.arm.control.minutes } : {}) });

// ---- the network: an internal network and its one way out ------------------------------------------------------------

async function egressUp(ctx, names, labels, image) {
  const allow = ctx.arm.control.egressAllow ?? ctx.campaign.network?.allow ?? [API_HOST];
  const c = createContainer({ name: names.egress, image, labels: { ...labels, "orbit.eval.role": "egress" }, network: names.net, alias: "egress", argv: ["node", "/opt/egress.mjs", String(EGRESS_PORT), allow.join(",")], limits: { cpus: 0.5, memoryMb: 256, pids: 128 }, logs: true, entrypoint: "" });
  if (!c.ok) return infra("DOCKER", c.why);
  if (!copyIn(join(EVALUATOR_DIR, "lib", "container", "egress.mjs"), names.egress, "/opt/egress.mjs").ok) return infra("DOCKER", "docker cp of the egress proxy failed");
  if (!connect("bridge", names.egress).ok) return infra("DOCKER", "the egress proxy could not join the bridge network");
  if (!startDetached(names.egress).ok) return infra("DOCKER", "the egress proxy did not start");
  return (await listening(names.egress)) ? null : infra("EGRESS", "the egress proxy never said it was listening");
}

async function listening(name) {
  for (let i = 0; i < 50; i += 1) {
    if (logsOf(name).includes('"listening"')) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ---- the task container -------------------------------------------------------------------------------------------------

const AGENT_ENV = { DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", BASH_DEFAULT_TIMEOUT_MS: "1800000", BASH_MAX_TIMEOUT_MS: "3600000", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };

function taskSpec(ctx, names, labels, imageRef) {
  const limits = limitsOf(ctx);
  return {
    name: names.task,
    image: imageRef,
    labels: { ...labels, "orbit.eval.role": "task" },
    network: ctx.arm.needsNetwork ? names.net : null,
    alias: "task",
    env: { ...AGENT_ENV, PATH: `${TOOLS_MOUNT}/bin:${imagePath(imageRef)}`, HOME: "/work/home", ORBIT_STORE_DIR: "/work/orbit-store", ...(ctx.arm.needsNetwork ? proxyEnv(ctx) : {}) },
    envNames: containerCredentials(ctx.arm),
    mounts: [{ type: "volume", source: ctx.tools.volume, target: TOOLS_MOUNT, readOnly: true }, ...(ctx.caFile ? [{ source: ctx.caFile, target: "/run/eval-ca.pem", readOnly: true }] : [])],
    limits: { cpus: limits.cpus, memoryMb: limits.memoryMb, pids: limits.pids },
    argv: [`${TOOLS_MOUNT}/bin/node`, "/opt/evalrun/entry.mjs"],
    workdir: ctx.task.repo,
    entrypoint: "",
  };
}

const proxyEnv = (ctx) => ({ HTTPS_PROXY: `http://egress:${EGRESS_PORT}`, HTTP_PROXY: `http://egress:${EGRESS_PORT}`, NO_PROXY: "localhost,127.0.0.1", ...(ctx.caFile ? { NODE_EXTRA_CA_CERTS: "/run/eval-ca.pem" } : {}) });

// The credential NAMES handed to the task container: an arm whose agent runs on the host hands it none.
const containerCredentials = (arm) => arm.containerCredentialNames ?? arm.credentialNames;

// What the entry checks of the network before the agent starts: the egress proxy's one way out, or -- for an arm whose
// container has no network at all -- that nothing gets out and no outside name resolves.
const networkBrief = (arm) => (arm.needsNetwork ? { proxy: { host: "egress", port: EGRESS_PORT }, allow: API_HOST, refusedProbe: REFUSED_PROBE_HOST } : { isolated: true, refusedProbe: REFUSED_PROBE_HOST });

// The run directory copied into the container: the entry, its brief, and the arm's own files.
function evalrunDir(ctx, scratch) {
  const dir = ensureDir(join(scratch, "evalrun"));
  cpSync(join(EVALUATOR_DIR, "lib", "container", "entry.mjs"), join(dir, "entry.mjs"));
  ensureDir(join(dir, "agent"));
  ensureDir(join(dir, "out"));
  const files = ctx.arm.files({ ...ctx, frozen: ctx.armFrozen });
  for (const f of files.filter((x) => x.kind === "agent")) (f.from ? cpSync(f.from, join(dir, "agent", f.name)) : writeFileSync(join(dir, "agent", f.name), f.bytes ?? ""));
  const limits = limitsOf(ctx);
  writeJson(join(dir, "brief.json"), { repo: ctx.task.repo, makeDirs: ["/work/home", "/work/orbit-store"], writeFiles: ctx.arm.homeFiles ?? [], egress: networkBrief(ctx.arm), ...seatBrief(ctx.arm), agent: { argv: ctx.arm.argv({ model: ctx.campaign.model, effort: ctx.campaign.effort, limits, task: ctx.task }), stdin: promptOf(ctx.task.issue) }, outCap: 15 * 1024 * 1024 });
  return { dir, plugin: files.find((x) => x.kind === "plugin") ?? null };
}

// A seated arm's seat, as the entry runs it: the plugin's adoption command in the checkout, with the run's own HOME and
// store and none of the credential names the container holds, bounded in time; what it wrote to the store is listed.
const SEAT_SECONDS = 300;

const seatBrief = (arm) => (arm.seat ? { seat: { argv: arm.seat.argv, dropEnv: containerCredentials(arm), store: "/work/orbit-store", timeoutMs: SEAT_SECONDS * 1000 } } : {});

function copiedIn(ctx, names, run, start) {
  const pairs = [[run.dir, "/opt"], ...start.copyIn.map((c) => [c.from, c.to]), ...(run.plugin ? [[run.plugin.from, run.plugin.to]] : []), ...(ctx.trackStore && existsSync(ctx.trackStore) ? [[dirname(ctx.trackStore), "/"]] : [])];
  const bad = pairs.find(([from, to]) => !copyIn(from, names.task, to).ok);
  return bad ? infra("DOCKER", `docker cp ${bad[0]} into the task container failed`) : null;
}

// ---- an agent that runs on the host --------------------------------------------------------------------------------------

const RELEASE = "/opt/evalrun/release";

const stopChild = (child) => (child.kill("SIGTERM"), setTimeout(() => child.kill("SIGKILL"), 10000).unref());

// Whether the container's hold said it is ready, before the container ended (the network check or the seat failed) or
// two minutes, and the seat's own bound for a seated arm.
async function holdReady(file, ended, seconds) {
  for (let i = 0; i < seconds * 5 && !ended.done; i += 1) {
    if (readOr(file, "").includes('"ready":true')) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// The container runs the entry and its hold; the arm's own program runs here, on the host, to its end or the wall time
// (then it is stopped), and acts in the container by `docker exec`; then the hold is released and the container ends
// as any agent's would. Its stdout is the run's stream; its config, without any credential, is kept in the room.
async function hostRan(ctx, names, room, scratch, limits) {
  const ended = { done: false };
  const container = startAttached(names.task, join(room, "container.out"), { deadlineMs: limits.minutes * 60000 + 180000, onDeadline: () => kill(names.task), capBytes: 1024 * 1024 }).then((r) => ((ended.done = true), r));
  if (!(await holdReady(join(room, "container.out"), ended, 120 + (ctx.arm.seat ? SEAT_SECONDS : 0)))) return container;
  const h = ctx.arm.host({ ...ctx, frozen: ctx.armFrozen, container: names.task, prompt: promptOf(ctx.task.issue), limits, trajectory: join(room, "trajectory.json"), configFile: join(room, "driver.json"), configDir: ensureDir(join(scratch, "host-config")) });
  const ran = h.infra ? { infra: h.infra } : await driven(h, room, limits);
  docker(["exec", names.task, "touch", RELEASE]);
  const c = await container;
  return { ...ran, container: { code: c.code, timedOut: c.timedOut } };
}

async function driven(h, room, limits) {
  writeJson(h.argv.at(-1), h.config);
  const r = await runToFile(h.argv, join(room, "stream.jsonl"), { env: h.env, deadlineMs: limits.minutes * 60000, onDeadline: stopChild, capBytes: 16 * 1024 * 1024 });
  writeText(join(room, "driver.err"), r.err);
  return { timedOut: r.timedOut, bytes: r.bytes, cut: r.cut, code: r.code };
}

// ---- after the agent ----------------------------------------------------------------------------------------------------

export function infraAfter(ctx, entry, state, summary, ran) {
  if (ran.timedOut) return null;
  if (!entry) return infra("KILLED", `the task container ended before its entry wrote anything (exit ${state?.exitCode})`);
  if (entry.phase === "egress") return infra("EGRESS", `the network did not hold before the agent started: ${JSON.stringify(entry.egress)}`);
  if (entry.phase === "seat") return infra("SEAT", `the seat did not hold before the agent started: ${entry.seat?.why ?? "no reason recorded"}`);
  if (entry.phase === "not-started") return infra("AGENT_NOT_STARTED", entry.agent?.why ?? "the agent's program did not start");
  if (entry.phase !== "ended") return infra(state?.oomKilled ? "OOM" : "KILLED", `the task container ended while the agent ran (exit ${state?.exitCode}${state?.oomKilled ? ", out of memory" : ""})`);
  if (!summary.started) return infra("HOST_NOT_STARTED", `the agent's stream has no init line (agent exit ${entry.agent?.exit})`);
  if (summary.apiError) return infra("API", summary.apiError);
  return null;
}

// The patch: the tree the agent left, against the start, both staged in the run's own git directory (the start's).
export function patchOf(start, scratch, room) {
  const after = join(scratch, "after");
  if (!existsSync(after)) return { bytes: 0, file: null, paths: [], why: "the repository could not be copied out" };
  const gitDir = start.gitDir;
  const tree = endOfWork(start, after);
  const bytes = diffTrees(gitDir, start.startTree, tree);
  const file = join(room, "patch.diff");
  writeFileSync(file, bytes);
  return { bytes: bytes.length, file, digest: sha256(bytes), paths: changedPaths(gitDir, start.startTree, tree), tree };
}

const readOr = (file, fallback) => {
  try { return readFileSync(file, "utf8"); }
  catch { return fallback; }
};

async function executed(ctx, names, room, scratch, labels) {
  const missing = ctx.arm.credentialNames.filter((n) => !(process.env[n]?.length > 0));
  if (missing.length) return { infra: infra("CREDENTIAL_MISSING", `the controller's environment has no ${missing.join(", ")}`) };
  const taskImg = ensureImage(ctx.task.image);
  if (!taskImg.ok) return { infra: infra("DOCKER", taskImg.why) };
  const start = await inPhase("START", () => ctx.task.start(join(scratch, "start"), ctx));
  if (start.infra) return { infra: start.infra };
  const egressImg = ctx.arm.needsNetwork ? await networkUp(ctx, names, labels) : { id: null };
  if (egressImg.infra) return { infra: egressImg.infra, images: { task: taskImg.id } };
  const c = createContainer(taskSpec(ctx, names, labels, ctx.task.image));
  if (!c.ok) return { infra: infra("DOCKER", c.why) };
  const run = evalrunDir(ctx, scratch);
  const cp = copiedIn(ctx, names, run, start);
  if (cp) return { infra: cp };
  return finished(ctx, names, room, scratch, { start, run, images: { task: taskImg.id, taskRef: ctx.task.image, pulled: taskImg.pulled, egress: egressImg.id } });
}

// The internal network and its egress proxy, for an arm whose agent calls the model from inside the container.
async function networkUp(ctx, names, labels) {
  const egressImg = ensureImage(ctx.tools.nodeImage);
  if (!egressImg.ok) return { infra: infra("DOCKER", egressImg.why) };
  const net = createNetwork(names.net, labels);
  if (!net.ok) return { infra: infra("DOCKER", net.why) };
  const e = await egressUp(ctx, names, labels, egressImg.id);
  return e ? { infra: e } : egressImg;
}

async function finished(ctx, names, room, scratch, x) {
  const limits = limitsOf(ctx);
  const startedAt = Date.now();
  const kills = ctx.arm.control.killAfterSeconds ? [{ ms: ctx.arm.control.killAfterSeconds * 1000, fn: () => kill(names.task) }] : [];
  const ran = ctx.arm.runsOn === "host" ? await hostRan(ctx, names, room, scratch, limits) : await startAttached(names.task, join(room, "stream.jsonl"), { deadlineMs: limits.minutes * 60000, onDeadline: () => kill(names.task), at: kills, capBytes: 16 * 1024 * 1024 });
  const wallMs = Date.now() - startedAt;
  const state = stateOf(names.task);
  copyOut(names.task, "/opt/evalrun/out", join(room, "out"));
  copyOut(names.task, ctx.task.repo, join(scratch, "after"));
  if (ctx.trackStore) (rmSync(ctx.trackStore, { recursive: true, force: true }), ensureDir(dirname(ctx.trackStore)), copyOut(names.task, "/work/orbit-store", ctx.trackStore));
  writeFileSync(join(room, "egress.log"), logsOf(names.egress));
  const entry = existsSync(join(room, "out", "entry.json")) ? readJson(join(room, "out", "entry.json")) : null;
  const egress = existsSync(join(room, "out", "egress.json")) ? readJson(join(room, "out", "egress.json")) : null;
  const summary = summaryOf(readOr(join(room, "stream.jsonl"), ""), { pluginDir: ctx.arm.pluginDir });
  const patch = await inPhase("PATCH", () => patchOf(x.start, scratch, room));
  return { infra: ran.infra ?? infraAfter(ctx, entry, state, summary, ran), timedOut: ran.timedOut, killedByControl: kills.length > 0 && !ran.timedOut, exit: state?.exitCode ?? null, oomKilled: state?.oomKilled ?? null, wallMs, streamBytes: ran.bytes, streamCut: ran.cut, entry, summary, patch, egress, plugin: x.run.plugin ? { digest: x.run.plugin.digest, files: x.run.plugin.files } : null, images: x.images, startCommit: x.start.base, startTree: x.start.startTree };
}

// ---- the attempt, from its journal line to its outcome --------------------------------------------------------------------

const cleanups = (names) => [() => removeContainer(names.task), () => removeContainer(names.egress), () => removeContainer(names.grader), () => removeNetwork(names.net)];

async function cleaned(names, scratch, keepScratch) {
  const steps = [...cleanups(names), ...(keepScratch ? [] : [() => rmSync(scratch, { recursive: true, force: true })])];
  return Promise.allSettled(steps.map((f) => Promise.resolve().then(f)));
}

const factsFor = (x, grade) => ({ infra: x.infra ?? null, timedOut: x.timedOut === true, stoppedOn: x.summary?.stoppedOn ?? null, patchBytes: x.patch?.bytes ?? 0, saidDone: x.summary?.status === "DONE", grade });

export async function runAttempt(ctx) {
  const { key } = ctx.run;
  const n = ctx.attempt;
  const names = namesOf(ctx.campaign.id, key, n);
  const labels = labelsOf(ctx.campaign.id, names.label, "run");
  const room = ensureDir(join(ctx.room, "runs", slug(key, 120), `a${n}`));
  const scratch = ensureDir(join(ctx.home, "scratch", slug(ctx.campaign.id, 64), `${slug(key, 120)}-a${n}`));
  const capUsd = ctx.arm.charges ? limitsOf(ctx).usd : 0;
  writeJson(join(room, "manifest.json"), manifestOf(ctx, names, capUsd));
  appendLine(ctx.journal, { kind: "started", run: key, attempt: n, at: nowIso(), capUsd, container: names.task, label: names.label });
  let x;
  try { x = await (ctx.execute ?? executed)(ctx, names, room, scratch, labels); }
  catch (e) { x = { infra: thrownAt(room, e, "RUN") }; }
  await cleaned(names, scratch, ctx.keepScratch);
  if (x.infra && !(ctx.dockerAnswers ?? dockerAnswers)()) throw new Error(`Docker stopped answering during ${key} attempt ${n} (${x.infra.code}: ${x.infra.says}): the campaign stops here; resume it when Docker is back`);
  return settled(ctx, room, names, scratch, x, capUsd);
}

async function settled(ctx, room, names, scratch, x, capUsd) {
  const leak = scrubbedRoom(room, ctx.credentialValues ?? []);
  const x2 = leak.leaked.length ? { ...x, infra: infra("CREDENTIAL_IN_ROOM", `the credential was found in ${leak.leaked.join(", ")}; those files were removed`), patch: { bytes: 0 } } : x;
  const chargedUsd = chargeOf(ctx.arm, x2.summary?.costUsd ?? null, capUsd);
  const ended = { kind: "ended", run: ctx.run.key, attempt: ctx.attempt, at: nowIso(), chargedUsd, ...endedFacts(x2) };
  appendLine(ctx.journal, ended);
  writeJson(join(room, "summary.json"), ended);
  const grade = await gradeOf(ctx, room, names, scratch, x2);
  const word = outcomeOf(factsFor(x2, grade));
  const line = { kind: "outcome", run: ctx.run.key, attempt: ctx.attempt, at: nowIso(), word: word.word, why: word.why, saidDone: x2.summary?.status === "DONE", grade: grade ? { ran: grade.ran, applied: grade.applied, resolved: grade.resolved ?? null, regressed: grade.regressed ?? null, f2pFailed: grade.f2pFailed ?? null, p2pFailed: grade.p2pFailed ?? null } : null };
  appendLine(ctx.journal, line);
  writeJson(join(room, "outcome.json"), { ...line, gradeDetail: grade });
  return { ended, outcome: line };
}

// A patch is graded whenever there is one and the run's environment held -- also when the run timed out or hit its
// budget, so what it left is known, though its word stays TIMEOUT or BUDGET.
async function gradeOf(ctx, room, names, scratch, x) {
  if (x.infra || !(x.patch?.bytes > 0)) return null;
  const gscratch = ensureDir(join(scratch, "g"));
  try { return await ctx.task.grade({ patchFile: x.patch.file, scratch: gscratch, names, labels: labelsOf(ctx.campaign.id, names.label, "grader"), room, campaign: ctx.campaign, home: ctx.home }); }
  catch (e) { return ((t) => ({ ran: false, applied: false, why: `${t.code}: ${t.says}` }))(thrownAt(room, e, "GRADE")); }
  finally { await Promise.allSettled([Promise.resolve().then(() => removeContainer(names.grader)), Promise.resolve().then(() => rmSync(scratch, { recursive: true, force: true }))]); }
}

const endedFacts = (x) => ({ infra: x.infra ?? null, timedOut: x.timedOut === true, killedByControl: x.killedByControl ?? false, exit: x.exit ?? null, oomKilled: x.oomKilled ?? null, wallMs: x.wallMs ?? null, streamBytes: x.streamBytes ?? null, streamCut: x.streamCut ?? null, summary: x.summary ? { ...x.summary, lastText: undefined } : null, patch: x.patch ? { bytes: x.patch.bytes, digest: x.patch.digest ?? null, paths: x.patch.paths ?? [] } : null, plugin: x.plugin ?? null, images: x.images ?? null, startCommit: x.startCommit ?? null, entryPhase: x.entry?.phase ?? null, seat: seatFacts(x.entry?.seat), egress: x.egress ?? x.entry?.egress ?? null });

// What the seat did, as the run's facts keep it: never its output (that is in the room's out/seat.out).
const seatFacts = (s) => (s ? { holds: s.holds, exit: s.exit, ms: s.ms, unchanged: s.unchanged, changed: s.changed, gitDirChanged: s.gitDirChanged, storeFiles: s.storeFiles.length, store: s.storeFiles.slice(0, 50), why: s.why } : null);

function manifestOf(ctx, names, capUsd) {
  return { campaign: ctx.campaign.id, run: ctx.run, attempt: ctx.attempt, arm: { id: ctx.arm.id, kind: ctx.arm.kind, def: ctx.arm.def, frozen: ctx.armFrozen ?? null }, seated: Boolean(ctx.arm.seat), ...(ctx.arm.seat ? { seat: { argv: ctx.arm.seat.argv } } : {}), task: { ref: ctx.task.ref, image: ctx.task.image, repo: ctx.task.repo, digest: ctx.task.digest }, model: ctx.campaign.model, effort: ctx.campaign.effort, limits: limitsOf(ctx), capUsd, tools: ctx.tools, containers: names, evaluator: ctx.campaign.evaluator, startedAt: nowIso() };
}
