// RUNNING is not READY, and neither is a verdict.
//
// A process that is alive has been STARTED. Whether the application inside it can
// answer is a separate fact with a separate way to learn it, and conflating them
// is how a test run starts against a server that has not finished booting. So a
// running component has one of three readiness answers:
//
//   READY               a probe asked, and the answer was yes
//   NOT_READY           a probe asked, and the answer was no -- yet
//   READINESS_UNKNOWN   nothing says how to ask. This is a valid state, and the
//                       honest one: it is running, and Orbit cannot tell you more
//
// Where a probe comes from is stated, because it decides how far to trust it: a
// PERSON configured it (`human`), or a file declared a port the component listens
// on (`discovered`, a TCP connection to it). No endpoint is ever invented -- there
// is no assumed /health -- and a probe only ever looks at THIS machine
// (src/probe/index.mjs).
//
// And READY is not QA: this module answers whether something is up, and never
// whether it is correct. Verdicts belong to a run (src/run/status.mjs) and to an
// investigation, and a runtime that said "healthy" would be claiming one.

import { probeOnLease } from "./sandbox/binding.mjs";

export const STATES = ["READY", "NOT_READY", "READINESS_UNKNOWN"];

export const DEFAULT_WAIT_MS = 30000;
export const INTERVAL_MS = 500;

// The probe for a component: the person's, else a port the command it was started with says it
// listens on, else one its files declare, else none. A port only another way of starting it opens
// (another launch profile's) is not one to wait for.
export function probeFor(component, configured, command = null) {
  if (configured) return probeOnLease({ kind: configured.kind, target: configured.target, expect: configured.expect, source: "human" }, command?.leased ? command.ports : null);
  const port = command?.ports?.[0] ?? (component.ports.find((p) => p.confidence === "certain") ?? component.ports[0])?.port;
  return port ? { kind: "tcp", target: port, source: "discovered" } : null;
}

// The command a session was started with, as the component declares it NOW (for the ports it says
// it listens on): found by the name it was declared as.
export const startedWith = (component, session) => leased(component.commands.find((c) => c.declaredAs === session?.command?.declaredAs) ?? null, session);

// A sandbox's component listens on the port it was GIVEN, which is not the one its files declare: what is
// asked of it is asked there.
const leased = (command, session) => (session?.leasedPorts?.length ? { ...(command ?? {}), ports: session.leasedPorts, leased: true } : command);

// The ports a start will open: the command's own when its file says so per command, else every one
// the component declares.
export const portsOpenedBy = (component, command) => (command?.ports?.length ? command.ports : component.ports.map((p) => p.port));

const ASK = {
  tcp: async (p, deps) => said(await deps.probe.tcp(p.target), `port ${p.target} accepts a connection`),
  http: async (p, deps) => statusOf(await deps.probe.http(p.target), p),
};

const said = (r, yes) => ({ ok: r.ok === true, because: r.ok ? yes : r.error });

function statusOf(r, p) {
  if (!r.ok) return { ok: false, because: r.error };
  const wanted = p.expect === undefined ? r.status >= 200 && r.status < 300 : r.status === p.expect;
  return { ok: wanted, because: `${p.target} answered ${r.status}${wanted ? "" : p.expect === undefined ? ", which is not a 2xx" : `, not ${p.expect}`}` };
}

// One look. `running` says whether the process is there to ask about at all.
export async function readiness(running, probe, deps) {
  if (!running) return { state: "NOT_RUNNING", because: "it is not running" };
  if (!probe) return { state: "READINESS_UNKNOWN", because: "it is running, and no file or setting says how to tell it is ready" };
  if (!Object.hasOwn(ASK, probe.kind)) return { state: "READINESS_UNKNOWN", because: `a readiness probe of kind "${probe.kind}" is not one this knows how to ask` };
  const got = await ASK[probe.kind](probe, deps);
  return { state: got.ok ? "READY" : "NOT_READY", probe: { kind: probe.kind, target: probe.target, source: probe.source }, because: got.because };
}

// What a provider knows about NOT being reached that a probe cannot: a process in a container can run
// and answer nobody on this machine. Said beside the probe's own sentence, never instead of it.
export const hinted = (answer, provider) => (answer.state === "NOT_READY" && provider?.unreached ? { ...answer, because: `${answer.because} — ${provider.unreached}` } : answer);

// Look again until it is ready, it is GONE, or the time is up. `running` is asked again on every look
// -- a process that exits while it is waited for ends the wait as NOT_RUNNING, never as a NOT_READY
// waited out to the last second. The clock and the sleep are handed in, so a test never waits.
export async function waitReady(running, probe, deps, ms = DEFAULT_WAIT_MS) {
  const until = deps.now() + ms;
  const alive = typeof running === "function" ? running : () => running;
  let last = await readiness(alive(), probe, deps);
  while (last.state === "NOT_READY" && deps.now() < until) last = await lookedAgain(alive, probe, deps);
  return last;
}

async function lookedAgain(alive, probe, deps) {
  await deps.sleep(INTERVAL_MS);
  return readiness(alive(), probe, deps);
}
