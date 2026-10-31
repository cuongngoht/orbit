// ONE REPAIR ROUND: the coding host given the round's brief in a runner container -- on the run's internal network,
// with the egress proxy as its only way to the model's API, the subject read-only and the runner's own store as the only
// place it writes -- then the inspection that reads back what the round left, and the CANDIDATE that is: the changes of
// the task's workspace laid over the subject, every byte checked against the digest the inspection reported, the files
// the subject's own ignore rules ignore set aside, the patch written out. Nothing here judges the candidate; the
// verifier does, in containers of its own.
//
//   ranRound(ctx, k, state) -> { error, runner, host, egress }        inspectedRound(ctx, k, task) -> inspection
//   candidateOf(ctx, k, inspection) -> { changes, entries, ignored, scope, patch, agentTests }
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { shaBytes, sha } from "../../src/hash.mjs";
import { docker } from "../../src/runtime/isolation/docker.mjs";
import { addedLines, agentTestsOf, overlaid, scopeFindings } from "./candidate.mjs";
import { ensuredRunNetwork, ranContainer, specFor, startedBackground, stoppedBackground } from "./docker.mjs";
import { gitOwn } from "./git.mjs";
import { hostOf } from "./host.mjs";
import { briefOf } from "./brief.mjs";
import { readRegular } from "./room.mjs";
import { safeRel } from "./paths.mjs";

export const EGRESS_PORT = 3128;

const forbidden = (ctx) => [homedir(), ctx.storeBase, ctx.repoRoot].filter(Boolean);

// A directory of the round made new: what a container of this round may write is never what an earlier one wrote.
const fresh = (ctx, ...parts) => ((dir) => (rmSync(dir, { recursive: true, force: true }), mkdirSync(dir, { recursive: true }), realpathSync(dir)))(ctx.room.at(...parts));

// ---- the containers of a round -------------------------------------------------------------------------------------------

const egressSpec = (ctx, net, k) => specFor("egress", ctx.run, { n: k, image: ctx.images.verifier, user: ctx.user, argv: ["node", "/bench/egress.mjs", String(EGRESS_PORT), ctx.allowedHosts.join(",")], network: { mode: "network", name: net, alias: "egress" }, limits: { cpus: 0.5, memoryMb: 256, pids: 128 }, logs: true, tmpMb: 16 });

const RUNNER_ENV = { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store", HTTPS_PROXY: `http://egress:${EGRESS_PORT}`, HTTP_PROXY: `http://egress:${EGRESS_PORT}`, NO_PROXY: "localhost,127.0.0.1", BASH_DEFAULT_TIMEOUT_MS: "1800000", BASH_MAX_TIMEOUT_MS: "3600000" };

// A person's CA bundle, for a network that inspects TLS: mounted read-only and named to Node, and nothing else.
const caMount = (ctx) => (ctx.caFile ? [{ source: ctx.caFile, target: "/run/orbit-ca.pem", readOnly: true }] : []);

const caEnv = (ctx) => (ctx.caFile ? { NODE_EXTRA_CA_CERTS: "/run/orbit-ca.pem" } : {});

const runnerSpec = (ctx, net, k, d) => specFor("runner", ctx.run, { n: k, image: ctx.images.runner, user: ctx.user, argv: ["node", "/bench/entry.mjs"], mounts: [{ source: ctx.checkoutDir, target: "/work/repo", readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: false }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }, ...caMount(ctx)], tmpfs: ["/work/repo/.claude-plugin/types:rw,nosuid,nodev,size=16m"], env: { names: ctx.credentialNames, values: { ...RUNNER_ENV, ...caEnv(ctx) } }, limits: { cpus: ctx.case.limits.runner.cpus, memoryMb: ctx.case.limits.runner.memoryMb, pids: ctx.case.limits.runner.pids }, cpuset: ctx.runnerCpuset, network: { mode: "network", name: net, alias: "runner" }, tmpMb: 2048 });

const inspectSpec = (ctx, k, task, out) => specFor("inspect", ctx.run, { n: k, image: ctx.images.runner, user: ctx.user, argv: ["node", "/bench/inspect.mjs", task ?? "-"], mounts: [{ source: ctx.checkoutDir, target: "/work/repo", readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: true }, { source: out, target: "/work/out", readOnly: false }], env: { names: [], values: { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store" } }, limits: { cpus: 1, memoryMb: 1024, pids: 256 }, tmpMb: 256 });

const attestOn = (ctx, net, image) => ({ network: net, forbidden: forbidden(ctx), pluginTarget: null, imageEnv: docker.imageEnv(image, ctx.deps) });

const logsOf = (ctx, id) => ((r) => (r.ok ? String(r.out).slice(-64 * 1024) : ""))(ctx.deps.process.run("docker", ["logs", "--tail", "500", id], { timeoutMs: 30000, env: ctx.dockerEnv }));

// ---- what the runner left in its out directory, read as data ---------------------------------------------------------------

const textAt = (file, max) => readRegular(file, max)?.toString("utf8") ?? "";

const jsonAt = (file) => {
  try { return JSON.parse(textAt(file, 4 * 1024 * 1024)); }
  catch { return null; }
};

function runnerOutputs(ctx, out) {
  const runner = jsonAt(join(out, "runner.json"));
  const head = textAt(join(out, "host.jsonl"), ctx.case.limits.runner.outputMb * 1024 * 1024 + 1);
  const tail = runner?.truncated ? textAt(join(out, "host-tail.jsonl"), 70 * 1024) : "";
  return { runner, start: jsonAt(join(out, "start.json")), host: hostOf(`${head}\n${tail}`) };
}

function briefWritten(ctx, k, state) {
  const dir = fresh(ctx, "rounds", String(k), "brief");
  const b = briefOf(ctx, k, state);
  writeFileSync(join(dir, "brief.json"), `${JSON.stringify(b.json, null, 2)}\n`);
  writeFileSync(join(dir, "brief.md"), b.md);
  return dir;
}

async function withEgress(ctx, net, k, fn) {
  const egress = await startedBackground(egressSpec(ctx, net, k), ctx.deps, { attest: attestOn(ctx, net, ctx.images.verifier), alsoOn: ["bridge"] });
  if (egress.refused) return { error: { cause: "ENVIRONMENT", says: egress.refused }, egress: { attested: egress.attested } };
  const ran = await fn();
  const log = logsOf(ctx, egress.id);
  return { ...ran, egress: { attested: egress.attested, log, ...stoppedBackground(egress.id, ctx.deps) } };
}

// The runner, between a brief written before it and outputs read after it -- its deadline the round's, enforced by
// stopping the container, whatever the host inside it is doing.
export async function ranRound(ctx, k, state) {
  const d = { brief: briefWritten(ctx, k, state), out: fresh(ctx, "rounds", String(k), "out") };
  const net = ensuredRunNetwork(ctx.run.id, ctx.deps);
  if (!net.ok) return { error: { cause: "ENVIRONMENT", says: net.why } };
  const ran = await withEgress(ctx, net.name, k, async () => ({ container: await ranContainer(runnerSpec(ctx, net.name, k, d), ctx.deps, { input: "", timeoutMs: state.deadlineMs, outputBytes: 1024 * 1024, attest: attestOn(ctx, net.name, ctx.images.runner) }) }));
  return { ...ran, ...(ran.container ? runnerOutputs(ctx, d.out) : {}) };
}

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

function assembled(ctx, changes, textOf, ignored) {
  const scope = scopeFindings(changes, { allow: ctx.case.scope.allow, deny: ctx.case.scope.deny, agentTests: ctx.case.checks.agentTests, textOf });
  const usable = changes.filter((c) => c.change === "deleted" || textOf(c.rel, "after") !== null);
  const entries = overlaid(ctx.baseline, usable.filter((c) => safeRel(c.rel)), (rel) => Buffer.from(textOf(rel, "after"), "utf8"));
  const patch = patchOf(ctx, usable.filter((c) => safeRel(c.rel)), textOf);
  return { changes: changes.map((c) => ({ rel: c.rel, change: c.change, kind: c.kind, size: c.size, ...(safeRel(c.rel) && c.change !== "deleted" && textOf(c.rel, "after") !== null ? lineCounts(textOf(c.rel, "before") ?? "", textOf(c.rel, "after")) : {}) })), entries, ignored, scope, patch, patchDigest: sha(patch), agentTests: agentTestsOf(usable, ctx.case.checks.agentTests.pattern) };
}
