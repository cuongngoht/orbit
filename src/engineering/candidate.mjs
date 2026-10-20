// What an ENGINEERING CANDIDATE may say -- the Specification a proposal is held
// to before reconciliation ever sees it.
//
// A candidate is not a fact. It is one observation's CLAIM about a subject, and
// the difference is exactly the fields the engine owns: how sure (`confidence`,
// derived from independent sessions), when and against what (`at`, `commit`,
// `fingerprint`, `status`), how often confirmed (`support`), which fact it is
// (`id`, derived from kind and key). A candidate carrying any of those is
// claiming to have been checked or repeated by filling a field in, and
// src/engineering/fields.mjs `STAMPED` refuses them by name.
//
// `confidence` is the one IGNORED rather than refused: `record` required it
// until this release, so a pipeline still sending it is told the value was
// dropped instead of having its whole batch refused. It is never stored.
//
// Everything that is a rule across two fields is a row in SPECS -- ordered,
// each one sentence, and none of them names a kind or a strength: the columns
// on src/engineering/vocab.mjs's rows say which kind allows which strength and
// which strength needs a gate.
import { factFindings, factId, isObject } from "./model.mjs";
import { REQUIRED } from "./fields.mjs";
import { claimableByObserver, kindRow, needsGate } from "./vocab.mjs";
import { constraintFindings } from "../constraints.mjs";

export const IGNORED = ["confidence"];

// Fields a candidate carries to tell reconciliation about ITSELF, never kept on
// a fact -- a fresh fact carrying one would fail its own field table.
export const ENVELOPE_FIELDS = {
  contradicts: { type: "string", doc: "The id of the fact this observation contradicts -- which must be this candidate's own subject, the fact `engineering facts` listed for this kind and key." },
};

export const CANDIDATE_REQUIRED = REQUIRED.filter((k) => !IGNORED.includes(k));

// Where a source's own word is all there is, it cannot buy more than it is:
// a person's statement is an instruction (adopted) or advice, never an
// observation of the code; the host's memory is at most something observed.
const SOURCE_STRENGTHS = {
  "human-declared-memory": ["adopted", "suggested"],
  "claude-memory": ["observed", "suggested"],
};

const SPECS = [
  {
    broken: (c, w) => !w.trusted && !claimableByObserver(c.strength),
    say: (c) => `strength "${c.strength}" may not be claimed by a candidate — only an explicit --human record may set enforced or adopted`,
  },
  {
    broken: (c) => Boolean(kindRow(c.kind)?.onlyStrength) && kindRow(c.kind).onlyStrength !== c.strength,
    say: (c) => `a ${c.kind} fact is only ever ${kindRow(c.kind).onlyStrength} — record it as another kind, or name the gate that enforces it`,
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
    broken: (c) => Boolean(SOURCE_STRENGTHS[c.source]) && !SOURCE_STRENGTHS[c.source].includes(c.strength),
    say: (c) => `a ${c.source} candidate may be ${SOURCE_STRENGTHS[c.source].join(" or ")}, not ${c.strength} — its source is somebody's word, not the code`,
  },
  {
    broken: (c) => c.contradicts !== undefined && c.contradicts !== factId(c),
    say: (c) => `contradicts must name this candidate's own fact (${factId(c)}), not "${c.contradicts}" — a contradiction is a claim about the SAME subject`,
  },
];

const ungated = (c, w) => (c.source === "test-suite" ? [] : (c.enforcedBy ?? []).filter((p) => !(w.gates ?? new Set()).has(p)));

export function candidateFindings(raw, where, world = {}) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...factFindings(bare(raw), where, CANDIDATE_REQUIRED), ...constraintFindings(ENVELOPE_FIELDS, raw, where)];
  if (shape.length) return shape;
  return SPECS.filter((s) => s.broken(raw, world)).map((s) => `${where}: ${s.say(raw, world)}`);
}

// What the field table is asked about: neither the ignored fields nor the
// envelope, both of which it rightly does not declare.
const bare = (raw) => omit(raw, [...IGNORED, ...Object.keys(ENVELOPE_FIELDS)]);

// What reconciliation receives: the envelope kept, the ignored dropped.
export const candidateOf = (raw) => omit(raw, IGNORED);

export const ignoredNotes = (raw, where) => IGNORED.filter((k) => isObject(raw) && k in raw).map((k) => `${where}: "${k}" is derived by the engine from independent sessions — the value supplied was ignored`);

const omit = (raw, keys) => Object.fromEntries(Object.entries(raw).filter(([k]) => !keys.includes(k)));
