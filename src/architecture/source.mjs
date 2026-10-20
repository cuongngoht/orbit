// A stored declaration is not a Git file. Give it an explicit virtual scope
// so freshness can compare it without pretending it belongs in the checkout.
//
// A project nobody has configured yet (1.8.9: a checkout whose test data lives in
// the store, before anything was written there) declares nothing, and nothing is
// fingerprinted as the empty declaration: the day a project.json appears, the
// facts that cite it read as moved, which is exactly what happened.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../hash.mjs";

export const CONFIG_SCOPE = "orbit:project-config";

export function withStoredConfig(source, project) {
  if (project.layout !== 3) return source;
  const hash = sha(declared(join(project.dataRoot, "project.json")));
  return { ...source, fingerprints: (scopes) => fingerprinted(source, scopes, hash) };
}

const declared = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");

function fingerprinted(source, scopes, hash) {
  const ordinary = scopes.filter((s) => s !== CONFIG_SCOPE);
  const current = ordinary.length ? source.fingerprints(ordinary) : {};
  return { ...current, ...(scopes.includes(CONFIG_SCOPE) ? { [CONFIG_SCOPE]: { hash, files: 1, dirty: 0 } } : {}) };
}
