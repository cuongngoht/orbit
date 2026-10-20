// Serialize authoring in the selected data home, then recheck the caller's snapshot.
// Every data path is contained through symlinks; the authoring lock lives in the store.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { realIo } from "./io.mjs";
import { storePath } from "./guard.mjs";
import { withLock } from "./lock.mjs";
import { machineContext } from "./context.mjs";

export const dataPath = (project, path) => contained(project.dataRoot, path);

export function editData(project, entries, fn) {
  const { io } = prepared(project);
  const lock = storePath(project.storeRoot, join(project.storeRoot, "state", "authoring"));
  io.ensureDir(lock);
  return withLock(lock, () => checked(project, entries, fn, realIo()), io);
}

function prepared(project) {
  const machine = machineContext({ project, config: {} }, {});
  machine.prepare();
  return machine;
}

function checked(project, entries, fn, io) {
  for (const entry of entries) unchanged(dataPath(project, entry.file), entry, io);
  return fn(io);
}

function unchanged(file, entry, io) {
  const normalize = entry.normalize ?? ((text) => text);
  if (normalize(io.read(file)) !== normalize(entry.before)) throw new Refused(`${file} changed since it was read — reload before writing`);
}
