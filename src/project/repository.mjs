// Repository identity and layout 3 paths, shared by every checkout of a project.
// The selected data home is read directly; churn and evidence stay in the machine store.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { sha } from "../hash.mjs";
import { Refused } from "../errors.mjs";
import { fromEnv } from "./env.mjs";
import { HOME_DIR, safeName } from "./paths.mjs";
import { contained, outsideRepositories, physical, repositoryAt } from "./boundary.mjs";
import { treePaths } from "./locate-tree.mjs";
import { dataHomeOf, dataRootOf } from "./data-home.mjs";

export function gitValue(root, args, exec = execFileSync) {
  try { return exec("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

export function remoteIdentity(remote, root) {
  const url = remote.replace(/^([^/@:]+@)?([^/:]+):(?=[^/])/, "ssh://$2/");
  if (!url.includes("://")) return `local:${physical(resolve(root, remote))}`;
  const parsed = new URL(url);
  return `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}/${parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "")}`;
}

export function storeBase(env = process.env) {
  const explicit = fromEnv(env, "STORE_DIR");
  return outsideWorkingTrees(resolve(explicit || join(homedir(), HOME_DIR, "projects")));
}

// The store path is validated once because
// the mistake is the same one: a store typed into a checkout is refused, never
// quietly moved somewhere a person will not look for it.
function outsideWorkingTrees(path) {
  const repo = repositoryAt(path);
  if (repo) throw new Refused(`${path} is inside the repository at ${repo} — the store never goes in a working tree, not even somewhere gitignored`);
  return path;
}

export function repositoryPaths(cwd, env = process.env, projectId = null) {
  const root = gitValue(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const base = storeBase(env);
  return boundPaths(physical(root), base, projectId, env);
}

// WHICH checkout this is, as distinct from which PROJECT: the hash of its real
// path. It is the name of the checkout's binding file and the folder its
// sessions keep, and the runtime subject (src/runtime/) keys everything that
// can differ between two checkouts of one repository -- a branch, a manifest,
// a port -- by it. Defined once, here, so those three can never be spelled
// two ways.
export const checkoutId = (root) => sha(root);

// WHERE a project's store is, from its key alone: inside the store base, never in a
// repository. Defined once and asked by paths() below, so the machine-wide task view and
// Orbit Control -- which know a project only by the registry's key, and must not run git or
// need the checkout's folder to find its store -- cannot spell it a second way.
export const projectStoreRoot = (base, key) => outsideRepositories(contained(base, join(base, key)));

const bindingFileOf = (base, root) => contained(base, join(base, "state", "checkouts", `${checkoutId(root)}.json`));

function boundPaths(root, base, projectId, env) {
  const bindingFile = bindingFileOf(base, root);
  const known = binding(bindingFile);
  const key = known?.key ?? `repo-${sha(identity(root, projectId))}`;
  if (projectId && known && known.key !== `repo-${sha(`id:${projectId}`)}`) throw new Refused("this checkout is already bound to another project; nothing changed");
  return paths(root, base, key, bindingFile, env);
}

function binding(file) {
  if (!existsSync(file)) return null;
  try { return checkedBinding(JSON.parse(readFileSync(file, "utf8"))); }
  catch { throw new Refused(`invalid checkout binding at ${file}`); }
}

function checkedBinding(record) {
  if (!/^repo-[a-f0-9]{64}$/.test(record?.key)) throw new Refused("invalid repository key");
  return record;
}

function identity(root, projectId) {
  if (projectId) return `id:${projectId}`;
  const remote = gitValue(root, ["remote", "get-url", "origin"]);
  if (remote) return `remote:${remoteIdentity(remote, root)}`;
  return `git:${physical(resolve(root, gitValue(root, ["rev-parse", "--git-common-dir"]) || ".git"))}`;
}

function paths(root, base, key, bindingFile, env) {
  const storeRoot = projectStoreRoot(base, key);
  const home = homeOf(root, storeRoot);
  const runtime = contained(storeRoot, join(storeRoot, "runtime", safeName(hostname())));
  return { root, repoRoot: root, ...home, uiTests: home.dataRoot, ...treePaths(home.dataRoot), storeRoot, storeBase: base, storeKey: key, checkoutId: checkoutId(root), bindingFile, layout: 3, runtime, sessionDir: join(runtime, "sessions", checkoutId(root).slice(0, 16)), reportsDir: join(storeRoot, "reports"), storeSource: sourceOf(env) };
}

// -> { dataHome, dataHomeBy, checkoutDataRoot, dataRoot }
const homeOf = (root, storeRoot) => ((d) => ({ ...d, dataRoot: dataRootOf(root, storeRoot, d.dataHome) }))(dataHomeOf(root, storeRoot));

const sourceOf = (env) => (fromEnv(env, "STORE_DIR") ? "env" : "home");

// Whether the machine KNOWS this checkout: a person used Orbit here (`/orbit-help`, `init`, a workflow, `track`), which
// left its binding (state/checkouts/<id>.json). The plugin's hooks observe only a known checkout, so opening some
// repository with a host that has the plugin enabled writes nothing about it. A checkout that commits its test data
// opted in by committing it, and a loose ui-tests/ directory was pointed at on purpose: both are known as they are.
export const knownCheckout = (p) => Boolean(p) && (p.dataHome === "explicit" || p.dataHome === "checkout" || existsSync(p.bindingFile));

// An explicitly named data directory is a current Orbit project too. Its identity
// is the directory itself, independent of application names and deployment URLs.
export function explicitProjectPaths(dataRoot, env = process.env) {
  const root = physical(resolve(dataRoot, ".."));
  const base = storeBase(env);
  const key = `repo-${sha(`directory:${physical(dataRoot)}`)}`;
  return { ...paths(root, base, key, bindingFileOf(base, root), env), dataRoot, uiTests: dataRoot, dataHome: "explicit", dataHomeBy: "explicit", ...treePaths(dataRoot) };
}
