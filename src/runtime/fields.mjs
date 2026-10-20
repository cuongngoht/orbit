// The SHAPE of a runtime fact, declared once and enforced from the declaration
// by src/constraints.mjs -- the leaf that holds an architecture fact, a case
// field and a project.json key to what their own tables say.
//
// A fact belongs to ONE checkout (`checkout`, stamped), and that is the whole
// reason this is not an architecture fact: the same repository on two branches
// has two sets of these, and a store that keyed them by project would hand one
// branch's manifest to the other.
//
// `verifiedAgainstSource` is not a field: it is read off the fact's `source` row
// (`verifiedBy`), so an inference cannot promote itself by setting a boolean.
import { COMPONENT_KIND_NAMES, CONFIDENCE_NAMES, DEPENDENCY_VIA, KIND_NAMES, PURPOSE_NAMES, PROBE_NAMES, SOURCE_NAMES, STAGES, STATUS_NAMES, fieldsOf } from "./vocab.mjs";

export const COMMON_FIELDS = {
  id: { type: "string", pattern: "^rt-[a-z][a-z0-9-]*-[0-9a-f]{6,12}$", doc: "Stable id: rt-<kind>-<hash of the subject>. Derived from what the fact is ABOUT, so deriving the same fact again rewrites one file rather than appending a twin." },
  kind: { enum: KIND_NAMES, doc: "What kind of thing this is. Decides which extra fields are allowed." },
  key: { type: "string", doc: "What this fact is ABOUT. The id is derived from kind and key." },
  statement: { type: "string", doc: "One sentence, built from a template filled with computed values. Never free text out of a file: that reaches `evidence`, through `quote`, and nothing else." },
  scope: { type: "array", items: { type: "string" }, minItems: 1, doc: "The repo-relative paths this fact is ABOUT. Freshness is measured over exactly these." },
  fingerprint: { type: "string", doc: "What the scope hashed to when this was recorded." },
  evidence: { type: "array", items: { type: "string" }, minItems: 1, doc: "Tracked paths a reader can open. A path nothing tracks is refused when a fact is recorded." },
  source: { enum: SOURCE_NAMES, doc: "Where it came from. Whether that counts as verified is read off the table." },
  confidence: { enum: CONFIDENCE_NAMES, doc: "How sure, not how important." },
  status: { enum: STATUS_NAMES, doc: "Whether the scope has moved since. `stale` means re-read it, and never means false." },
  because: { type: "string", doc: "Why this confidence and not a higher one." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What this fact could NOT determine. Always present, even when empty." },
  checkout: { type: "string", pattern: "^[a-f0-9]{16,64}$", doc: "The checkout this fact is about. Stamped by the store, never asked for." },
  at: { type: "string", doc: "When it was recorded. Stamped." },
  commit: { type: "string", doc: "The source commit it was recorded against. Structural: never masked." },
};

export const KIND_FIELDS = {
  name: { type: "string", doc: "The name its file gives it: a component's display name, or a compose service's own name -- the one a definition's `service` and a compose command use." },
  dir: { type: "string", doc: "The repo-relative directory a component lives in; `.` for the root." },
  componentKind: { enum: COMPONENT_KIND_NAMES, doc: "What kind of component this is." },
  ecosystem: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The ecosystem adapter or script runner that evidenced a component." },
  component: { type: "string", doc: "The key of the component this is about. Absent: the whole checkout." },
  requirement: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The requirement id, as the ecosystem reports it." },
  range: { type: "string", doc: "The version range as the file wrote it, or a range derived from a pin." },
  stage: { enum: STAGES, doc: "What the requirement is needed for: to run the component, or only to develop and test it. Absent means run." },
  purpose: { enum: PURPOSE_NAMES, doc: "What the command is for, read off the name the project gave it." },
  declaredAs: { type: "string", doc: "The name the project gave the command." },
  text: { type: "string", doc: "The command as its file spells it. Shown, never run through a shell." },
  argv: { type: "array", items: { type: "string" }, doc: "The command as an argument list, when it can be run without a shell. Empty otherwise." },
  cwd: { type: "string", doc: "The repo-relative directory it runs in." },
  runner: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The requirement id of whatever runs it." },
  safe: { type: "boolean", doc: "Whether argv can be launched as it is. False says why in `because`." },
  dependsOn: { type: "string", doc: "The key of the component this one depends on. Absent when the reference matched no unit this read found: unknown, never unrelated." },
  reference: { type: "string", doc: "What the file wrote: a path, a unit's name, or the shared file inherited." },
  via: { enum: DEPENDENCY_VIA, doc: "How the dependency is evidenced: the unit's own manifest, or a shared file that reaches it." },
  port: { type: "integer", minimum: 1, maximum: 65535, doc: "The TCP port." },
  ports: { type: "array", items: { type: "integer" }, doc: "The TCP ports a command listens on, when the file that declares it says so per command. Absent: whichever the component declares." },
  portOverride: { type: "object", doc: "How a command is told which port to listen on: an environment variable (`kind: env`, `name`) or an argument (`kind: argv`, `flag`), and a `format` holding `{port}` once. Evidence a project declares, never a guess; a command without one has a fixed port." },
  implied: { type: "boolean", doc: "True when the command is not one a file declared but one the catalog says every unit of its ecosystem has (restoring its dependencies)." },
  service: { type: "string", doc: "A server's name: the catalog id when its image is known, else the name the file gave it." },
  image: { type: "string", doc: "The image reference a service was declared with." },
  probe: { enum: PROBE_NAMES, doc: "How readiness is asked." },
  target: { type: "string", doc: "What the probe is asked of: a port, a URL, a command." },
  mechanism: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "Which environment mechanism an existing definition is for." },
  definition: { type: "object", doc: "A summary of an environment definition: what it provides, by name. Never a command it runs and never a value it sets." },
  os: { type: "array", items: { type: "string" }, doc: "Platform ids." },
  exclusive: { type: "boolean", doc: "True only when a file says nothing but these will do." },
};

export const FACT_FIELDS = { ...COMMON_FIELDS, ...KIND_FIELDS };

export const STAMPED = ["at", "commit", "status", "fingerprint", "checkout"];

export const REQUIRED = ["kind", "key", "statement", "scope", "evidence", "source", "confidence"];

export const COMMON_NAMES = Object.keys(COMMON_FIELDS);

export const allowedOn = (kind) => [...COMMON_NAMES, ...fieldsOf(kind)];

export const misplacedOn = (kind, key) => key in KIND_FIELDS && !allowedOn(kind).includes(key);
