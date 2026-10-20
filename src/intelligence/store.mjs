// The INTELLIGENCE room inside the machine store, and the port over it.
//
// src/architecture/store.mjs's layout and damage rule, over a third subject: one
// file per fact (a torn byte costs one fact, and two writers never meet in one
// file), and the scan's bookkeeping in `state/`, which is never a fact and never
// shown as one. Nothing here is ever written into a repository.
//
// `descriptors/` is the one directory a PERSON writes into: a project's own
// technology descriptors, as JSON -- the company SDK nobody else has heard of --
// read by src/intelligence/descriptors.mjs and registered after the built-ins.
import { join } from "node:path";
import { writeAtomic } from "../store/atomic.mjs";
import { withLock } from "../store/lock.mjs";
import { emptyModel, usableModel } from "./model.mjs";

export const DIR = "intelligence";

export const intelligencePaths = (root) => ({
  root: join(root, DIR),
  facts: join(root, DIR, "facts"),
  state: join(root, DIR, "state"),
  model: join(root, DIR, "state", "model.json"),
  descriptors: join(root, DIR, "descriptors"),
});

export function createIntelligence(root, io) {
  const paths = intelligencePaths(root);
  const c = { paths, io };
  return { root, paths, host: io.host, ...factApi(c), ...stateApi(c), descriptorFiles: () => descriptorFiles(c) };
}

const factApi = (c) => ({
  all: () => allFacts(c),
  find: (id) => allFacts(c).find((f) => f.id === id) ?? null,
  save: (fact) => writeAtomic(factFile(c, fact.id), `${JSON.stringify(fact, null, 2)}\n`, c.io),
  remove: (id) => removeFact(c, id),
});

const factFile = (c, id) => join(c.paths.facts, `${id}.json`);

function allFacts(c) {
  const files = c.io.list(c.paths.facts).filter((n) => n.endsWith(".json"));
  return files.map((n) => oneFact(c, n)).filter(Boolean);
}

function oneFact(c, name) {
  const fact = parsed(c.io.read(join(c.paths.facts, name)));
  if (!fact) c.io.note({ kind: "unreadable-fact", say: `${name} is not in the shape this tool writes — it is left exactly as it is, and nothing here reads it` });
  return fact;
}

function removeFact(c, id) {
  const file = factFile(c, id);
  if (!c.io.exists(file)) return false;
  c.io.removeFile(file);
  return true;
}

const stateApi = (c) => ({
  model: () => readModel(c),
  setModel: (m) => saveModel(c, m),
  emptyModel: (now) => emptyModel(now),
});

function readModel(c) {
  const text = c.io.read(c.paths.model);
  if (text === null) return { model: null, why: "nothing has scanned this project yet" };
  const verdict = usableModel(parsed(text));
  if (verdict.why) c.io.note({ kind: "unreadable-state", say: `${c.paths.model}: ${verdict.why} — it is left where it is, and the next scan starts from nothing` });
  return verdict;
}

function saveModel(c, model) {
  const text = `${JSON.stringify(model, null, 2)}\n`;
  if (!c.io.exists(c.paths.model)) return writeAtomic(c.paths.model, text, c.io);
  return withLock(c.paths.state, () => writeAtomic(c.paths.model, text, c.io), c.io);
}

// Every descriptor file a person left here, raw. Judging them is the
// registry's job; this only says what is on disk.
function descriptorFiles(c) {
  const names = c.io.list(c.paths.descriptors).filter((n) => n.endsWith(".json")).sort();
  return names.map((name) => ({ name, text: c.io.read(join(c.paths.descriptors, name)) }));
}

function parsed(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
