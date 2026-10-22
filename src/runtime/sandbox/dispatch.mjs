// DISPATCHING one generated test to the sandbox's WORKER (ADR 0036, 0038): a container created from the pinned,
// trusted worker image on the task's network, inspected and held to the isolation profile BEFORE it starts, then run
// attached with its request on stdin, every chunk it prints observed as it arrives, and -- when its deadline passes --
// stopped by its receipt, because ending the docker client alone does not end the container.
//
// What it runs is the engine's own entry (catalog isolation.worker: `cli/sandbox-worker.mjs`, the plugin mounted
// read-only), with a run's inputs mounted read-only (`/work/in`, prepared by the caller in this sandbox's live room)
// and its outputs writable (`/work/out`), its store a scratch one INSIDE that (`ORBIT_STORE_DIR`), and the project it
// runs as the configuration the caller laid in the inputs (`ORBIT_UI_TESTS`, catalog `worker.project`). It never mounts
// the machine store, a journal, a vault, a control socket or a home directory. It decides no verdict: it answers how
// the worker ended and where its envelope is, and the HOST validates that envelope (src/run/envelope.mjs) before
// anything authoritative is written.
import { join } from "node:path";
import { Blocked, Refused } from "../../errors.mjs";
import { short } from "../../hash.mjs";
import { scrub } from "../../scrub.mjs";
import { PREPARED_EGRESS, attestation, unattested } from "./isolation.mjs";
import { recomposed } from "./isolated-launch.mjs";
import { ROLE_HARDENING, containerNameOf, podNameOf, receiptOf } from "./network.mjs";
import { createOperations } from "./operations.mjs";
import { operationsRoom } from "../rooms.mjs";
import { supervisionNow, supervisionRoom } from "./supervise.mjs";

export const DISPATCH_GRACE_MS = 15000;
export const MAX_DEADLINE_MS = 30 * 60 * 1000;
export const ACTIVITY_TEXT = 400;

const RUN = /^[a-z0-9][a-z0-9-]{3,63}$/;

export const dispatchRoom = (ctx, run) => join(ctx.rooms.liveSandbox, "dispatch", run);

export const dispatchDirs = (ctx, run) => ({ in: join(dispatchRoom(ctx, run), "in"), out: join(dispatchRoom(ctx, run), "out"), activity: join(dispatchRoom(ctx, run), "activity.jsonl") });

// Ordered: the first that holds refuses or blocks the dispatch, before anything is created.
const GATES = [
  { fails: (g) => !RUN.test(String(g.args.run ?? "")), stop: Refused, say: () => "name the run with --run=<id>: lowercase letters, digits and dashes" },
  { fails: (g) => !g.doc?.isolation || g.doc.isolation.mode !== "required", stop: Refused, say: () => "this sandbox is not isolated: a generated test runs only in a worker whose isolation was attested (sandbox.isolation.mode is required)" },
  { fails: (g) => g.doc.state !== "READY", stop: Blocked, say: (g) => `the sandbox is ${g.doc.state}: \`sandbox-prepare\` makes it READY first` },
  { fails: (g) => !g.doc.isolation.attested, stop: Blocked, say: (g) => `the sandbox's isolation was not attested: ${g.doc.isolation.because}` },
  { fails: (g) => g.doc.isolation.egress?.held !== true, stop: Blocked, say: () => "the sandbox's preparation keeps no egress evidence that held, and a dispatch never asks it again on its own: `sandbox-prepare` attests the sandbox again" },
  { fails: (g) => g.signals.cancelled, stop: Refused, say: () => "the sandbox was cancelled: nothing more is dispatched to it" },
  { fails: (g) => g.signals.paused, stop: Blocked, say: (g) => `the sandbox is paused (${g.signals.last?.by ?? "unknown"}): nothing new is dispatched until it is resumed` },
  { fails: (g) => !g.ctx.io.exists(dispatchDirs(g.ctx, g.args.run).in), stop: Refused, say: () => "the run's inputs are not prepared: the caller writes them into the run's in/ room first" },
  { fails: (g) => !g.ctx.pluginRoot, stop: Blocked, say: () => "this machine's runtime was bound without the plugin's own directory, so a worker has nothing to run" },
];

const W = (ctx) => ctx.catalog.isolation.worker;

const workerPlace = (ctx, now, run) => (now.topology.mode === "pod" ? { mode: "container", container: podNameOf(ctx.envId) } : { mode: "network", name: now.topology.network.name, alias: `worker-${short(run, 6)}` });

export const workerSpec = (ctx, now, run, deadlineMs) => ({ name: `${containerNameOf(ctx.envId, "worker")}-${short(run, 8)}`, image: now.place.policy.isolation.workerImage, network: workerPlace(ctx, now, run), labels: { ...now.topology.network.labels, "orbit.node": "worker", "orbit.role": "worker", "orbit.run": run }, ...ROLE_HARDENING.worker, stdin: true, mounts: [{ source: ctx.pluginRoot, target: W(ctx).plugin, readOnly: true }, { source: dispatchDirs(ctx, run).in, target: W(ctx).in, readOnly: true }, { source: dispatchDirs(ctx, run).out, target: W(ctx).out, readOnly: false }], env: { names: [], values: { ORBIT_STORE_DIR: W(ctx).store, HOME: W(ctx).home, ORBIT_WORKER_DEADLINE_MS: String(deadlineMs), ...(W(ctx).project ? { ORBIT_UI_TESTS: W(ctx).project } : {}) } }, limits: now.place.policy.isolation.limits, workdir: W(ctx).out, argv: W(ctx).argv });

const deadlineOf = (args) => Math.min(Number(args.deadlineMs) > 0 ? Number(args.deadlineMs) : 120000, MAX_DEADLINE_MS);

// -> { run, session, status, timedOut, stopped, out, envelope }.
export async function dispatched(ctx, args, deps) {
  const doc = ctx.sandboxes.read(ctx.envId);
  const gate = GATES.find((g) => g.fails({ ctx, doc, args, signals: supervisionNow(ctx.io, supervisionRoom(ctx.rooms.liveSandbox)) }));
  if (gate) throw new gate.stop(gate.say({ ctx, doc, args, signals: supervisionNow(ctx.io, supervisionRoom(ctx.rooms.liveSandbox)) }));
  const now = recomposed(ctx, deps);
  return now.needs ? blocked(now) : ran(ctx, args, deps, now);
}

const blocked = (now) => {
  throw (now.needs === "person" ? new Refused(now.say) : new Blocked(now.say));
};

async function ran(ctx, args, deps, now) {
  const spec = workerSpec(ctx, now, args.run, deadlineOf(args));
  ctx.io.ensureDir(dispatchDirs(ctx, args.run).out);
  const ops = createOperations(operationsRoom(ctx.rooms.liveSandbox), ctx.io, ctx.now);
  const op = ops.begin("dispatch", { fingerprint: short(args.run, 16) });
  return settledRun(ctx, ops, op, await attached(ctx, args, deps, now, spec));
}

function settledRun(ctx, ops, op, r) {
  ops.settle(op, r.ok ? "DONE" : "FAILED", r.because ?? null);
  return r;
}

// The receipt, then the container, then its facts held to the profile -- and only then is it started.
async function attached(ctx, args, deps, now, spec) {
  const receipt = { ...receiptOf(ctx, { key: `worker:${args.run}` }, spec, { iso: now.iso, kind: "worker", tree: ctx.sandboxDoc().source?.tree ?? null }), deadlineAt: new Date(ctx.clock() + deadlineOf(args)).toISOString() };
  ctx.sessions.write(receipt);
  const made = now.iso.container.create(spec, deps);
  if (!made.ok) return lost(ctx, receipt, args, made.why);
  return attestedThenRun(ctx, args, deps, now, spec, { ...receipt, container: { ...receipt.container, id: made.id } });
}

function lost(ctx, receipt, args, why) {
  ctx.sessions.write({ ...receipt, state: "LOST", why });
  return { ok: false, run: args.run, session: receipt.id, because: `the worker could not be created: ${why}`, status: null, timedOut: false, stopped: false, out: dispatchDirs(ctx, args.run).out, envelope: false };
}

async function attestedThenRun(ctx, args, deps, now, spec, receipt) {
  const facts = now.iso.facts(now.iso.container.inspect(receipt.container.id, deps));
  const held = attestation({ containers: [{ node: { key: receipt.component, role: "worker", mounts: spec.mounts, allowedEnv: [...now.iso.imageEnv(spec.image, deps), ...Object.keys(spec.env.values)] }, facts }], network: now.iso.network.inspect(now.topology.network.name, deps), egress: PREPARED_EGRESS, attest: { ...now.place.attest, podId: ctx.sandboxes.read(ctx.envId).isolation.podId } });
  if (!held.ok) return refusedWorker(ctx, args, deps, now, receipt, unattested(held));
  ctx.sessions.write({ ...receipt, state: "RUNNING", startedAt: ctx.now(), pidStartedAt: facts?.startedAt ?? null });
  return finished(ctx, args, deps, now, receipt, await runAttached(ctx, args, deps, now, receipt));
}

function refusedWorker(ctx, args, deps, now, receipt, why) {
  now.iso.container.remove(receipt.container.id, deps);
  ctx.sessions.write({ ...receipt, state: "STOPPED", stoppedHow: "removed before it ran", why });
  throw new Blocked(`the worker did not hold to the isolation profile, so it was removed before it ran: ${why}`);
}

// Every chunk the worker prints, as a numbered, scrubbed and bounded line beside the run -- an observation for a
// viewer, which nothing reads to decide anything.
const observer = (ctx, file) => {
  let seq = 0;
  return (stream, bytes) => ctx.io.append(file, `${JSON.stringify({ seq: ++seq, at: ctx.now(), stream, text: scrub(String(bytes)).slice(-ACTIVITY_TEXT) })}\n`);
};

const runAttached = (ctx, args, deps, now, receipt) => now.iso.container.startAttached(receipt.container.id, deps, { input: String(args.input ?? ""), timeoutMs: deadlineOf(args) + DISPATCH_GRACE_MS, observe: observer(ctx, dispatchDirs(ctx, args.run).activity) });

// A worker past its deadline is stopped by its receipt -- what is SIGTERM to its entry, which writes an INTERRUPTED
// envelope -- and every worker, once it ended, is removed.
function finished(ctx, args, deps, now, receipt, r) {
  const stopped = r.timedOut ? now.iso.container.stop(receipt.container.id, deps).ok : false;
  now.iso.container.remove(receipt.container.id, deps);
  ctx.sessions.write({ ...receipt, state: "STOPPED", stoppedAt: ctx.now(), stoppedHow: r.timedOut ? "its deadline passed" : "it ended" });
  return { ok: true, run: args.run, session: receipt.id, status: r.status ?? null, timedOut: Boolean(r.timedOut), stopped, out: dispatchDirs(ctx, args.run).out, envelope: ctx.io.exists(join(dispatchDirs(ctx, args.run).out, "envelope.json")) };
}
