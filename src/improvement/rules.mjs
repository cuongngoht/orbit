// What a line must be before it is written into a campaign's journal: rows with an id, the code a caller maps to a
// status, when it fails and what to say -- the shape src/task/rules.mjs keeps. ops.mjs reads them in order:
//
//   DOOR     a campaign is written by the improvement engine or by Orbit Control, which proves a person -- never by a
//            terminal on its own word
//   KNOWN    the campaign exists in this project's store (another project's id is unknown here)
//   ENDED    an ended campaign takes only what it taught (`learned`)
//   PHASE    what the campaign's phase allows next (ALLOWED), read beneath a block a person's switch put there
//   TEXT     a sentence of at most 240 characters, refused rather than cut
//   STALE    a person's decision on a revision the campaign has materially moved past
//
// A refusal writes nothing.
import { modelOf, phaseOf } from "./model.mjs";
import { CODES, FREE_TEXT, TEXT_LIMIT, WRITERS } from "./vocab.mjs";

const OPEN = ["DETECTED", "DIAGNOSED", "PROPOSED", "GENERATING", "GENERATED", "VALIDATED", "EVALUATING", "QUALIFIED", "AWAITING_AUTHORITY", "PROMOTING", "PROMOTED", "MONITORING", "ROLLING_BACK", "REJECTED", "ROLLED_BACK"];

const BEFORE_PROMOTION = ["DIAGNOSED", "PROPOSED", "GENERATING", "GENERATED", "VALIDATED", "EVALUATING", "QUALIFIED", "AWAITING_AUTHORITY", "PROMOTING"];

// Which kinds of line may follow which phase. A kind not listed may follow any open phase.
export const ALLOWED = {
  diagnosed: ["DETECTED"],
  proposed: ["DIAGNOSED"],
  generating: ["PROPOSED"],
  generated: ["GENERATING"],
  "generation-refused": ["GENERATING"],
  validated: ["GENERATED"],
  "evaluation-started": ["VALIDATED", "EVALUATING"],
  "evaluation-run": ["EVALUATING"],
  "evaluation-settled": ["EVALUATING"],
  "evaluation-interrupted": ["EVALUATING"],
  linked: ["EVALUATING"],
  qualified: ["EVALUATING"],
  gated: ["QUALIFIED", "AWAITING_AUTHORITY"],
  "awaiting-authority": ["QUALIFIED", "PROMOTING"],
  "promotion-started": ["QUALIFIED", "AWAITING_AUTHORITY"],
  "promotion-interrupted": ["PROMOTING"],
  promoted: ["PROMOTING"],
  rejected: BEFORE_PROMOTION,
  observed: ["PROMOTED", "MONITORING"],
  regression: ["PROMOTED", "MONITORING"],
  "rollback-started": ["PROMOTED", "MONITORING"],
  "rollback-interrupted": ["ROLLING_BACK"],
  "rolled-back": ["ROLLING_BACK"],
  unblocked: ["BLOCKED"],
};

// The phase a line is judged against: beneath a block, so that what was waiting can go on once it is lifted.
const beneath = (m, kind) => (kind === "unblocked" ? phaseOf(m) : phaseOf({ ...m, blocked: null }));

const phaseAllows = (m, kind) => (ALLOWED[kind] ?? OPEN).includes(beneath(m, kind));

const long = (fields) => FREE_TEXT.filter((k) => typeof fields[k] === "string" && fields[k].length > TEXT_LIMIT);

export const RULES = [
  { id: "IMP_DOOR", code: CODES.DOOR, fails: (w) => !WRITERS.includes(w.door), say: () => "a campaign is written by the improvement engine (improve step) or by a person in Orbit Control — never on a terminal's own word" },
  { id: "IMP_UNKNOWN", code: CODES.UNKNOWN, fails: (w) => !w.lines, say: (w) => `${w.id} is no improvement campaign of this project` },
  { id: "IMP_ENDED", code: CODES.ENDED, fails: (w) => Boolean(w.m.ended) && w.kind !== "learned", say: (w) => `${w.id} ended (${w.m.ended?.outcome}) — only what it taught is still recorded` },
  { id: "IMP_LEARNED", code: CODES.PHASE, fails: (w) => w.kind === "learned" && (!w.m.ended || Boolean(w.m.learned)), say: (w) => `${w.id} teaches once, after it ended` },
  { id: "IMP_PHASE", code: CODES.PHASE, fails: (w) => w.kind !== "learned" && !phaseAllows(w.m, w.kind), say: (w) => `${w.id} is ${phaseOf(w.m)} — a ${w.kind} line does not follow it` },
  { id: "IMP_TEXT", code: CODES.TEXT, fails: (w) => long(w.fields).length > 0, say: (w) => `${long(w.fields).join(", ")}: a sentence of at most ${TEXT_LIMIT} characters — a campaign records what and why, never a log or a chain of thought` },
  { id: "STALE_REVISION", code: CODES.STALE, fails: (w) => Number.isInteger(w.expected) && w.m.materialAt.some((p) => p > w.expected), say: (w) => `${w.id} moved since revision ${w.expected} was read (it is ${w.m.position} now) — read it again and decide on what is there` },
];

export const worldOf = (store, id, kind, fields, opts) => ((lines) => ({ id, kind, fields, lines, m: modelOf(lines ?? []), door: opts.door ?? null, expected: opts.expected }))(store.read(id));
