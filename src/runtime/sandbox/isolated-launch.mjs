// STARTING an isolated sandbox's components (ADR 0039): each in a container of its own on the task's network, behind
// a receipt, from the topology the sandbox was prepared with -- composed again, and refused when it is not the same.
//
// What `sandbox-start` does for a sandbox that is not isolated is the ordinary lifecycle's (a process or a dev
// container); for an isolated one it is this, in the same answer's shape, so the orchestrator reads one thing. A
// component container of THIS sandbox built from another tree is stopped and replaced -- never reused, because a
// container that outlived a change is exactly the evidence a sandbox exists to refuse -- and only one whose ownership
// is proven is ever stopped.
import { look } from "../understanding.mjs";
import { composedNow } from "./isolated-prepare.mjs";
import { builtImage, readyNode, specOf, startedNode, stoppedNode } from "./network.mjs";
import { supervisorLaunched } from "./supervise.mjs";

// The topology NOW, the way preparing composes it.
export const recomposed = (ctx, deps, closure = null) => composedNow({ ctx, deps, closure, state: { view: look(ctx).view, settings: ctx.readSettings().settings } });

const STALE_TOPOLOGY = "the workspace or a person's policy says something else now than the topology this sandbox was prepared with: `sandbox-prepare` composes it again";

const prepared = (ctx) => ctx.sandboxes.read(ctx.envId)?.isolation ?? null;

const withPod = (now, ctx) => ({ ...now, place: { ...now.place, attest: { ...now.place.attest, podId: prepared(ctx)?.podId ?? null } } });

// -> launched()'s answer for an isolated sandbox.
export async function isolatedLaunched(ctx, args, deps, prep) {
  const now = recomposed(ctx, deps);
  const stuck = now.needs ? { needs: now.needs, say: now.say } : now.topology.fingerprint !== prepared(ctx)?.topology?.fingerprint ? { needs: "environment", say: STALE_TOPOLOGY } : null;
  if (stuck) return blockedAll(ctx, prep, stuck.needs, stuck.say);
  return launchedNow(ctx, args, deps, prep, now);
}

async function launchedNow(ctx, args, deps, prep, now) {
  const replaced = replacedOld(ctx, now, deps);
  const results = await startedAll(ctx, args, deps, withPod(now, ctx));
  return { ...answerOf(ctx, prep, replaced, results), supervisor: supervised(supervisorLaunched(ctx, deps)) };
}

const supervised = (r) => (r.ok ? { session: r.session.id, reused: Boolean(r.reused) } : { session: null, because: r.because });

// A component container that runs another tree is ended before its replacement starts.
function replacedOld(ctx, now, deps) {
  const tree = ctx.sandboxDoc().source?.tree ?? null;
  const old = ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && s.kind === "component" && s.state === "RUNNING" && s.sourceTree !== tree);
  return old.map((s) => ({ component: s.component, session: s.id, ...stoppedNode(ctx, now.iso, s, deps) }));
}

async function startedAll(ctx, args, deps, now) {
  const results = [];
  for (const n of now.topology.nodes.filter((x) => x.role === "component" && (!args.component || x.key === args.component))) results.push(await oneComponent(ctx, args, deps, now, n));
  return results;
}

async function oneComponent(ctx, args, deps, now, node) {
  const built = builtImage(now.iso, node, now.place, deps);
  if (!built.ok) return { component: node.key, blocked: built.because };
  const r = startedNode(ctx, now.iso, built.node, specOf(built.node, now.topology, now.place), { kind: "component", tree: ctx.sandboxDoc().source?.tree ?? null }, deps);
  if (!r.ok) return { component: node.key, blocked: r.because };
  return { component: node.key, session: r.session, reused: Boolean(r.reused), readiness: args.wait ? await readyNode(built.node, { ctx, iso: now.iso, topology: now.topology, place: now.place, deps }, args.wait * 1000) : null };
}

const startedOf = (r) => ({ component: r.component, session: r.session.id, executionProvider: "isolated", requestedAt: r.session.requestedAt });

const answerOf = (ctx, prep, replaced, results) => ({ environment: ctx.envId, tree: prep.tree, started: results.filter((r) => r.session && !r.reused).map(startedOf), reused: [], skipped: results.filter((r) => r.reused).map((r) => ({ component: r.component, session: r.session.id })), replaced: replaced.filter((r) => r.ok).map(({ component, session }) => ({ component, session })), exited: [], blocked: [...results.filter((r) => r.blocked).map((r) => ({ component: r.component, because: r.blocked, needs: "environment" })), ...replaced.filter((r) => !r.ok).map((r) => ({ component: r.component, because: r.because, needs: "person" }))], notReady: results.filter((r) => r.readiness && r.readiness.state !== "READY").map((r) => ({ component: r.component, because: r.readiness.because })), endpoints: ctx.sandboxes.read(ctx.envId)?.endpoints ?? [] });

const blockedAll = (ctx, prep, needs, because) => ({ environment: ctx.envId, tree: prep.tree, started: [], reused: [], skipped: [], replaced: [], exited: [], blocked: [{ component: "*", because, needs }], notReady: [], endpoints: [], state: "BLOCKED" });
