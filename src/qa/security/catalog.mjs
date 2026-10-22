// A SECURITY CATALOG, version 1, as data (ADR 0040; doc §7).
//
// A catalog is a SOURCE a person chose: the standard or the policy a system is held to, as its
// controls -- each with a versioned id, its group and level, a summary in Orbit's own words (never
// the standard's text), a link, how it can be verified, the minimum evidence a conclusion needs, a
// predicate over the graph's structural roles saying where it applies, the obligation shapes a
// runtime test of it takes, and why a runtime test cannot verify it when one cannot. Another
// standard's categories are LABELS, mapped many to many.
//
// Nothing here knows any standard. The catalog Orbit ships is data under skills/; a catalog a person
// adds, writes or enables arrives through Orbit Control (src/qa/security/store.mjs), and is read in
// LAYERS: the shipped catalogs, then the ones adopted on this machine, then what a project enabled
// and the controls a person marked not applicable. A catalog's REVISION is its digest: one byte
// changed is another catalog, and what was derived from the old one is stale.
import { Refused } from "../../errors.mjs";
import { canonicalJson, sha } from "../../hash.mjs";
import { isObject, walkFindings } from "../../walk.mjs";
import { CONTROL_ROLES, METHODS } from "../obligations/contract.mjs";
import { SHAPE_IDS } from "../obligations/shapes.mjs";
import { predicateFindings } from "./applicability.mjs";

export const CATALOG_API = "orbit.control-catalog/v1";
export const SUPPORTED_CATALOG_APIS = [CATALOG_API];

export const CATALOG_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
export const CONTROL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const LABEL_SET_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
export const LABEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DIGEST = /^[0-9a-f]{64}$/;
export const HTTPS = /^https:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/;
export const MAX_CONTROLS = 2000;

const text = (doc, max = 400) => ({ type: "string", doc, max });
const link = (doc) => ({ type: "string", pattern: HTTPS.source, doc });

export const CATALOG_FIELDS = {
  apiVersion: { type: "string", enum: SUPPORTED_CATALOG_APIS, doc: "Which published contract this catalog was written against." },
  catalog: { type: "string", pattern: CATALOG_ID.source, doc: "The catalog's id: lower case, the same for every version of it." },
  title: text("What a person calls it."),
  version: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$", doc: "The version of the standard or the policy it carries." },
  source: { $ref: "#/definitions/source", doc: "Where it came from: a link, a tag, the digest of what was retrieved and when." },
  licence: text("The licence of what it was derived from."),
  note: text("What it holds and what it leaves out.", 2000),
  default: { type: "boolean", doc: "The catalog in effect for a project that enabled none. Only a catalog Orbit ships may say so." },
  labels: { type: "object", additionalProperties: { $ref: "#/definitions/labelSet" }, doc: "Other standards' categories a control may carry, by set." },
  controls: { type: "array", items: { $ref: "#/definitions/control" }, minItems: 1, doc: "Its controls." },
};

export const CATALOG_REQUIRED = ["apiVersion", "catalog", "title", "version", "controls"];

export const SOURCE_FIELDS = {
  url: link("Where the standard is published."),
  tag: text("The tag or edition it was taken from.", 64),
  digest: { type: "string", pattern: DIGEST.source, doc: "The SHA-256 of what was retrieved, when it was retrieved." },
  retrieved: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}", doc: "When it was retrieved." },
};

export const LABEL_SET_FIELDS = {
  title: text("What the set is called."),
  url: link("Where the set is published."),
  items: { type: "object", additionalProperties: { $ref: "#/definitions/label" }, minProperties: 1, doc: "Its categories, by id." },
};

export const LABEL_FIELDS = { title: text("The category's name."), url: link("Where it is described.") };

export const CONTROL_FIELDS = {
  id: { type: "string", pattern: CONTROL_ID.source, doc: "The control's VERSIONED id, as its standard asks it be cited." },
  group: text("The chapter or section it sits in.", 120),
  level: { type: "integer", minimum: 1, maximum: 9, doc: "The lowest level the standard owes it at." },
  summary: text("What it asks, in Orbit's own words -- never the standard's text."),
  url: link("Where the control is described."),
  methods: { type: "array", items: { type: "string" }, minItems: 1, doc: `How it can be verified: ${METHODS.join(", ")}.` },
  minimumEvidence: { type: "array", items: { type: "string" }, doc: `The controls a conclusion needs: ${CONTROL_ROLES.join(", ")}.` },
  applies: { type: "object", doc: "Where it applies: a predicate over the graph's structural roles (src/qa/security/applicability.mjs)." },
  shapes: { type: "array", items: { type: "string" }, doc: "The obligation shapes a runtime test of it takes (src/qa/obligations/shapes.mjs)." },
  unsupported: text("Why a runtime test cannot verify it here, when it cannot."),
  labels: { type: "array", items: { type: "string" }, doc: "The categories it carries, as <set>:<id>." },
};

export const CONTROL_REQUIRED = ["id", "summary", "methods"];

export const DEFINITIONS = {
  source: { table: SOURCE_FIELDS, required: [] },
  labelSet: { table: LABEL_SET_FIELDS, required: ["title", "items"] },
  label: { table: LABEL_FIELDS, required: ["title"] },
  control: { table: CONTROL_FIELDS, required: CONTROL_REQUIRED },
};

// ── judging one catalog ────────────────────────────────────────────────────

const controlsOf = (doc) => (Array.isArray(doc?.controls) ? doc.controls.filter(isObject) : []);
const each = (doc, rule) => controlsOf(doc).flatMap((c) => rule(c, `${doc.catalog} ${String(c.id).slice(0, 64)}`, doc));
const notIn = (list, allowed) => (Array.isArray(list) ? list : []).filter((v) => !allowed.includes(v));
const labelIds = (doc) => Object.entries(isObject(doc.labels) ? doc.labels : {}).flatMap(([set, s]) => Object.keys(isObject(s?.items) ? s.items : {}).map((id) => `${set}:${id}`));

const CROSS = [
  (doc, at) => (controlsOf(doc).length > MAX_CONTROLS ? [`${at}: ${controlsOf(doc).length} controls, more than ${MAX_CONTROLS}`] : []),
  (doc, at) => controlsOf(doc).map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i).map((id) => `${at}: control ${String(id).slice(0, 64)} is declared twice`),
  (doc) => each(doc, (c, at) => notIn(c.methods, METHODS).map((m) => `${at}: method "${String(m).slice(0, 40)}" is not one of ${METHODS.join(", ")}`)),
  (doc) => each(doc, (c, at) => notIn(c.minimumEvidence, CONTROL_ROLES).map((r) => `${at}: evidence "${String(r).slice(0, 40)}" is not one of ${CONTROL_ROLES.join(", ")}`)),
  (doc) => each(doc, (c, at) => notIn(c.shapes, SHAPE_IDS).map((s) => `${at}: shape "${String(s).slice(0, 40)}" is not an obligation shape`)),
  (doc) => each(doc, (c, at) => notIn(c.labels, labelIds(doc)).map((l) => `${at}: label "${String(l).slice(0, 60)}" is not one the catalog declares`)),
  (doc) => each(doc, (c, at) => (c.applies === undefined ? [] : predicateFindings(c.applies, `${at} applies`))),
  (doc) => each(doc, (c, at) => ((c.methods ?? []).includes("runtime-test") && !(c.shapes ?? []).length && !c.unsupported ? [`${at}: a runtime test needs a shape, or an unsupported reason saying why it has none`] : [])),
  (doc, at) => Object.keys(isObject(doc.labels) ? doc.labels : {}).filter((k) => !LABEL_SET_ID.test(k)).map((k) => `${at}: label set "${k.slice(0, 40)}" is not an id`),
  (doc, at) => labelIds(doc).filter((l) => !LABEL_ID.test(l.split(":")[1])).map((l) => `${at}: label "${l.slice(0, 60)}" is not an id`),
  (doc, at) => textFindings(doc, at),
];

// Free text stays short: a catalog is ids, links and summaries, never a standard's whole text.
function textFindings(doc, at) {
  const fields = [...Object.entries(CATALOG_FIELDS).map(([k, f]) => [k, f, doc]), ...controlsOf(doc).flatMap((c) => Object.entries(CONTROL_FIELDS).map(([k, f]) => [k, f, c]))];
  return fields.filter(([k, f, rec]) => f.max && typeof rec[k] === "string" && rec[k].length > f.max).map(([k, f]) => `${at}: ${k} is longer than ${f.max} characters — a catalog keeps a summary, never a standard's text`);
}

export function catalogFindings(doc) {
  if (!isObject(doc)) return ["a catalog is an object"];
  const at = typeof doc.catalog === "string" ? doc.catalog.slice(0, 64) : "catalog";
  return [...walkFindings(DEFINITIONS, CATALOG_FIELDS, CATALOG_REQUIRED, doc, at), ...CROSS.flatMap((rule) => rule(doc, at))];
}

// The catalog's revision: the digest of its canonical form. Two catalogs that differ by one byte
// of meaning are two revisions; the order keys were written in is not a difference.
export const catalogDigest = (doc) => sha(canonicalJson(doc));

// ── the JSON Schema a person's editor validates against (generated) ─────────

const strip = ({ doc, max, ...schema }) => ({ ...schema, ...(max ? { maxLength: max } : {}), description: doc });
const properties = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, strip(v)]));
const object = (table, required) => ({ type: "object", required, additionalProperties: false, properties: properties(table) });

export function catalogSchema() {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://orbit/security/control-catalog.schema.json",
    title: "Security control catalog (orbit)",
    description: `${CATALOG_API}. GENERATED from src/qa/security/catalog.mjs. The rules a shape cannot say -- unique control ids, declared labels, known shapes and roles, a reason for a runtime test with no shape -- are catalogFindings().`,
    ...object(CATALOG_FIELDS, CATALOG_REQUIRED),
    definitions: Object.fromEntries(Object.entries(DEFINITIONS).map(([k, d]) => [k, object(d.table, d.required)])),
  };
}

// ── the layers, and what a project has in effect ───────────────────────────

const entryOf = (doc, layer, from) => ({ catalog: doc.catalog, version: doc.version, title: doc.title, digest: catalogDigest(doc), layer, from, doc });

// One layer's documents, judged: a catalog that does not hold is REFUSED with its reasons and left
// exactly as it is, and the layer goes on.
export function layerOf(docs, layer) {
  const judged = docs.map((d) => ({ ...d, problems: d.doc ? catalogFindings(d.doc) : [d.why] }));
  return { catalogs: judged.filter((d) => !d.problems.length).map((d) => entryOf(d.doc, layer, d.from)), refused: judged.filter((d) => d.problems.length).map((d) => ({ from: d.from, layer, problems: d.problems })) };
}

// Shipped first, then adopted. A digest already held by an earlier layer is that catalog again.
export function catalogLayers(...layers) {
  const catalogs = layers.flatMap((l) => l.catalogs).filter((c, i, all) => all.findIndex((x) => x.digest === c.digest) === i);
  return { catalogs, refused: layers.flatMap((l) => l.refused) };
}

const filterOf = (e) => ({ levels: Array.isArray(e.levels) && e.levels.length ? e.levels : null, groups: Array.isArray(e.groups) && e.groups.length ? e.groups : null });
const kept = (c, f) => (!f.levels || f.levels.includes(c.level)) && (!f.groups || f.groups.includes(c.group));

function inEffect(entry, e = {}) {
  const f = filterOf(e);
  return { catalog: entry.catalog, version: entry.version, title: entry.title, digest: entry.digest, layer: entry.layer, filter: f.levels || f.groups ? f : null, controls: controlsOf(entry.doc).filter((c) => kept(c, f)), labels: entry.doc.labels ?? {} };
}

// What a project holds itself to: the catalogs it enabled, pinned by digest and filtered by level
// or group -- or, when it enabled none, the catalogs Orbit ships as the default. An enabled
// catalog this machine does not hold is MISSING, said, and never replaced by another.
export function effectiveCatalogs(layers, settings = {}) {
  const enabled = Array.isArray(settings.enabled) ? settings.enabled : [];
  if (!enabled.length) return { by: "default", catalogs: layers.catalogs.filter((c) => c.layer === "shipped" && c.doc.default === true).map((c) => inEffect(c)), missing: [] };
  const found = enabled.map((e) => ({ e, c: layers.catalogs.find((c) => c.digest === e.digest && c.catalog === e.catalog) }));
  return { by: "project", catalogs: found.filter((x) => x.c).map((x) => inEffect(x.c, x.e)), missing: found.filter((x) => !x.c).map((x) => ({ catalog: x.e.catalog, digest: x.e.digest, why: "enabled for this project, and no catalog with that digest is on this machine — adopt it in Orbit Control, or enable another" })) };
}

// A person's not-applicable mark for one control of one catalog, by the catalog's id.
export const markOf = (settings, catalog, control) => (Array.isArray(settings?.notApplicable) ? settings.notApplicable : []).find((m) => m.catalog === catalog && m.control === control) ?? null;

// ── a preview, before anything is adopted ─────────────────────────────────

const latestOf = (layers, catalog) => layers.catalogs.filter((c) => c.catalog === catalog).at(-1) ?? null;
const byId = (doc) => new Map(controlsOf(doc).map((c) => [c.id, canonicalJson(c)]));

function diffOf(before, after) {
  const was = byId(before);
  const now = byId(after);
  return { added: [...now.keys()].filter((id) => !was.has(id)), removed: [...was.keys()].filter((id) => !now.has(id)), changed: [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id)) };
}

// What adopting a document would do: how many controls, which digest it would be pinned at, and
// what differs from the latest catalog of the same id this machine already holds. Writes nothing.
export function previewOf(doc, layers) {
  const problems = [...catalogFindings(doc), ...(isObject(doc) && doc.default === true ? ["default: only a catalog Orbit ships is a default — a person enables a catalog for a project instead"] : [])];
  if (problems.length) return { ok: false, problems };
  const against = latestOf(layers, doc.catalog);
  return { ok: true, problems: [], catalog: doc.catalog, version: doc.version, title: doc.title, digest: catalogDigest(doc), controls: controlsOf(doc).length, against: against && { digest: against.digest, version: against.version, layer: against.layer }, same: against?.digest === catalogDigest(doc), diff: diffOf(against?.doc, doc) };
}

// A document a person sent, parsed: JSON only, bounded, never evaluated.
export function parsedCatalog(text, max = 1024 * 1024) {
  if (typeof text !== "string" || !text.length) throw new Refused("a catalog is a JSON document, and nothing was sent");
  if (Buffer.byteLength(text) > max) throw new Refused(`a catalog is at most ${max} bytes`);
  try { return JSON.parse(text); }
  catch (e) { throw new Refused(`a catalog is a JSON document — ${String(e.message).slice(0, 120)}`); }
}
