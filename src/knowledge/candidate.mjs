// What a knowledge CANDIDATE may say -- the Specification a proposal is held to
// before reconciliation ever sees it. src/engineering/candidate.mjs's
// discipline, over claims.
//
// A candidate is not a claim. It is one observation's word about a triple in a
// context, and the difference is exactly the fields the engine owns (STAMPED):
// its id (derived), how sure (derived from independent sessions), when and
// against what (stamped). Every rule across two fields is a row in SPECS, one
// sentence each, and none of them names a source, a strength or a layer: each
// reads the column on its vocab row.
import { constraintFindings } from "../constraints.mjs";
import { CANDIDATE_REQUIRED, ENVELOPE_FIELDS, STAMPED } from "./fields.mjs";
import { claimFindings, claimId, isObject } from "./model.mjs";
import { claimableByObserver, needsGate, recordable, stampedOnly, storedAt, strengthsFor } from "./vocab.mjs";

const SPECS = [
  {
    broken: (c, w) => !w.trusted && !claimableByObserver(c.strength),
    say: (c) => `strength "${c.strength}" may not be claimed by a candidate — only an explicit --human record may set enforced or adopted`,
  },
  {
    broken: (c) => needsGate(c.strength) && !(c.enforcedBy ?? []).length,
    say: (c) => `strength "${c.strength}" needs enforcedBy: the gate or test that enforces it. A person saying so buys adopted, not enforced`,
  },
  {
    broken: (c, w) => needsGate(c.strength) && ungated(c, w).length > 0,
    say: (c, w) => `enforcedBy ${ungated(c, w).map((p) => `"${p}"`).join(", ")} is not a gate this engine can see — no architecture invariant cites it and the source is not test-suite`,
  },
  {
    broken: (c, w) => stampedOnly(c.source) && !w.stamped,
    say: (c) => `a ${c.source} claim is the engine's own, recorded through its stamped door from a record it keeps — it is never typed in`,
  },
  {
    broken: (c) => !recordable(c.source),
    say: (c) => `a ${c.source} claim is never recorded — a host's memory is context for one invocation. Confirm it against current source and record THAT, citing the source`,
  },
  {
    broken: (c) => Boolean(strengthsFor(c.source)) && !strengthsFor(c.source).includes(c.strength),
    say: (c) => `a ${c.source} candidate may be ${strengthsFor(c.source).join(" or ")}, not ${c.strength} — its source is somebody's word, not the code`,
  },
  {
    broken: (c) => c.layer !== undefined && !storedAt(c.layer),
    say: (c) => `layer "${c.layer}" is never recorded into a project — an organisation declares in its own room, and a host's hints are never written`,
  },
  {
    broken: (c) => c.contradicts !== undefined && c.contradicts !== claimId(c),
    say: (c) => `contradicts must name this candidate's own claim (${claimId(c)}), not "${c.contradicts}" — a contradiction is a claim about the SAME triple in the SAME context`,
  },
];

const ungated = (c, w) => (c.source === "test-suite" ? [] : (c.enforcedBy ?? []).filter((p) => !(w.gates ?? new Set()).has(p)));

export function candidateFindings(raw, where, world = {}) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...claimFindings(bare(raw), where, CANDIDATE_REQUIRED), ...constraintFindings(ENVELOPE_FIELDS, raw, where), ...stampedFindings(raw, where)];
  if (shape.length) return shape;
  return SPECS.filter((s) => s.broken(raw, world)).map((s) => `${where}: ${s.say(raw, world)}`);
}

const stampedFindings = (raw, where) => Object.keys(raw).filter((k) => STAMPED.includes(k)).map((k) => `${where}: "${k}" is stamped by the engine, never supplied by a candidate`);

const bare = (raw) => Object.fromEntries(Object.entries(raw).filter(([k]) => !(k in ENVELOPE_FIELDS)));

// What reconciliation receives: the defaults filled in, the envelope kept.
export const candidateOf = (raw) => ({ context: {}, layer: "project", unknowns: [], ...raw });
