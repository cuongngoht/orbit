// Where security catalogs and a project's choices among them are KEPT, and the one door they are
// written through (ADR 0040).
//
//   <storeBase>/control/security/catalogs/index.json        what a person ADOPTED on this machine
//   <storeBase>/control/security/catalogs/<digest>.json     each adopted catalog, kept once by digest
//   <storeRoot>/security/settings.json                      which catalogs this project follows, and
//                                                           the controls a person marked not applicable
//   <storeRoot>/security/assessments/<asm-id>.json          each assessment, the engine's record
//
// A catalog, and which ones a project is held to, are a PERSON's: every write here refuses unless
// the context came through Orbit Control's door (`door: "control"`, set only after its mutation
// token), because a terminal cannot prove who typed a command and an agent must never choose the
// standard it is assessed against. Every write names the revision it read, holds the room's lock and
// replaces atomically; reading creates nothing, and a document of a schema this engine does not hold
// is reported and left exactly as it is. An adopted catalog is never edited in place: another
// version is another digest, kept beside it.
import { join } from "node:path";
import { Refused } from "../../errors.mjs";
import { contained } from "../../project/boundary.mjs";
import { scrub } from "../../scrub.mjs";
import { writeAtomic } from "../../store/atomic.mjs";
import { readState, writeState } from "../../store/control.mjs";
import { withLock } from "../../store/lock.mjs";
import { checkRevision, contentOf, revisionFor } from "../../store/revisioned.mjs";
import { CATALOG_ID, CONTROL_ID, DIGEST, HTTPS, catalogDigest, catalogLayers, layerOf, previewOf } from "./catalog.mjs";

export const SECURITY_SCHEMA = 1;
export const SECURITY_DOOR = "SECURITY_PERSON_UNPROVEN";
export const SECURITY_INVALID = "SECURITY_CATALOG_INVALID";
export const ASSESSMENT_ID = /^asm-[0-9a-f]{16}$/;

const SOURCE_KINDS = ["url", "file", "editor"];
const MAX_WHY = 300;
const MAX_ADOPTED = 200;

export function securityRooms(storeBase, storeRoot = null) {
  const adopted = contained(storeBase, join(storeBase, "control", "security", "catalogs"));
  const project = storeRoot ? contained(storeRoot, join(storeRoot, "security")) : null;
  return { adopted, index: join(adopted, "index.json"), project, settings: project && join(project, "settings.json"), assessments: project && join(project, "assessments") };
}

const refused = (code, message) => Object.assign(new Refused(message), { code });

function admitted(writer) {
  if (writer?.door !== "control") throw refused(SECURITY_DOOR, "a security catalog, and which ones a project is held to, are a person's to choose — done in Orbit Control (Security → Catalogs); a terminal cannot prove who typed it, and an agent never chooses the standard it is assessed against");
}

// ── reading the layers ─────────────────────────────────────────────────────

const jsonOf = (text) => {
  try { return JSON.parse(text); }
  catch { return undefined; }
};

const docAt = (io, dir, name) => ((doc) => (doc === undefined ? { from: name, why: `${name}: not a JSON document — left as it is` } : { from: name, doc }))(jsonOf(io.read(join(dir, name))));

// What Orbit ships: every catalog file in the directory the composition root names.
export const shippedDocs = (io, dir) => io.list(dir).filter((n) => n.endsWith(".json")).sort().map((n) => docAt(io, dir, n));

export function readIndex(io, rooms) {
  const kept = readState(io, rooms.index, { adopted: [] }, SECURITY_SCHEMA);
  const content = contentOf(kept);
  const exists = io.read(rooms.index) !== null;
  return { adopted: Array.isArray(content.adopted) ? content.adopted : [], content, revision: exists ? revisionFor(content) : null, exists };
}

// An adopted catalog whose bytes no longer hash to the digest it was adopted at was changed after a
// person adopted it: refused, and left exactly as it is.
function adoptedDoc(io, rooms, entry) {
  const name = `${entry.digest}.json`;
  const read = DIGEST.test(String(entry.digest)) ? docAt(io, rooms.adopted, name) : { from: String(entry.digest).slice(0, 70), why: "an adopted entry names no digest" };
  if (read.doc && catalogDigest(read.doc) !== entry.digest) return { from: name, why: `${name}: its content is not the digest it was adopted at — changed after adoption, left as it is` };
  return read;
}

export function adoptedDocs(io, rooms) {
  try { return readIndex(io, rooms).adopted.map((e) => adoptedDoc(io, rooms, e)); }
  catch (e) { return [{ from: "index.json", why: e.message }]; }
}

export const layersFrom = (io, rooms, shippedDir) => catalogLayers(layerOf(shippedDocs(io, shippedDir), "shipped"), layerOf(adoptedDocs(io, rooms), "adopted"));

export function readProjectSecurity(io, rooms) {
  if (!rooms.settings) return { settings: { enabled: [], notApplicable: [] }, content: {}, revision: null, exists: false, project: false };
  const content = contentOf(readState(io, rooms.settings, {}, SECURITY_SCHEMA));
  const exists = io.read(rooms.settings) !== null;
  return { settings: { enabled: Array.isArray(content.enabled) ? content.enabled : [], notApplicable: Array.isArray(content.notApplicable) ? content.notApplicable : [] }, content, revision: exists ? revisionFor(content) : null, exists, project: true };
}

// ── adopting a catalog: by URL, by file, or written in the editor ──────────

function sourceFindings(s) {
  if (!s || typeof s !== "object" || !SOURCE_KINDS.includes(s.kind)) return [`source.kind is one of ${SOURCE_KINDS.join(", ")}`];
  return [...(s.kind === "url" && !HTTPS.test(String(s.url ?? "")) ? ["source.url is the https link it was fetched from"] : []), ...(s.name !== undefined && (typeof s.name !== "string" || s.name.length > 120) ? ["source.name is a file name of 120 characters at most"] : [])];
}

const sourceOf = (s) => ({ kind: s.kind, ...(s.kind === "url" ? { url: s.url } : {}), ...(typeof s.name === "string" ? { name: scrub(s.name) } : {}) });

export function adoptCatalog(io, rooms, layers, asked, writer) {
  admitted(writer);
  const preview = previewOf(asked.doc, layers);
  const wrong = [...(preview.ok ? [] : preview.problems), ...sourceFindings(asked.source)];
  if (wrong.length) throw refused(SECURITY_INVALID, `the catalog was not adopted: ${wrong.slice(0, 12).join("; ")}`);
  return locked(io, rooms.adopted, () => adopted(io, rooms, asked, writer));
}

const locked = (io, dir, fn) => (io.ensureDir(dir), withLock(dir, fn, io, "somebody else is changing these security settings — try again in a moment"));

function adopted(io, rooms, asked, writer) {
  const kept = readIndex(io, rooms);
  checkRevision(kept, writer, "adopted security catalogs");
  keepDocument(io, rooms, asked.doc);
  writeState(io, rooms.index, { ...kept.content, adopted: indexed(kept.adopted, entryOf(asked, writer)), updatedAt: writer.at, updatedBy: "person" }, SECURITY_SCHEMA);
  return readIndex(io, rooms);
}

function indexed(list, entry) {
  const next = [...list.filter((a) => a.digest !== entry.digest), entry];
  if (next.length > MAX_ADOPTED) throw refused(SECURITY_INVALID, `up to ${MAX_ADOPTED} catalogs may be adopted on one machine`);
  return next;
}

const entryOf = (asked, writer) => ({ catalog: asked.doc.catalog, version: asked.doc.version, title: asked.doc.title, digest: catalogDigest(asked.doc), controls: asked.doc.controls.length, source: sourceOf(asked.source), at: writer.at ?? null });

// Kept ONCE, by its digest: the same content is the same file, and a different content is another.
function keepDocument(io, rooms, doc) {
  const file = contained(rooms.adopted, join(rooms.adopted, `${catalogDigest(doc)}.json`));
  if (io.read(file) === null) writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`, io, false);
}

// ── what a project follows ─────────────────────────────────────────────────

const ENABLED_RULES = [
  (e) => (CATALOG_ID.test(String(e?.catalog)) ? [] : ["catalog is a catalog's id"]),
  (e) => (DIGEST.test(String(e?.digest)) ? [] : ["digest is the 64 hex digits a catalog was adopted or shipped at"]),
  (e, layers) => (layers.catalogs.some((c) => c.catalog === e?.catalog && c.digest === e?.digest) ? [] : [`no catalog ${String(e?.catalog).slice(0, 64)} at that digest is on this machine`]),
  (e) => (e?.levels === undefined || (Array.isArray(e.levels) && e.levels.every((l) => Number.isInteger(l) && l >= 1)) ? [] : ["levels is a list of whole numbers"]),
  (e) => (e?.groups === undefined || (Array.isArray(e.groups) && e.groups.every((g) => typeof g === "string" && g.length <= 120)) ? [] : ["groups is a list of group names"]),
];

function enabledFindings(enabled, layers) {
  if (!Array.isArray(enabled)) return ["enabled is a list of { catalog, digest, levels?, groups? }"];
  const twice = enabled.map((e) => e?.catalog).filter((c, i, all) => all.indexOf(c) !== i).map((c) => `${String(c).slice(0, 64)} is enabled twice — one version of a catalog at a time`);
  return [...enabled.flatMap((e, i) => ENABLED_RULES.flatMap((r) => r(e, layers)).map((w) => `enabled[${i + 1}]: ${w}`)), ...twice];
}

const enabledEntry = (e) => ({ catalog: e.catalog, digest: e.digest, ...(e.levels?.length ? { levels: e.levels } : {}), ...(e.groups?.length ? { groups: e.groups } : {}) });

export function enableCatalogs(io, rooms, layers, asked, writer) {
  admitted(writer);
  const wrong = enabledFindings(asked.enabled, layers);
  if (wrong.length) throw refused(SECURITY_INVALID, `nothing was enabled: ${wrong.join("; ")}`);
  return projectWrite(io, rooms, writer, (content) => ({ ...content, enabled: asked.enabled.map(enabledEntry) }));
}

// ── a person's not-applicable mark, with its reason ────────────────────────

const MARK_RULES = [
  (m) => (CATALOG_ID.test(String(m.catalog)) && CONTROL_ID.test(String(m.control)) ? [] : ["name the catalog and the control by their ids"]),
  (m, layers) => (layers.catalogs.some((c) => c.catalog === m.catalog && c.doc.controls.some((x) => x.id === m.control)) ? [] : [`${String(m.catalog).slice(0, 64)} has no control ${String(m.control).slice(0, 64)} on this machine`]),
  (m) => (m.clear === true || (typeof m.why === "string" && m.why.trim().length > 0 && m.why.length <= MAX_WHY) ? [] : [`why is the reason it does not apply here, ${MAX_WHY} characters at most`]),
];

const marked = (list, m, writer) => [...list.filter((x) => !(x.catalog === m.catalog && x.control === m.control)), ...(m.clear === true ? [] : [{ catalog: m.catalog, control: m.control, why: scrub(m.why.trim()), at: writer.at ?? null }])];

export function markControl(io, rooms, layers, asked, writer) {
  admitted(writer);
  const wrong = MARK_RULES.flatMap((r) => r(asked ?? {}, layers));
  if (wrong.length) throw refused(SECURITY_INVALID, `nothing was marked: ${wrong.join("; ")}`);
  return projectWrite(io, rooms, writer, (content) => ({ ...content, notApplicable: marked(Array.isArray(content.notApplicable) ? content.notApplicable : [], asked, writer) }));
}

function projectWrite(io, rooms, writer, change) {
  if (!rooms.settings) throw refused(SECURITY_INVALID, "these are a project's settings, and no project was named — open Orbit Control from the project's checkout");
  return locked(io, rooms.project, () => projectWritten(io, rooms, writer, change));
}

function projectWritten(io, rooms, writer, change) {
  const kept = readProjectSecurity(io, rooms);
  checkRevision(kept, writer, "project security settings");
  writeState(io, rooms.settings, { ...change(kept.content), updatedAt: writer.at, updatedBy: "person" }, SECURITY_SCHEMA);
  return readProjectSecurity(io, rooms);
}

// ── assessments: the engine's record, kept once ────────────────────────────

export function keepAssessment(io, rooms, snapshot) {
  if (!rooms.assessments) throw new Refused("an assessment is a project's, and no project was named — run it inside the project's checkout");
  const file = contained(rooms.assessments, join(rooms.assessments, `${snapshot.id}.json`));
  io.ensureDir(rooms.assessments);
  if (io.read(file) === null) writeAtomic(file, `${JSON.stringify(snapshot, null, 2)}\n`, io, false);
  return file;
}

export function readAssessment(io, rooms, id) {
  if (!ASSESSMENT_ID.test(String(id)) || !rooms.assessments) return null;
  const doc = jsonOf(io.read(join(rooms.assessments, `${id}.json`)));
  return doc?.id === id ? doc : null;
}
