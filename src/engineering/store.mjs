// The ENGINEERING rooms inside the machine store, and the port over them.
//
// Where the store is at all is src/project/repository.mjs, shared with the lessons
// and the architecture facts -- what rooms it has is each subsystem's own
// business, and this file is that business for this subsystem. Same split as
// src/architecture/store.mjs, for the same reason: `facts/` is what a person
// opens, `state/` is bookkeeping and is never projected anywhere. One file per
// fact so two writers never meet and an unreadable one costs exactly one fact.
import { Refused } from "../errors.mjs";
import { join } from "node:path";
import { writeAtomic } from "../store/atomic.mjs";
import { withLock } from "../store/lock.mjs";
import { emptyModel, usableModel } from "./model.mjs";

export const DIR = "engineering";

export const engineeringPaths = (root) => ({
  root: join(root, DIR),
  facts: join(root, DIR, "facts"),
  state: join(root, DIR, "state"),
  model: join(root, DIR, "state", "model.json"),
  findings: join(root, DIR, "state", "findings"),
  observations: join(root, DIR, "observations"),
});

export function createEngineering(root, io) {
  const paths = engineeringPaths(root);
  const c = { paths, io };
  return { root, paths, host: io.host, ...factApi(c), ...stateApi(c), ...logApi(c), transact: (fn) => transact(c, fn) };
}

// Reconciliation reads a fact and writes it back, so two sessions reconciling
// at once must take turns. The lock lives in `state/`, beside the model it
// already guards; a store nobody has written yet has nothing to lock around.
function transact(c, fn) {
  c.io.ensureDir(c.paths.state);
  return withLock(c.paths.state, fn, c.io);
}

const factApi = (c) => ({
  all: () => allFacts(c),
  find: (id) => allFacts(c).find((f) => f.id === id) ?? null,
  save: (fact) => writeAtomic(factFile(c, fact.id), `${JSON.stringify(fact, null, 2)}\n`, c.io),
  // The one write that is NOT reconciliation: freshness re-measured, and only
  // `status` moves. Everything a person or an observer decided stays byte for
  // byte what it was -- src/engineering/freshen.mjs is its only caller.
  restamp: (fact, status) => writeAtomic(factFile(c, fact.id), `${JSON.stringify({ ...fact, status }, null, 2)}\n`, c.io),
  remove: (id) => removeFact(c, id),
});

const factFile = (c, id) => join(c.paths.facts, `${id}.json`);

// Reading never creates. A project nobody has analysed yet leaves nothing
// behind.
function allFacts(c) {
  const files = c.io.list(c.paths.facts).filter((n) => n.endsWith(".json"));
  return files.map((n) => oneFact(c, n)).filter(Boolean);
}

// A fact this tool cannot read is REPORTED and left exactly as it is, never
// rewritten and never deleted -- src/architecture/store.mjs's same rule.
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
  setModelLocked: (m) => checkedWrite(c, m),
  emptyModel: (now) => emptyModel(now),
});

// Answers WHY there is no model as well as WHETHER, because "nothing analysed
// yet" and "a file here was written by a version that is gone" send the reader
// somewhere completely different.
function readModel(c) {
  const text = c.io.read(c.paths.model);
  if (text === null) return { model: null, why: "nothing has analysed this project's engineering yet" };
  return judged(c, parsed(text));
}

function judged(c, raw) {
  const verdict = usableModel(raw);
  if (verdict.why) throw new Refused(`${c.paths.model}: ${verdict.why}; file unchanged`);
  return verdict;
}

// The first write has nothing to coordinate with. Every write after that takes
// the lock, because the model is read-modify-write -- src/architecture/store.mjs's
// same reasoning.
function saveModel(c, m) {
  readModel(c);
  const text = `${JSON.stringify(m, null, 2)}\n`;
  if (!c.io.exists(c.paths.model)) return writeAtomic(c.paths.model, text, c.io);
  return withLock(c.paths.state, () => writeAtomic(c.paths.model, text, c.io), c.io);
}

// `observations/` is the JOURNAL: one line per candidate reconciliation ever
// made, appended before the fact is saved and never rewritten. A fact file is
// what it all MEANS now; the journal is why -- which sessions, in what order,
// with what evidence -- and `engineering replay` re-derives every fact from it
// to prove the two still agree. Sharded per host like the findings, so a
// shared store never has two machines appending to one file.
const logApi = (c) => ({
  observations: () => readLines(c, c.paths.observations),
  journal: (line) => journaled(c, line),
  findings: () => readLines(c, c.paths.findings),
  addFinding: (f) => c.io.append(join(c.paths.findings, `${c.io.host}.jsonl`), `${JSON.stringify({ at: c.io.now(), host: c.io.host, ...f })}\n`),
});

// A machine-written line, torn: dropped, and the file survives -- the opposite
// rule from a fact, and opposite on purpose: what is safe to lose differs
// because the data differs.
function readLines(c, dir) {
  const files = c.io.list(dir).filter((n) => n.endsWith(".jsonl"));
  return files.flatMap((n) => String(c.io.read(join(dir, n)) ?? "").split("\n").filter(Boolean).map(parsed).filter(Boolean));
}

function parsed(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function journaled(c, line) {
  c.io.append(join(c.paths.observations, `${c.io.host}.jsonl`), `${JSON.stringify(line)}\n`);
}

function checkedWrite(c, model) {
  readModel(c);
  return writeAtomic(c.paths.model, `${JSON.stringify(model, null, 2)}\n`, c.io);
}
