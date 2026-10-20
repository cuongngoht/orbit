import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Blocked, Refused } from "../errors.mjs";
import { storePath } from "./guard.mjs";
import { writeAtomic } from "./atomic.mjs";
import { withLock } from "./lock.mjs";
import { STORE_FILE } from "../project/paths.mjs";

export function repositoryStore(project) {
  const root = storePath(project.storeBase, project.storeRoot);
  checkLayout(root);
  return { root, key: project.storeKey, layout: 3, source: project.storeSource, why: "repository identity, shared by its checkouts", considered: [], project };
}

function checkLayout(root) {
  const file = storePath(root, join(root, "store.json"));
  if (!existsSync(file)) return;
  try { if (currentStamp(JSON.parse(readFileSync(file, "utf8")))) return; }
  catch { throw new Refused(`cannot read store layout at ${file}`); }
  throw new Refused(`unsupported store layout at ${file}; no automatic migration`);
}

export function prepareRepository(store, io) {
  writableStore(store);
  const project = store.project;
  if (project.dataHome === "explicit") return;
  return prepareBinding(project, io);
}

function prepareBinding(project, io) {
  const file = storePath(project.storeBase, project.bindingFile);
  io.ensureDir(dirname(file));
  return withLock(dirname(file), () => saveBinding(project, file, io), io);
}

function saveBinding(project, file, io) {
  if (io.exists(file)) return;
  return writeAtomic(file, `${JSON.stringify({ key: project.storeKey, root: project.root })}\n`, io, false);
}

function writableStore(store) {
  let at = store.root;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  try { checkWritable(at); }
  catch { throw new (store.source === "home" ? Blocked : Refused)(`${store.root} cannot be written to`); }
}

function checkWritable(path) {
  if (!statSync(path).isDirectory()) throw new Error("not a directory");
  accessSync(path, constants.W_OK);
}

// A PERSON's decision of where this project's test data lives (src/project/data-home.mjs) -- an import, an export
// that moves it, `init --in-checkout` -- written into store.json beside what the store already says about itself:
// the one rewrite of that file, under the store's lock, every other key kept. Only a prepared store is restamped
// (a context's prepare() stamps it first), so a decision can never invent a layout or erase one.
export function restamp(storeRoot, patch, io) {
  const file = storePath(storeRoot, join(storeRoot, STORE_FILE));
  return withLock(storeRoot, () => writeAtomic(file, `${JSON.stringify({ ...stampOf(file, io), ...patch, at: io.now() }, null, 2)}\n`, io, false), io);
}

function stampOf(file, io) {
  const was = parsedOrNull(io.read(file));
  if (was?.layout !== 3) throw new Refused(`cannot read store layout at ${file} — nothing changed`);
  return was;
}

function parsedOrNull(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

const currentStamp = (doc) => doc?.layout === 3 && Object.keys(doc).every((k) => ["layout", "key", "at", "dataHome"].includes(k));
