// START: launch what a file declared -- and nothing else.
//
// Start means launch the components the resolver says are READY, with the
// argument list their declared command was tokenized into. It does not install a
// tool, edit the repository, pick another port, kill what is in the way, or guess
// a command: each of those is something a person is told, and each ends in a
// BLOCKED the person can read.
//
// The order is the order of what could go wrong, and the receipt is the first
// thing written (src/runtime/sessions.mjs): a start that dies before it settles is
// read back as AMBIGUOUS, never resent. Per component, in this order:
//
//   already running   a session Orbit can PROVE is its own is running: nothing is started twice
//   unsettled         an earlier start never settled: it is named, and nothing is started
//                     until a person releases it
//   the way out       a reach target a person said must answer first (`beforeStart`) is asked from
//                     where the component will run -- with the saved retry, BEFORE the lock, so a
//                     wait holds nobody's start up. Not reachable is BLOCKED with the target named,
//                     and nothing is written or launched
//   the place         the provider's environment is there to launch into
//   the port          nothing else holds a port the component declared -- and if something does,
//                     whose it is, when Orbit knows. Never killed, never moved
//   the holder        a port held by something that is NOT Orbit's may be REUSED, when a person
//                     allowed it (`reuseExternal`) and the readiness a person expects of the
//                     component answers there. Reused is EXTERNAL: no receipt, no pid, never
//                     stopped -- a held port proves only that something listens, so without an
//                     expectation that answers it is still blocked. A Orbit-owned holder never is
//   the receipt       a session document written BEFORE the launch
//   the launch        through the provider, through the Process port
//   the proof         the pid's start time, kept, so ownership can be proven later
//
// Whether it is READY is a separate question asked afterwards (src/runtime/
// readiness.mjs); `wait` only chooses to ask it for a while.
import { dirname } from "node:path";
import { Blocked, Refused } from "../../errors.mjs";
import { conflicts, ownerLookup, runningEverywhere } from "../ports.mjs";
import { exclusively } from "../exclusive.mjs";
import { judge, mayStop } from "../ownership.mjs";
import { hinted, portsOpenedBy, probeFor, readiness, startedWith, waitReady } from "../readiness.mjs";
import { commandFingerprint, sessionId } from "../sessions.mjs";
import { providerOf } from "../providers/index.mjs";
import { deps, scopeOf } from "./deps.mjs";
import { reachedFrom } from "../connectivity/check.mjs";
import { gatesOf, targetsOf as reachTargetsOf, whereOf } from "../connectivity/targets.mjs";

// The sessions of THIS context -- a person's runtime, or one task's sandbox -- each judged against the OS
// now. The live room holds both, and port ownership reads all of it (src/runtime/ports.mjs); everything
// that asks "is it already running" asks this, so a developer's server is never a task's.
export function sessionsNow(ctx) {
  return ctx.sessions.list(scopeOf(ctx)).map((s) => ({ session: s, judgement: judge(s, ctx.process.alive(s.pid) ? { alive: true, startedAt: ctx.process.startedAtOf(s.pid) } : { alive: false }) }));
}

// Which components a start is about: the one named (and it must be startable), or
// every one that is ready. A component the person named that is not ready is
// BLOCKED with what is in the way -- never skipped quietly.
function targetsOf(plan, named) {
  if (!named) return plan.components.filter((c) => c.state === "ready");
  const one = plan.components.find((c) => c.key === named);
  if (!one) throw new Refused(`no component ${JSON.stringify(named)} is known here: ${plan.components.map((c) => c.key).join(", ") || "none"}`);
  if (one.state !== "ready") throw new Blocked(`${named} cannot be started: ${one.because}${one.blocking.length ? ` — ${one.blocking.join("; ")}` : ""}`);
  return [one];
}

// -> { started, reused, skipped, blocked, notReady }
//
// The look for what is running and the launch are ONE step, taken alone (src/runtime/exclusive.mjs).
// Whether what was started ANSWERS is asked after that step is over: it can take minutes, and
// nobody else's start has any reason to wait for it.
export async function start(ctx, planned, args) {
  const targets = targetsOf(planned.plan, args.component);
  const gate = await gated(ctx, targets, planned.world);
  const launched = await exclusively(ctx, () => launches(ctx, gate.clear, planned.world, args));
  return outcome(await answered(ctx, [...gate.blocked, ...launched], planned.world, args), planned.plan, args.component);
}

// The reach targets a person said must answer before a component starts, asked from where EACH will
// run, each (target, location) once however many components need it. A component Orbit already runs
// is not asked about: starting it again starts nothing. -> { clear, blocked }
export async function gated(ctx, components, world) {
  const running = new Set(sessionsNow(ctx).filter((s) => s.judgement.state === "RUNNING" && mayStop(s.judgement)).map((s) => s.session.component));
  const reach = reachTargetsOf(ctx.readSettings().settings);
  const asked = await askedAll(ctx, pairsOf(components.filter((c) => !running.has(c.key)).flatMap((c) => gatesOf(reach, c.key, locationOf(c)).map((t) => ({ t, provider: locationOf(c) })))), world);
  return split(components, asked);
}

// WHERE a component runs, which is the network it is asked about: the provider that runs it, or -- for a
// component a sandbox places -- the way it was placed on.
const locationOf = (c) => c.execution ?? c.provider;

// Unique by target and location, in the order first needed.
const pairsOf = (all) => all.filter((p, i) => all.findIndex((q) => q.t.id === p.t.id && q.provider === p.provider) === i);

async function askedAll(ctx, pairs, world) {
  const asked = [];
  for (const p of pairs) asked.push({ ...p, done: await reachedFrom(ctx, p.t, p.provider, p.t.retry, world) });
  return asked;
}

function split(components, asked) {
  const blockingOf = (c) => asked.filter((a) => a.provider === locationOf(c) && a.t.requiredBy.includes(c.key) && a.done.state !== "REACHABLE").map(unreachable);
  return { clear: components.filter((c) => !blockingOf(c).length), blocked: components.filter((c) => blockingOf(c).length).map((c) => ({ component: c.key, state: "blocked", blocking: blockingOf(c) })) };
}

// "Could not be checked" is not "is not reachable": a container that is not up has said nothing about the network.
const unreachable = (a) => `${whereOf(a.t)} ${a.done.state === "BLOCKED" ? "could not be checked" : "is not reachable"} from ${a.provider}: ${a.done.because}`;

async function launches(ctx, targets, world, args) {
  const results = [];
  for (const target of targets) results.push(await one(ctx, target, world, args));
  return results;
}

// What each started component says once it has had its time to come up.
async function answered(ctx, results, world, args) {
  const out = [];
  for (const r of results) out.push(r.state === "started" ? { ...r, readiness: hinted(await asked(ctx, componentOf(world, r.component), args, ctx.sessions.read(r.session)), providerOf(r.provider, ctx.providers)) } : r);
  return out;
}

// Some blocked is a partial runtime, which is valid; NOTHING that could start is a
// BLOCKED -- whether each was tried and found blocked, or none was ready to try.
// A start of ONE component speaks of that one: the rest of the checkout is `status`'s to tell.
function outcome(results, plan, named) {
  const blocked = results.filter((r) => r.state === "blocked");
  const notReady = notReadyOf(plan).filter((n) => !named || n.component === named);
  const stuck = blocked.length && blocked.length === results.length ? blocked.map((b) => `${b.component}: ${b.blocking.join("; ")}`) : !results.length ? notReady.map(sayNotReady) : [];
  if (stuck.length) throw new Blocked(stuck.join("\n"));
  return { started: results.filter((r) => r.state === "started"), reused: results.filter((r) => r.state === "reused"), skipped: results.filter((r) => r.state === "already-running"), blocked, notReady };
}

const sayNotReady = (n) => `${n.component}: ${n.because}${n.blocking.length ? ` — ${n.blocking.join("; ")}` : ""}`;

const notReadyOf = (plan) => plan.components.filter((c) => !["ready", "not-startable"].includes(c.state)).map((c) => ({ component: c.key, state: c.state, because: c.because, blocking: c.blocking }));

// An earlier start that never settled stops this one, by name; one that is
// running and Orbit's own means there is nothing to do.
function prior(all, key) {
  const unsettled = all.find((s) => s.session.component === key && s.judgement.state === "AMBIGUOUS");
  if (unsettled) throw new Refused(`an earlier start of ${key} never settled (${unsettled.session.id}); release it with \`runtime stop --release=${unsettled.session.id} --human\` before starting again`);
  const running = all.find((s) => s.session.component === key && s.judgement.state === "RUNNING" && mayStop(s.judgement));
  return running ? { component: key, state: "already-running", session: running.session.id, pid: running.session.pid } : null;
}

async function one(ctx, target, world, args) {
  const already = prior(sessionsNow(ctx), target.key);
  if (already) return already;
  const way = await wayOf(ctx, target, world);
  if (way.reused) return way.reused;
  return way.blocking.length ? { component: target.key, state: "blocked", blocking: way.blocking } : launch(ctx, target, world, args);
}

const componentOf = (world, key) => world.view.components.find((c) => c.key === key);

// The ports a start will open: what the provider that runs it says (a sandbox's are the ones it LEASED), else
// what the component declares.
const portsOf = (ctx, world, target) => portNumbers(ctx, world, target).map((port) => ({ component: target.key, port }));

const portNumbers = (ctx, world, target) => providerOf(target.provider, ctx.providers).ports?.(componentOf(world, target.key), target.command, world, target) ?? portsOpenedBy(componentOf(world, target.key), target.command);

export const owners = (ctx) => ownerLookup(runningEverywhere(registryDeps(ctx)));

export const heldBy = (h) => `port ${h.port} is in use${h.owner ? ` by ${h.owner.component} of ${h.owner.project}${h.owner.owner?.kind === "task" ? ` (task ${h.owner.owner.id}'s sandbox)` : ""}` : " by something that is not Orbit's (external or unknown)"} — it is not stopped and not moved`;

export const registryDeps = (ctx) => ({ registry: ctx.registry, storeBase: ctx.storeBase, host: ctx.host, io: ctx.raw, process: ctx.process });

// What stands in the way of launching, as sentences -- the environment is not there, or a port is
// held -- or, for a holder that is not Orbit's, the component REUSED. -> { blocking } | { reused }
async function wayOf(ctx, target, world) {
  const there = providerOf(target.provider, ctx.providers).ready(world, deps(ctx), target);
  if (!there.ok) return { blocking: [there.because] };
  const held = await conflicts(portsOf(ctx, world, target), { probe: ctx.probe, ownerOf: owners(ctx) });
  if (!held.length) return { blocking: [] };
  return reusable(ctx, target, held) ? reused(ctx, target, world, held) : { blocking: held.map(heldBy) };
}

// Reuse is a person's choice, and only of what is nobody's in Orbit: a holder another session of Orbit
// owns is that session's, and is never "reused". And never by a provider that says it does not: a sandbox's
// whole purpose is to run THE TASK's code, and a developer's server on the expected port is not that.
const reusable = (ctx, target, held) => providerOf(target.provider, ctx.providers).reuses !== false && ctx.readSettings().settings.reuseExternal === true && held.every((h) => h.owner === null);

// What a person said the component answers when it is up. A probe the engine would DISCOVER is a port,
// and "the port is held" is the very fact in question -- it would prove nothing about what holds it.
function expectedProbe(ctx, component, command) {
  const set = ctx.readSettings().settings.components?.[component.key]?.readiness ?? null;
  return set ? probeFor(component, set, command) : null;
}

async function reused(ctx, target, world, held) {
  const probe = expectedProbe(ctx, componentOf(world, target.key), target.command);
  if (!probe) return { blocking: [NO_EXPECTATION(held[0], target.key)] };
  const answer = await readiness(true, probe, deps(ctx));
  return answer.state === "READY" ? { reused: reusedAs(target, held, answer) } : { blocking: [NOT_ANSWERING(held[0], answer)] };
}

const reusedAs = (target, held, answer) => ({ component: target.key, state: "reused", provider: target.provider, ownership: "EXTERNAL", readiness: answer, session: null, pid: null, because: `port ${held[0].port} is held by something that is not Orbit's, and it answers as ${target.key} is expected to (${answer.probe.kind} ${answer.probe.target}): reused as EXTERNAL — Orbit did not start it and will never stop it` });

const NO_EXPECTATION = (h, key) => `port ${h.port} is in use by something that is not Orbit's (external or unknown) — reuseExternal is set, but nothing a person set says how to tell ${key} is ready there, so it is not reused: set a readiness probe (runtime configure --component=${key} --probe=http|tcp --target=… --human); it is not stopped and not moved`;

const NOT_ANSWERING = (h, a) => `port ${h.port} is in use by something that is not Orbit's (external or unknown) — reuseExternal is set, and the readiness expected of it (${a.probe.kind} ${a.probe.target}) did not answer: ${a.because}; it is not reused, not stopped and not moved`;


async function launch(ctx, target, world, args) {
  const component = componentOf(world, target.key);
  const receipt = recorded(ctx, target, component, world);
  const started = startedBy(ctx, target, component, world, receipt);
  return withheldBy(started, report(ctx, target, component, settledAs(ctx, receipt, started), args));
}

// A variable a provider could not hand over (a value with a line break, into a container) is said
// beside the start, by name.
const withheldBy = (started, reported) => (started?.withheld?.length ? { ...reported, withheld: started.withheld } : reported);

// The receipt, BEFORE the launch.
function recorded(ctx, target, component, world) {
  const doc = receiptOf(ctx, target, component, world, new Date(ctx.clock()).toISOString());
  ctx.sessions.write(doc);
  ctx.io.ensureDir(dirname(ctx.sessions.logs(doc.id).out));
  ctx.sessions.prune(target.key, scopeOf(ctx));
  return doc;
}

// The environment a receipt names: the one its PROVIDER runs in. A person's native component and a validated
// dev container are two environments, and one `world.envId` used to stamp both with the container's.
const envOf = (world, target) => world.envs?.[target.provider] ?? world.envId;

// What a PLACED start records beyond a person's: which provider actually launches it, and the tree it was
// built from -- the identity of the source this session is evidence about -- and the ports it was given.
const placedBy = (target, world) => (target.execution ? { executionProvider: target.execution, sourceTree: world.sandbox?.source?.tree ?? null, leasedPorts: world.sandbox?.endpoints?.filter((e) => e.component === target.key && e.source === "lease").map((e) => e.port) ?? [] } : {});

function receiptOf(ctx, target, component, world, requestedAt) {
  const { declaredAs, argv, cwd } = target.command;
  return { id: sessionId({ env: envOf(world, target), component: target.key, requestedAt }), env: envOf(world, target), owner: ctx.owner ?? { kind: "human" }, component: target.key, provider: target.provider, state: "STARTING", pid: null, requestedAt, startedAt: null, pidStartedAt: null, host: ctx.host, checkout: ctx.checkout, command: { declaredAs, argv, cwd }, commandFingerprint: commandFingerprint(argv, cwd), ports: portNumbers(ctx, world, target), ...placedBy(target, world) };
}

// A launch that throws -- a directory that escapes the checkout, a command that
// cannot be created -- is a start that did not happen, and is said, never lost.
function startedBy(ctx, target, component, world, receipt) {
  try {
    const envNames = ctx.readSettings().settings.components?.[target.key]?.env ?? [];
    return providerOf(target.provider, ctx.providers).start(component, target.command, world, deps(ctx, { logs: ctx.sessions.logs(receipt.id), envNames, session: receipt.id, execution: target.execution ?? null, portSetting: ctx.readSettings().settings.components?.[target.key]?.port ?? null }));
  } catch (e) {
    return { pid: null, error: String(e?.message ?? e) };
  }
}

// The sentence for a launch that made no process: the command was not found, or it is a
// Windows command shim whose script could not be found (src/process/shim.mjs starts the
// script a shim forwards to) -- and Orbit never hands a command to a shell instead.
const NO_PROCESS = (receipt) => `${receipt.command.argv[0]} could not be started: it is not on PATH, or it is a Windows command shim whose script could not be found, and Orbit never uses a shell instead`;

// A launch that returned a pid is RUNNING, with the start time the OS gives it
// kept so ownership can be proven; one that did not is LOST, and says so.
function settledAs(ctx, receipt, started) {
  const pid = started?.pid ?? null;
  const next = pid ? provable(ctx, receipt, started, ctx.process.startedAtOf(pid)) : { ...receipt, state: "LOST", why: started?.error ?? NO_PROCESS(receipt) };
  ctx.sessions.write(next);
  return next;
}

// A task's sandbox must be able to END what it started, and Orbit ends only what it can PROVE its own -- a receipt, a pid and
// the pid's start time in agreement. A host whose sandbox will not tell a process's start time (it may not even run the
// program that asks) makes that proof impossible for ever, so the process is ended NOW, while the pid is known to be the
// one just launched, and the session is LOST with the reason: starting something nobody can stop is worse than not starting.
function provable(ctx, receipt, started, pidStartedAt) {
  const own = { ...receipt, state: "RUNNING", pid: started.pid, startedAt: started.startedAt, pidStartedAt };
  if (pidStartedAt || receipt.owner?.kind !== "task") return own;
  const ended = ctx.process.signal(started.pid, "SIGTERM", { tree: true });
  return { ...receipt, state: "LOST", pid: started.pid, why: `the OS would not say when process ${started.pid} started, so Orbit could never prove it its own to stop it afterwards; it was ${ended.ok ? "ended at once" : "asked to end and may still run"} rather than left behind (a host whose sandbox forbids asking, such as a restricted terminal, cannot run a sandbox's application)` };
}

function report(ctx, target, component, settled, args) {
  const running = settled.state === "RUNNING";
  return { component: target.key, state: running ? "started" : "blocked", session: settled.id, pid: settled.pid, provider: target.provider, blocking: running ? [] : [settled.why], readiness: null };
}

async function asked(ctx, component, args, session) {
  const probe = probeFor(component, ctx.readSettings().settings.components?.[component.key]?.readiness ?? null, startedWith(component, session));
  const wait = (args.wait ?? 0) * 1000;
  return wait ? exited(ctx, session, await waitReady(() => ctx.process.alive(session.pid), probe, deps(ctx), wait)) : { state: "NOT_CHECKED", because: "readiness was not asked about: `runtime status` does, and --wait=<seconds> waits for it" };
}

// A process that exited while it was waited for: how long it ran, and where what it printed is --
// the path, never a line of it (a log is the application's, and may hold what it was configured with).
function exited(ctx, session, answer) {
  if (answer.state !== "NOT_RUNNING") return answer;
  const ran = Math.max(0, Math.round((ctx.clock() - Date.parse(session.startedAt ?? session.requestedAt)) / 1000));
  const logs = ctx.sessions.logs(session.id);
  return { ...answer, exited: true, because: `it exited about ${ran} s after it started, before it answered — what it printed is in ${logs.err} and ${logs.out}` };
}
