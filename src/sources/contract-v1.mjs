// What a REQUIREMENT SOURCE is, version 1, as DATA -- and nothing about any
// provider of one.
//
// A team's requirement lives in somebody else's system: a work item, a ticket, an
// issue, a document. This engine asks for it through SEMANTIC capabilities
// (`workitem.read`, ...) and never through a provider: which reader answers is a
// binding the resolver decides today and can decide differently tomorrow, so no
// row here names a vendor, a product, a host or a stack. A provider's words
// (its URL shapes, its relation names, the commands it needs) arrive as DESCRIPTOR
// data in a pack under skills/, which is the boundary AGENTS.md draws.
//
// What a source keeps is what src/investigation/input.mjs already keeps for a
// requirement file (ADR 0007): where it came from, which revision, a digest, whose
// word it is, when it was read and its state -- never its text.
import { CAPABILITY_ID } from "../capability/contract-v1.mjs";

export const SOURCE_API = "orbit.source/v1";

// The acquisition vocabulary. `required`: a reader that cannot answer the first is
// not a reader of work items at all; the rest enrich what the first returned.
export const ACQUISITION = [
  { id: "workitem.read", returns: "workitem", required: true, doc: "one work item: title, state, revision, description and acceptance criteria" },
  { id: "workitem.relations.read", returns: "relations", required: false, doc: "the items this one is related to: parent, children, related" },
  { id: "workitem.comments.read", returns: "comments", required: false, doc: "the discussion on the item" },
  { id: "workitem.history.read", returns: "revisions", required: false, doc: "the revisions the item has had" },
];

export const ACQUISITION_IDS = ACQUISITION.map((a) => a.id);

// WHAT MAY BEAR requirement authority. `authorityBearing: false` is context only:
// an implementation artefact can be recorded and cited as background, and can never
// settle what the requirement says -- what a product does today is not what it
// should do. A rule asks the COLUMN, never a kind's name.
export const SOURCE_KINDS = [
  { id: "workitem", authorityBearing: true, doc: "the root work item, or a parent, child or related requirement item" },
  { id: "criteria", authorityBearing: true, doc: "acceptance criteria attached to a work item" },
  { id: "comment", authorityBearing: true, doc: "requirement discussion on the item" },
  { id: "doc", authorityBearing: true, doc: "a business or specification document a person named" },
  { id: "decision", authorityBearing: true, doc: "a person's recorded answer -- always the team's word" },
  { id: "pr", authorityBearing: false, doc: "a pull request -- implementation context" },
  { id: "commit", authorityBearing: false, doc: "a commit -- implementation context" },
  { id: "code", authorityBearing: false, doc: "source code -- implementation context" },
  { id: "test", authorityBearing: false, doc: "an existing test -- implementation context" },
];

export const SOURCE_KIND_NAMES = SOURCE_KINDS.map((k) => k.id);

export const kindRow = (id) => SOURCE_KINDS.find((k) => k.id === id) ?? null;

export const authorityBearing = (kind) => kindRow(kind)?.authorityBearing === true;

// ADR 0007's two words. A test holds them equal to the plan's own.
export const AUTHORITIES = ["accepted", "draft"];

// What a source record can be in. `context`: recorded, cited as background, never read.
export const SOURCE_STATES = ["read", "unavailable", "anomaly", "context"];

// WHAT KIND of reader answered. `pack` is a reader a skill ships, `mcp` one a managed
// server provides through the broker, `capability` a project's own registered one.
export const READER_KINDS = ["capability", "mcp", "pack"];

// `resolves(ref)` answers an identity or null and touches nothing. `read(identity,
// capability)` returns a PROMISE of a (partial) work item -- a broker call and a
// network request are both asynchronous, and one port must hold either.
export const READER_METHODS = ["resolves", "read"];

// A reader is judged by what it declares, before anything asks it anything.
export function readerProblems(reader) {
  if (typeof reader !== "object" || reader === null) return ["a reader must be an object"];
  const at = `reader ${reader.key ?? "?"}`;
  return [...keyProblems(reader, at), ...providesProblems(reader, at), ...methodProblems(reader, at)];
}

const keyProblems = (r, at) => [...(typeof r.key === "string" && r.key ? [] : [`${at}: needs a key`]), ...(READER_KINDS.includes(r.kind) ? [] : [`${at}: kind must be ${READER_KINDS.join(", ")}`])];

const providesProblems = (r, at) => (Array.isArray(r.provides) && r.provides.length && r.provides.every((p) => ACQUISITION_IDS.includes(p)) ? [] : [`${at}: provides must list acquisition capabilities (${ACQUISITION_IDS.join(", ")})`]);

const methodProblems = (r, at) => READER_METHODS.filter((m) => typeof r[m] !== "function").map((m) => `${at}: needs a ${m}() method`);

// The acquisition ids are capability ids like any other, so the registry, the
// resolver and a generated adapter can all speak of them without a second grammar.
export const acquisitionIdsValid = () => ACQUISITION_IDS.every((id) => CAPABILITY_ID.test(id));
