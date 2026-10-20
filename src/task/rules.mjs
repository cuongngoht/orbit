// What an operation on a task must be before anything is written: rows, each with an id, the
// code a caller maps to a status, when it fails and what to say -- the shape of
// src/investigation/decision.mjs. src/task/ops.mjs reads them in a fixed order:
//
//   HUMAN   a person's operation must be relayed with --human
//   PERSON  and one that ALLOWS something must come through a door that proves a person
//   FIELDS  only the fields it takes, every one as src/task/fields.mjs declares it
//   TEXT    free text a sentence long, never blank where it is required
//   PHASE   what the task's lifecycle allows: nothing STARTS on a paused or ended task, nothing
//           but a record of what was already running is written to an ended one
//   the op's own rows
//   STALE   a person's decision on a revision the task has materially moved past is refused
//
// A refusal writes nothing.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { relativeInside } from "../project/boundary.mjs";
import { STALE_REVISION } from "../store/revisioned.mjs";
import { FIELDS } from "./fields.mjs";
import { CODES, ENGINE_DOMAINS, ENGINE_WRITERS, PROVEN_STATES, TEXT_LIMIT, isMaterial } from "./vocab.mjs";

// Rules are called (given, world, op, name); `world` is src/task/load.mjs's { model, now, state }.

export const takenBy = (op) => [...op.required, ...op.optional, ...(op.human ? ["human"] : [])];

const specOf = (op, k) => op.specs?.[k] ?? FIELDS[k];

function problemsOf(g, op, name) {
  const table = Object.fromEntries(takenBy(op).map((k) => [k, specOf(op, k)]));
  const unknown = Object.keys(g).filter((k) => !takenBy(op).includes(k)).map((k) => `${name}: takes no ${k}`);
  return [...unknown, ...missingFindings(op.required, g, name), ...constraintFindings(table, g, name)];
}

const isText = (op, k) => specOf(op, k)?.text === true;

const longText = (g, op) => Object.keys(g).filter((k) => isText(op, k) && typeof g[k] === "string" && g[k].length > TEXT_LIMIT);

const blankText = (g, op) => op.required.filter((k) => isText(op, k) && typeof g[k] === "string" && g[k].trim() === "");

export const HUMAN = { id: "HUMAN", fails: (g) => g.human !== true, say: (g, w, op, name) => `${name} is a person's decision — relay it with --human, from the person who made it` };

// A decision that ALLOWS something -- an approval, a resume after a person's pause -- is written only
// through a door that proves a person: Orbit Control, whose page carries the mutation token. A
// terminal cannot prove who typed a command, so an agent could relay its own --human there and
// approve its own action; from a terminal a person may only STOP work (pause, cancel, reject). The
// composition root says which door it is (`door` on the task context), and nothing a caller types
// can say it.
export const PERSON = { id: "PERSON_UNPROVEN", code: CODES.PERSON_UNPROVEN, fails: (g, w, op) => op.grants === true && w.door !== "control", say: (g, w, op, name) => `${name} allows what a person withheld, so it is decided in Orbit Control's Mission Control, where the page proves the decision is a person's; a terminal cannot prove who typed it, and stops work only (pause, cancel, reject)` };

// A line the coordinator's engine reads its own state back from (0.0.4, vocab.mjs ENGINE_DOMAINS) is written only
// through the coordinator's door (or Control's): a receipt in one of those domains, or a verification whose subject is
// one -- `step:…`, `skillstep:…` -- refused from a terminal, so nobody but the engine can say a step was proven.
const engineDomain = (key) => ENGINE_DOMAINS.includes(String(key ?? "").split(":")[0]);

const doorless = (w) => !ENGINE_WRITERS.includes(w.door);

export const ENGINE_RECEIPT = { id: "ENGINE_DOMAIN", fails: (g, w) => ENGINE_DOMAINS.includes(g.domain) && doorless(w), say: (g) => `a ${g.domain} receipt is what the coordinator's engine says happened — only its own door writes one (automation step, settle, reconcile), never a terminal's link` };

export const ENGINE_SUBJECT = { id: "ENGINE_DOMAIN", fails: (g, w) => engineDomain(g.subject) && doorless(w), say: (g) => `${g.subject} is a coordinator's own step — only its door records how it was verified, never a terminal's link` };

export const FIELD_RULES = { id: "FIELDS", fails: (g, w, op, name) => problemsOf(g, op, name).length > 0, say: (g, w, op, name) => problemsOf(g, op, name).join("; ") };

export const TEXT = { id: "TEXT", fails: (g, w, op) => longText(g, op).length + blankText(g, op).length > 0, say: (g, w, op) => `${[...longText(g, op), ...blankText(g, op)].join(", ")}: a sentence of at most ${TEXT_LIMIT} characters, and not blank — a task records what and why, never a log, a transcript or a chain of thought` };

const ENDED = { id: "ENDED", code: CODES.TASK_ENDED, fails: (g, w) => w.state.ended, say: (g, w) => `the task is ${w.state.lifecycle} — nothing new starts on it, and only how something already running ended may still be recorded` };

const PAUSED = { id: "PAUSED", code: CODES.TASK_PAUSED, fails: (g, w) => w.state.lifecycle === "PAUSED", say: () => "the task is paused — nothing new starts until a person resumes it" };

// What each phase of operation the lifecycle allows. A record of how something that was already
// running ended is always allowed: a pause or a cancel never pretends it was interrupted.
export const PHASES = {
  start: [ENDED, PAUSED],
  note: [ENDED],
  record: [],
  govern: [ENDED],
};

const movedSince = (m, expected) => m.records.slice(expected).filter((r) => isMaterial(r.kind));

const movedKinds = (m, expected) => [...new Set(movedSince(m, expected).map((r) => r.kind))].join(", ");

const staleSay = (g, w) => (g.expected > w.model.position ? `revision ${g.expected} is ahead of the task, which is at ${w.model.position} — read it again` : `the task moved since revision ${g.expected} (${movedKinds(w.model, g.expected)}) — read it again and decide on what is there now`);

export const STALE = { id: "STALE", code: STALE_REVISION, fails: (g, w) => g.expected > w.model.position || movedSince(w.model, g.expected).length > 0, say: staleSay };

// ---- the ops' own rows ------------------------------------------------------------------------

const budgetOf = (w, k) => w.model.meta?.budget?.[k] ?? null;

const spentAll = (w, k) => budgetOf(w, k) !== null && w.state.spent[k] >= budgetOf(w, k);

const budget = (k, noun) => ({ id: "BUDGET", fails: (g, w) => spentAll(w, k), say: (g, w) => `its ${noun} budget is spent (${w.state.spent[k]} of ${budgetOf(w, k)}) — record why it stops: fail --stop=BUDGET_EXHAUSTED` });

export const BUDGET_ATTEMPTS = budget("attempts", "attempt");

export const BUDGET_ACTIONS = budget("actions", "action");

export const BUDGET_MINUTES = budget("minutes", "time");

export const OPEN_ATTEMPT = { id: "OPEN_ATTEMPT", fails: (g, w) => w.model.current !== null, say: (g, w) => `${w.model.current.id} is still open — complete it before the next attempt starts` };

export const NO_OPEN_ATTEMPT = { id: "NO_OPEN_ATTEMPT", fails: (g, w) => w.model.current === null, say: () => "no attempt is open — start one first" };

export const UNFINISHED_ATTEMPT = { id: "UNFINISHED_ATTEMPT", fails: (g, w) => w.model.current !== null, say: (g, w) => `${w.model.current.id} is still open — record how it ended before the task completes` };

const openActions = (w) => [...w.model.actions.values()].filter((a) => !a.ended).map((a) => a.id);

export const STILL_RUNNING = { id: "STILL_RUNNING", fails: (g, w) => openActions(w).length > 0, say: (g, w) => `${openActions(w).join(", ")} still running — record how it ended before the task completes` };

export const ACTION_KNOWN = { id: "ACTION_UNKNOWN", fails: (g, w) => g.action !== undefined && !w.model.actions.has(g.action), say: (g) => `${g.action} is not an action this task started` };

export const ACTION_OPEN = { id: "ACTION_ENDED", fails: (g, w) => w.model.actions.get(g.action).ended !== null, say: (g, w) => `${g.action} already ended (${w.model.actions.get(g.action).ended.kind}) — an action ends once` };

const receiptKnown = (w, ref) => w.model.receipts.has(ref) || [...w.model.receipts.values()].some((r) => r.ref === ref);

export const RECEIPT_KNOWN = { id: "RECEIPT_UNKNOWN", fails: (g, w) => g.receipt !== undefined && !receiptKnown(w, g.receipt), say: (g) => `${g.receipt} names no receipt this task linked — link it first (link receipt --domain= --ref=)` };

export const EVIDENCE_KNOWN = { id: "RECEIPT_UNKNOWN", fails: (g, w) => g.evidence !== undefined && !receiptKnown(w, g.evidence), say: (g) => `${g.evidence} names no receipt this task linked — link it first (link receipt --domain= --ref=)` };

// No receipt, no verification: a state that says something was shown must cite what showed it.
export const PROVEN_NEEDS_RECEIPT = { id: "NO_RECEIPT", fails: (g) => PROVEN_STATES.includes(g.state) && g.evidence === undefined, say: (g) => `${g.state} needs evidence: a receipt this task linked (--evidence=<domain:ref>) — with none, the obligation is not-verified` };

const MAX_EVIDENCE = 16;

const recordedIds = (w) => new Set([...w.model.attempts.map((a) => a.id), ...w.model.actions.keys(), ...w.model.decisions.map((d) => d.id), ...w.model.approvals.keys(), ...w.model.receipts.keys(), ...[...w.model.receipts.values()].map((r) => r.ref)]);

const unknownRefs = (g, w) => (g.evidence ?? []).filter((r) => !recordedIds(w).has(r));

export const EVIDENCE_LIMIT = { id: "EVIDENCE_LIMIT", fails: (g) => (g.evidence ?? []).length > MAX_EVIDENCE, say: () => `a decision cites at most ${MAX_EVIDENCE} pieces of evidence` };

export const REFS = { id: "REFS", fails: (g, w) => unknownRefs(g, w).length > 0, say: (g, w) => `evidence ${unknownRefs(g, w).join(", ")} names nothing this task recorded — cite an attempt, an action, a decision, an approval or a linked receipt` };

export const PATH = { id: "PATH", fails: (g) => !relativeInside(g.path) || g.path.length > 400 || /[\u0000-\u001f]/.test(g.path), say: () => "path is relative to the repository: no root, no drive letter, no `..`, no control characters" };

export const IS_BLOCKED = { id: "NOT_BLOCKED", fails: (g, w) => w.model.blocked === null, say: () => "the task is not blocked" };

export const NOT_YET_PAUSED = { id: "ALREADY_PAUSED", code: CODES.TASK_PAUSED, fails: (g, w) => w.model.paused !== null, say: () => "the task is already paused" };

export const IS_PAUSED = { id: "NOT_PAUSED", code: CODES.TASK_NOT_PAUSED, fails: (g, w) => w.model.paused === null, say: () => "the task is not paused" };
