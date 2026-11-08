// ONE REPAIR ROUND: the coding host given the round's brief in a runner container -- on the run's internal network,
// with the egress proxy as its only way to the model's API, the subject read-only and the runner's own store as the only
// place it writes -- then the inspection that reads back what the round left, and the CANDIDATE that is: the changes of
// the task's workspace laid over the subject, every byte checked against the digest the inspection reported, the files
// the subject's own ignore rules ignore set aside, the patch written out. Nothing here judges the candidate; the
// verifier does, in containers of its own.
//
//   ranRound(ctx, k, state) -> { error, runner, host, egress }        inspectedRound(ctx, k, task) -> inspection
//   candidateOf(ctx, inspection) -> { changes, entries, ignored, scope, patch, patchDigest, agentTests }
//   assembled(ctx, changes, textOf, ignored) -> the same, from changes and their text however they were read back
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { shaBytes, sha } from "../../../src/hash.mjs";
import { docker } from "../../../src/runtime/isolation/docker.mjs";
import { addedLines, agentTestsOf, overlaid, scopeFindings } from "./candidate.mjs";
import { ranContainer, specFor } from "../core/docker.mjs";
import { gitOwn } from "../core/git.mjs";
import { forbidden, fresh, jsonAt, offlineRan, roundRan, RUNNER_HOST, runnerSpecOf, streamFileOf } from "../core/runner.mjs";
import { briefOf } from "./brief.mjs";
import { readRegular } from "../core/room.mjs";
import { safeRel } from "../core/paths.mjs";
import { isGoalKind } from "../core/suites.mjs";

export { EGRESS_PORT } from "../core/runner.mjs";

// ---- the containers of a repair round ------------------------------------------------------------------------------------

// Where Orbit is in a round's containers: the subject itself for a source repair (Orbit repairs its own checkout), or the
// frozen Orbit beside the target for an engineering goal -- read-only either way.
const PLUGIN_AT = "/work/orbit";

const goalCase = (ctx) => isGoalKind(ctx.case);

const pluginMounts = (ctx) => (goalCase(ctx) ? [{ source: ctx.pluginDir, target: PLUGIN_AT, readOnly: true }] : []);

const pluginOf = (ctx) => (goalCase(ctx) ? PLUGIN_AT : "/work/repo");

// An arm with no Orbit (0.5.0, B23) is handed none: no plugin is mounted where its host runs, so no Orbit hook can fire
// and no trail is written -- and, with no task workspace to change, the target is a writable copy of its own (`worktree`,
// beside the run's checkout, which stays the frozen subject). The inspection still reads with the release plugin.
const handed = (ctx) => ctx.arm !== "none";

const WORKTREE_AT = "/work/worktree";

const repoMount = (ctx) => (handed(ctx) ? { source: ctx.checkoutDir, target: "/work/repo", readOnly: true } : { source: ctx.worktreeDir, target: "/work/repo", readOnly: false });

const runnerSpec = (ctx, net, k, d) => runnerSpecOf(ctx, net, k, [repoMount(ctx), ...(handed(ctx) ? pluginMounts(ctx) : []), { source: ctx.runnerStore, target: "/work/store", readOnly: false }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }], {}, handed(ctx) ? pluginOf(ctx) : null);

const worktreeRead = (ctx) => (handed(ctx) ? { mounts: [], argv: [] } : { mounts: [{ source: ctx.worktreeDir, target: WORKTREE_AT, readOnly: true }], argv: [`--tree=${WORKTREE_AT}`] });

// A workflow case's inspection also reads every coordinated workflow back (0.5.0, ADR 0053): what its path leg is held to;
// a mission case's (0.5.0, ADR 0055) every mission, the trail's agent events and the tasks its evidence names.
const KIND_READS = { workflow: ["--workflow"], mission: ["--mission"] };

const workflowRead = (ctx) => KIND_READS[ctx.case.kind] ?? [];

const inspectSpec = (ctx, k, task, out) => specFor("inspect", ctx.run, { n: k, image: ctx.images.runner, user: ctx.user, hostname: RUNNER_HOST, argv: ["node", "/bench/inspect.mjs", task ?? "-", `--plugin=${pluginOf(ctx)}`, ...worktreeRead(ctx).argv, ...workflowRead(ctx)], mounts: [{ source: ctx.checkoutDir, target: "/work/repo", readOnly: true }, ...pluginMounts(ctx), ...worktreeRead(ctx).mounts, { source: ctx.runnerStore, target: "/work/store", readOnly: true }, { source: out, target: "/work/out", readOnly: false }], env: { names: [], values: { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store" } }, limits: { cpus: 1, memoryMb: 1024, pids: 256 }, tmpMb: 256 });

function briefWritten(ctx, k, state) {
  const dir = fresh(ctx, "rounds", String(k), "brief");
  const b = briefOf(ctx, k, state);
  writeFileSync(join(dir, "brief.json"), `${JSON.stringify(b.json, null, 2)}\n`);
  writeFileSync(join(dir, "brief.md"), b.md);
  return dir;
}

// The runner, between a brief written before it and outputs read after it -- its deadline the round's, enforced by
// stopping the container, whatever the host inside it is doing; and, for the round a case interrupts, its cut
// (source/cut.mjs): the container stopped at once the moment the engineering task's journal shows the steps it names.
export async function ranRound(ctx, k, state) {
  const d = { brief: briefWritten(ctx, k, state), out: fresh(ctx, "rounds", String(k), "out") };
  const o = { deadlineMs: state.deadlineMs, out: d.out, held: state.held, heldEveryMs: ctx.heldEveryMs, cut: state.cut, cutEveryMs: ctx.cutEveryMs, capture: streamFileOf(ctx, k) };
  return offlineHost(ctx) ? offlineRan(ctx, k, runnerSpec(ctx, null, k, d), o) : roundRan(ctx, k, (net) => runnerSpec(ctx, net, k, d), o);
}

// A control's scripted host, never a model: its round runs with no network (core/runner.mjs offlineRan).
// A host that reasons nowhere in the runner -- a scripted control, or a session driving it from outside -- gets a runner
// with no network at all and no credential.
export const offlineHost = (ctx) => /^(scripted|session):/.test(String(ctx.host ?? ""));

// ---- the inspection ------------------------------------------------------------------------------------------------------

export async function inspectedRound(ctx, k, task) {
  const out = fresh(ctx, "rounds", String(k), "inspect");
  const r = await ranContainer(inspectSpec(ctx, k, task, out), ctx.deps, { input: "", timeoutMs: 300000, outputBytes: 1024 * 1024, attest: { network: "none", forbidden: forbidden(ctx), pluginTarget: null, imageEnv: docker.imageEnv(ctx.images.runner, ctx.deps) } });
  return { end: r.refused ? "REFUSED" : r.timedOut ? "TIMEOUT" : `EXIT_${r.exit}`, refused: r.refused ?? null, attested: r.attested, dir: out, inspect: jsonAt(join(out, "inspect.json")), task: jsonAt(join(out, "task.json")), tasks: jsonAt(join(out, "tasks.json")), trace: jsonAt(join(out, "trace.json")), turns: jsonAt(join(out, "turns.json")), goals: jsonAt(join(out, "goals.json")), sandbox: jsonAt(join(out, "sandbox.json")), workflows: jsonAt(join(out, "workflows.json")), missions: jsonAt(join(out, "missions.json")), trail: jsonAt(join(out, "trail.json")), owners: jsonAt(join(out, "owners.json")) };
}

// ---- the candidate ---------------------------------------------------------------------------------------------------------

const MAX_FILE = 2 * 1024 * 1024;

// The bytes a change brought, exactly as the inspection hashed them -- or nothing, and then the change is not regular.
const broughtBytes = (ins, c) => ((b) => (b && shaBytes(b) === c.digest ? b : null))(c.change === "deleted" || !c.copied || !safeRel(c.rel) ? null : readRegular(join(ins.dir, "files", c.rel), MAX_FILE));

const ignoredOf = (ctx, rels) => (rels.length ? ((r) => (r.ok || r.status === 1 ? String(r.out).split("\u0000").filter(Boolean) : []))(gitOwn(ctx.checkoutDir, ["check-ignore", "-z", "--stdin"], ctx.env, { input: rels.join("\u0000") })) : []);

const lineCounts = (before, after) => ({ added: addedLines(before, after).filter((l) => l !== "").length, removed: addedLines(after, before).filter((l) => l !== "").length });

function patchOf(ctx, changes, textOf) {
  const dir = fresh(ctx, "scratch", "patch");
  const parts = changes.map((c) => filePatch(ctx, dir, c, textOf));
  return parts.join("");
}

const sideWritten = (dir, rel, text) => (mkdirSync(dirname(join(dir, rel)), { recursive: true }), writeFileSync(join(dir, rel), text), rel);

// One file's part of the patch, by git's own diff of the two sides written out -- `/dev/null` for a side that is not.
function filePatch(ctx, dir, c, textOf) {
  const a = c.change === "added" ? "/dev/null" : sideWritten(dir, join("a", c.rel), textOf(c.rel, "before"));
  const b = c.change === "deleted" ? "/dev/null" : sideWritten(dir, join("b", c.rel), textOf(c.rel, "after"));
  return String(gitOwn(dir, ["diff", "--no-index", "--no-color", "--no-prefix", a, b], ctx.env).out);
}

const textsOf = (ctx, ins, changes) => ((bytes) => (rel, side) => (side === "before" ? ctx.baselineText(rel) : bytes.get(rel)?.toString("utf8") ?? null))(new Map(changes.map((c) => [c.rel, broughtBytes(ins, c)])));

export function candidateOf(ctx, ins) {
  const listed = (ins.inspect?.changes ?? []).filter((c) => c && typeof c.rel === "string");
  const ignored = ignoredOf(ctx, listed.filter((c) => c.change === "added" && safeRel(c.rel)).map((c) => c.rel));
  const changes = listed.filter((c) => !ignored.includes(c.rel));
  const textOf = textsOf(ctx, ins, changes);
  return assembled(ctx, changes, textOf, ignored);
}

export function assembled(ctx, changes, textOf, ignored) {
  const scope = scopeFindings(changes, { allow: ctx.case.scope.allow, deny: ctx.case.scope.deny, imports: ctx.case.scope.imports ?? [], agentTests: ctx.case.checks.agentTests, textOf });
  const usable = changes.filter((c) => c.change === "deleted" || textOf(c.rel, "after") !== null);
  const entries = overlaid(ctx.baseline, usable.filter((c) => safeRel(c.rel)), (rel) => Buffer.from(textOf(rel, "after"), "utf8"));
  const patch = patchOf(ctx, usable.filter((c) => safeRel(c.rel)), textOf);
  return { changes: changes.map((c) => ({ rel: c.rel, change: c.change, kind: c.kind, size: c.size, ...(safeRel(c.rel) && c.change !== "deleted" && textOf(c.rel, "after") !== null ? lineCounts(textOf(c.rel, "before") ?? "", textOf(c.rel, "after")) : {}) })), entries, ignored, scope, patch, patchDigest: sha(patch), agentTests: agentTestsOf(usable, ctx.case.checks.agentTests.pattern) };
}
