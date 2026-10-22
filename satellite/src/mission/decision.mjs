// ONE DECISION, judged before anything runs. The host's model chooses; the engine refuses -- on the first rule a
// decision breaks, naming it -- anything malformed, anything that claims what only the engine may derive (refused by
// NAME: an outcome, a mode, an operation kind, a level, a lifecycle …), anything decided on a revision that has moved
// (STALE), and anything not allowed where the mission stands. A decision already recorded is a REPLAY: its first
// answer, nothing written again.
import { Refused } from "../../../src/errors.mjs";
import { askedOf } from "../execution/gateway.mjs";
import { isObject, isSentence, list, refused } from "../store/text.mjs";
import { ACTIONS, allowedNow } from "./actions.mjs";
import { lifecycleOf } from "./state.mjs";
import { DECISION_FIELDS, DECISION_ID, DECISION_SCHEMA, FORBIDDEN, MAX_EVIDENCE, TERMINAL } from "./vocab.mjs";

const rowOf = (d) => ACTIONS[d?.action?.kind] ?? null;

const forbiddenIn = (d) => [...Object.keys(d), ...Object.keys(isObject(d.action) ? d.action : {})].filter((k) => FORBIDDEN.includes(k));

const FORM = [
  { code: "DECISION_SHAPE", fails: (d) => !isObject(d) || d.schemaVersion !== DECISION_SCHEMA, say: () => `a decision is { "schemaVersion": ${DECISION_SCHEMA}, "decisionId", "expectedRevision", "action": { "kind", … }, "observed", "hypothesis"? }` },
  { code: "DECISION_FORBIDDEN", fails: (d) => forbiddenIn(d).length > 0, say: (d) => `a decision never carries ${[...new Set(forbiddenIn(d))].join(", ")} — the engine derives it` },
  { code: "DECISION_FIELDS", fails: (d) => Object.keys(d).some((k) => !DECISION_FIELDS.includes(k)), say: (d) => `unknown field(s): ${Object.keys(d).filter((k) => !DECISION_FIELDS.includes(k)).join(", ")}` },
  { code: "DECISION_ID", fails: (d) => !DECISION_ID.test(String(d.decisionId ?? "")), say: () => "decisionId is yours: 1-64 letters, digits, . _ : -" },
  { code: "DECISION_REVISION", fails: (d) => !Number.isInteger(d.expectedRevision), say: () => "expectedRevision is the revision the context you read printed" },
  { code: "ACTION_UNKNOWN", fails: (d) => !rowOf(d), say: () => `action.kind is one of ${Object.keys(ACTIONS).join(", ")}` },
  { code: "ACTION_FIELDS", fails: (d) => Object.keys(d.action).some((k) => k !== "kind" && !rowOf(d).fields.includes(k)), say: (d) => `${d.action.kind} takes ${rowOf(d).fields.join(", ") || "no field"}` },
  { code: "ACTION_REQUIRED", fails: (d) => rowOf(d).required.some((k) => d.action[k] === undefined), say: (d) => `${d.action.kind} needs ${rowOf(d).required.join(", ")}` },
  { code: "DECISION_TEXT", fails: (d) => !isSentence(d.observed) || ["hypothesis", "reason"].some((k) => d[k] !== undefined && !isSentence(d[k])), say: () => "observed is one sentence of what you saw; hypothesis and reason, when given, one sentence each (at most 240 characters)" },
  { code: "DECISION_EVIDENCE", fails: (d) => d.evidence !== undefined && !(Array.isArray(d.evidence) && d.evidence.length <= MAX_EVIDENCE && d.evidence.every((e) => typeof e === "string")), say: () => `evidence is at most ${MAX_EVIDENCE} ids this mission recorded` },
];

const refusedBy = (row, d) => refused(Refused, row.code, row.say(d));

export function judgeForm(d) {
  const failed = FORM.find((r) => r.fails(d));
  if (failed) throw refusedBy(failed, d);
  return d;
}

// The same decision id again: its first answer when it asked the same thing, refused when it asked something else.
export function againOf(lw, d) {
  const prior = lw.m.decisions.get(d.decisionId);
  if (!prior) return null;
  const a = lw.m.actions.get(prior);
  if (a?.asked !== askedOf(d.action)) throw refused(Refused, "DECISION_ID_REUSED", `${d.decisionId} already decided ${a?.type} (${prior}); a new decision takes a new id`);
  return { replay: true, action: prior, status: a?.status, summary: a?.recorded?.summary ?? null };
}

const FRESH = [
  { code: "MISSION_ENDED", fails: (lw) => TERMINAL.includes(lifecycleOf(lw.m)), say: (lw) => `${lw.id} has ended (${lifecycleOf(lw.m)}); nothing more is decided in it` },
  { code: "STALE_REVISION", fails: (lw, d) => d.expectedRevision !== lw.m.position, say: (lw, d) => `${lw.id} moved since revision ${d.expectedRevision} (it is at ${lw.m.position}); read its context again and decide on what is there now` },
  { code: "ACTION_NOT_ALLOWED", fails: (lw, d) => !allowedNow(lw).includes(d.action.kind), say: (lw, d) => `${d.action.kind} is not allowed now; allowed: ${allowedNow(lw).join(", ") || "nothing"}` },
  { code: "BUDGET_EXHAUSTED", fails: (lw, d) => d.action.kind !== "checkpoint" && lw.spent().actions >= lw.limits.maxActions, say: (lw) => `${lw.id} has spent its ${lw.limits.maxActions} actions; finish it with --stop=BUDGET_EXHAUSTED` },
  { code: "MINUTES_EXHAUSTED", fails: (lw, d) => d.action.kind !== "checkpoint" && lw.limits.maxMinutes !== null && lw.limits.maxMinutes !== undefined && lw.spent().minutes >= lw.limits.maxMinutes, say: (lw) => `${lw.id} has run its ${lw.limits.maxMinutes} minutes; finish it with --stop=BUDGET_EXHAUSTED` },
  { code: "EVIDENCE_UNKNOWN", fails: (lw, d) => list(d.evidence).some((e) => !lw.m.evidence.has(e) && !lw.m.actions.has(e) && !lw.m.handoffs.has(e)), say: () => "evidence names evd-, act- or hof- ids this mission recorded" },
];

export function judgeFresh(lw, d) {
  const failed = FRESH.find((r) => r.fails(lw, d));
  if (failed) throw refused(Refused, failed.code, failed.say(lw, d));
  return d;
}

export const protocolRules = () => ({ form: FORM.map((r) => r.code), fresh: FRESH.map((r) => r.code) });
