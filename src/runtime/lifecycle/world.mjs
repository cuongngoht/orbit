// The WORLD the resolver is asked about, assembled from what is kept and -- only
// when a command asks for it -- what the machine says now.
//
// Two ways to ask, and the difference is the whole of "probe only what is
// needed":
//
//   read-only (`status`)   the machine as it was LAST observed. Nothing is run. A tool
//                          nobody has asked about is UNKNOWN, and says so
//   probing (`doctor`,     the tools THIS checkout's requirements name are asked their
//   `start`)               version first -- and the container host's only when a
//                          container is in play, or when something cannot run
//                          natively and a container might be the way
//
// The machine is never asked about a tool no requirement mentions: the laptop has
// whatever it has, and a project's business is what it needs. What a connectivity check
// last observed is handed in too (`reach`) -- as what is KEPT, fresh answers only; the world
// is never a reason to ask the network.
import { requirement as row } from "../catalog.mjs";
import { filesOn } from "../validate.mjs";
import { HOST_TOOLS } from "../providers/devcontainer.mjs";
import { resolve } from "../resolve/plan.mjs";
import { reachOf } from "../connectivity/observations.mjs";
import { targetsOf } from "../connectivity/targets.mjs";

// The tool ids a checkout's RUN requirements are checked against.
export function neededTools(view, catalog, containerHost) {
  const all = [...view.components.flatMap((c) => c.requirements), ...view.shared.requirements];
  const tools = all.filter((r) => r.confidence === "certain" && r.stage === "run").map((r) => row(catalog, r.requirement)?.tool).filter(Boolean);
  return [...new Set([...tools, ...(containerHost ? HOST_TOOLS.map((t) => t.id) : [])])];
}

// Is a container in play already -- a person chose one, or one exists?
export function containerRelevant(ctx, view, settings) {
  const chosen = settings.strategy === "devcontainer" || Object.values(settings.components ?? {}).some((c) => c.provider === "devcontainer");
  return chosen || view.definitions.length > 0 || ctx.instances.list().length > 0;
}

// An instance as it is NOW: one that was VALIDATED and whose files have been edited
// since is no longer known to work, and reads as merely ADOPTED -- an existing
// environment is inspected, never trusted on the strength of an old yes.
export function instancesNow(ctx) {
  const disk = filesOn(ctx);
  return ctx.instances.list().map((i) => (i.state === "VALIDATED" && changed(i.files ?? {}, disk) ? { ...i, state: "ADOPTED", changed: true } : i));
}

const changed = (recorded, disk) => Object.keys({ ...recorded, ...disk }).some((p) => (recorded[p] ?? null) !== (disk[p] ?? null));

// What names a container as a TASK's, beside the checkout and the environment: a person's container carries
// none, so the labels that find a sandbox's containers never find a person's.
const labelsOf = (ctx) => (ctx.owner?.kind === "task" ? [["orbit.task", ctx.task], ["orbit.workspace", ctx.workspace?.id]] : []);

export function worldOf(ctx, view, settings, { probe, host }) {
  const ids = neededTools(view, ctx.catalog, host);
  const tools = probe ? ctx.machine.probe(ids) : ctx.machine.cached(ids);
  const env = ctx.instances.list().find((i) => i.provider === "devcontainer");
  return { view, machine: { platform: ctx.machine.platform, arch: ctx.machine.arch, tools }, catalog: ctx.catalog, instances: instancesNow(ctx), checkout: ctx.checkout, envId: env?.id ?? ctx.envId, envs: ctx.envs ?? { native: ctx.envId, devcontainer: env?.id ?? ctx.envId }, labels: labelsOf(ctx), sandbox: ctx.sandboxNow?.() ?? null, tools: ids, reach: reachOf(ctx.observations?.list() ?? [], targetsOf(settings), ctx.clock()) };
}

// The plan, and the world it was made in. Probing asks the container host's tools
// only when a container is relevant -- or when something cannot run natively, in
// which case a container may be the way and the answer is worth having.
export function planned(ctx, look, settings, { probe }) {
  const relevant = containerRelevant(ctx, look.view, settings);
  const first = made(ctx, look, settings, probe, relevant || !probe);
  return relevant || !probe || settled(first.plan) ? first : made(ctx, look, settings, probe, true);
}

const settled = (plan) => ["READY", "EMPTY"].includes(plan.overall);

function made(ctx, look, settings, probe, host) {
  const world = worldOf(ctx, look.view, settings, { probe, host });
  return { world, plan: resolve(world, settings, ctx.providers) };
}
