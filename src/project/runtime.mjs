import { existsSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { loadProject } from "./index.mjs";
import { repositoryPaths } from "./repository.mjs";
import { contained, outsideRepositories } from "./boundary.mjs";

// Optional adapters may list tools outside a configured project. Once a store
// project exists, errors propagate; a missing setting does not select another path.
export function adapterProject(env = process.env, cwd = process.cwd()) {
  const candidate = repositoryPaths(cwd, env);
  if (candidate) return { ...candidate, ...loadProjectIfConfigured(env, cwd, candidate) };
  return null;
}

export function runtimePath(project, path) {
  if (project?.isolated) return outsideRepositories(contained(project.sessionDir, path));
  return sharedRuntimePath(project, path);
}

// What a PERSON keeps for this checkout on this machine -- the identity map --
// is the same for every host's session. Only session STATE is isolated per host
// (a browser, a working set), so a bound Codex or AGY command reads the map the
// way Claude does, still held inside the checkout's runtime room.
export function sharedRuntimePath(project, path) {
  return outsideRepositories(contained(project.runtime, path));
}

export function runtimeSession(project, dir) {
  for (const name of [".playwright", ".playwright/cli.config.json", ".playwright-cli"]) runtimePath(project, join(dir, name));
  return runtimePath(project, dir);
}

export function profileName(name) {
  if (typeof name !== "string" || !/^[\w-][\w.-]*$/.test(name) || name === "." || name === "..") throw new Refused("profile name must be a plain name, not a path");
  return name;
}

// Bounded working-set metadata lives in the checkout session room.
export function workingSetDir(project) {
  if (project?.isolated) return join(project.sessionDir, "working-set");
  return runtimePath(project, join(project.sessionDir, "working-set"));
}

// Where a host's memory directory was last FOUND for this checkout on this
// machine -- a location record, never a byte of what that memory says. Only a
// hook can discover it (the host hands a hook its transcript path, and a shell
// command nothing), so the async SessionStart hook writes it here and a later
// `knowledge` command reads it. The same rooms the working set uses, for the
// same reason: per host, per checkout, temporary, and never the store or the
// repository.
export function hostMemoryFile(project) {
  return runtimePath(project, join(project.sessionDir, "host-memory.json"));
}

function loadProjectIfConfigured(env, cwd, candidate) {
  if (!existsSync(join(candidate.dataRoot, "project.json"))) return {};
  return loadProject(env, cwd);
}
