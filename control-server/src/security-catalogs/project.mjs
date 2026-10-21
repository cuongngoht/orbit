// WHICH catalogs Control's Security page is about: the ones adopted on THIS machine, and the choices
// of the project Control was started from -- no route takes a project from outside, the rule the
// report and autonomous-QA pages keep. Each room is written through an io guarded at its own root:
// the machine's adopted catalogs at the store base, the project's choices at the project's store.
import { join } from "node:path";
import { Refused, guardedIo, reportProject, securityRooms, securityState } from "../core.mjs";

function projectOf(ctx) {
  try { return reportProject(ctx.world.env, ctx.world.projectRoot); }
  catch (e) { return refusedAsNone(e); }
}

function refusedAsNone(e) {
  if (e instanceof Refused) return null;
  throw e;
}

// -> { rooms, machineIo, projectIo (null outside a checkout), project, ports for the command table }
export function securityWorld(ctx) {
  const found = projectOf(ctx);
  const rooms = securityRooms(ctx.world.storeBase, found?.store.root ?? null);
  const machineIo = guardedIo(ctx.world.storeBase, ctx.world.io);
  return { rooms, machineIo, projectIo: found?.io ?? null, project: found?.project ?? null, ports: portsOf(ctx, rooms, machineIo) };
}

// The same ports the terminal binds, with Control's door: this server is where a person's choice is
// made. It reads no graph and no evidence -- those are the auditor's, from the project's checkout.
const portsOf = (ctx, rooms, io) => ({ io, rooms, shippedDir: join(ctx.world.pluginRoot, "skills", "orbit-security-audit", "catalogs"), graph: () => null, scopeDigest: () => null, results: () => [], resultsSource: "reported", now: () => ctx.now().toISOString(), door: "control" });

export const stateHere = (w) => securityState(w.ports);
