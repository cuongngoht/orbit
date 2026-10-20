// The MEMORY port: the run ledger and the notes, in the machine store
// (src/memory/store.mjs names the rooms, src/project/repository.mjs finds the root).
//
// The ledger is ONE FILE PER MACHINE -- `runs/<host>.jsonl`. Two testers never
// append to the same line, and reading merges every machine's file: that is what
// makes "passes on mine, fails on his" visible AT ALL, and it is the reason a
// store put on a shared or synced directory still behaves. test/fakes/memory.mjs
// implements the same names.
//
// The root arrives as a THUNK, not a string. Resolving the store touches the
// filesystem and can end in Blocked, and a command that only reads the DSL must
// not acquire a new way to fail; asking for the root at the first write keeps
// "reading never creates" true of the location as well as of the directory.
//
// Both doors scrub. Not because this is committed -- it no longer is -- but
// because a run carries a UPN, the rows SQL returned and the text of a page,
// none of which is the engine's to keep: a ledger line is projected into the
// host's MEMORY.md (src/projection/) and quoted in a report that gets mailed.
// src/scrub.mjs masks by shape, at the write.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { safeName } from "../project/paths.mjs";
import { scrubRecord } from "../scrub.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { realIo } from "../store/io.mjs";
import { withLock } from "../store/lock.mjs";
import { keep, memoryPaths } from "./store.mjs";
import { ACTIVE } from "./reserve.mjs";
import { formatNote, parseNote, slugOf } from "./note.mjs";
import { contained } from "../project/boundary.mjs";

export function createMemory(root, deps = {}) {
  const host = safeName(deps.host ?? hostname());
  const now = deps.now ?? (() => new Date().toISOString());
  const stamp = (o) => ({ at: now(), host, ...o });
  const at = (room, write = false) => memoryPaths(root(write))[room];
  return { root, host, ...ledger(at, host, stamp), ...notebook(at, stamp, deps.io ?? realIo()), ...evidence(at) };
}

const ledger = (at, host, stamp) => ({
  recordRun: (result) => append(at("runs", true), `${host}.jsonl`, stamp(scrubRecord(result))),
  runs: (limit = 500) => readRuns(at("runs")).slice(-limit),
});

const notebook = (at, stamp, io) => ({
  saveNote: (note) => save(at("notes", true), stamp(note), io),
  notes: () => readNotes(at("notes")),
});

// The blob room, and the only one that is thrown away. src/memory/store.mjs
// `keep` decides WHICH, purely; this does it.
const evidence = (at) => ({
  evidenceDir: () => at("evidence"),
  prune: (policy) => pruned(at("evidence"), policy),
});

function pruned(out, policy) {
  if (!existsSync(out)) return [];
  return withLock(out, () => removed(out, policy), realIo());
}

function removed(out, policy) {
  const dirs = readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const gone = keep(dirs, policy).prune.filter((d) => !existsSync(join(out, d, ACTIVE)));
  for (const d of gone) rmSync(join(out, d), { recursive: true, force: true });
  return gone;
}

// Created on the first WRITE, never on a read: a --dry run, a query, and a
// project nobody has run yet must not leave empty directories behind.
function append(out, file, record) {
  mkdirSync(out, { recursive: true });
  appendFileSync(contained(out, join(out, file)), JSON.stringify(record) + "\n");
  return join(out, file);
}

// Merged across machines and put back in time order, so the ledger reads as one
// history of the case rather than as N histories nobody can compare.
function readRuns(out) {
  if (!existsSync(out)) return [];
  const files = readdirSync(out).filter((n) => n.endsWith(".jsonl"));
  const all = files.flatMap((n) => lines(join(out, n)));
  return all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function lines(file) {
  const text = readFileSync(file, "utf8").trim();
  return text ? text.split("\n").filter(Boolean).map(parsed).filter(Boolean) : [];
}

// A line truncated by a machine going down mid-write loses that line, not the
// ledger.
const parsed = (line) => { try { return JSON.parse(line); } catch { return null; } };

function save(out, note, io) {
  const file = contained(out, join(out, `${slugOf(note)}.md`));
  return writeAtomic(file, formatNote(note), io);
}

function readNotes(out) {
  if (!existsSync(out)) return [];
  const files = readdirSync(out).filter((n) => n.endsWith(".md"));
  return files.map((n) => parseNote(readFileSync(join(out, n), "utf8"), n)).filter(Boolean);
}
