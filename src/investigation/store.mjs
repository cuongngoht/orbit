import { JOURNAL_SCHEMA } from "./vocab.mjs";
// WHERE an investigation lives: one room in the project's machine store, beside
// the lessons and the architecture, and never in a repository.
//
//   <store>/autonomous-qa/settings.json              what a PERSON approved
//   <store>/autonomous-qa/investigations/<id>/
//       journal.jsonl                                 append-only, every record
//       evidence/                                     screenshots, by action id
//       artifacts/<kind>/<sha256>.json                 written once, named by their digest (0.1.0)
//       artifacts/versions/<digest16>/<case>.json      a frozen case version, version.json beside it
//       activity/<execution>.jsonl                     a running test's progress, never the journal
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
//
// An ARTIFACT is the same promise for a document: written once, under the name of its own
// digest, so what a run was bound to can never change under it. The same bytes again are
// nothing; other bytes where a file already is are refused and the file is kept; a file whose
// bytes no longer match its name is never read. Nothing here goes through a link.
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { Refused } from "../errors.mjs";
import { canonicalJson, sha, short } from "../hash.mjs";
import { caseDigest } from "../dsl/digest.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { checkedId } from "../store/id.mjs";
import { FREE_TEXT, KINDS, PROGRESS_AUTHORITY, PROGRESS_KINDS, PROGRESS_LIMITS, PROGRESS_SCHEMA, TEXT_LIMIT } from "./vocab.mjs";

export const DIR = "autonomous-qa";
export const JOURNAL = "journal.jsonl";
export const ARTIFACTS = "artifacts";
export const ACTIVITY = "activity";
export const ID_SPEC = { type: "string", pattern: "^inv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$" };
export const EXECUTION_SPEC = { type: "string", pattern: "^exe-[a-z0-9-]{1,48}$" };

// What may be kept as an artifact, one row per kind -- a document a test was bound to, never
// anything a run could write back over.
export const ARTIFACT_KINDS = [
  { id: "bindings", doc: "the source bindings an obligation rests on" },
  { id: "obligations", doc: "a test obligation, one revision" },
  { id: "designs", doc: "a test design" },
  { id: "versions", doc: "a frozen case version and its sidecar" },
  { id: "results", doc: "what one execution came to" },
  { id: "dispatches", doc: "what one execution was dispatched with, its secrets by name only -- the request a late envelope is held to" },
  { id: "assessments", doc: "an assessment, frozen" },
  { id: "graphs", doc: "the system graph projection an obligation was derived from" },
  { id: "catalogs", doc: "the control catalog an assessment pinned" },
];

const ARTIFACT_KIND_IDS = ARTIFACT_KINDS.map((k) => k.id);
const DIGEST = /^[0-9a-f]{64}$/;
const CASE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export const investigationPaths = (root) => ({
  root: join(root, DIR),
  settings: join(root, DIR, "settings.json"),
  investigations: join(root, DIR, "investigations"),
  sessions: join(root, DIR, "sessions"),
  artifactsOf: (id) => join(root, DIR, "investigations", checkedId(id, ID_SPEC), ARTIFACTS),
});

export function createInvestigations(root, io) {
  const paths = investigationPaths(root);
  const dirOf = (id) => contained(paths.investigations, join(paths.investigations, checkedId(id, ID_SPEC)));
  const append = (id, kind, record) => appended(io, dirOf(id), kind, record);
  return { root, paths, dirOf, evidenceDir: (id) => join(dirOf(id), "evidence"), append, appendOnce: (id, kind, record) => onceAppended(io, dirOf(id), kind, record), read: (id) => readJournal(io, dirOf(id)), list: () => listed(io, paths), create: (meta) => created(io, paths, dirOf, meta), ...live(io, dirOf), ...artifacts(io, dirOf), ...progress(io, dirOf) };
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

// The identity of ONE event: what it is about, which attempt, and what it was made from. The
// same write replayed has the same id, and is then nothing (onceAppended).
export const eventIdOf = (kind, subject, attempt, inputs) => short([kind, subject ?? "", attempt ?? 0, sha(canonicalJson(inputs ?? null))].join("|"), 16);

// Called under the journal lock (src/investigation/act.mjs withJournal), like every append that
// must see the journal it adds to: an eventId already there is the same event, and nothing is
// written -- the record that is there is handed back, marked a duplicate.
function onceAppended(io, dir, kind, record) {
  if (typeof record?.eventId !== "string" || !record.eventId) throw new Refused(`a ${kind} recorded once needs its eventId (eventIdOf)`);
  const there = readJournal(io, dir).find((r) => r.eventId === record.eventId);
  return there ? { ...there, duplicate: true } : appended(io, dir, kind, record);
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

// ---- artifacts: written once, named by their digest ---------------------------------------------

// Called under the journal lock, like an append (src/investigation/index.mjs keepArtifact).
const artifacts = (io, dirOf) => ({
  artifactsDir: (id) => join(dirOf(id), ARTIFACTS),
  putArtifact: (id, kind, value) => artifactPut(io, dirOf(id), kind, value),
  readArtifact: (id, kind, digest) => artifactRead(io, dirOf(id), kind, digest),
  putVersion: (id, frozen) => versionPut(io, dirOf(id), frozen),
  readVersion: (id, path) => versionRead(io, dirOf(id), path),
});

function artifactPut(io, dir, kind, value) {
  const text = canonicalJson(value);
  const digest = sha(text);
  const file = artifactFile(io, dir, artifactKind(kind), `${digest}.json`);
  writtenOnce(io, file, text);
  return { kind, digest, path: `${ARTIFACTS}/${kind}/${digest}.json` };
}

function artifactRead(io, dir, kind, digest) {
  if (!DIGEST.test(String(digest))) throw new Refused(`"${String(digest).slice(0, 70)}" is not an artifact digest`);
  const text = io.read(artifactFile(io, dir, artifactKind(kind), `${digest}.json`));
  if (text === null) return null;
  if (sha(text) !== digest) throw new Refused(`${ARTIFACTS}/${kind}/${digest}.json no longer holds what its name says — it is kept as it is and never read`);
  return readable(text, `${ARTIFACTS}/${kind}/${digest}.json`);
}

const artifactKind = (kind) => {
  if (!ARTIFACT_KIND_IDS.includes(kind)) throw new Refused(`an investigation keeps no "${kind}" artifact — it keeps ${ARTIFACT_KIND_IDS.join(", ")}`);
  return kind;
};

// The file a name means, inside the room and through no link: every directory on the way from the
// investigation down, and the file itself, is asked what it is before anything is written or read.
function artifactFile(io, dir, ...parts) {
  const file = contained(join(dir, ARTIFACTS), join(dir, ARTIFACTS, ...parts));
  for (const p of chainOf(dir, file)) notLinked(io, p);
  return file;
}

const chainOf = (dir, file) => [dir, join(dir, ARTIFACTS), ...ancestorsBetween(join(dir, ARTIFACTS), file)];

const ancestorsBetween = (top, file) => (dirname(file) === top || dirname(file) === file ? [file] : [...ancestorsBetween(top, dirname(file)), file]);

function notLinked(io, p) {
  if (io.kind?.(p) === "symlink") throw new Refused(`${p} is a link — nothing in an investigation is read or written through a link`);
}

// The same bytes are nothing; other bytes where a file is are refused, and the file is kept.
function writtenOnce(io, file, text) {
  const there = io.read(file);
  if (there === text) return file;
  if (there !== null) throw new Refused(`${file} already holds other bytes — an artifact is written once, so it is kept as it is and nothing was written`);
  io.ensureDir(dirname(file));
  return writeAtomic(file, text, io, false);
}

// A frozen case version (src/qa/generation/version.mjs freezeVersion): the case AS WRITTEN, key
// order kept so its digest is the one a run records, under its own id; the sidecar beside it.
function versionPut(io, dir, frozen) {
  const [, d16, file] = versionPath(frozen.path);
  writtenOnce(io, artifactFile(io, dir, "versions", d16, file), `${JSON.stringify(frozen.case, null, 2)}\n`);
  writtenOnce(io, artifactFile(io, dir, "versions", d16, "version.json"), canonicalJson(frozen.version));
  return { path: `${ARTIFACTS}/${frozen.path}`, file: artifactFile(io, dir, "versions", d16, file) };
}

// A frozen case is read only while it is still the case it was frozen as: its digest is the
// sidecar's, and the directory it sits in is named by that digest.
function versionRead(io, dir, path) {
  const [, d16, file] = versionPath(path);
  const text = io.read(artifactFile(io, dir, "versions", d16, file));
  const sidecar = io.read(artifactFile(io, dir, "versions", d16, "version.json"));
  const where = artifactFile(io, dir, "versions", d16, file);
  return text === null || sidecar === null ? null : stillFrozen({ case: readable(text, where), version: readable(sidecar, where), file: where }, d16);
}

// A document that will not parse is somebody's damage, not a crash: refused, and kept as it is.
function readable(text, where) {
  try { return JSON.parse(text); }
  catch { throw new Refused(`${where} is not readable JSON — it is kept as it is and never run`); }
}

function stillFrozen(frozen, d16) {
  const digest = caseDigest(frozen.case);
  if (digest !== frozen.version.caseDigest || !digest.startsWith(d16)) throw new Refused(`${frozen.file} is no longer the case it was frozen as — it is kept as it is and never run`);
  return frozen;
}

function versionPath(path) {
  const parts = String(path ?? "").split("/");
  if (parts.length !== 3 || parts[0] !== "versions" || !/^[0-9a-f]{16}$/.test(parts[1]) || !CASE_FILE.test(parts[2]) || !parts[2].endsWith(".json")) throw new Refused(`"${String(path).slice(0, 80)}" is not a frozen version's path (versions/<digest16>/<case>.json)`);
  return parts;
}

// ---- a running test's progress: beside the journal, never in it ---------------------------------

const progress = (io, dirOf) => ({
  progressFile: (id, execution) => progressFileOf(io, dirOf(id), execution),
  appendProgress: (id, execution, kind, fields) => progressAppended(io, dirOf(id), execution, kind, fields),
  readProgress: (id, execution) => progressRead(io, dirOf(id), execution),
});

function progressFileOf(io, dir, execution) {
  const file = contained(join(dir, ACTIVITY), join(dir, ACTIVITY, `${checkedId(execution, EXECUTION_SPEC)}.jsonl`));
  for (const p of [dir, join(dir, ACTIVITY), file]) notLinked(io, p);
  return file;
}

const lineCount = (text) => (text ? text.split("\n").filter(Boolean).length : 0);

// One allow-listed line, numbered; past a bound the line is not written and the caller is told so
// -- a progress file can never grow past what a person's disk was promised.
function progressAppended(io, dir, execution, kind, fields) {
  if (!PROGRESS_KINDS[kind]) throw new Refused(`a running test's progress says no "${kind}" — it says ${Object.keys(PROGRESS_KINDS).join(", ")}`);
  const file = progressFileOf(io, dir, execution);
  const seq = lineCount(io.read(file));
  const line = `${JSON.stringify({ v: PROGRESS_SCHEMA, seq, at: io.now(), kind, authority: PROGRESS_AUTHORITY, execution, ...keptProgress(kind, fields) })}\n`;
  return overBounds(io, dir, seq, line) ? { written: false, seq, why: "bounds" } : progressWritten(io, file, line, seq);
}

function progressWritten(io, file, line, seq) {
  io.ensureDir(dirname(file));
  io.append(file, line);
  return { written: true, seq };
}

const keptProgress = (kind, fields) => scrubFields(Object.fromEntries(PROGRESS_KINDS[kind].filter((k) => scalarOk(fields?.[k])).map((k) => [k, clipped(fields[k])])), PROGRESS_KINDS[kind]);

const scalarOk = (v) => v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string";

const clipped = (v) => (typeof v === "string" && v.length > TEXT_LIMIT ? `${v.slice(0, TEXT_LIMIT - 1)}…` : v);

const overBounds = (io, dir, seq, line) => Buffer.byteLength(line) > PROGRESS_LIMITS.LINE_BYTES || seq >= PROGRESS_LIMITS.EXECUTION_LINES || roomBytes(io, join(dir, ACTIVITY)) + Buffer.byteLength(line) > PROGRESS_LIMITS.INVESTIGATION_BYTES;

const roomBytes = (io, room) => (io.exists(room) ? io.list(room).reduce((n, name) => n + (io.size(join(room, name)) ?? 0), 0) : 0);

function progressRead(io, dir, execution) {
  const text = io.read(progressFileOf(io, dir, execution));
  return text === null ? [] : text.split(/\r?\n/).filter(Boolean).map(journalLine).filter((l) => l && PROGRESS_KINDS[l.kind]);
}
