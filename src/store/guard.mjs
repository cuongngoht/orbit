// Wrap mutations as well as path resolution: a child symlink can change later.
import { contained, outsideRepositories } from "../project/boundary.mjs";

export const storePath = (root, path) => outsideRepositories(contained(root, path));

export function guardedIo(root, io) {
  const guard = (path) => storePath(root, path);
  return { ...io, ...singlePaths(io, guard), copy: (a, b) => io.copy(guard(a), guard(b)), rename: (a, b) => io.rename(guard(a), guard(b)) };
}

function singlePaths(io, guard) {
  const names = ["write", "append", "mkdir", "ensureDir", "remove", "removeFile"];
  return Object.fromEntries(names.map((name) => [name, (path, ...args) => io[name](guard(path), ...args)]));
}
