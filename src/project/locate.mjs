// Only explicit data or a current repository binding determines a project.
import { resolve } from "node:path";
import { Refused } from "../errors.mjs";
import { fromEnv, varName } from "./env.mjs";
import { explicitProjectPaths, repositoryPaths } from "./repository.mjs";

export const projectPaths = (dataRoot, env = process.env) => explicitProjectPaths(dataRoot, env);

export function requireUiTests(env = process.env, cwd = process.cwd()) {
  const explicit = fromEnv(env, "UI_TESTS");
  if (explicit) return projectPaths(resolve(explicit), env);
  const repo = repositoryPaths(cwd, env) ?? (env.CLAUDE_PROJECT_DIR ? repositoryPaths(env.CLAUDE_PROJECT_DIR, env) : null);
  if (!repo) throw new Refused(`no Orbit project found from ${cwd}: run from a Git checkout or set ${varName("UI_TESTS")}=<dir>`);
  return repo;
}
