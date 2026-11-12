// ONE ATTEMPT of one run (arm, task, trial): a fresh internal network, an egress proxy that lets out only the model's
// API, a fresh task container of the task's image with the tools volume mounted read-only, the task's starting
// repository, the arm's files and the entry; the agent runs to its end, its wall time or a kill; the patch is taken by
// the controller as a diff of trees; the room is scanned for the credential; the patch is graded in a container of
// its own; and the outcome is ONE word from what was observed. Every container and network carries this attempt's
// labels and is removed at the end, all of them, whatever happened -- and a cleanup never replaces the error that
// stopped the attempt.
//
//   runAttempt(ctx) -> { ended, outcome }      namesOf(campaignId, key, n) -> { net, egress, task, grader, label }
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, copyIn, copyOut, createContainer, createNetwork, ensureImage, imagePath, kill, labelsOf, logsOf, removeContainer, removeNetwork, startAttached, startDetached, stateOf } from "../core/docker.mjs";
import { changedPaths, diffTrees, privateGitDir, treeOfWork } from "../core/git.mjs";
import { scrubbedRoom } from "../core/credential.mjs";
import { chargeOf } from "../core/journal.mjs";
import { outcomeOf } from "../core/outcome.mjs";
import { summaryOf } from "../core/stream.mjs";
import { appendLine, EVALUATOR_DIR, ensureDir, nowIso, readJson, sha256, slug, writeJson } from "../core/util.mjs";
import { API_HOST, REFUSED_PROBE_HOST, TOOLS_MOUNT } from "../core/versions.mjs";
import { promptOf } from "./prompt.mjs";

export const EGRESS_PORT = 3128;

const short = (s) => sha256(String(s)).slice(0, 8);

export function namesOf(campaignId, key, n) {
  const p = `evl-${short(campaignId)}-${short(key)}-a${n}`;
  return { net: `${p}-net`, egress: `${p}-egress`, task: `${p}-task`, grader: `${p}-grader`, label: `${campaignId}/${key}/a${n}` };
}

const infra = (code, says) => ({ code, says: String(says).slice(0, 400) });

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
    network: names.net,
    alias: "task",
    env: { ...AGENT_ENV, PATH: `${TOOLS_MOUNT}/bin:${imagePath(imageRef)}`, HOME: "/work/home", ORBIT_STORE_DIR: "/work/orbit-store", HTTPS_PROXY: `http://egress:${EGRESS_PORT}`, HTTP_PROXY: `http://egress:${EGRESS_PORT}`, NO_PROXY: "localhost,127.0.0.1", ...(ctx.caFile ? { NODE_EXTRA_CA_CERTS: "/run/eval-ca.pem" } : {}) },
    envNames: ctx.arm.credentialNames,
    mounts: [{ type: "volume", source: ctx.tools.volume, target: TOOLS_MOUNT, readOnly: true }, ...(ctx.caFile ? [{ source: ctx.caFile, target: "/run/eval-ca.pem", readOnly: true }] : [])],
    limits: { cpus: limits.cpus, memoryMb: limits.memoryMb, pids: limits.pids },
    argv: [`${TOOLS_MOUNT}/bin/node`, "/opt/evalrun/entry.mjs"],
    workdir: ctx.task.repo,
    entrypoint: "",
  };
}

// The run directory copied into the container: the entry, its brief, and the arm's own files.
function evalrunDir(ctx, scratch) {
  const dir = ensureDir(join(scratch, "evalrun"));
  cpSync(join(EVALUATOR_DIR, "lib", "container", "entry.mjs"), join(dir, "entry.mjs"));
  ensureDir(join(dir, "agent"));
  ensureDir(join(dir, "out"));
  const files = ctx.arm.files({ ...ctx, frozen: ctx.armFrozen });
  for (const f of files.filter((x) => x.kind === "agent")) (f.from ? cpSync(f.from, join(dir, "agent", f.name)) : writeFileSync(join(dir, "agent", f.name), f.bytes ?? ""));
  const limits = limitsOf(ctx);
  writeJson(join(dir, "brief.json"), { repo: ctx.task.repo, makeDirs: ["/work/home", "/work/orbit-store"], egress: { proxy: { host: "egress", port: EGRESS_PORT }, allow: API_HOST, refusedProbe: REFUSED_PROBE_HOST }, agent: { argv: ctx.arm.argv({ model: ctx.campaign.model, effort: ctx.campaign.effort, limits, task: ctx.task }), stdin: promptOf(ctx.task.issue) }, outCap: 15 * 1024 * 1024 });
  return { dir, plugin: files.find((x) => x.kind === "plugin") ?? null };
}

function copiedIn(ctx, names, run, start) {
  const pairs = [[run.dir, "/opt"], ...start.copyIn.map((c) => [c.from, c.to]), ...(run.plugin ? [[run.plugin.from, run.plugin.to]] : []), ...(ctx.trackStore && existsSync(ctx.trackStore) ? [[ctx.trackStore, "/work"]] : [])];
  const bad = pairs.find(([from, to]) => !copyIn(from, names.task, to).ok);
  return bad ? infra("DOCKER", `docker cp ${bad[0]} into the task container failed`) : null;
}

// ---- after the agent ----------------------------------------------------------------------------------------------------

function infraAfter(ctx, entry, state, summary, ran) {
  if (ran.timedOut) return null;
  if (!entry) return infra("KILLED", `the task container ended before its entry wrote anything (exit ${state?.exitCode})`);
  if (entry.phase === "egress") return infra("EGRESS", `the network did not hold before the agent started: ${JSON.stringify(entry.egress)}`);
  if (entry.phase === "not-started") return infra("AGENT_NOT_STARTED", entry.agent?.why ?? "the agent's program did not start");
  if (entry.phase !== "ended") return infra(state?.oomKilled ? "OOM" : "KILLED", `the task container ended while the agent ran (exit ${state?.exitCode}${state?.oomKilled ? ", out of memory" : ""})`);
  if (!summary.started) return infra("HOST_NOT_STARTED", `the agent's stream has no init line (agent exit ${entry.agent?.exit})`);
  if (summary.apiError) return infra("API", summary.apiError);
  return null;
}

// The patch: the tree the agent left, against the start, staged in a git directory of the controller's own.
function patchOf(start, scratch, room) {
  const after = join(scratch, "after");
  if (!existsSync(after)) return { bytes: 0, file: null, paths: [], why: "the repository could not be copied out" };
  const gitDir = privateGitDir(start.gitDir, join(scratch, "diff.git"));
  const tree = treeOfWork(gitDir, after, start.base);
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
  const egressImg = ensureImage(ctx.tools.nodeImage);
  if (!egressImg.ok) return { infra: infra("DOCKER", egressImg.why) };
  const start = await ctx.task.start(join(scratch, "start"), ctx);
  if (start.infra) return { infra: start.infra };
  const net = createNetwork(names.net, labels);
  if (!net.ok) return { infra: infra("DOCKER", net.why), images: { task: taskImg.id } };
  const e = await egressUp(ctx, names, labels, egressImg.id);
  if (e) return { infra: e, images: { task: taskImg.id, egress: egressImg.id } };
  const c = createContainer(taskSpec(ctx, names, labels, ctx.task.image));
  if (!c.ok) return { infra: infra("DOCKER", c.why) };
  const run = evalrunDir(ctx, scratch);
  const cp = copiedIn(ctx, names, run, start);
  if (cp) return { infra: cp };
  return finished(ctx, names, room, scratch, { start, run, images: { task: taskImg.id, egress: egressImg.id } });
}

async function finished(ctx, names, room, scratch, x) {
  const limits = limitsOf(ctx);
  const startedAt = Date.now();
  const kills = ctx.arm.control.killAfterSeconds ? [{ ms: ctx.arm.control.killAfterSeconds * 1000, fn: () => kill(names.task) }] : [];
  const ran = await startAttached(names.task, join(room, "stream.jsonl"), { deadlineMs: limits.minutes * 60000, onDeadline: () => kill(names.task), at: kills, capBytes: 16 * 1024 * 1024 });
  const wallMs = Date.now() - startedAt;
  const state = stateOf(names.task);
  copyOut(names.task, "/opt/evalrun/out", join(room, "out"));
  copyOut(names.task, ctx.task.repo, join(scratch, "after"));
  if (ctx.trackStore) (rmSync(ctx.trackStore, { recursive: true, force: true }), copyOut(names.task, "/work/orbit-store", ctx.trackStore));
  writeFileSync(join(room, "egress.log"), logsOf(names.egress));
  const entry = existsSync(join(room, "out", "entry.json")) ? readJson(join(room, "out", "entry.json")) : null;
  const egress = existsSync(join(room, "out", "egress.json")) ? readJson(join(room, "out", "egress.json")) : null;
  const summary = summaryOf(readOr(join(room, "stream.jsonl"), ""), { pluginDir: ctx.arm.pluginDir });
  const patch = patchOf(x.start, scratch, room);
  return { infra: infraAfter(ctx, entry, state, summary, ran), timedOut: ran.timedOut, killedByControl: kills.length > 0 && !ran.timedOut, exit: state?.exitCode ?? null, oomKilled: state?.oomKilled ?? null, wallMs, streamBytes: ran.bytes, streamCut: ran.cut, entry, summary, patch, egress, plugin: x.run.plugin ? { digest: x.run.plugin.digest, files: x.run.plugin.files } : null, images: x.images, startCommit: x.start.base, startTree: x.start.startTree };
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
  let error = null;
  try { x = await executed(ctx, names, room, scratch, labels); }
  catch (e) { error = e; }
  await cleaned(names, scratch, Boolean(error) || ctx.keepScratch);
  if (error) throw error;
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
  finally { await Promise.allSettled([Promise.resolve().then(() => removeContainer(names.grader)), Promise.resolve().then(() => rmSync(scratch, { recursive: true, force: true }))]); }
}

const endedFacts = (x) => ({ infra: x.infra ?? null, timedOut: x.timedOut === true, killedByControl: x.killedByControl ?? false, exit: x.exit ?? null, oomKilled: x.oomKilled ?? null, wallMs: x.wallMs ?? null, streamBytes: x.streamBytes ?? null, streamCut: x.streamCut ?? null, summary: x.summary ? { ...x.summary, lastText: undefined } : null, patch: x.patch ? { bytes: x.patch.bytes, digest: x.patch.digest ?? null, paths: x.patch.paths ?? [] } : null, plugin: x.plugin ?? null, images: x.images ?? null, startCommit: x.startCommit ?? null, entryPhase: x.entry?.phase ?? null, egress: x.egress ?? x.entry?.egress ?? null });

function manifestOf(ctx, names, capUsd) {
  return { campaign: ctx.campaign.id, run: ctx.run, attempt: ctx.attempt, arm: { id: ctx.arm.id, kind: ctx.arm.kind, def: ctx.arm.def, frozen: ctx.armFrozen ?? null }, task: { ref: ctx.task.ref, image: ctx.task.image, repo: ctx.task.repo, digest: ctx.task.digest }, model: ctx.campaign.model, effort: ctx.campaign.effort, limits: limitsOf(ctx), capUsd, tools: ctx.tools, containers: names, evaluator: ctx.campaign.evaluator, startedAt: nowIso() };
}
