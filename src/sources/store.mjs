// WHERE a project's sources live: one room in the project's machine store, beside
// the knowledge and the investigations, and never in a repository.
//
//   <store>/sources/records/<sid>.json    one file per source, so two writers never
//                                         meet and a torn byte costs one record. It
//                                         keeps what a source WAS, never its text
//   <store>/sources/bindings.json         which system this project's work items are
//                                         in, so "PBI 4312" needs no provider named
//   <store>/sources/findings/<host>.jsonl what reading noticed (a revision that
//                                         did not move while the content did)
//
// Every rule the other rooms keep is kept here: reading never creates, a newer
// schema is refused rather than overwritten, a corrupt document is copied aside,
// and a field nobody declared never reaches the disk.
//
// The BINDINGS are the one shared, merged document, so they take a lock and name
// the revision they were changed against -- src/investigation/settings.mjs's rule,
// for its reason: a session must not overwrite what a person decided a minute ago
// with a copy it read an hour ago. And a binding a person made is never replaced
// by the engine's guess (BINDING_RULES).
import { join } from "node:path";
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { sha } from "../hash.mjs";
import { scrub, scrubFields } from "../scrub.mjs";
import { checkedId } from "../store/id.mjs";
import { staleRefusal } from "../store/revisioned.mjs";
import { readState, writeState } from "../store/control.mjs";
import { withLock } from "../store/lock.mjs";
import { IDENTITY_FIELDS } from "./fields.mjs";
import { stableText } from "./model.mjs";

export const DIR = "sources";
export const BINDINGS_SCHEMA = 1;
export const RECORD_SCHEMA = 1;
export const SID_SPEC = { type: "string", pattern: "^src-[0-9a-f]{12}$" };
// The refusal every revision-protected document shares (src/store/revisioned.mjs). The revision itself
// stays this module's own: it is taken over the same stable text a source record's digest is.
export { STALE_REVISION } from "../store/revisioned.mjs";
export const BY = ["person", "engine"];
export const MAX_REFS = 64;
export const MAX_PATTERN = 200;

// What a record may hold. Anything else -- a body somebody passed in, a field a
// reader invented -- is dropped before it can reach the disk.
export const RECORD_KEYS = ["schema", "id", "kind", "identity", "ref", "url", "revision", "digest", "authority", "read", "state", "why", "relations", "provenance", "acceptedBy"];
const FREE_TEXT = ["why"];

export const sourcePaths = (root) => ({
  root: join(root, DIR),
  records: join(root, DIR, "records"),
  bindings: join(root, DIR, "bindings.json"),
  findings: join(root, DIR, "findings"),
});

export function createSources(root, io) {
  const c = { paths: sourcePaths(root), io };
  return { root, paths: c.paths, host: io.host, ...recordApi(c), ...bindingApi(c), ...findingApi(c) };
}

// ---- records -------------------------------------------------------------------------

const fileOf = (c, sid) => contained(c.paths.records, join(c.paths.records, `${checkedId(sid, SID_SPEC)}.json`));

const recordApi = (c) => ({
  record: (sid) => oneRecord(c, fileOf(c, sid), false),
  records: () => names(c, c.paths.records).map((n) => oneRecord(c, join(c.paths.records, n), true)).filter(Boolean),
  saveRecord: (rec) => savedRecord(c, rec),
});

const names = (c, dir) => c.io.list(dir).filter((n) => n.endsWith(".json")).sort();

// Reading never creates. A record this engine cannot read is REPORTED and left
// exactly as it is, never rewritten or deleted.
function oneRecord(c, file, report) {
  const doc = readState(c.io, file, {}, RECORD_SCHEMA);
  const usable = doc.id && !doc.unreadable ? doc : null;
  if (!usable && c.io.exists(file) && report) c.io.note({ kind: "unreadable-source", say: `${file} is not a source record this engine can read — it is left exactly as it is` });
  return usable;
}

const kept = (rec) => scrubFields(Object.fromEntries(RECORD_KEYS.filter((k) => rec[k] !== undefined).map((k) => [k, rec[k]])), FREE_TEXT);

function savedRecord(c, rec) {
  const file = fileOf(c, rec.id);
  writeState(c.io, file, kept(rec), RECORD_SCHEMA);
  return file;
}

// ---- bindings ------------------------------------------------------------------------

export const EMPTY_BINDINGS = { default: null, refs: {} };

const CONTENT = ["default", "refs"];

const contentOf = (doc) => Object.fromEntries(CONTENT.map((k) => [k, doc?.[k] ?? EMPTY_BINDINGS[k]]));

export const revisionOf = (doc) => sha(stableText(contentOf(doc))).slice(0, 16);

const bindingApi = (c) => ({
  bindings: () => readBindings(c),
  setBinding: (change, w) => changedBindings(c, change, w),
});

// What is bound, and whose word it is. An absent document reads as nothing bound.
function readBindings(c) {
  const state = readState(c.io, c.paths.bindings, {}, BINDINGS_SCHEMA);
  const exists = c.io.exists(c.paths.bindings);
  return { exists, doc: contentOf(state), by: state.by ?? null, revision: exists ? state.revision : undefined, unreadable: state.unreadable ?? null };
}

const stale = (now, read) => staleRefusal("source bindings", now, read);

// Ordered: the first row that finds a reason refuses. A person's word outranks the
// engine's, and nobody writes over a document they did not read.
const BINDING_RULES = [
  { name: "engine-guess", refuses: (current, w) => w.by === "engine" && current.by === "person", say: () => "a person bound this project's source; change it with bind --human, never by a guess" },
  { name: "stale-revision", refuses: (current, w) => current.exists && w.revision !== current.revision, say: (current, w) => stale(current.revision, w.revision) },
];

function refusedBy(current, w) {
  const row = BINDING_RULES.find((r) => r.refuses(current, w));
  if (!row) return;
  const say = row.say(current, w);
  throw say instanceof Error ? say : new Refused(say);
}

function changedBindings(c, change, w) {
  if (!BY.includes(w.by)) throw new Refused(`a binding is written by ${BY.join(" or ")}, not "${w.by}"`);
  c.io.ensureDir(c.paths.root);
  return withLock(c.paths.root, () => bound(c, change, w), c.io, "another session is changing this project's source bindings — try again in a moment");
}

function bound(c, change, w) {
  const current = readBindings(c);
  refusedBy(current, w);
  const doc = held(change(current.doc));
  writeState(c.io, c.paths.bindings, { ...doc, by: w.by, revision: revisionOf(doc), updatedAt: w.now }, BINDINGS_SCHEMA);
  return { ...doc, by: w.by, revision: revisionOf(doc) };
}

const TARGET_KEYS = ["provider", "organization", "project"];

const secret = (v) => typeof v === "string" && scrub(v) !== v;

function targetFindings(t, where) {
  if (typeof t !== "object" || t === null || Array.isArray(t)) return [`${where} must be an object`];
  const unknown = Object.keys(t).filter((k) => !TARGET_KEYS.includes(k)).map((k) => `${where}: unknown field "${k}"`);
  const secrets = Object.entries(t).filter(([, v]) => secret(v)).map(([k]) => `${where}: ${k} looks like a secret`);
  return [...missingFindings(["provider", "organization"], t, where), ...constraintFindings(IDENTITY_FIELDS, t, where), ...unknown, ...secrets];
}

const patternFindings = (refs) => Object.keys(refs).filter((p) => !p || p.length > MAX_PATTERN || secret(p)).map((p) => `a ref pattern must be 1 to ${MAX_PATTERN} characters and no secret: "${p.slice(0, 20)}…"`);

function bindingFindings(doc) {
  const refs = doc.refs;
  if (typeof refs !== "object" || refs === null || Array.isArray(refs)) return ["refs must be an object of pattern -> target"];
  const tooMany = Object.keys(refs).length > MAX_REFS ? [`more than ${MAX_REFS} ref patterns — the bound`] : [];
  const each = Object.entries(refs).flatMap(([p, t]) => targetFindings(t, `refs["${p.slice(0, 30)}"]`));
  return [...tooMany, ...patternFindings(refs), ...each, ...(doc.default === null ? [] : targetFindings(doc.default, "default"))];
}

// A binding that does not hold is refused before anything is written.
function held(next) {
  const doc = contentOf(next);
  const wrong = bindingFindings(doc);
  if (wrong.length) throw new Refused(`these source bindings do not hold:\n  ${wrong.join("\n  ")}`);
  return doc;
}

// ---- findings ------------------------------------------------------------------------

const hostFile = (c) => String(c.io.host ?? "host").replace(/[^A-Za-z0-9._-]/g, "_");

const findingApi = (c) => ({
  addFinding: (f) => c.io.append(join(c.paths.findings, `${hostFile(c)}.jsonl`), `${JSON.stringify(scrubFields({ at: c.io.now(), host: c.io.host, ...f }, ["say"]))}\n`),
  findings: () => readLines(c),
});

const parsed = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

const readLines = (c) => c.io.list(c.paths.findings).filter((n) => n.endsWith(".jsonl")).sort().flatMap((n) => String(c.io.read(join(c.paths.findings, n)) ?? "").split("\n").filter(Boolean).map(parsed).filter(Boolean));
