// A project's REPORT SETTINGS: which source, which scope, which window by
// default, which sections -- one schema-stamped document in the project's
// report room, edited by a person in Orbit Control or by a session relaying what
// a person asked for.
//
// Every write names the REVISION it was made against, and a stale one is
// refused: a session must never overwrite a change a person made a minute ago
// with a copy it read an hour ago. The revision is a hash of the settings'
// content, so it changes exactly when they do.
//
// What a scope may name is the PROVIDER's to say (its descriptor, handed in),
// so this file knows no provider -- and a credential is never a setting: a
// project names a CONNECTION, and the connection names where its secret lives.
import { Refused } from "../errors.mjs";
import { readState, writeState } from "../store/control.mjs";
import { STALE_REVISION, checkRevision, revisionFor } from "../store/revisioned.mjs";
import { withLock } from "../store/lock.mjs";
import { zoneOf } from "./window.mjs";

export const SETTINGS_SCHEMA = 1;

export const DEFAULTS = { provider: null, connection: null, scope: {}, docs: null, period: { months: 2 }, timezone: null, output: { dir: null, formats: ["html"] }, sections: {}, mapping: {}, assumptions: {}, parts: {}, retention: 20 };

const KNOWN = new Set([...Object.keys(DEFAULTS), "revision", "updatedAt", "updatedBy", "schema"]);
const MAPPING = new Set(["bots", "aiMarkers", "areas", "iterations", "aiHeavyThreshold", "states"]);

// { providers } is the pack's list of provider descriptors.
export function settingsProblems(doc, { providers = [] } = {}) {
  const wrong = [...Object.keys(doc).filter((k) => !KNOWN.has(k)).map((k) => `unknown setting "${k}"`)];
  return [...wrong, ...RULES.filter((r) => r.fails(doc, providers)).map((r) => r.says(doc, providers))];
}

const providerOf = (doc, providers) => providers.find((p) => p.id === doc.provider) ?? null;

const scopeKeys = (p) => new Set((p?.scope?.fields ?? []).map((f) => f.name));

// A scope field may declare the shape its value must have and the sentence that
// says so -- the provider knows what its source refuses, this file does not.
const misfits = (d, ps) => (providerOf(d, ps)?.scope?.fields ?? []).filter((f) => f.pattern && typeof d.scope?.[f.name] === "string" && !new RegExp(f.pattern, "u").test(d.scope[f.name]));

// Ordered; each asked only when its setting is present. A credential-looking
// key anywhere is refused before the rest is even read.
const RULES = [
  { fails: (d) => /"(token|pat|password|secret|credential)"\s*:/i.test(JSON.stringify(d)), says: () => "a credential is never a setting: name a connection, and set its credential in Orbit Control" },
  { fails: (d, ps) => d.provider !== null && d.provider !== undefined && !providerOf(d, ps), says: (d, ps) => `provider must be one of ${ps.map((p) => p.id).join(", ")}` },
  { fails: (d) => d.connection !== null && d.connection !== undefined && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(String(d.connection)), says: () => "connection is a connection id, e.g. source-acme" },
  { fails: (d, ps) => providerOf(d, ps) && Object.keys(d.scope ?? {}).some((k) => !scopeKeys(providerOf(d, ps)).has(k)), says: (d, ps) => `a ${d.provider} scope may name ${[...scopeKeys(providerOf(d, ps))].join(", ")}` },
  { fails: (d, ps) => misfits(d, ps).length > 0, says: (d, ps) => misfits(d, ps).map((f) => `scope.${f.name}: ${f.says ?? `does not have the shape ${f.pattern}`}`).join("; ") },
  { fails: (d) => d.period && (!Number.isInteger(d.period.months) || d.period.months < 1 || d.period.months > 60), says: () => "period.months is a whole number from 1 to 60" },
  { fails: (d) => d.timezone !== null && d.timezone !== undefined && !zoneKnown(d.timezone), says: (d) => `${d.timezone} is not a time zone this machine knows (an IANA name, e.g. Asia/Ho_Chi_Minh)` },
  { fails: (d) => d.output?.dir !== null && d.output?.dir !== undefined && !isAbsolutePath(d.output.dir), says: () => "output.dir is an absolute path" },
  { fails: (d) => Object.keys(d.mapping ?? {}).some((k) => !MAPPING.has(k)), says: () => `mapping may name ${[...MAPPING].join(", ")}` },
  { fails: (d) => Object.values(d.sections ?? {}).some((v) => typeof v !== "boolean"), says: () => "sections maps a section id to true or false" },
  { fails: (d) => Object.values(d.parts ?? {}).some((v) => typeof v?.enabled !== "boolean"), says: () => "parts maps a part id to { enabled: true|false }" },
  { fails: (d) => d.retention !== undefined && (!Number.isInteger(d.retention) || d.retention < 1 || d.retention > 500), says: () => "retention is how many runs to keep, 1 to 500" },
];

function zoneKnown(tz) {
  try { return Boolean(zoneOf(tz)); }
  catch { return false; }
}

const isAbsolutePath = (p) => typeof p === "string" && (/^\//.test(p) || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p));

// The content the revision is taken over: the settings, keys sorted, without
// the fields that record the write itself.
export const revisionOf = (doc) => revisionFor(content(doc));

const content = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => !["revision", "updatedAt", "updatedBy", "schema", "unreadable"].includes(k)));


// The settings as stored, with every default filled in, and whether a document
// exists at all.
export function readSettings(room, io) {
  const stored = readState(io, room.settings, {}, SETTINGS_SCHEMA);
  if (stored.unreadable) throw new Refused(`report settings: ${stored.unreadable}; file unchanged`);
  const exists = io.exists(room.settings);
  const doc = { ...DEFAULTS, ...content(stored) };
  return { exists, settings: doc, revision: exists ? revisionOf(doc) : null, unreadable: stored.unreadable ?? null };
}

// { next: whole settings, revision: what the writer read, by: who } -> the kept document.
export function writeSettings(room, io, { next, revision, by, providers, now }) {
  io.ensureDir(room.root);
  return withLock(room.root, () => kept(room, io, { next, revision, by, providers, now }), io);
}

function kept(room, io, w) {
  const current = readSettings(room, io);
  checkRevision(current, w, "report settings");
  const doc = holding({ ...DEFAULTS, ...content(w.next) }, w.providers);
  writeState(io, room.settings, { ...doc, revision: revisionOf(doc), updatedAt: w.now, updatedBy: w.by }, SETTINGS_SCHEMA);
  return { ...doc, revision: revisionOf(doc) };
}

// Its own code (src/store/revisioned.mjs), so a page can say "somebody changed
// these" rather than "wrong".
export { STALE_REVISION };

function holding(doc, providers) {
  const wrong = settingsProblems(doc, { providers });
  if (wrong.length) throw new Refused(`these report settings do not hold: ${wrong.join("; ")}`);
  return doc;
}

// `a.b.c=value` onto a settings object; the value is JSON when it parses as
// JSON, else the text itself.
export function setPath(doc, path, raw) {
  const keys = String(path).split(".");
  if (!keys.every((k) => /^[A-Za-z0-9_.-]+$/.test(k))) throw new Refused(`${path} is not a settings path`);
  return assigned(structuredClone(doc), keys, valueOf(raw));
}

function assigned(doc, keys, value) {
  const parent = keys.slice(0, -1).reduce((node, k) => (node[k] ??= {}), doc);
  parent[keys.at(-1)] = value;
  return doc;
}

function valueOf(raw) {
  try { return JSON.parse(raw); }
  catch { return raw; }
}
