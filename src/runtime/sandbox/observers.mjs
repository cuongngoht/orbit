// OBSERVER sessions of an isolated sandbox (ADR 0036): a long-lived container an ADAPTER needs to watch a channel or
// a workload without taking anything from the application -- started here behind a receipt, on the task's network,
// and ended only by its ownership proof.
//
// What an observer DOES is the adapter's program and none of this module's business: it is handed an image (the
// adapter's own, pinned and trusted like the worker's, or the worker image itself) and a fixed argument list, the way
// every container of the topology is. The supervisor keeps observers alive until the windows that need them close
// (TEARDOWN AWAIT_WINDOWS) and then this closes them; nothing here knows a transport.
import { containerNameOf, specOf, startedNode, stoppedNode } from "./network.mjs";

export const OBSERVER_KINDS = ["observer", "helper"];

const KEY = /^[a-z][a-z0-9-]{0,40}$/;

// -> { ok, session, because? }. `observer`: { key, image (pinned), argv, env: { names, values } }.
export function observerStarted(ctx, iso, now, observer, deps) {
  if (!KEY.test(String(observer.key))) return { ok: false, because: "an observer is named by a short logical key" };
  const node = { key: `observer:${observer.key}`, role: "observer", alias: `obs-${observer.key}`.slice(0, 40), image: { pinned: observer.image }, argv: observer.argv ?? [], env: observer.env ?? { names: [], values: {} }, ports: [] };
  return startedNode(ctx, iso, node, specOf(node, now.topology, now.place), { kind: "observer", tree: ctx.sandboxDoc().source?.tree ?? null }, deps);
}

export const observersOf = (ctx) => ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && OBSERVER_KINDS.includes(s.kind) && s.state === "RUNNING");

// Every observer of this sandbox ended, by its receipt; one that cannot be proven Orbit's is named and left.
export const observersClosed = (ctx, iso, deps) => observersOf(ctx).map((s) => ({ session: s.id, ...stoppedNode(ctx, iso, s, deps) }));

export const observerNameOf = (envId, key) => containerNameOf(envId, `observer:${key}`);
