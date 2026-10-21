// ISOLATED: what a container an isolated sandbox started IS to the ordinary lifecycle (ADR 0039) -- the runtime
// provider a container's session names, so `status`, `stop` and `release` judge and end it by the same table a
// process is judged by, and never by a name.
//
// It starts nothing itself: an isolated sandbox's containers are made by its topology (src/runtime/sandbox/
// network.mjs), each behind a receipt, and a person's runtime never sees this provider. What it adds is the two
// questions every session is asked -- is it still there and since when (`status`, read through the isolation
// provider the receipt names), and end it (`stop`, only after ownership was proven: stop, then remove) -- and the
// promise a sandbox's providers all keep: a holder of a port is never reused for the task (`reuses: false`).
import { ISOLATION_PROVIDERS, isolationOf } from "../isolation/index.mjs";
import { observedOf } from "../sandbox/network.mjs";

const SAID = "an isolated sandbox is prepared by `runtime sandbox-prepare` and started by `runtime sandbox-start`, from its topology, under a person's trust and a receipt per container";

const providerFor = (session, deps) => isolationOf(session.container?.provider, deps.isolation ?? ISOLATION_PROVIDERS);

function status(session, deps) {
  const iso = providerFor(session, deps);
  if (!session.container || !iso) return { alive: false };
  return observedOf(iso, session, deps);
}

async function stop(session, deps) {
  const iso = providerFor(session, deps);
  if (!iso || !session.container?.id) return { ok: false, how: "none", why: "the receipt names no container this engine can reach" };
  const stopped = iso.container.stop(session.container.id, deps);
  if (!stopped.ok) return { ok: false, how: "none", why: stopped.why };
  return { ok: true, how: iso.container.remove(session.container.id, deps).ok ? "stopped and removed" : "stopped" };
}

const answer = (state, because) => ({ state, because });

const compatibility = (component, world) => (world.sandbox?.isolation?.provider ? answer("compatible", `an isolated sandbox runs it in a container on the task's own network (${world.sandbox.isolation.provider})`) : answer("incompatible", "only an isolated sandbox runs a component this way"));

export const isolated = {
  apiVersion: "orbit.runtime-provider/v1",
  id: "isolated",
  doc: "runs a component, a service or a test worker in a container on an internal network of the task's own, behind a receipt per container",
  reuses: false,
  compatibility,
  doctor: (world) => ({ provider: "isolated", checks: [{ what: "an isolated sandbox", state: world.sandbox?.isolation?.attested ? "ATTESTED" : "NOT_ATTESTED", because: world.sandbox?.isolation?.because ?? null }] }),
  prepare: (world, deps, opts = {}) => (opts.apply ? { ok: false, because: SAID, receipt: null } : { provider: "isolated", host: [], environment: [{ step: "sandbox-prepare", needed: !world.sandbox?.isolation?.attested, say: SAID }], repository: "no changes" }),
  validate: () => ({ ok: false, because: SAID, receipt: null }),
  ready: (world) => (world.sandbox?.isolation?.attested ? { ok: true, because: "the sandbox's isolation was attested" } : { ok: false, because: `the sandbox's isolation is not attested: ${SAID}` }),
  start: () => ({ pid: null, error: SAID }),
  status,
  stop,
};
