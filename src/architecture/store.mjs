// The ARCHITECTURE rooms inside the machine store, and the port over them.
//
// Where the store is at all is src/project/repository.mjs, shared with the lessons.
// What is here is the layout: `architecture/facts/`, `architecture/state/`. How a
// room of facts is kept -- one file per fact, the damage rule, the locked state
// file -- is src/store/fact-room.mjs, shared with the runtime facts that have the
// same needs and a different subject.
//
// There is deliberately no `projected.json` here. Claude Code's MEMORY.md has
// ONE region with one writer and one record of what was written, in the lesson
// store's state. Two records of one file is two stories about it.
import { join } from "node:path";
import { createFactRoom } from "../store/fact-room.mjs";
import { emptyModel, usableModel } from "./model.mjs";

export const DIR = "architecture";

export const architecturePaths = (root) => ({
  root: join(root, DIR),
  facts: join(root, DIR, "facts"),
  state: join(root, DIR, "state"),
  model: join(root, DIR, "state", "model.json"),
  findings: join(root, DIR, "state", "findings"),
});

export function createArchitecture(root, io) {
  const paths = architecturePaths(root);
  return { root, ...createFactRoom({ paths, io, empty: emptyModel, usable: usableModel }) };
}
