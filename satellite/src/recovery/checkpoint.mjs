// A CHECKPOINT: one immutable summary of a mission at one revision, for a session that resumes it. The journal is the
// authority; a checkpoint only says where to look first, and one claiming a revision its journal does not have yet is
// PARTIAL and never trusted over the fold.
import { canonicalJson, short } from "../../../src/hash.mjs";
import { openActions } from "../mission/state.mjs";
import { missionFile } from "../store/rooms.mjs";
import { quietly } from "../store/text.mjs";

export const CHECKPOINT_SCHEMA = 1;

export const checkpointOf = (m, states) => ((cp) => ({ ...cp, digest: short(canonicalJson(cp), 16) }))({ schema: CHECKPOINT_SCHEMA, missionId: m.meta.id, revision: m.position, cursor: `o=${m.position}`, open: openActions(m).map((a) => ({ id: a.id, type: a.type, status: a.status, agentRun: a.agentRun ?? null })), runs: [...m.runs.values()].filter((r) => !r.ended).map((r) => ({ id: r.id, mode: r.stack.at(-1)?.mode ?? r.mode, modes: r.stack.map((s) => s.mode) })), units: Object.fromEntries(states) });

export function writeCheckpoint(io, rooms, id, cp) {
  const rel = `checkpoints/${cp.revision}-${cp.digest.slice(0, 8)}.json`;
  const file = missionFile(rooms, id, ...rel.split("/"));
  if (!io.exists(file)) io.writePrivate(file, `${JSON.stringify(cp, null, 2)}\n`);
  return rel;
}

// The newest checkpoint, and whether it claims more than the journal holds.
export function readCheckpoint(io, rooms, id, m) {
  const names = io.list(missionFile(rooms, id, "checkpoints")).filter((n) => /^\d+-[0-9a-f]{8}\.json$/.test(n)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const cp = names.length ? quietly(() => JSON.parse(io.read(missionFile(rooms, id, "checkpoints", names.at(-1))) ?? "null")) : null;
  return cp ? { ...cp, partial: cp.revision > m.position } : null;
}
