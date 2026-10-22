// SUPERVISING an isolated sandbox (ADR 0036): heartbeats a viewer can follow, the signals the roots that own a
// cancel hand it, the deadlines a person set -- and the TEARDOWN, in the one order that keeps evidence and never
// takes what is somebody else's.
//
// The supervisor LAUNCHES NOTHING and knows no transport: it reads what the sandbox's receipts and its signals say,
// stops only what ownership proves (src/runtime/sandbox/network.mjs), and writes two allow-listed logs of its own in
// the sandbox's live room -- `heartbeats.jsonl` and `signals.jsonl` -- whose state is always FOLDED from the lines,
// never kept beside them. Pausing interrupts nothing (what runs settles); cancelling ends what runs, in order.
//
//   SUPERVISE   one tick, as ordered rows over the facts of the moment: the sandbox is gone (end), a cancel or a
//               spent lifetime (teardown, then end), a pause (beat as paused), a worker past its deadline (stop it,
//               by its receipt), and always a heartbeat
//   TEARDOWN    stop minting -> stop triggers -> keep observers until the window closes -> freeze evidence -> close
//               observers -> clean up fixtures, last first -> stop containers by receipt, last first -> remove the
//               network only if nothing else is attached -> release leases -> RELEASED; anything that could not be
//               PROVEN leaves the sandbox QUARANTINED, which only Orbit Control releases
import { join } from "node:path";
import { Refused } from "../../errors.mjs";
import { scrub } from "../../scrub.mjs";
import { moved } from "../instances.mjs";
import { ISOLATION_PROVIDERS, isolationOf } from "../isolation/index.mjs";
import { childEnv } from "../../process/env.mjs";
import { judge, mayStop } from "../ownership.mjs";
import { commandFingerprint, sessionId } from "../sessions.mjs";
import { CLIENT_ENV } from "../isolation/docker.mjs";
import { leasesOf } from "./held.mjs";
import { removedNetwork, stoppedNode } from "./network.mjs";

export const supervisionRoom = (liveSandbox) => join(liveSandbox, "supervision");
export const heartbeatsFile = (room) => join(room, "heartbeats.jsonl");
export const signalsFile = (room) => join(room, "signals.jsonl");

export const TICK_MS = 2000;
export const KEEP_BEATS = 500;
export const MAX_WHY = 200;

// ---- the two logs, allow-listed -----------------------------------------------------------------------------------------

export const HEARTBEAT_FIELDS = ["seq", "gen", "at", "state", "running", "workers", "deadline"];
export const SIGNAL_FIELDS = ["seq", "at", "signal", "by", "why"];

export const SIGNALS = [
  { id: "pause", say: "hold new dispatches; what runs settles" },
  { id: "resume", say: "dispatches may go on" },
  { id: "cancel", say: "stop minting, end what runs in order, and release" },
];

const picked = (fields, record) => Object.fromEntries(fields.filter((k) => record[k] !== undefined).map((k) => [k, record[k]]));

const linesOf = (io, file) => String(io.read(file) ?? "").split("\n").filter(Boolean).map((l) => parsedLine(l)).filter(Boolean);

function parsedLine(line) {
  try { return JSON.parse(line); }
  catch { return null; }
}

export const heartbeatLine = (record) => `${JSON.stringify(picked(HEARTBEAT_FIELDS, record))}\n`;

// The signal a root that owns a cancel writes (`runtime sandbox-signal`): one known word, a sequence, who and why --
// scrubbed and short. -> the line written.
export function signalled(io, room, { signal, by, why }, now) {
  if (!SIGNALS.some((s) => s.id === signal)) throw new Refused(`a signal is ${SIGNALS.map((s) => s.id).join(", ")}`);
  const line = picked(SIGNAL_FIELDS, { seq: linesOf(io, signalsFile(room)).length + 1, at: now, signal, by: by ?? "unknown", why: scrub(String(why ?? "")).slice(0, MAX_WHY) });
  io.append(signalsFile(room), `${JSON.stringify(line)}\n`);
  return line;
}

const FOLD = { pause: (s) => ({ ...s, paused: true }), resume: (s) => ({ ...s, paused: false }), cancel: (s) => ({ ...s, cancelled: true }) };

// What the signals SAY now, folded: never kept anywhere else.
export const supervisionNow = (io, room) => linesOf(io, signalsFile(room)).reduce((s, line) => ({ ...(FOLD[line.signal]?.(s) ?? s), seq: line.seq, last: line }), { paused: false, cancelled: false, seq: 0, last: null });

export const heartbeats = (io, room) => linesOf(io, heartbeatsFile(room)).slice(-KEEP_BEATS);

// ---- one tick ------------------------------------------------------------------------------------------------------------

const overdue = (f) => f.workers.filter((w) => w.deadlineAt && Date.parse(w.deadlineAt) < f.nowMs);

export const SUPERVISE = [
  { name: "GONE", when: (f) => ["RELEASED", "QUARANTINED"].includes(f.doc?.state ?? "RELEASED"), actions: () => [{ kind: "end", why: "the sandbox is released or quarantined" }] },
  { name: "CANCELLED", when: (f) => f.signals.cancelled, actions: () => [{ kind: "teardown", why: "a cancel was signalled" }, { kind: "end", why: "torn down" }] },
  { name: "LIFETIME", when: (f) => f.nowMs > f.lifetimeEndsMs, actions: () => [{ kind: "teardown", why: "its lifetime is spent" }, { kind: "end", why: "torn down" }] },
  { name: "PAUSED", when: (f) => f.signals.paused, actions: (f) => [...overdue(f).map((w) => ({ kind: "stop-worker", session: w.id })), { kind: "beat", state: "paused" }] },
  { name: "RUNNING", when: () => true, actions: (f) => [...overdue(f).map((w) => ({ kind: "stop-worker", session: w.id })), { kind: "beat", state: "running" }] },
];

export const decided = (f) => SUPERVISE.find((r) => r.when(f)).actions(f);

// ---- the teardown --------------------------------------------------------------------------------------------------------

const ORDER = ["worker", "probe", "observer", "helper", "component", "service", "pod"];

const runningOf = (ctx, kinds) => ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && kinds.includes(s.kind) && ["RUNNING", "STARTING"].includes(s.state)).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

const providerOf = (ctx, s) => isolationOf(s.container.provider, ctx.isolation ?? ISOLATION_PROVIDERS);

function stoppedAll(ctx, kinds, deps) {
  const results = runningOf(ctx, kinds).map((s) => ({ session: s.id, kind: s.kind, ...stoppedNode(ctx, providerOf(ctx, s), s, deps) }));
  const left = results.filter((r) => !r.ok);
  return { ok: left.length === 0, say: left.length ? left.map((r) => `${r.kind} ${r.session}: ${r.because}`).join("; ") : `${results.length} container(s) ended`, left };
}

const hooked = async (hooks, name, ctx) => ((fn) => (fn ? fn(ctx) : { ok: true, say: "nothing was handed in to do" }))(hooks?.[name]);

function networkRemoved(ctx, deps) {
  const doc = ctx.sandboxes.read(ctx.envId);
  const network = doc?.isolation?.network;
  if (!network) return { ok: true, say: "it has no network of its own" };
  const r = removedNetwork(isolationOf(doc.isolation.provider, ctx.isolation ?? ISOLATION_PROVIDERS), network, deps);
  return r.ok ? { ok: true, say: r.gone ? "the network was already gone" : `${network.name} was removed` } : { ok: false, say: r.because };
}

async function leasesReleased(ctx) {
  const freed = await leasesOf(ctx).release({ env: ctx.envId, owner: ctx.owner });
  return { ok: true, say: `${freed.length} lease(s) released` };
}

export const TEARDOWN = [
  { id: "STOP_MINTING", run: async (ctx, deps, hooks) => hooked(hooks, "stopMinting", ctx), proves: false },
  { id: "STOP_TRIGGERS", run: async (ctx, deps, hooks) => hooked(hooks, "stopTriggers", ctx), proves: false },
  { id: "STOP_WORKERS", run: async (ctx, deps) => stoppedAll(ctx, ["worker", "probe"], deps), proves: true },
  { id: "AWAIT_WINDOWS", run: async (ctx, deps, hooks) => hooked(hooks, "awaitWindows", ctx), proves: false },
  { id: "FREEZE_EVIDENCE", run: async (ctx, deps, hooks) => hooked(hooks, "freezeEvidence", ctx), proves: false },
  { id: "CLOSE_OBSERVERS", run: async (ctx, deps) => stoppedAll(ctx, ["observer", "helper"], deps), proves: true },
  { id: "CLEANUP_FIXTURES", run: async (ctx, deps, hooks) => hooked(hooks, "cleanupFixtures", ctx), proves: true },
  { id: "STOP_CONTAINERS", run: async (ctx, deps) => stoppedAll(ctx, ["component", "service", "pod"], deps), proves: true },
  { id: "REMOVE_NETWORK", run: async (ctx, deps) => networkRemoved(ctx, deps), proves: true },
  { id: "RELEASE_LEASES", run: async (ctx) => leasesReleased(ctx), proves: true },
];

// -> { state: RELEASED | QUARANTINED, steps, left }: every step taken in order, whatever came before -- a step that
// could not be proven does not stop the rest, it decides the word the sandbox ends with.
export async function teardown(ctx, deps, hooks = {}) {
  const steps = [];
  for (const step of TEARDOWN) steps.push({ id: step.id, proves: step.proves, ...(await safely(() => step.run(ctx, deps, hooks))) });
  const left = steps.filter((s) => s.proves && !s.ok);
  return settled(ctx, steps, left);
}

async function safely(fn) {
  try { return await fn(); }
  catch (e) { return { ok: false, say: String(e?.message ?? e) }; }
}

function settled(ctx, steps, left) {
  const doc = ctx.sandboxes.read(ctx.envId);
  const state = left.length ? "QUARANTINED" : "RELEASED";
  if (doc && doc.state !== state) ctx.sandboxes.write(moved(doc, state, ctx.now(), { endpoints: [], blocked: left.length ? { needs: "person", because: left.map((s) => `${s.id}: ${s.say}`).join("; "), at: ctx.now() } : null, lastActiveAt: ctx.now() }));
  return { state, steps, left: left.map((s) => ({ step: s.id, because: s.say })) };
}

// ---- the supervisor itself: one per sandbox, behind a receipt ------------------------------------------------------------

// What the supervisor process is handed of this machine's environment: the store it binds, and the container client's
// own names -- nothing else.
const SUPERVISOR_ENV = ["ORBIT_STORE_DIR", "ORBIT_UI_TESTS", "ORBIT_HOST", ...CLIENT_ENV];

const provenRunning = (s, deps) => s.state === "RUNNING" && mayStop(judge(s, { alive: deps.process.alive(s.pid), startedAt: deps.process.startedAtOf(s.pid) }));

const supervisorOf = (ctx, deps) => ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).find((s) => s.kind === "supervisor" && provenRunning(s, deps)) ?? null;

const supervisorReceipt = (ctx, argv) => ((requestedAt) => ({ id: sessionId({ env: ctx.envId, component: "supervisor", requestedAt }), env: ctx.envId, owner: ctx.owner, component: "supervisor", kind: "supervisor", provider: "native", state: "STARTING", pid: null, requestedAt, startedAt: null, pidStartedAt: null, host: ctx.host, checkout: ctx.checkout, command: { declaredAs: "supervisor", argv, cwd: "." }, commandFingerprint: commandFingerprint(argv, "."), ports: [] }))(new Date(ctx.clock()).toISOString());

// -> { ok, session, reused? }: the sandbox's supervisor running, launched detached behind a receipt when it is not.
export function supervisorLaunched(ctx, deps) {
  const running = supervisorOf(ctx, deps);
  if (running) return { ok: true, session: running, reused: true };
  if (!ctx.supervisorArgv?.length) return { ok: false, because: "this runtime was bound without the supervisor's entry, so none was launched" };
  const argv = [...ctx.supervisorArgv, `--task=${ctx.task}`];
  return launchedSupervisor(ctx, deps, supervisorReceipt(ctx, argv), argv);
}

function launchedSupervisor(ctx, deps, receipt, argv) {
  const logs = ctx.sessions.logs(receipt.id);
  ctx.sessions.write(receipt);
  ctx.io.ensureDir(join(logs.out, ".."));
  return settledSupervisor(ctx, deps, receipt, deps.process.launch(argv[0], argv.slice(1), { cwd: ctx.primaryRoot ?? ctx.root, env: childEnv(ctx.env ?? {}, SUPERVISOR_ENV), out: logs.out, err: logs.err }));
}

function settledSupervisor(ctx, deps, receipt, started) {
  const next = started.pid ? { ...receipt, state: "RUNNING", pid: started.pid, startedAt: started.startedAt, pidStartedAt: deps.process.startedAtOf(started.pid) } : { ...receipt, state: "LOST", why: "the supervisor could not be started" };
  ctx.sessions.write(next);
  return { ok: next.state === "RUNNING", session: next };
}

// ---- one tick's facts, gathered for the table ----------------------------------------------------------------------------

export function factsNow(ctx, policy) {
  const doc = ctx.sandboxes.read(ctx.envId);
  const nowMs = ctx.clock();
  return { doc, signals: supervisionNow(ctx.io, supervisionRoom(ctx.rooms.liveSandbox)), nowMs, lifetimeEndsMs: Date.parse(doc?.createdAt ?? new Date(nowMs).toISOString()) + policy.isolation.lifetimeMinutes * 60000, workers: ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.kind === "worker" && s.state === "RUNNING") };
}
