// A decision the HOST sends, held to the protocol before anything is written or run.
//
// The host's model chooses the next step; this engine lets through only a choice that is well
// formed, made on the task as it stands, allowed in the stage the task is in, carrying what its
// action needs, and -- for an action a person must allow -- naming a grant a person actually gave
// for exactly that action. Two lines matter beyond the shape:
//
//   a decision may not ASSERT anything the engine derives: an outcome, a verdict, a stage, a
//   signature, a confidence or an approval. One sent anyway is refused by name, never ignored
//
//   `expectedRevision` is the task's revision the decision was made on. Anything written since --
//   by this host, another one or a person -- makes it STALE, so a decision sent twice runs once
//
// Rows, first failing row refuses, in the order a host should be told. A refusal is REFUSED (2)
// with the rule's id first and writes nothing.
import { Refused } from "../errors.mjs";
import { approvalOf, fingerprintAsked, kindOf, openActions, openOf, rejectedFingerprints } from "./journal.mjs";
import { ACTIONS } from "./dispatch.mjs";
import { allowedNow } from "./stages.mjs";
import { DECISION_FIELDS, DECISION_FORBIDDEN, DECISION_SCHEMA, LIFE, MAX_EVIDENCE, TEXT_LIMIT } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const forbidden = (d) => DECISION_FORBIDDEN.filter((k) => k in d);
const unknown = (d) => Object.keys(d).filter((k) => !DECISION_FIELDS.includes(k) && !DECISION_FORBIDDEN.includes(k));
const kindOfDecision = (d) => (isObject(d.action) && typeof d.action.kind === "string" ? d.action.kind : null);

// Before anything is read of the task: is it a decision at all?
const FORM = [
  { id: "SHAPE", fails: (d) => !isObject(d) || d.schemaVersion !== DECISION_SCHEMA, say: (d) => `a decision is a JSON object with "schemaVersion": ${DECISION_SCHEMA}${isObject(d) && d.schemaVersion !== undefined ? ` — this engine does not speak ${d.schemaVersion}` : ""}` },
  { id: "FORBIDDEN", fails: (d) => forbidden(d).length > 0, say: (d) => `a decision may not carry ${forbidden(d).join(", ")} — whether something worked, where the task stands, what a failure is and whether a person allowed something are the engine's to derive, never a decision's to assert` },
  { id: "FIELDS", fails: (d) => unknown(d).length > 0, say: (d) => `unknown field(s) ${unknown(d).join(", ")} — a decision carries ${DECISION_FIELDS.join(", ")}` },
  { id: "ACTION", fails: (d) => !Object.hasOwn(ACTIONS, kindOfDecision(d) ?? ""), say: () => `action is { "kind": one of ${Object.keys(ACTIONS).join(", ")}, …its fields }` },
];

const sentence = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= TEXT_LIMIT;

const textProblem = (d) => !sentence(d.observed) || !sentence(d.hypothesis) || (d.reason !== undefined && !sentence(d.reason));

const evidenceProblem = (d) => d.evidence !== undefined && (!Array.isArray(d.evidence) || d.evidence.length > MAX_EVIDENCE || !d.evidence.every((e) => typeof e === "string"));

const extraFields = (a) => Object.keys(a).filter((k) => k !== "kind" && !ACTIONS[a.kind].fields.includes(k));

const missingFields = (a) => ACTIONS[a.kind].required.filter((k) => a[k] === undefined);

const fieldsProblem = (a) => (extraFields(a).length || missingFields(a).length ? `a ${a.kind} step takes ${ACTIONS[a.kind].fields.join(", ") || "no fields"}${missingFields(a).length ? `, and needs ${missingFields(a).join(", ")}` : ""}${extraFields(a).length ? ` — not ${extraFields(a).join(", ")}` : ""}` : null);

const allowedSay = (lw) => (allowedNow(lw).length ? allowedNow(lw).join(", ") : "nothing");

// An open `implement` is settled by `record-changes`, and only reading may run beside it. Any
// other open action never settled.
const unsettledOf = (lw) => openActions(lw).filter((x) => kindOf(x) !== "implement");

const implementOpen = (lw) => openOf(lw, "implement") !== null;

const askedFor = (lw, fp) => lw.view.approvals.find((a) => ["pending", "granted"].includes(a.state) && fingerprintAsked(lw, a.id) === fp) ?? null;

// `c`: { lw, gate, fp } -- the loop's world, the approval the action needs (or null) and its fingerprint.
const FRESH = [
  { id: "TEXT", fails: (d) => textProblem(d), say: () => `observed and hypothesis are each one sentence of at most ${TEXT_LIMIT} characters, and reason too when given — a decision says what was seen and why, never a chain of thought` },
  { id: "EVIDENCE", fails: (d) => evidenceProblem(d), say: () => `evidence is a list of at most ${MAX_EVIDENCE} ids this task recorded (an attempt, an action, a decision, an approval or a receipt)` },
  { id: "STALE", fails: (d, c) => d.expectedRevision !== c.lw.view.revision, say: (d, c) => `expectedRevision ${d.expectedRevision} is not the task's revision ${c.lw.view.revision} — read the context again and decide on what is there now` },
  { id: "ENDED", fails: (d, c) => c.lw.view.terminal, say: (d, c) => `the task is ${c.lw.view.lifecycle} — nothing new starts on it` },
  { id: "PAUSED", fails: (d, c) => c.lw.view.lifecycle === LIFE.PAUSED, say: () => "a person paused the task — nothing new starts until they resume it, in Orbit Control; no step resumes it" },
  { id: "WAITING", fails: (d, c) => c.lw.view.lifecycle === LIFE.WAITING_APPROVAL, say: () => "an action waits for a person's decision in Orbit Control — read the context again once they decide" },
  { id: "UNSETTLED", fails: (d, c) => unsettledOf(c.lw).length > 0, say: (d, c) => `${unsettledOf(c.lw).map((x) => x.id).join(", ")} started and never settled — reconcile it first: what it did is read back, never done again` },
  { id: "STAGE", fails: (d, c) => !allowedNow(c.lw).includes(d.action.kind), say: (d, c) => `${c.lw.view.stage ?? "this task"} does not allow ${d.action.kind}${c.lw.view.blocked ? ` while blocked (${c.lw.view.blocked.stop})` : ""}${implementOpen(c.lw) ? " while a change is being made" : ""} — it allows ${allowedSay(c.lw)}` },
  { id: "FIELDS_OF_ACTION", fails: (d) => fieldsProblem(d.action) !== null, say: (d) => fieldsProblem(d.action) },
  { id: "ACTION_CHECK", fails: (d, c) => ACTIONS[d.action.kind].check(d.action, c.lw) !== null, say: (d, c) => ACTIONS[d.action.kind].check(d.action, c.lw) },
  { id: "REJECTED", fails: (d, c) => c.gate !== null && rejectedFingerprints(c.lw).has(c.fp), say: () => "a person rejected exactly this action on this task — it is never asked again; decide something else" },
  { id: "UNNEEDED", fails: (d, c) => d.approval !== undefined && c.gate === null, say: () => "this action needs no person's approval — send it without one" },
  { id: "APPROVAL_UNKNOWN", fails: (d, c) => d.approval !== undefined && approvalOf(c.lw, d.approval) === null, say: (d) => `${d.approval} is not an approval of this task` },
  { id: "NOT_GRANTED", fails: (d, c) => d.approval !== undefined && approvalOf(c.lw, d.approval).state !== "granted", say: (d, c) => `${d.approval} is ${approvalOf(c.lw, d.approval).state} — only a grant a person gave allows the action, once` },
  { id: "OTHER_ACTION", fails: (d, c) => d.approval !== undefined && fingerprintAsked(c.lw, d.approval) !== c.fp, say: (d) => `${d.approval} was granted for a different action — an approval allows exactly what it was asked for` },
  { id: "ASKED", fails: (d, c) => d.approval === undefined && c.gate !== null && askedFor(c.lw, c.fp) !== null, say: (d, c) => `${askedFor(c.lw, c.fp).id} already asks for exactly this action (${askedFor(c.lw, c.fp).state}) — once a person grants it, send the action again with "approval": "${askedFor(c.lw, c.fp).id}"` },
];

function refusedBy(rules, d, c) {
  const failed = rules.find((r) => r.fails(d, c));
  if (failed) throw new Refused(`${failed.id}: ${failed.say(d, c)}`);
}

// -> nothing; throws Refused for the first rule a decision breaks. `c`: { lw, gate, fp }.
export function judge(d, c) {
  refusedBy(FORM, d, c);
  refusedBy(FRESH, d, c);
}

export const judgeForm = (d) => refusedBy(FORM, d, {});

export const protocolRules = () => ({ form: FORM.map((r) => r.id), fresh: FRESH.map((r) => r.id) });
