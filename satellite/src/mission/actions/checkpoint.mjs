// CHECKPOINT: where the mission stands, kept as one immutable artifact a resume can start from -- the revision, the
// cursor a viewer resumes at, what is open and every run's mode. The journal stays the authority: a checkpoint is a
// summary of it at one revision, and one ahead of its journal is flagged partial (src/recovery/checkpoint.mjs).
import { checkpointOf, writeCheckpoint } from "../../recovery/checkpoint.mjs";
import { ENGINE, ORCHESTRATOR } from "./common.mjs";

function kept(ports, lw) {
  const cp = checkpointOf(lw.m, lw.states());
  const file = writeCheckpoint(ports.io, ports.rooms, lw.id, cp);
  lw.append("checkpoint.written", { n: (lw.m.counts["checkpoint.written"] ?? 0) + 1, digest: cp.digest, file, revision: cp.revision, action: lw.action });
  return { outcome: "kept", level: "CONTRACT_MET", summary: `checkpoint at revision ${cp.revision}: ${cp.open.length} open action(s)`, refs: [`checkpoint:${cp.digest}`], digests: [cp.digest] };
}

export const checkpoint = { fields: [], required: [], mode: () => "RECOVERING", operation: () => "artifact.publish", provider: ENGINE, profile: ORCHESTRATOR, run: kept };
