// The LESSONS' rooms inside the machine store.
//
// WHERE that store is, and why it is never in a working tree, is
// src/project/repository.mjs -- a question architecture asks identically, so it is
// answered once. What is left here is this subsystem's own layout, which nothing
// else has any business knowing.
//
// The split matters. `memory/` is what a person opens -- lessons and the rollups
// rendered from them. `state/` is bookkeeping: the on/off switch, how far each
// evidence source has been read, what has been forgotten, what was last
// projected. State is NEVER projected into Claude Code's memory directory: a
// tombstone and a watermark are not things anyone wants recalled into a
// conversation.
import { join } from "node:path";

export const storePaths = (root) => ({
  root,
  memory: join(root, "memory"),
  lessons: join(root, "memory", "lessons"),
  index: join(root, "memory", "index.md"),
  state: join(root, "state"),
  switchFile: join(root, "state", "switch.json"),
  native: join(root, "state", "native.json"),
  projected: join(root, "state", "projected.json"),
  watermarks: join(root, "state", "watermark"),
  tombstones: join(root, "state", "tombstones"),
  findings: join(root, "state", "findings"),
});
