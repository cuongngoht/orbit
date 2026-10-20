// An ENVIRONMENT PROPOSAL: what the designer worked out, kept as a document a
// person reviews -- and the record of what it was worked out FROM, so adopting it
// can tell whether that is still true.
//
// A proposal rests on two things that can move while somebody reads it. The
// checkout's runtime understanding can (a manifest was edited and discovery read
// it again), and the environment files can (a developer opened `devcontainer.json`
// and changed it). So it records BOTH: a digest of the understanding it was
// designed from, and the fingerprint of every environment file it considered or
// would write -- `null` for a file that must not exist yet. Adoption compares
// them to now, and a proposal that no longer matches is STALE_PROPOSAL, never an
// overwrite of whatever is there.
//
// Its id is a hash of exactly what it would do: the same understanding and the
// same files design the same proposal, and any change to what would be written is
// a different id. That is what makes the id the revision a person approves.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { canonicalJson, sha, short } from "../hash.mjs";
import { readState, writeState } from "../store/control.mjs";

export const PROPOSAL_SCHEMA = 1;

export const STALE_PROPOSAL = "STALE_PROPOSAL";

const ID = /^ep-[a-f0-9]{12}$/;

// The understanding a design rested on: which facts, at which fingerprints, read by
// what. A fact that is re-derived to the same value changes nothing here.
export const understandingDigest = (facts, readers) => short(sha(canonicalJson({ readers, facts: facts.map((f) => [f.id, f.fingerprint ?? null, f.status]).sort() })), 16);

// The fingerprint of an environment file as it is on the disk: its content's hash,
// or null when it is not there.
export const fingerprintOf = (text) => (text === null || text === undefined ? null : sha(text));

// -> the proposal document. `body` is the designer's answer; `rest` is what the
// proposal rests on: { checkout, understanding, environment: { path: fingerprint }, now }.
export function build(body, rest) {
  const kept = { state: body.state, because: body.because, definition: body.definition, files: body.files, gaps: body.gaps.map(({ id, state, because }) => ({ id, state, because })), unresolved: body.unresolved, risks: body.risks, notes: body.notes };
  const content = { ...kept, checkout: rest.checkout, understanding: rest.understanding, environment: rest.environment };
  return { schema: PROPOSAL_SCHEMA, id: `ep-${short(sha(canonicalJson(content)), 12)}`, ...content, status: "open", createdAt: rest.now };
}

// What a person may adopt: only a proposal that WRITES something.
export const adoptable = (proposal) => ["CREATE", "PATCH"].includes(proposal.state);

// Is what a proposal rests on still true? -> { fresh: true } | { fresh: false, why }
export function freshness(proposal, now) {
  if (now.understanding !== proposal.understanding) return { fresh: false, why: "the checkout's runtime understanding changed since this was designed" };
  const paths = Object.keys({ ...proposal.environment, ...now.environment });
  const moved = paths.find((path) => (now.environment[path] ?? null) !== (proposal.environment[path] ?? null));
  return moved ? { fresh: false, why: `${moved} changed since this was designed` } : { fresh: true };
}

export const stale = (why) => Object.assign(new Refused(`${STALE_PROPOSAL}: ${why} — design it again before adopting`), { code: STALE_PROPOSAL });

export function createProposals(room, io) {
  const file = (id) => join(room, `${id}.json`);
  return { list: () => io.list(room).filter((n) => n.endsWith(".json")).map((n) => read(io, file, n.replace(/\.json$/, ""))).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), read: (id) => read(io, file, id), write: (doc) => writeState(io, file(doc.id), doc, PROPOSAL_SCHEMA) };
}

function read(io, file, id) {
  if (!ID.test(id)) return null;
  const doc = readState(io, file(id), {}, PROPOSAL_SCHEMA);
  return doc.id === id ? doc : null;
}
