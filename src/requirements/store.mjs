// WHERE requirements live: one room per requirement set in the project's machine store,
// beside the knowledge, the sources and the investigations -- and never in a repository.
//
//   <store>/requirements/<root>/
//       journal.jsonl        append-only: every recorded fact, question, answer and
//                            snapshot, in order. Written BEFORE the file it describes,
//                            so a crash between the two is explained by the journal
//       facts/<id>.json      the standing version of a slot
//       facts/<id>@<n>.json  every version it replaced, kept -- history explains itself
//       questions/<id>.json  what is asked, and where it stands
//       decisions/<id>.json  what a person decided; written once
//       snapshots/<id>.json  a frozen state; written once
//       state.json           which revisions of which sources the facts were read
//                            against -- bookkeeping, never a fact
//       findings/<host>.jsonl  what reconciliation noticed
//       .lock                one writer at a time
//
// Every rule the other rooms keep is kept here: reading never creates, a document from a
// newer format is refused rather than overwritten, a corrupt one is copied aside, a field
// nobody declared never reaches the disk, and every id is checked before it is a path.
//
// A version that was superseded, a decision and a snapshot are WRITTEN ONCE: writing the
// same thing again is a no-op (a replay after a crash does exactly that), writing
// something different is refused. Provenance that could be rewritten would explain nothing.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { readState, writeState } from "../store/control.mjs";
import { checkedId } from "../store/id.mjs";
import { withLock } from "../store/lock.mjs";
import { DECISION_VERSION, FACT_VERSION, QUESTION_VERSION, SNAPSHOT_VERSION } from "./model.mjs";
import { FREE_TEXT, KINDS } from "./vocab.mjs";

export const DIR = "requirements";
export const STATE_SCHEMA = 1;
export const JOURNAL_VERSION = 1;

export const ROOT_SPEC = { type: "string", pattern: "^req-[0-9a-f]{12}$" };
const FACT_ID = { type: "string", pattern: "^rf-[0-9a-f]{12}$" };
const QUESTION_ID = { type: "string", pattern: "^rq-[0-9a-f]{12}$" };
const DECISION_ID = { type: "string", pattern: "^rd-[0-9a-f]{12}$" };
const SNAPSHOT_ID = { type: "string", pattern: "^rs-[0-9a-f]{12}$" };

export const EMPTY_STATE = { sources: {}, position: 0, lastSnapshot: null };

const BUSY = "another session is writing this requirement's facts — try again in a moment";

export const requirementPaths = (root) => ({ root: join(root, DIR) });

export function roomPaths(paths, id) {
  const dir = contained(paths.root, join(paths.root, checkedId(id, ROOT_SPEC)));
  return { dir, journal: join(dir, "journal.jsonl"), facts: join(dir, "facts"), questions: join(dir, "questions"), decisions: join(dir, "decisions"), snapshots: join(dir, "snapshots"), findings: join(dir, "findings"), state: join(dir, "state.json") };
}

export function createRequirements(root, io) {
  const paths = requirementPaths(root);
  return { root, paths, host: io.host, roots: () => io.list(paths.root).filter((n) => new RegExp(ROOT_SPEC.pattern).test(n)).sort(), open: (id) => openRoom(io, paths, id) };
}

// One requirement set's port. Nothing is created by opening it: only the writers below do.
function openRoom(io, paths, id) {
  const c = { io, id, p: roomPaths(paths, id), cache: null };
  return { id, paths: c.p, host: io.host, ...factApi(c), ...questionApi(c), ...decisionApi(c), ...snapshotApi(c), ...stateApi(c), ...journalApi(c), ...findingApi(c), transact: (fn) => transact(c, fn) };
}

// ---- documents -----------------------------------------------------------------------

const parsed = (text) => {
  try { return text ? JSON.parse(text) : undefined; }
  catch { return undefined; }
};

const names = (c, dir) => c.io.list(dir).filter((n) => n.endsWith(".json")).sort();

// A document this engine cannot read -- torn, or written in a format it does not know --
// is REPORTED and left exactly as it is, never rewritten or deleted.
function readDoc(c, file, version, report) {
  const doc = parsed(c.io.read(file));
  const usable = doc && doc.v === version ? doc : null;
  if (!usable && report && c.io.exists(file)) c.io.note({ kind: "unreadable-requirement", say: `${file} is not a document this engine can read — it is left exactly as it is` });
  return usable;
}

// A newer format is never overwritten by an older engine; a corrupt file is set aside
// before anything replaces it.
function writeDoc(c, file, doc, version) {
  const current = c.io.read(file);
  const known = parsed(current);
  if (known?.v > version) throw new Refused(`${file} was written by a newer Orbit (format ${known.v}); upgrade the plugin before changing it here`);
  if (current !== null && known === undefined) c.io.copy(file, `${file}.corrupt-${c.io.nowMs()}`);
  return writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`, c.io, false);
}

// Once: the same document again is nothing, a different one is refused.
function writeOnce(c, file, doc, version, what) {
  const known = readDoc(c, file, version, false);
  if (known && JSON.stringify(known) === JSON.stringify(doc)) return file;
  if (known || c.io.exists(file)) throw new Refused(`${what} is written once, and ${file} already holds something else`);
  return writeDoc(c, file, doc, version);
}

const inside = (dir, file) => contained(dir, join(dir, file));

// ---- facts ---------------------------------------------------------------------------

const factFile = (c, id) => inside(c.p.facts, `${checkedId(id, FACT_ID)}.json`);
const versionFile = (c, id, n) => inside(c.p.facts, `${checkedId(id, FACT_ID)}@${Number(n)}.json`);

const factApi = (c) => ({
  facts: () => names(c, c.p.facts).filter((n) => !n.includes("@")).map((n) => readDoc(c, join(c.p.facts, n), FACT_VERSION, true)).filter(Boolean),
  fact: (id) => readDoc(c, factFile(c, id), FACT_VERSION, false),
  versions: (id) => names(c, c.p.facts).filter((n) => n.startsWith(`${checkedId(id, FACT_ID)}@`)).map((n) => readDoc(c, join(c.p.facts, n), FACT_VERSION, true)).filter(Boolean).sort((a, b) => a.revision - b.revision),
  saveFact: (fact) => writeDoc(c, factFile(c, fact.id), fact, FACT_VERSION),
  keepAside: (fact) => writeOnce(c, versionFile(c, fact.id, fact.revision), fact, FACT_VERSION, "a superseded version"),
});

// ---- questions, decisions, snapshots ---------------------------------------------------

const questionFile = (c, id) => inside(c.p.questions, `${checkedId(id, QUESTION_ID)}.json`);
const decisionFile = (c, id) => inside(c.p.decisions, `${checkedId(id, DECISION_ID)}.json`);
const snapshotFile = (c, id) => inside(c.p.snapshots, `${checkedId(id, SNAPSHOT_ID)}.json`);

const questionApi = (c) => ({
  questions: () => names(c, c.p.questions).map((n) => readDoc(c, join(c.p.questions, n), QUESTION_VERSION, true)).filter(Boolean),
  question: (id) => readDoc(c, questionFile(c, id), QUESTION_VERSION, false),
  saveQuestion: (q) => writeDoc(c, questionFile(c, q.id), q, QUESTION_VERSION),
});

const decisionApi = (c) => ({
  decisions: () => names(c, c.p.decisions).map((n) => readDoc(c, join(c.p.decisions, n), DECISION_VERSION, true)).filter(Boolean),
  decision: (id) => readDoc(c, decisionFile(c, id), DECISION_VERSION, false),
  saveDecision: (d) => writeOnce(c, decisionFile(c, d.id), d, DECISION_VERSION, "a decision"),
});

const snapshotApi = (c) => ({
  snapshots: () => names(c, c.p.snapshots).map((n) => readDoc(c, join(c.p.snapshots, n), SNAPSHOT_VERSION, true)).filter(Boolean),
  snapshot: (id) => readDoc(c, snapshotFile(c, id), SNAPSHOT_VERSION, false),
  saveSnapshot: (s) => writeOnce(c, snapshotFile(c, s.id), s, SNAPSHOT_VERSION, "a snapshot"),
});

// ---- state ---------------------------------------------------------------------------

const stateApi = (c) => ({
  state: () => readState(c.io, c.p.state, EMPTY_STATE, STATE_SCHEMA),
  setState: (doc) => writeState(c.io, c.p.state, doc, STATE_SCHEMA),
});

// ---- the journal -----------------------------------------------------------------------

// A process killed mid-append leaves a line with no end. Appending straight after it
// would glue the next record onto the fragment, and the tolerant reader would then drop
// BOTH -- so a torn tail is ended first: the fragment stays unreadable, everything after
// it survives.
const endsTorn = (text) => (text && !text.endsWith("\n") ? "\n" : "");

const linesOf = (text) => String(text ?? "").split(/\r?\n/).filter(Boolean).map(parsed).filter(Boolean);

const readLines = (c) => linesOf(c.io.read(c.p.journal));

const lastSequence = (lines) => lines.reduce((n, l) => Math.max(n, l.sequence ?? 0), 0);

// Every kind of line is an allow-list; the store owns `at`, `sequence`, `v` and `kind`.
function recordOf(c, line, lines) {
  const kept = scrubFields(Object.fromEntries(KINDS[line.kind].filter((k) => line[k] !== undefined).map((k) => [k, line[k]])), FREE_TEXT);
  return { v: JOURNAL_VERSION, at: c.io.now(), ...kept, sequence: lastSequence(lines) + 1, kind: line.kind };
}

// In a transaction the tail was looked at once, with the read that filled the cache; and
// after the first line there is nothing torn left to end.
function appended(c, line) {
  if (!KINDS[line.kind]) throw new Refused(`the requirements journal keeps no "${line.kind}" line — it keeps ${Object.keys(KINDS).join(", ")}`);
  const record = recordOf(c, line, c.cache ?? readLines(c));
  c.io.append(c.p.journal, `${c.cache ? c.tail : endsTorn(c.io.read(c.p.journal))}${JSON.stringify(record)}\n`);
  if (c.cache) [c.tail, c.cache] = ["", [...c.cache, record]];
  return record;
}

const journalApi = (c) => ({
  journalLines: () => c.cache ?? readLines(c),
  journal: (line) => appended(c, line),
});

// The lock is the room's, and inside it the journal is read ONCE: every line a writer
// appends is added to the same list, so the next sequence is still the next one.
function transact(c, fn) {
  c.io.ensureDir(c.p.dir);
  return withLock(c.p.dir, () => cached(c, fn), c.io, BUSY);
}

function cached(c, fn) {
  const text = c.io.read(c.p.journal);
  [c.cache, c.tail] = [linesOf(text), endsTorn(text)];
  try { return fn(); }
  finally { [c.cache, c.tail] = [null, null]; }
}

// ---- findings --------------------------------------------------------------------------

const hostFile = (c) => String(c.io.host ?? "host").replace(/[^A-Za-z0-9._-]/g, "_");

const findingApi = (c) => ({
  addFinding: (f) => c.io.append(join(c.p.findings, `${hostFile(c)}.jsonl`), `${JSON.stringify(scrubFields({ at: c.io.now(), host: c.io.host, ...f }, ["say"]))}\n`),
  findings: () => c.io.list(c.p.findings).filter((n) => n.endsWith(".jsonl")).sort().flatMap((n) => String(c.io.read(join(c.p.findings, n)) ?? "").split("\n").filter(Boolean).map(parsed).filter(Boolean)),
});
