// What a CAPABILITY is, version 1, as DATA.
//
// A capability is one named thing this engine can ask of the world outside the
// browser and outside the one database `sql` already knows about: read a row from
// somebody's PostgreSQL, ask a vendor's SDK whether a document really landed,
// look in a queue. The engine holds no list of those and never will -- a row here
// naming one would be a product learned (AGENTS.md's last extension rule).
//
// The ID is NAMESPACED, and that is a rule rather than a style. `query` and
// `get` are words two providers will both want; `postgres.query` and
// `msgraph.driveItem.get` are words only one can mean. A project's own,
// ungeneralisable operation says so out loud: `project.<domain>.<operation>`.
//
// Why capabilities and not verbs. A verb is GRAMMAR -- every case, every report
// column and every coverage denominator is shaped by the set of them, and the set
// has stayed at twelve through four releases because growing it is expensive. A
// provider is not grammar; it is a thing you can ask. So providers grow and the
// grammar does not: one `call` verb, any number of capabilities behind it. That
// is the whole trade, and it is why there is no `postgres` verb.

export const CAPABILITY_API = "orbit.capability/v1";
export const SUPPORTED_CAPABILITY_APIS = [CAPABILITY_API];

// Two segments at least, lowercase, dot-separated. `postgres.query` passes,
// `query` does not -- and that refusal is the point.
export const CAPABILITY_ID = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

// A connection's provider, spelled as its descriptor spells it: a lowercase slug.
export const CONNECTION_PROVIDER = "^[a-z][a-z0-9-]{0,47}$";

export const CAPABILITY_FIELDS = {
  id: { type: "string", pattern: CAPABILITY_ID.source, doc: "Namespaced name, e.g. postgres.query. Two segments at least: a bare \"query\" is a word two providers would both claim." },
  apiVersion: { type: "string", enum: SUPPORTED_CAPABILITY_APIS, doc: "Which published contract this was written against." },
  doc: { type: "string", doc: "One line: what asking this tells you." },
  inputSchema: { type: "object", doc: "A field table for `input`, same shape as a DSL field row — constraints.mjs enforces it, so a wrong input is a sentence, not a stack trace. A row may say `bind: <kind>` (src/topology/vocab.mjs BIND_KINDS): its value is then a logical ALIAS the binding gate resolves for this run, and the resolved value reaches only the helper, never this code." },
  required: { type: "array", items: { type: "string" }, doc: "Which input keys must be present." },
  mutates: { type: "boolean", doc: "true if invoking it can change external state. Read-only verification is what QC should prefer; declaring otherwise is what lets the engine guard it." },
  tools: { type: "array", items: { type: "string" }, doc: "External commands it needs on PATH. query doctor reports a missing one BEFORE a run fails somewhere that reads like a product defect." },
  timeoutSec: { type: "integer", minimum: 1, doc: "How long one invocation may take. The engine's default applies when this is unset." },
  provides: { type: "array", items: { type: "string" }, doc: "Semantic capabilities this one answers besides its own id, e.g. workitem.read. The resource registry lists it as a provider of each, so a need names the capability and never this adapter -- and a different provider can take its place." },
  connection: { type: "string", pattern: CONNECTION_PROVIDER, doc: "The provider of the CONNECTION it needs (a credential REFERENCE a person set up). It is refused, as Blocked, when no such connection exists here; the engine hands the credential to the command it spawns and never to this code." },
  page: { type: "boolean", doc: "false if it never touches ext.browser. A case made only of sql and call steps asking such capabilities runs with no browser at all; unset means it may, and the run then needs a page (src/dsl/page.mjs)." },
  effects: { type: "array", items: { type: "string" }, doc: "What invoking it does to the world (src/topology/vocab.mjs EFFECTS). A mutating effect is what a test grant is minted for (ADR 0037); an observation that takes a message is `consume`, however it is named." },
  outputs: { type: "object", doc: "Each field of its answer and the MEANING it carries (src/topology/vocab.mjs MEANINGS), so a compiled assertion reads a field by what it means, never by a provider's name for it." },
  helper: { type: "object", doc: "The helper program it reaches through ext.helper.run (ADR 0036): {argv, runIn, image}. An argument list, never a shell line; where it runs is the launcher's decision, never this declaration's." },
};

export const CAPABILITY_REQUIRED = ["id", "apiVersion", "doc"];

// What `provides` may hold. The one statement of it: the registry asks it of every
// capability that registers, and the loader asks it BEFORE the first registration
// (its registries are append-only, so a bad second capability must not leave a
// first one behind).
export const providesFindings = (cap, at) => (Array.isArray(cap?.provides) ? cap.provides : []).filter((p) => typeof p !== "string" || !CAPABILITY_ID.test(p)).map((p) => `${at}: provides "${String(p).slice(0, 40)}" is not a capability id`);

// A capability that MUTATES is guarded the way a destructive case is: nothing
// runs it by accident. Named here so the guard and the declaration are one word
// apart and cannot drift.
export const MUTATING = "mutates";
