// The composition root's view of the project: paths and config, resolved once.
import { affinityPaths } from "./affinity.mjs";
import { requireUiTests } from "./locate.mjs";
import { loadConfig } from "./config.mjs";

export function loadProject(env = process.env, cwd = process.cwd()) {
  const paths = affinityPaths(requireUiTests(env, cwd), env);
  return { ...paths, config: loadConfig(paths, env) };
}
