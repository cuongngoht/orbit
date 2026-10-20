// A decision the HOST sends, held to the protocol before anything happens.
//
// The host's model chooses; this engine only lets through a choice that is
// well formed, about the journal as it stands, aimed at something still owed,
// citing evidence that exists, and taking a step the mode allows. Two rules
// matter beyond the shape:
//
//   a decision may not ASSERT anything -- a verdict, a confidence, an approval
//   or an oracle is the engine's to derive from evidence, and one sent anyway
//   is refused by name, never ignored
//
//   the same decisionId twice is ONE decision: settled, it is replayed (the
//   host retried after losing the answer); started and never settled, it is
//   ambiguous and refused -- whatever it did must be read back, never done again.
//   An id sent again asking for something ELSE is not a retry: a host that lost
//   its counter would otherwise be handed an old answer to a new question, so it
//   is refused (ID_REUSED) rather than replayed
//
// Each rule is a row, first failing row refuses, in the order a host should be
// told. A refusal is REFUSED (2) with the rule's id first, so a host can tell a
// stale decision from a malformed one.
import { Refused } from "../errors.mjs";
import { canonical } from "../network/fingerprint.mjs";
import { scrub } from "../scrub.mjs";
import { ACTIONS } from "./dispatch.mjs";
import { unsettled } from "./stop.mjs";
import { DECISION_FIELDS, DECISION_FORBIDDEN, DECISION_SCHEMA, TEXT_LIMIT } from "./vocab.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const forbidden = (d) => DECISION_FORBIDDEN.filter((k) => k in d);
const unknown = (d) => Object.keys(d).filter((k) => !DECISION_FIELDS.includes(k) && !DECISION_FORBIDDEN.includes(k));

// Before the duplicate check: a replay still has to be a decision at all.
const FORM = [
  { id: "SHAPE", fails: (d) => !isObject(d) || d.schemaVersion !== DECISION_SCHEMA, say: (d) => `a decision is a JSON object with "schemaVersion": ${DECISION_SCHEMA}${isObject(d) && d.schemaVersion !== undefined ? ` — this engine does not speak ${d.schemaVersion}` : ""}` },
  { id: "FORBIDDEN", fails: (d) => forbidden(d).length > 0, say: (d) => `a decision may not carry ${forbidden(d).join(", ")} — a verdict, a confidence or an approval is the engine's to derive from evidence, never a decision's to assert` },
  { id: "FIELDS", fails: (d) => unknown(d).length > 0, say: (d) => `unknown field(s) ${unknown(d).join(", ")} — a decision carries ${DECISION_FIELDS.join(", ")}` },
  { id: "ID", fails: (d) => !ID.test(String(d.decisionId ?? "")), say: () => "decisionId: 1-64 letters, digits, dot, underscore or dash, unique within the investigation" },
];

// After it: everything a NEW decision has to be.
const FRESH = [
  { id: "TEXT", fails: (d) => ["hypothesis", "reason"].some((k) => d[k] !== undefined && (typeof d[k] !== "string" || d[k].length > TEXT_LIMIT)), say: () => `hypothesis and reason are short text, ${TEXT_LIMIT} characters at most — a decision says what and why, never a chain of thought` },
  { id: "STALE", fails: (d, lw) => d.expectedRevision !== lw.model.position, say: (d, lw) => `expectedRevision ${d.expectedRevision} is not the journal's position ${lw.model.position} — read the context again and decide on what is there now` },
  { id: "LIFECYCLE", fails: (d, lw) => lw.model.lifecycle !== "active", say: (d, lw) => `the investigation is ${lw.model.lifecycle}${lw.model.lifecycle === "paused" ? " — resume it first" : ""}` },
  { id: "TARGET", fails: (d, lw) => !lw.frontier.some((o) => o.id === d.target), say: (d, lw) => targetWhy(d, lw) },
  { id: "REFS", fails: (d, lw) => unresolved(d, lw).length > 0, say: (d, lw) => `evidenceRefs ${unresolved(d, lw).join(", ")} name no record of this investigation` },
  { id: "ACTION", fails: (d, lw) => actionProblem(d, lw) !== null, say: (d, lw) => actionProblem(d, lw) },
  { id: "MODE", fails: (d, lw) => !ACTIONS[d.action.kind].allowed(lw.mode, d.action, lw), say: (d, lw) => `a ${d.action.kind} step is not allowed in ${lw.mode} mode (${ACTIONS[d.action.kind].modes})` },
  { id: "READ_BACK_FIRST", fails: (d, lw) => ACTIONS[d.action.kind].mutates(d.action, lw) && unsettled(lw.model).some((x) => x.mutates), say: (d, lw) => `${unsettled(lw.model).find((x) => x.mutates).id} started a step that could write and never settled — read back what it did (a data check) before anything writes again, or a person releases it (autonomous-qa release --human)` },
  { id: "BUDGET", fails: (d, lw) => lw.model.decisions.length >= lw.settings.limits.decisions, say: (d, lw) => `the decision budget is spent (${lw.settings.limits.decisions}, settings limits.decisions) — finish, or a person raises it` },
];

// lw: { model, frontier, obligations, mode, settings, ctx } (src/investigation/loop.mjs)
// -> { decision } for a new one, { replay } for one already settled; else throws.
export function judgeDecision(raw, lw) {
  refusedBy(FORM, raw, lw);
  const earlier = lw.model.decisions.find((d) => d.id === raw.decisionId);
  if (earlier) return againOf(earlier, raw, lw);
  refusedBy(FRESH, raw, lw);
  return { decision: raw };
}

function refusedBy(rules, raw, lw) {
  const failed = rules.find((r) => r.fails(raw, lw));
  if (failed) throw new Refused(`${failed.id}: ${failed.say(raw, lw)}`);
}

function againOf(earlier, raw, lw) {
  if (!sameAsked(earlier, raw)) throw new Refused(`ID_REUSED: ${earlier.id} is an earlier decision that asked for something else (${earlier.action?.kind ?? "?"} on ${earlier.target}) — one decisionId names one decision; send this one under a new id`);
  const settled = lw.model.settled.find((s) => s.decision === earlier.id);
  if (settled) return { replay: settled };
  throw new Refused(`AMBIGUOUS: ${earlier.id} was started and never settled${earlier.mutates ? " — it may have written; read back what it did, and never send it again" : " — send a new decision to try again"}`);
}

// A retry asks for exactly what the earlier decision asked for, as it was kept.
const sameAsked = (earlier, raw) => earlier.target === raw.target && canonical(earlier.action) === canonical(keptAction(isObject(raw.action) ? raw.action : {}));

// The step as the journal keeps it: its own fields, and an input's text scrubbed.
export const keptAction = (a) => ({ ...a, ...(a.input ? { input: Object.fromEntries(Object.entries(a.input).map(([k, v]) => [k, typeof v === "string" ? scrub(v) : v])) } : {}) });

function targetWhy(d, lw) {
  const known = lw.obligations.find((o) => o.id === d.target);
  return known ? `${known.id} is ${known.status}: ${known.why}` : `target ${d.target ?? "(none)"} is not an obligation of this investigation — pick one from the context's frontier`;
}

// Every id the journal holds, so a decision can cite only what exists.
const RECORDED = ["actions", "observations", "checks", "security", "history", "reproductions", "runs", "inputs", "questions", "answers"];

function unresolved(d, lw) {
  const ids = new Set(RECORDED.flatMap((k) => (lw.model[k] ?? []).map((r) => r.id)));
  return (Array.isArray(d.evidenceRefs) ? d.evidenceRefs : [d.evidenceRefs].filter((x) => x !== undefined)).filter((ref) => !ids.has(ref));
}

function actionProblem(d, lw) {
  if (!isObject(d.action) || !ACTIONS[d.action.kind]) return `action.kind is one of ${Object.keys(ACTIONS).join(", ")}`;
  const target = lw.frontier.find((o) => o.id === d.target);
  if (!target.can.includes(d.action.kind)) return `${target.id} (${target.kind}) is settled by ${target.can.join(", ") || "a person"}, not by ${d.action.kind}`;
  return fieldProblem(d.action, ACTIONS[d.action.kind], lw);
}

function fieldProblem(a, row, lw) {
  const extra = Object.keys(a).filter((k) => k !== "kind" && !row.fields.includes(k));
  const missing = row.required.filter((k) => ![k].flat().some((x) => a[x] !== undefined)).map((k) => [k].flat().join(" or "));
  if (extra.length || missing.length) return `a ${a.kind} step takes ${row.fields.join(", ")}${missing.length ? `, and needs ${missing.join(", ")}` : ""}${extra.length ? ` — not ${extra.join(", ")}` : ""}`;
  return row.check(a, lw);
}
