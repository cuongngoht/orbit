// A PORT that is already in use is somebody's, and is not Orbit's to free.
//
// Two checkouts of one repository, or two unrelated projects, will both want
// 8080. The second to start finds the port taken, and the only honest answer is
// BLOCKED -- with whose it is when that is known. Orbit never kills the holder,
// never picks another port on the person's behalf, and never retries around it:
// the holder may be the other project's server doing exactly its job.
//
// "Whose" comes from Orbit's own receipts, across every project and checkout the
// registry knows on this machine: a running session, Orbit's by the same proof
// stopping requires (src/runtime/ownership.mjs), that declared the port. A port
// held by anything else -- another program, a session Orbit cannot prove is its
// own -- is `external`, which says exactly that and nothing more.
import { join } from "node:path";
import { createSessions } from "./sessions.mjs";
import { judge, mayStop } from "./ownership.mjs";
import { liveRoom } from "./rooms.mjs";

// -> [{ component, port, owner }]. `wanted` is [{ component, port }].
export async function conflicts(wanted, deps) {
  const found = [];
  for (const w of wanted) if ((await deps.probe.tcp(w.port)).ok) found.push({ ...w, owner: deps.ownerOf(w.port) });
  return found;
}

// The Orbit-owned running sessions of every project and checkout on this machine,
// each with where it lives and what it declared. The registry is the list of what
// Orbit knows -- bindings, never a scan -- and each live room is read, never
// written. `io` is the raw store io: these rooms belong to other projects.
export function runningEverywhere({ registry, storeBase, host, io, process }) {
  return registry.list().flatMap((project) => project.checkouts.flatMap((checkout) => ownedIn(project, checkout, { storeBase, host, io, process })));
}

function ownedIn(project, checkout, { storeBase, host, io, process }) {
  const sessions = createSessions(liveRoom(join(storeBase, project.key), host, checkout.id), io);
  return sessions.all().filter((s) => s.state === "RUNNING" && mayStop(judge(s, { alive: process.alive(s.pid), startedAt: process.startedAtOf(s.pid) }))).map((s) => ({ project: project.name, key: project.key, checkout: checkout.id, root: checkout.root, component: s.component, ports: s.ports ?? [], session: s.id, owner: s.owner ?? { kind: "human" } }));
}

// A function from a port to who holds it among those running sessions, or null.
export const ownerLookup = (running) => (port) => {
  const hit = running.find((r) => r.ports.includes(port));
  return hit ? { project: hit.project, checkout: hit.root, component: hit.component, owner: hit.owner } : null;
};
