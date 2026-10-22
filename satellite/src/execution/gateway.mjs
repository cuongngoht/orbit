// THE EXECUTION GATEWAY: the one path every Satellite operation takes, so nothing it does can go unobserved.
//
//   ACTION PROPOSAL      action.proposed: its mode, operation kind, provider and profile DERIVED from what the plan
//                        accepted -- never sent by the host
//   CONTRACT VALIDATION  the row's own contract; a refusal is action.refused, nothing dispatched
//   POLICY CHECK         profile × operation × mode × owner × grants, together (src/permissions/evaluate.mjs);
//                        permission.evaluated always, permission.denied + action.refused when it denies
//   DISPATCH INTENT      action.intended, DURABLE before any side effect (and a lease when the provider runs outside
//                        the lock)
//   PROVIDER EXECUTION   the row's run (engine, inside the lock) or call (a spawned owner, OUTSIDE every lock)
//   OBSERVED RESULT      action.observed: references and digests, never payloads
//   EVIDENCE RECORD      action.recorded, then evidence.linked for each piece read back
//   JOURNAL / LIVE       every line above is the authoritative journal; Live is a fold of it (src/projection/)
//
// Recording an intent is not running: an action the host must carry out stays OPEN (INTENT_PERSISTED or
// PROVIDER_ACCEPTED) until its result comes back and is read back.
import { canonicalJson, short } from "../../../src/hash.mjs";
import { evaluate } from "../permissions/evaluate.mjs";
import { effectiveGrants, whyWithheld } from "../permissions/grants.mjs";
import { effectOf } from "../permissions/operations.mjs";
import { nextId } from "../store/ids.mjs";
import { clip, list } from "../store/text.mjs";
import { triggered } from "./triggers.mjs";

export const PIPELINE = Object.freeze(["ACTION_PROPOSAL", "CONTRACT_VALIDATION", "POLICY_CHECK", "DISPATCH_INTENT", "PROVIDER_EXECUTION", "OBSERVED_RESULT", "EVIDENCE_RECORD", "AUTHORITATIVE_JOURNAL", "LIVE_PROJECTION"]);

export const askedOf = (action) => short(canonicalJson(action ?? null), 16);

const correlationOf = (row, plan, a) => ({ unit: row.unitOf?.(plan, a) ?? a.unit ?? undefined, agentRun: row.runOf?.(plan, a) ?? a.agentRun ?? undefined, parentAction: row.parentOf?.(plan, a) ?? undefined, parentAgentRun: a.parentAgentRun ?? undefined });

function shapeOf(lw, a, row, plan) {
  const operationKind = row.operation(plan, a, lw);
  const base = { id: nextId(lw.m, "action.proposed"), type: a.kind, mode: row.mode(plan, a, lw), operationKind, effect: effectOf(operationKind), provider: row.provider(plan, a, lw), profile: row.profile(plan, a, lw) };
  return { ...base, ...correlationOf(row, plan, a), asked: askedOf(a), fingerprint: short(canonicalJson({ type: a.kind, unit: a.unit ?? null, asked: askedOf(a) }), 16) };
}

// x: { d, row, a, plan, shape } -- everything one action carries through the gateway.
export function proposed(ports, lw, d, row) {
  const plan = row.plan ? row.plan(ports, lw, d.action) : {};
  const shape = shapeOf(lw, d.action, row, plan);
  lw.append("action.proposed", { ...shape, decision: d.decisionId, observed: d.observed, hypothesis: d.hypothesis, reason: d.reason, evidence: d.evidence });
  lw.action = shape.id;
  return { d, row, a: d.action, plan, shape };
}

function refusedAction(lw, x, f) {
  for (const [kind, record] of list(f.lines)) lw.append(kind, record);
  lw.append("action.refused", { id: x.shape.id, rule: f.rule, say: clip(f.say) });
  if (f.trigger) triggered(lw, { at: f.trigger, unit: x.shape.unit ?? null });
  return { refused: true, action: x.shape.id, rule: f.rule, say: f.say };
}

function deniedAction(lw, x, v) {
  lw.append("permission.denied", { action: x.shape.id, unit: x.shape.unit, agentRun: x.shape.agentRun, operationKind: x.shape.operationKind, profile: x.shape.profile, mode: x.shape.mode, rule: v.rule, say: clip(v.say) });
  lw.append("action.refused", { id: x.shape.id, rule: v.rule, say: clip(v.say) });
  triggered(lw, { at: "denied", unit: x.shape.unit ?? null });
  return { refused: true, denied: true, action: x.shape.id, rule: v.rule, say: v.say };
}

const parentGrantsOf = (lw, x) => (x.shape.parentAgentRun ? lw.m.runs.get(x.shape.parentAgentRun)?.grants ?? [] : undefined);

const grantsFor = (ports, lw, x) => effectiveGrants({ profile: x.shape.profile, mode: x.shape.mode, values: ports.limits.values, spent: lw.spent(), budget: { actions: lw.limits.maxActions }, parentGrants: parentGrantsOf(lw, x) });

// CONTRACT, then POLICY: null when the action may go on, else what refused it (already journaled).
export function admitted(ports, lw, x) {
  const finding = x.row.contract ? x.row.contract(ports, lw, x.a, x.plan) : null;
  return finding ? refusedAction(lw, x, finding) : policed(ports, lw, x);
}

function policed(ports, lw, x) {
  const grants = grantsFor(ports, lw, x);
  const verdict = evaluate({ ...x.shape, grants: grants.operationKinds, why: whyWithheld(grants, x.shape.operationKind) });
  lw.append("permission.evaluated", { action: x.shape.id, profile: x.shape.profile, operationKind: x.shape.operationKind, mode: x.shape.mode, verdict: verdict.verdict, rule: verdict.rule });
  x.grants = grants.operationKinds;
  return verdict.verdict === "deny" ? deniedAction(lw, x, verdict) : null;
}

export const intended = (ports, lw, x, lease) => lw.append("action.intended", { id: x.shape.id, lease: lease ? lease.token.slice(0, 8) : undefined, host: ports.host, pid: ports.pid });

// A closed result: observed, recorded, then each piece of evidence it rests on.
export function recorded(lw, x, r) {
  lw.append("action.observed", { id: x.shape.id, refs: list(r.refs), digests: list(r.digests), outcome: r.outcome, by: r.by ?? "engine" });
  lw.append("action.recorded", { id: x.shape.id, outcome: r.outcome, level: r.level ?? "UNKNOWN", summary: clip(r.summary) });
  const ids = list(r.evidence).map((row) => lw.append("evidence.linked", { id: nextId(lw.m, "evidence.linked"), action: x.shape.id, unit: x.shape.unit, owner: row.owner, ref: row.ref, level: row.level, independent: row.independent === true, digest: row.digest, verified: row.level === "VERIFIED" && row.independent === true, say: clip(row.say) }).id);
  return { action: x.shape.id, outcome: r.outcome, level: r.level ?? "UNKNOWN", summary: r.summary ?? null, evidence: ids, ...(r.result ? { result: r.result } : {}) };
}
