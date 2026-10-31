// THE RUNNER CONTAINER of a round, whatever the round is for: the coding host on the run's internal network with the
// egress proxy as its only way out -- to the model's API and nowhere else -- a person's CA bundle when the network
// inspects TLS, the credential by name, and what the host printed read back afterwards as data. A source round mounts
// the subject and the runner's store; a QA round mounts the plugin, the application's public material and the relay's
// mailbox. Its deadline is the round's, enforced by stopping the container, whatever the host inside it is doing.
//
// A SCRIPTED host's round (a control: Orbit's own loop driven by a script, no model) has no network at all: no
// internal network, no egress proxy, no credential -- there is nothing for it to reach.
//
//   roundRan(ctx, k, specOf(net, d), o) -> { error, container, runner, start, host, egress }
//   offlineRan(ctx, k, spec, o) -> the same, with no network
//   runnerSpecOf(ctx, net, k, mounts, values) · fresh(ctx, ...parts) · forbidden(ctx) · RUNNER_ENV · EGRESS_PORT
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { docker } from "../../../src/runtime/isolation/docker.mjs";
import { ensuredRunNetwork, ranContainer, specFor, startedBackground, stoppedBackground } from "./docker.mjs";
import { hostOf } from "./host.mjs";
import { readRegular } from "./room.mjs";

export const EGRESS_PORT = 3128;

export const forbidden = (ctx) => [homedir(), ctx.storeBase, ctx.repoRoot].filter(Boolean);

// A directory of the round made new: what a container of this round may write is never what an earlier one wrote.
export const fresh = (ctx, ...parts) => ((dir) => (rmSync(dir, { recursive: true, force: true }), mkdirSync(dir, { recursive: true }), realpathSync(dir)))(ctx.room.at(...parts));

const egressSpec = (ctx, net, k) => specFor("egress", ctx.run, { n: k, image: ctx.images.verifier, user: ctx.user, argv: ["node", "/bench/egress.mjs", String(EGRESS_PORT), ctx.allowedHosts.join(",")], network: { mode: "network", name: net, alias: "egress" }, limits: { cpus: 0.5, memoryMb: 256, pids: 128 }, logs: true, tmpMb: 16 });

export const RUNNER_ENV = { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store", HTTPS_PROXY: `http://egress:${EGRESS_PORT}`, HTTP_PROXY: `http://egress:${EGRESS_PORT}`, NO_PROXY: "localhost,127.0.0.1", BASH_DEFAULT_TIMEOUT_MS: "1800000", BASH_MAX_TIMEOUT_MS: "3600000" };

// What a runner with no network is handed: the same, less every way out.
export const OFFLINE_ENV = { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store" };

// A person's CA bundle, for a network that inspects TLS: mounted read-only and named to Node, and nothing else.
const caMount = (ctx) => (ctx.caFile ? [{ source: ctx.caFile, target: "/run/orbit-ca.pem", readOnly: true }] : []);

const caEnv = (ctx) => (ctx.caFile ? { NODE_EXTRA_CA_CERTS: "/run/orbit-ca.pem" } : {});

// The runner as every round has it: the image, the user, the entry, the limits, the network and the credential by
// name -- with the mounts and the values the round brings.
// The host name every container that shares a run's runner store goes by: Orbit records which host ran an action, and
// asks that host's processes about it -- with a host name of its own per container, a round could never tell an action
// an earlier round's crash left open from one still running elsewhere.
export const RUNNER_HOST = "orbit-benchmark-runner";

export const runnerSpecOf = (ctx, net, k, mounts, values = {}, plugin = "/work/repo") => specFor("runner", ctx.run, { n: k, image: ctx.images.runner, user: ctx.user, hostname: RUNNER_HOST, argv: ["node", "/bench/entry.mjs"], mounts: [...mounts, ...caMount(ctx)], tmpfs: [`${plugin}/.claude-plugin/types:rw,nosuid,nodev,size=16m`], env: net ? { names: ctx.credentialNames, values: { ...RUNNER_ENV, ...caEnv(ctx), ...values } } : { names: [], values: { ...OFFLINE_ENV, ...values } }, limits: { cpus: ctx.case.limits.runner.cpus, memoryMb: ctx.case.limits.runner.memoryMb, pids: ctx.case.limits.runner.pids }, cpuset: ctx.runnerCpuset, network: net ? { mode: "network", name: net, alias: "runner" } : null, tmpMb: 2048 });

export const attestOn = (ctx, net, image) => ({ network: net, forbidden: forbidden(ctx), pluginTarget: null, imageEnv: docker.imageEnv(image, ctx.deps) });

const logsOf = (ctx, id) => ((r) => (r.ok ? String(r.out).slice(-64 * 1024) : ""))(ctx.deps.process.run("docker", ["logs", "--tail", "500", id], { timeoutMs: 30000, env: ctx.dockerEnv }));

// ---- what the runner left in its out directory, read as data ---------------------------------------------------------------

export const textAt = (file, max) => readRegular(file, max)?.toString("utf8") ?? "";

export const jsonAt = (file) => {
  try { return JSON.parse(textAt(file, 4 * 1024 * 1024)); }
  catch { return null; }
};

function runnerOutputs(ctx, out) {
  const runner = jsonAt(join(out, "runner.json"));
  const head = textAt(join(out, "host.jsonl"), ctx.case.limits.runner.outputMb * 1024 * 1024 + 1);
  const tail = runner?.truncated ? textAt(join(out, "host-tail.jsonl"), 70 * 1024) : "";
  return { runner, start: jsonAt(join(out, "start.json")), host: hostOf(`${head}\n${tail}`) };
}

async function withEgress(ctx, net, k, fn) {
  const egress = await startedBackground(egressSpec(ctx, net, k), ctx.deps, { attest: attestOn(ctx, net, ctx.images.verifier), alsoOn: ["bridge"] });
  if (egress.refused) return { error: { cause: "ENVIRONMENT", says: egress.refused }, egress: { attested: egress.attested } };
  const ran = await fn();
  const log = logsOf(ctx, egress.id);
  return { ...ran, egress: { attested: egress.attested, log, ...stoppedBackground(egress.id, ctx.deps) } };
}

// One round with no network: the runner alone, attested on no network at all, its outputs read back the same way.
export async function offlineRan(ctx, k, spec, o) {
  const container = await ranContainer(spec, ctx.deps, { input: "", timeoutMs: o.deadlineMs, outputBytes: 1024 * 1024, attest: attestOn(ctx, "none", ctx.images.runner), held: o.held, heldEveryMs: o.heldEveryMs });
  return { container, egress: { none: true, holds: true, says: "a scripted host runs with no network" }, ...runnerOutputs(ctx, o.out) };
}

// One round's runner: the run's internal network, the egress proxy, the runner the round's spec makes, its outputs.
export async function roundRan(ctx, k, specOf, o) {
  const net = ensuredRunNetwork(ctx.run.id, ctx.deps);
  if (!net.ok) return { error: { cause: "ENVIRONMENT", says: net.why } };
  const ran = await withEgress(ctx, net.name, k, async () => ({ container: await ranContainer(specOf(net.name), ctx.deps, { input: "", timeoutMs: o.deadlineMs, outputBytes: 1024 * 1024, attest: attestOn(ctx, net.name, ctx.images.runner), held: o.held, heldEveryMs: o.heldEveryMs }) }));
  return { ...ran, ...(ran.container ? runnerOutputs(ctx, o.out) : {}) };
}
