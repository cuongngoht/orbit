// A coordinator's two inputs from the host, held to the protocol before anything is written or run:
//
//   a DECISION (`step`)   which ready step to run next, made on a revision of the workflow
//   an OUTCOME (`settle`) what a step the host ran came to, and the evidence its owner keeps
//
// Neither may assert what the engine derives -- an outcome word, a verdict, a stage, a signature, an
// approval: one sent anyway is refused by name (FORBIDDEN). A decision carries the host's own id
// (`decisionId`), kept on the journal's decision line, so a decision delivered twice is answered from the
// journal and never run twice (AGAIN): the same id that started a step the host is running is replayed,
// one whose engine step never settled is AMBIGUOUS (reconcile it), and one reused for another step is
// refused. Rows, first failing row refuses, in the order a host should be told; a refusal writes nothing.
import { Refused } from "../errors.mjs";
import { BLOCKING_LIMIT, DECISION_FIELDS, DECISION_ID, DECISION_SCHEMA, EXECUTION_STATES, FORBIDDEN, LIFE, MAX_EVIDENCE, OUTCOME_FIELDS, TEXT_LIMIT } from "./vocab.mjs";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const forbidden = (d) => FORBIDDEN.filter((k) => k in d);
const unknown = (d, fields) => Object.keys(d).filter((k) => !fields.includes(k) && !FORBIDDEN.includes(k));
const sentence = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= TEXT_LIMIT;
const strings = (v, max) => v === undefined || (Array.isArray(v) && v.length <= max && v.every((e) => typeof e === "string" && e.length <= 160));

const shape = (fields, noun) => [
  { id: "SHAPE", fails: (d) => !isObject(d) || d.schemaVersion !== DECISION_SCHEMA, say: () => `${noun} is a JSON object with "schemaVersion": ${DECISION_SCHEMA}` },
  { id: "FORBIDDEN", fails: (d) => forbidden(d).length > 0, say: (d) => `${noun} may not carry ${forbidden(d).join(", ")} — whether a step worked, where the workflow stands and whether a person allowed something are the engine's to derive from the evidence, never the host's to assert` },
  { id: "FIELDS", fails: (d) => unknown(d, fields).length > 0, say: (d) => `unknown field(s) ${unknown(d, fields).join(", ")} — ${noun} carries ${fields.join(", ")}` },
  { id: "ID", fails: (d) => !DECISION_ID.test(String(d.decisionId ?? "")), say: () => "decisionId is the host's own id for this decision (letters, digits, . _ : -), the same on every delivery of it" },
];

const FORM = [
  ...shape(DECISION_FIELDS, "a decision"),
  { id: "ACTION", fails: (d) => !isObject(d.action) || d.action.kind !== "run" || typeof d.action.step !== "string" || Object.keys(d.action).some((k) => !["kind", "step"].includes(k)), say: () => 'action is { "kind": "run", "step": "<a ready step\'s id>" } — the plan says which steps are ready' },
];

const OUTCOME_FORM = [
  ...shape(OUTCOME_FIELDS, "an outcome"),
  { id: "STEP", fails: (o) => typeof o.stepId !== "string", say: () => "stepId names the step the host ran" },
  { id: "EXECUTION", fails: (o) => !EXECUTION_STATES.includes(o.executionState), say: () => `executionState is what the host saw: one of ${EXECUTION_STATES.join(", ")} — a report the engine checks against the owner's evidence` },
  { id: "REFS", fails: (o) => !strings(o.evidenceRefs, MAX_EVIDENCE) || !strings(o.receiptRefs, MAX_EVIDENCE) || !strings(o.requestedCapabilities, MAX_EVIDENCE), say: () => `evidenceRefs and receiptRefs are at most ${MAX_EVIDENCE} references each, as domain:id (task:tsk-…, investigation:inv-…, requirement:rs-…)` },
  { id: "TEXT", fails: (o) => !strings(o.blockingReasons, BLOCKING_LIMIT) || (o.summary !== undefined && !sentence(o.summary)) || o.blockingReasons?.some((b) => !sentence(b)), say: () => `summary and each blocking reason are one sentence of at most ${TEXT_LIMIT} characters` },
];

// ---- the same decision, delivered again --------------------------------------------------------------

export const AGAIN = [
  { id: "ID_REUSED", when: (prior, d) => prior.nextAction !== `step.${d.action.step}`, say: (prior) => `this decisionId already decided ${prior.nextAction} — a new decision takes a new id` },
  { id: "AMBIGUOUS", when: (prior, d, c) => c.open && c.mode === "engine", say: () => "this decision started an engine step that never settled — reconcile reads it back; it is never run twice" },
  { id: "REPLAY", when: () => true, say: () => "this decision was already taken — the answer is read back from the journal; nothing ran twice" },
];

// ---- a decision on the workflow as it stands ------------------------------------------------------

const textProblem = (d) => !sentence(d.observed) || !sentence(d.hypothesis) || (d.reason !== undefined && !sentence(d.reason));

const readyIds = (c) => c.ready.map((s) => s.id).join(", ") || "nothing";

// c: { lw, step, ready, gate, verdict, fp, approvals }
const FRESH = [
  { id: "TEXT", fails: (d) => textProblem(d), say: () => `observed and hypothesis are each one sentence of at most ${TEXT_LIMIT} characters, and reason too when given — what was seen and why, never a chain of thought` },
  { id: "EVIDENCE", fails: (d) => !strings(d.evidence, MAX_EVIDENCE), say: () => `evidence is a list of at most ${MAX_EVIDENCE} ids this workflow recorded` },
  { id: "STALE", fails: (d, c) => d.expectedRevision !== c.lw.view.revision, say: (d, c) => `expectedRevision ${d.expectedRevision} is not the workflow's revision ${c.lw.view.revision} — read the context again and decide on what is there now` },
  { id: "ENDED", fails: (d, c) => c.lw.view.terminal, say: (d, c) => `the workflow is ${c.lw.view.lifecycle} — nothing new starts on it` },
  { id: "PAUSED", fails: (d, c) => c.lw.view.lifecycle === LIFE.PAUSED, say: () => "a person paused the workflow — it goes on when they resume it, in Orbit Control" },
  { id: "WAITING", fails: (d, c) => c.lw.view.lifecycle === LIFE.WAITING_APPROVAL, say: () => "a step waits for a person's decision in Orbit Control — read the context again once they decide" },
  { id: "UNSETTLED", fails: (d, c) => c.lw.open.length > 0, say: (d, c) => `${c.lw.open.map((a) => a.id).join(", ")} started and is not settled — settle it with its evidence, or reconcile it; a workflow runs one step at a time` },
  { id: "PLAN", fails: (d, c) => !c.lw.plan, say: () => "the workflow's plan cannot be read — its plan receipt names an artifact that is gone (plan shows it)" },
  { id: "STEP", fails: (d, c) => !c.step, say: (d, c) => `${d.action.step} is not a step of the plan — it has ${c.lw.plan.steps.map((s) => s.id).join(", ")}` },
  { id: "READY", fails: (d, c) => !c.ready.some((s) => s.id === d.action.step), say: (d, c) => `${d.action.step} is not ready — ready now: ${readyIds(c)}` },
  { id: "BLOCKED", fails: (d, c) => c.lw.view.lifecycle === LIFE.BLOCKED && c.state !== "blocked", say: (d, c) => `the workflow is blocked on ${c.lw.states.find((s) => s.state === "blocked")?.id ?? "a step"} — only that step runs again, once what blocked it is settled` },
  { id: "POLICY_DENIED", fails: (d, c) => c.verdict === "deny", say: (d, c) => `${c.kindClass} is denied by policy: the resource policy or action class; nothing here goes around it` },
  { id: "REJECTED", fails: (d, c) => c.gate !== null && c.approvals.rejected.has(c.fp), say: () => "a person rejected exactly this step on this workflow — it is never asked again; decide something else, or finish" },
  { id: "UNNEEDED", fails: (d, c) => d.approval !== undefined && c.gate === null, say: () => "this step needs no person's approval — send it without one" },
  { id: "APPROVAL_UNKNOWN", fails: (d, c) => d.approval !== undefined && !c.approvals.byId.has(d.approval), say: (d) => `${d.approval} is not an approval of this workflow` },
  { id: "NOT_GRANTED", fails: (d, c) => d.approval !== undefined && c.approvals.byId.get(d.approval).state !== "granted", say: (d, c) => `${d.approval} is ${c.approvals.byId.get(d.approval).state} — only a grant a person gave allows the step, once` },
  { id: "OTHER_ACTION", fails: (d, c) => d.approval !== undefined && c.approvals.byId.get(d.approval).fingerprint !== c.fp, say: (d) => `${d.approval} was granted for a different step — an approval allows exactly what it was asked for` },
  { id: "ASKED", fails: (d, c) => d.approval === undefined && c.gate !== null && c.approvals.open.has(c.fp), say: (d, c) => `${c.approvals.open.get(c.fp)} already asks for exactly this step — once a person grants it, send it again with "approval": "${c.approvals.open.get(c.fp)}"` },
];

// ---- an outcome on the workflow as it stands -----------------------------------------------------

// c: { lw, prior, step, state }
const SETTLE = [
  { id: "STALE", fails: (o, c) => o.expectedRevision !== c.lw.view.revision, say: (o, c) => `expectedRevision ${o.expectedRevision} is not the workflow's revision ${c.lw.view.revision} — read the context again` },
  { id: "UNKNOWN_DECISION", fails: (o, c) => !c.prior, say: (o) => `${o.decisionId} decided no step of this workflow — settle the step with the decisionId that started it` },
  { id: "OTHER_STEP", fails: (o, c) => c.prior.nextAction !== `step.${o.stepId}`, say: (o, c) => `${o.decisionId} started ${c.prior.nextAction.slice(5)}, not ${o.stepId}` },
  { id: "NOT_RUNNING", fails: (o, c) => c.state !== "running", say: (o, c) => `${o.stepId} is ${c.state ?? "not a step of the plan"} — only a step the host is running is settled` },
];

function refusedBy(rules, d, c) {
  const failed = rules.find((r) => r.fails(d, c));
  if (failed) throw Object.assign(new Refused(`${failed.id}: ${failed.say(d, c)}`), { code: failed.id });
}

export const judgeForm = (d) => refusedBy(FORM, d, {});

export const judgeFresh = (d, c) => refusedBy(FRESH, d, c);

export const judgeOutcomeForm = (o) => refusedBy(OUTCOME_FORM, o, {});

export const judgeSettle = (o, c) => refusedBy(SETTLE, o, c);

export const againOf = (prior, d, c) => AGAIN.find((r) => r.when(prior, d, c));

export const protocolRules = () => ({ form: FORM.map((r) => r.id), again: AGAIN.map((r) => r.id), fresh: FRESH.map((r) => r.id), outcome: OUTCOME_FORM.map((r) => r.id), settle: SETTLE.map((r) => r.id) });
