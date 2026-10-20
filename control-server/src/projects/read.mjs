// WHICH projects and checkouts Orbit knows on this machine, from the registry and from nothing
// else: a checkout is known because Orbit was USED from it (the binding every command writes the
// first time), so listing them costs a directory listing and never a crawl, and opening Control
// reads no repository. Each row carries the one-line summary the last command left, as of the time
// it says -- the truth about a checkout is its own Runtime page.
import { createRegistry } from "../core.mjs";
import { missing } from "../errors.mjs";

export const registryOf = (ctx) => createRegistry(ctx.world.rooms, ctx.world.io);

export const listProjects = (ctx) => ({ projects: registryOf(ctx).list() });

export function readProject(ctx, key) {
  const project = registryOf(ctx).list().find((p) => p.key === key);
  if (!project) throw missing("PROJECT_UNKNOWN", "no project like that is known on this machine");
  return { project };
}
