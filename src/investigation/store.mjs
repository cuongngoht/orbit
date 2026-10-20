import { JOURNAL_SCHEMA } from "./vocab.mjs";
// WHERE an investigation lives: one room in the project's machine store, beside
// the lessons and the architecture, and never in a repository.
//
//   <store>/autonomous-qa/settings.json              what a PERSON approved
//   <store>/autonomous-qa/investigations/<id>/
//       journal.jsonl                                 append-only, every record
//       evidence/                                     screenshots, by action id
//   <store>/autonomous-qa/sessions/<session>/.lock    one driver per browser
//
// The journal is APPEND-ONLY and that is the whole guarantee "a later attempt
// that passed does not overwrite the one that failed" rests on: a reproduction
// is a new record beside the original, a finding re-derived is a new record
// that `supersedes` the old one, and every view is a fold over the file
// (src/investigation/model.mjs). Nothing here rewrites or deletes a line, and
// nothing here prunes evidence -- retention of an investigation is a person's
// act, not the engine's.
//
// Every record passes KINDS (an allow-list per kind) and the scrub on the way
// in, so a field nobody declared, or a token somebody pasted into an
// objective, never reaches the disk.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { checkedId } from "../store/id.mjs";
import { FREE_TEXT, KINDS } from "./vocab.mjs";

export const DIR = "autonomous-qa";
export const JOURNAL = "journal.jsonl";
export const ID_SPEC = { type: "string", pattern: "^inv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$" };

export const investigationPaths = (root) => ({
  root: join(root, DIR),
  settings: join(root, DIR, "settings.json"),
  investigations: join(root, DIR, "investigations"),
  sessions: join(root, DIR, "sessions"),
});

export function createInvestigations(root, io) {
  const paths = investigationPaths(root);
  const dirOf = (id) => contained(paths.investigations, join(paths.investigations, checkedId(id, ID_SPEC)));
  const append = (id, kind, record) => appended(io, dirOf(id), kind, record);
  return { root, paths, dirOf, evidenceDir: (id) => join(dirOf(id), "evidence"), append, read: (id) => readJournal(io, dirOf(id)), list: () => listed(io, paths), create: (meta) => created(io, paths, dirOf, meta), ...live(io, dirOf) };
}

// What a live page asks of a journal without reading it whole: whether it is there, where it is (for
// a follower, src/store/follow.mjs), and its FIRST record -- which task a sandbox investigation was
// begun against is written there, and discovery asks it of many journals.
const live = (io, dirOf) => ({ exists: (id) => io.exists(join(dirOf(id), JOURNAL)), journalFile: (id) => join(dirOf(id), JOURNAL), head: (id) => headOf(io, join(dirOf(id), JOURNAL)) });

export const HEAD_BYTES = 8192;

// The first line from a small window; a first line longer than the window (a long scope) is read
// from the whole file rather than guessed at.
function headOf(io, file) {
  const got = io.readFrom(file, 0, HEAD_BYTES);
  if (got === null) return null;
  const text = got.buffer.includes(0x0a) || got.next >= got.size ? got.buffer.toString("utf8") : io.read(file);
  return text.includes("\n") ? journalLine(text.slice(0, text.indexOf("\n"))) : null;
}

// An id a person can read and sort: when it began, and four random hex so two
// started in the same second never share a directory.
export const newId = (nowIso, rand = () => randomBytes(2).toString("hex")) => `inv-${nowIso.slice(0, 10).replaceAll("-", "")}-${nowIso.slice(11, 19).replaceAll(":", "")}-${rand()}`;

// A salt of its own, so fingerprints inside it compare and outside it mean
// nothing (src/network/fingerprint.mjs).
export const newSalt = () => randomBytes(16).toString("hex");

function created(io, paths, dirOf, meta) {
  const id = creationId(meta, io);
  if (io.exists(join(dirOf(id), JOURNAL))) throw new Refused(`investigation ${id} already exists`);
  io.ensureDir(join(dirOf(id), "evidence"));
  appended(io, dirOf(id), "created", { salt: newSalt(), ...meta, id, schema: JOURNAL_SCHEMA });
  return id;
}

function appended(io, dir, kind, record) {
  if (!KINDS[kind]) throw new Refused(`an investigation keeps no "${kind}" record — it keeps ${Object.keys(KINDS).join(", ")}`);
  const kept = scrubFields(Object.fromEntries(KINDS[kind].filter((k) => record[k] !== undefined).map((k) => [k, record[k]])), FREE_TEXT);
  io.append(join(dir, JOURNAL), `${tornTail(io, join(dir, JOURNAL))}${JSON.stringify({ at: record.at ?? io.now(), ...kept, kind })}\n`);
  return { kind, ...kept };
}

// A process killed mid-append leaves a line with no end. Appending straight
// after it would glue the next record onto the fragment, and the tolerant
// reader below would then drop BOTH -- the first record after a crash, lost
// without a word. So a torn tail is ended first: the fragment stays unreadable,
// and everything after it survives.
function tornTail(io, file) {
  const text = io.read(file);
  return text && !text.endsWith("\n") ? "\n" : "";
}

// A torn last line (a process killed mid-append) is dropped, never fatal: the
// journal is read by a tolerant reader, like the trail's.
function readJournal(io, dir) {
  const text = io.read(join(dir, JOURNAL));
  if (text === null) throw new Refused(`no investigation at ${dir}`);
  return text.split(/\r?\n/).filter(Boolean).map(journalLine).filter(Boolean);
}

// The ONE reading of a journal line, shared with a live follower so both number lines alike.
export const journalLine = (line) => parsedLine(line) || null;

function parsedLine(line) {
  try { return JSON.parse(line); }
  catch { return null; }
}

function listed(io, paths) {
  return io.list(paths.investigations).filter((id) => new RegExp(ID_SPEC.pattern).test(id)).sort().reverse();
}

function creationId(meta, io) {
  if (meta.schema !== undefined && meta.schema !== JOURNAL_SCHEMA) throw new Refused("unsupported investigation schema");
  return meta.id ?? newId(io.now());
}
