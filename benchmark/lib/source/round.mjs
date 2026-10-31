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
import { forbidden, fresh, jsonAt, offlineRan, roundRan, runnerSpecOf } from "../core/runner.mjs";
import { briefOf } from "./brief.mjs";
import { readRegular } from "../core/room.mjs";
import { safeRel } from "../core/paths.mjs";

export { EGRESS_PORT } from "../core/runner.mjs";

// ---- the containers of a repair round ------------------------------------------------------------------------------------

const runnerSpec = (ctx, net, k, d) => runnerSpecOf(ctx, net, k, [{ source: ctx.checkoutDir, target: "/work/repo", readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: false }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }]);

const inspectSpec = (ctx, k, task, out) => specFor("inspect", ctx.run, { n: k, image: ctx.images.runner, user: ctx.user, argv: ["node", "/bench/inspect.mjs", task ?? "-"], mounts: [{ source: ctx.checkoutDir, target: "/work/repo", readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: true }, { source: out, target: "/work/out", readOnly: false }], env: { names: [], values: { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store" } }, limits: { cpus: 1, memoryMb: 1024, pids: 256 }, tmpMb: 256 });

function briefWritten(ctx, k, state) {
  const dir = fresh(ctx, "rounds", String(k), "brief");
  const b = briefOf(ctx, k, state);
  writeFileSync(join(dir, "brief.json"), `${JSON.stringify(b.json, null, 2)}\n`);
  writeFileSync(join(dir, "brief.md"), b.md);
  return dir;
}

// The runner, between a brief written before it and outputs read after it -- its deadline the round's, enforced by
// stopping the container, whatever the host inside it is doing.
export async function ranRound(ctx, k, state) {
  const d = { brief: briefWritten(ctx, k, state), out: fresh(ctx, "rounds", String(k), "out") };
  const o = { deadlineMs: state.deadlineMs, out: d.out, held: state.held, heldEveryMs: ctx.heldEveryMs };
  return scriptedHost(ctx) ? offlineRan(ctx, k, runnerSpec(ctx, null, k, d), o) : roundRan(ctx, k, (net) => runnerSpec(ctx, net, k, d), o);
}

// A control's scripted host, never a model: its round runs with no network (core/runner.mjs offlineRan).
export const scriptedHost = (ctx) => String(ctx.host ?? "").startsWith("scripted:");

// ---- the inspection ------------------------------------------------------------------------------------------------------

export async function inspectedRound(ctx, k, task) {
  const out = fresh(ctx, "rounds", String(k), "inspect");
  const r = await ranContainer(inspectSpec(ctx, k, task, out), ctx.deps, { input: "", timeoutMs: 300000, outputBytes: 1024 * 1024, attest: { network: "none", forbidden: forbidden(ctx), pluginTarget: null, imageEnv: docker.imageEnv(ctx.images.runner, ctx.deps) } });
  return { end: r.refused ? "REFUSED" : r.timedOut ? "TIMEOUT" : `EXIT_${r.exit}`, refused: r.refused ?? null, attested: r.attested, dir: out, inspect: jsonAt(join(out, "inspect.json")), task: jsonAt(join(out, "task.json")), tasks: jsonAt(join(out, "tasks.json")), trace: jsonAt(join(out, "trace.json")) };
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
