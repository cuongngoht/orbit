// What a generated playbook's manifest may SAY, and what it may never say. A field the engine stamps --
// its status, digest, version, when and by whom it was registered -- is refused by name when a draft
// brings it: a model writes a playbook, the lifecycle decides what it is.
//
// Its current CONTRACT: its `shape`, what it
// takes (`inputs`), what it gives back (`outputs`), what a host following it can show (`evidence`), and what
// it never does (`restrictions`). The scaffold writes them from the shape -- a host writes only the
// playbook's .md text and the needs it declares -- and they are held, like every word of the manifest, to
// the text rules (no hidden characters, no override text, no secret).
//
//   manifestFindings(raw) -> [{ id, says }]
import { SHAPE_IDS } from "./gap.mjs";
import { MANIFEST_SCHEMA, SCOPES } from "./vocab.mjs";

const CAPABILITY = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
const isList = (v, re) => Array.isArray(v) && v.length <= 16 && v.every((x) => typeof x === "string" && re.test(x));
const isText = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

// What following a playbook can SHOW: a record an owner keeps and a listed Orbit command reads back, or a
// report -- which proves nothing (src/automation/outcome.mjs keeps a followed playbook REPORTED).
export const EVIDENCE = ["owner-record", "report"];

export const FIELDS = {
  schema: { required: true, ok: (v) => v === MANIFEST_SCHEMA, say: `schema is ${MANIFEST_SCHEMA}` },
  id: { required: true, ok: (v) => typeof v === "string", say: "id names the playbook" },
  origin: { required: true, ok: (v) => v === "generated", say: 'origin is "generated" — a playbook a workflow drafted, never a shipped skill' },
  scope: { required: true, ok: (v) => SCOPES.includes(v), say: `scope is one of ${SCOPES.join(", ")}` },
  provides: { required: true, ok: (v) => isList(v, CAPABILITY) && v.length > 0, say: "provides is a list of capability words (dotted, lower case), at least one" },
  needs: { required: true, ok: (v) => isList(v, CAPABILITY), say: "needs is a list of capability words — what following the playbook needs to be provided here" },
  optional: { required: false, ok: (v) => isList(v, CAPABILITY), say: "optional is a list of capability words" },
  signals: { required: false, ok: (v) => isList(v, /^[a-z0-9][a-z0-9 -]{1,40}$/), say: "signals are short lower-case phrases" },
  workflow: { required: true, ok: (v) => typeof v === "string" && /^orbit-[a-z0-9-]+$/.test(v), say: "workflow names the shipped skill the playbook was drafted under — its tools are the widest the playbook may name" },
  allowedTools: { required: true, ok: (v) => Array.isArray(v) && v.length <= 16 && v.every((x) => typeof x === "string" && x.length <= 200), say: "allowedTools is a list of at most 16 tools" },
  sourceTask: { required: false, ok: (v) => /^tsk-[a-f0-9]{12}$/.test(String(v)), say: "sourceTask is the tsk- id of the workflow that drafted it" },
  generationReason: { required: true, ok: (v) => isText(v, 240), say: "generationReason is one sentence of at most 240 characters" },
  engine: { required: true, ok: (v) => isText(v, 40), say: "engine is the range of Orbit versions it was drafted for (>=1.8.1)" },
  shape: { required: true, ok: (v) => SHAPE_IDS.includes(v), say: `shape is one of ${SHAPE_IDS.join(", ")}` },
  inputs: { required: true, ok: (v) => isText(v, 240), say: "inputs is one sentence of at most 240 characters: what following the playbook starts from" },
  outputs: { required: true, ok: (v) => isText(v, 240), say: "outputs is one sentence of at most 240 characters: what following it gives back" },
  evidence: { required: true, ok: (v) => EVIDENCE.includes(v), say: `evidence is one of ${EVIDENCE.join(", ")}: what a host following it can show` },
  restrictions: { required: true, ok: (v) => isText(v, 240), say: "restrictions is one sentence of at most 240 characters: what it never does" },
};

// What the lifecycle writes, and a draft may never bring.
export const STAMPED = ["status", "digest", "version", "createdAt", "verifiedAt", "engineVersion", "registeredBy", "validation", "approved"];

export function manifestFindings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [{ id: "SF_MANIFEST_SHAPE", says: "manifest.json is one JSON object" }];
  const stamped = STAMPED.filter((k) => k in raw).map((k) => ({ id: "SF_MANIFEST_STAMPED", says: `${k} is the engine's to stamp — a draft may not carry it` }));
  const unknown = Object.keys(raw).filter((k) => !(k in FIELDS) && !STAMPED.includes(k)).map((k) => ({ id: "SF_MANIFEST_SHAPE", says: `${k} is not a manifest field` }));
  const bad = Object.entries(FIELDS).filter(([k, f]) => (raw[k] === undefined ? f.required : !f.ok(raw[k]))).map(([, f]) => ({ id: "SF_MANIFEST_SHAPE", says: f.say }));
  return [...stamped, ...unknown, ...bad];
}
