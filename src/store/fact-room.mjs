// One ROOM of facts inside the machine store, and the port over it: one file per
// fact, a state file beside them, and an append-only log of what the store
// noticed.
//
// The architecture facts were the first subject to need this and the runtime
// facts (src/runtime/) the second, and they differ in exactly two things -- where
// the room is and what a usable state file looks like -- so those are the two
// parameters and everything else is here once. Engineering, intelligence and
// knowledge keep their own stores: they journal, and a journal is a different
// damage rule.
//
// One file per FACT, and a separate file for the state. That is not filing
// preference, it is src/learn/lessons.mjs's rule applied to another subject: lose
// the smallest thing it is safe to lose. A single model.json holding everything
// means one torn byte costs every fact the project knows, and a lock on every
// write because two scans would meet in one file. One file per fact means two
// writers never meet, an unreadable one costs exactly one fact, and the rest of
// the snapshot survives to say so.
//
// `facts/` is what a person opens. `state/` is bookkeeping -- which commit the
// last scan saw, what each scope hashed to then -- and is never projected
// anywhere.
import { Refused } from "../errors.mjs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.mjs";
import { withLock } from "./lock.mjs";

// `paths` is { facts, state, model, findings }; `empty(now)` is a fresh state and
// `usable(raw)` says { model, why } of one read from disk.
export function createFactRoom({ paths, io, empty, usable }) {
  const c = { paths, io, empty, usable };
  return { paths, host: io.host, ...factApi(c), ...stateApi(c), ...logApi(c) };
}

const factApi = (c) => ({
  all: () => allFacts(c),
  find: (id) => allFacts(c).find((f) => f.id === id) ?? null,
  save: (fact) => writeAtomic(factFile(c, fact.id), `${JSON.stringify(fact, null, 2)}\n`, c.io),
  remove: (id) => removeFact(c, id),
});

const factFile = (c, id) => join(c.paths.facts, `${id}.json`);

// Reading never creates. A project nobody has scanned leaves nothing behind.
function allFacts(c) {
  const files = c.io.list(c.paths.facts).filter((n) => n.endsWith(".json"));
  return files.map((n) => oneFact(c, n)).filter(Boolean);
}

// A fact this tool cannot read is REPORTED and left exactly as it is, never
// rewritten and never deleted: somebody working out what happened needs the
// broken file more than the store needs the space.
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
  emptyModel: (now) => c.empty(now),
});

// Answers WHY there is no model as well as WHETHER, because "nothing scanned
// this project yet" and "a file here was written by a version that is gone" send
// the reader somewhere completely different.
function readModel(c) {
  const text = c.io.read(c.paths.model);
  if (text === null) return { model: null, why: "nothing has scanned this project yet" };
  return judged(c, parsed(text));
}

function judged(c, raw) {
  const verdict = c.usable(raw);
  if (verdict.why) throw new Refused(`${c.paths.model}: ${verdict.why}; file unchanged`);
  return verdict;
}

// The first write has nothing to coordinate with -- there is no store yet, so
// there is no other writer inside it and no directory for a lock to live in.
// Every write after that takes the lock, because the model is read-modify-write:
// two scans that both read before either wrote would lose one scan's scopes.
function saveModel(c, model) {
  readModel(c);
  const text = `${JSON.stringify(model, null, 2)}\n`;
  if (!c.io.exists(c.paths.model)) return writeAtomic(c.paths.model, text, c.io);
  return withLock(c.paths.state, () => writeAtomic(c.paths.model, text, c.io), c.io);
}

const logApi = (c) => ({
  findings: () => readLines(c, c.paths.findings),
  addFinding: (f) => c.io.append(join(c.paths.findings, `${c.io.host}.jsonl`), `${JSON.stringify({ at: c.io.now(), host: c.io.host, ...f })}\n`),
});

// A machine-written line, torn: dropped, and the file survives. The opposite of
// the rule for a fact, and opposite on purpose -- what is safe to lose differs
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
