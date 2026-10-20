// A new project's test data written into the CHECKOUT (ui-tests/, the copy a team commits) -- since 1.8.9 a
// person's explicit choice (`init --in-checkout`), never the default, which seats the project in the store
// (src/seat.mjs). The store gets its binding, a stamp saying the checkout is the home from now on
// (src/project/data-home.mjs, so the choice survives a branch that lacks the tree), and, from the caller, the mirror.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { DATA_DIR } from "../project/data-home.mjs";
import { repositoryPaths } from "../project/repository.mjs";
import { machineContext } from "./context.mjs";
import { realIo } from "./io.mjs";
import { withLock } from "./lock.mjs";
import { restamp } from "./repository.mjs";

export function initialize(root, env, opts) {
  if (existsSync(join(root, DATA_DIR, "project.json")) || existsSync(join(root, DATA_DIR, "graph"))) throw new Refused("ui-tests already exists — nothing moved or written");
  const project = repositoryPaths(root, env, opts.projectId);
  if (!project) throw new Refused("init needs a Git checkout");
  const machine = machineContext({ project, config: {} }, env);
  return initialized(project, machine, { ...opts, env });
}

// -> the project as it resolves afterwards: its test data in the checkout.
function initialized(project, machine, opts) {
  const target = contained(project.root, join(project.root, DATA_DIR));
  machine.prepare();
  withLock(project.storeRoot, () => scaffold(target, checkoutIo(target), opts), machine.io);
  restamp(project.storeRoot, { dataHome: "checkout" }, machine.io);
  return repositoryPaths(project.root, opts.env, opts.projectId);
}

const checkoutIo = (root) => ({ ...realIo(), write: (path, body) => realIo().write(contained(root, path), body) });

function scaffold(target, io, opts) {
  if (io.exists(join(target, "project.json"))) return;
  const files = { ...templateFiles(opts.templates), ...opts.generated };
  for (const [name, body] of Object.entries(files).filter(([name]) => name !== "project.json")) io.write(join(target, name), body);
  io.write(join(target, "project.json"), files["project.json"].replace("https://CHANGE-ME.example.com", opts.origin));
}

function templateFiles(dir, prefix = "") {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap((entry) => templateEntry(dir, prefix, entry)));
}

function templateEntry(dir, prefix, entry) {
  const name = join(prefix, entry.name);
  const path = join(dir, entry.name);
  if (entry.isSymbolicLink()) throw new Refused(`template symlink refused: ${path}`);
  if (entry.isDirectory()) return Object.entries(templateFiles(path, name));
  return [[name, readFileSync(path, "utf8")]];
}
