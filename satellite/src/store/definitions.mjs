// The four kinds of REUSABLE definition -- a role, an agent template, a skill and a workflow template -- share one
// record shape and one write door. A published version is IMMUTABLE: written once with writePrivate (refused when
// anything is already at the path, so a planted link is never followed), and named by its content,
// <room>/<id>/<version>-<digest8>.json. The same content again is the version already there, never a second one; new
// content under the same id is the next version. A mission PINS id:version:digest8 and reads exactly that version
// back, its digest checked again, whatever was registered after it. A pin never outranks a revocation (registry.mjs).
//
//   { api, id, kind, schemaVersion, version, contentDigest, scope, provenance, dependencies, compatibility,
//     validationStatus, evidenceRefs, content }
//
// `contentDigest` is taken over what the definition SAYS (id, kind, schema, scope, dependencies, compatibility,
// content) and never over what the engine stamps (version, provenance, validation, evidence): the same role proposed
// by two missions is one definition.
import { join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { canonicalJson, sha } from "../../../src/hash.mjs";
import { withLock } from "../../../src/store/lock.mjs";
import { DEFINITION_KINDS, kindOfId } from "./rooms.mjs";
import { isObject, quietly, refused } from "./text.mjs";

export const DEFINITION_API = "orbit.satellite.definition/v1";

export const STAMPED = Object.freeze(["api", "version", "contentDigest", "provenance", "validationStatus", "evidenceRefs"]);

export const DIGESTED = Object.freeze(["id", "kind", "schemaVersion", "scope", "dependencies", "compatibility", "content"]);

export const ID = /^(rol|atp|skl|wft)-[a-z0-9][a-z0-9-]{0,47}$/;

export const PIN = /^((?:rol|atp|skl|wft)-[a-z0-9][a-z0-9-]{0,47}):(\d{1,4})\.(\d{1,4})\.(\d{1,4}):([0-9a-f]{8})$/;

const FILE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})-([0-9a-f]{8})\.json$/;

const BUSY = "another session is registering a Satellite definition for this project — try again in a moment";

export const digestOf = (record) => sha(canonicalJson(Object.fromEntries(DIGESTED.map((k) => [k, record?.[k] ?? null]))));

export const pinOf = (r) => `${r.id}:${r.version}:${r.contentDigest.slice(0, 8)}`;

export const parsePin = (pin) => ((m) => (m ? { id: m[1], version: `${Number(m[2])}.${Number(m[3])}.${Number(m[4])}`, digest8: m[5], kind: kindOfId(m[1]) } : null))(PIN.exec(String(pin ?? "")));

const parseFileName = (name) => ((m) => (m ? { version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`, digest8: m[4], name } : null))(FILE.exec(String(name)));

export const compareVersions = (a, b) => ((x, y) => x.map((n, i) => n - y[i]).find((d) => d !== 0) ?? 0)(String(a).split(".").map(Number), String(b).split(".").map(Number));

const bumped = (version) => (version ? version.split(".").map(Number).map((n, i) => (i === 2 ? n + 1 : n)).join(".") : "1.0.0");

const roomOf = (rooms, kind) => rooms.definitions[kind];

const parsed = (text) => quietly(() => JSON.parse(text));

// What a kept file must be to be read at all: this API, the id and version its path names, and the digest it claims
// taken again over what it says -- a file edited by hand is CORRUPT, listed and never offered.
const intactOf = (record, id, f) => isObject(record) && record.api === DEFINITION_API && record.id === id && record.version === f.version && record.contentDigest === digestOf(record) && record.contentDigest.slice(0, 8) === f.digest8;

const rowOf = (io, rooms, kind, id, f) => ((file) => ((record) => ({ id, kind, version: f.version, digest8: f.digest8, file, pin: `${id}:${f.version}:${f.digest8}`, record: intactOf(record, id, f) ? record : null, corrupt: !intactOf(record, id, f) }))(parsed(io.read(file))))(join(roomOf(rooms, kind), id, f.name));

// Every version kept under one id, oldest first.
export const versionsOf = (io, rooms, kind, id) => io.list(join(roomOf(rooms, kind), id)).map(parseFileName).filter(Boolean).map((f) => rowOf(io, rooms, kind, id, f)).sort((a, b) => compareVersions(a.version, b.version));

// Every version of every definition of one kind, rebuilt from the files on every read: no index is kept to drift.
export const allOf = (io, rooms, kind) => io.list(roomOf(rooms, kind)).filter((id) => ID.test(id) && kindOfId(id) === kind).flatMap((id) => versionsOf(io, rooms, kind, id));

// proposed: { id, kind, schemaVersion, scope, dependencies, compatibility, content, provenance, evidenceRefs }
// -> { reused, pin, record }
export function writeDefinition(io, rooms, proposed) {
  io.ensureDir(rooms.registry);
  return withLock(rooms.registry, () => published(io, rooms, proposed), io, BUSY);
}

function published(io, rooms, proposed) {
  const digest = digestOf(proposed);
  const rows = versionsOf(io, rooms, proposed.kind, proposed.id);
  const same = rows.find((r) => r.record?.contentDigest === digest);
  return same ? { reused: true, pin: same.pin, record: same.record } : written(io, rooms, proposed, digest, bumped(rows.at(-1)?.version));
}

function written(io, rooms, proposed, digest, version) {
  const record = { api: DEFINITION_API, id: proposed.id, kind: proposed.kind, schemaVersion: proposed.schemaVersion ?? 1, version, contentDigest: digest, scope: proposed.scope ?? "project", provenance: proposed.provenance ?? null, dependencies: proposed.dependencies ?? [], compatibility: proposed.compatibility ?? {}, validationStatus: "registered", evidenceRefs: proposed.evidenceRefs ?? [], content: proposed.content };
  io.writePrivate(join(roomOf(rooms, proposed.kind), proposed.id, `${version}-${digest.slice(0, 8)}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return { reused: false, pin: pinOf(record), record };
}

// A pin read back: the exact version it names, intact, or a refusal that says which.
export function readDefinition(io, rooms, pin) {
  const p = parsePin(pin);
  if (!p?.kind || !DEFINITION_KINDS[p.kind]) throw refused(Refused, "PIN_INVALID", `${pin} is not a definition pin (<rol|atp|skl|wft>-<name>:<version>:<digest8>)`);
  const row = versionsOf(io, rooms, p.kind, p.id).find((r) => r.version === p.version && r.digest8 === p.digest8);
  if (!row || row.corrupt) throw refused(Refused, row ? "DEFINITION_CORRUPT" : "PIN_UNKNOWN", row ? `${pin} no longer holds what was registered: its file was changed after it was published` : `no definition ${pin} is kept in this project's store`);
  return row.record;
}
