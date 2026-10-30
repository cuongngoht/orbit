// The ONE projection of a campaign every reader draws -- the CLI's `show`, Orbit Control's candidate page and Orbit
// Live's improvement view -- so a page and a terminal can never disagree about where a campaign stands. Pure: a
// campaign's fold in, words out; what is unknown stays null and is said to be, and nothing is a percentage nobody
// measured.
//
//   campaignView(id, model, values) -> { id, revision, phase, subject, pin, signal, ..., evaluations, aggregate, gates, ... }
//   opportunityView(doc) -> a kept opportunity as a reader shows it
import { aggregateOf } from "./evaluation.mjs";
import { openEvaluation, phaseOf, PHASES } from "./model.mjs";
import { STAGE_MODES, STAGE_OPERATIONS, outcomeRow } from "./vocab.mjs";

const lastMode = (m) => [m.rollback, m.promotion, m.gates, m.evaluations.at(-1), m.validated, m.candidate, m.generating, m.proposal, m.diagnosis].find((x) => x?.mode)?.mode ?? STAGE_MODES.detect;

// Who carries the stage a campaign is in: the engine itself, the host (a successor's text, a Satellite mission), a
// person in Orbit Control, or nobody until later work runs. Never an agent's name a host did not report.
const CARRIER = { GENERATING: "host", AWAITING_AUTHORITY: "person", BLOCKED: "person", MONITORING: "later work", PROMOTED: "later work" };

const evaluationOf = (e) => ({ evaluation: e.evaluation, task: e.task ?? null, at: e.at, session: e.session ?? null, host: e.host ?? null, baseline: e.baseline, candidate: e.candidate, planned: e.planned ?? null, recorded: e.runs.length, links: (e.links ?? []).map((l) => ({ mission: l.mission, side: l.side })), open: !e.settled && !e.interrupted, verdict: e.settled?.verdict ?? (e.interrupted ? "INTERRUPTED" : null), because: e.settled?.because ?? e.interrupted?.because ?? null, regressions: e.settled?.regressions ?? [], metrics: e.settled?.metrics ?? null, attribution: [...new Set(e.runs.map((r) => r.attribution))].sort() });

const promotionOf = (m) => (m.promoted ? { from: m.promoted.from, to: m.promoted.to, door: m.promoted.door, by: m.promoted.by, at: m.promoted.at } : null);

const rollbackOf = (m) => (m.rolledBack ? { state: "ROLLED_BACK", from: m.rolledBack.from, to: m.rolledBack.to, door: m.rolledBack.door, at: m.rolledBack.at } : m.rollback ? { state: "ROLLING_BACK", from: m.rollback.from, to: m.rollback.to, door: m.rollback.door, at: m.rollback.at } : null);

const candidateOf = (m) => (m.candidate ? { id: m.candidate.candidate, pin: m.candidate.pin, digest: m.candidate.digest, successorOf: m.candidate.successorOf, reused: m.candidate.reused === true, changed: m.candidate.changed ?? [], at: m.candidate.at } : null);

export function campaignView(id, m, values) {
  const phase = phaseOf(m);
  return { id, revision: m.position, phase, say: PHASES.find((p) => p.id === phase)?.say ?? outcomeRow(m.ended?.outcome)?.say ?? null, carrier: CARRIER[phase] ?? (m.ended ? "nobody" : "improvement engine"), mode: lastMode(m), modes: STAGE_MODES, operations: STAGE_OPERATIONS, subject: { kind: m.meta?.subjectKind ?? null, id: m.meta?.subjectId ?? null }, pin: m.meta?.pin ?? null, opportunity: m.meta?.opportunity ?? null, signal: m.meta?.signal ?? null, category: m.meta?.category ?? null, signature: m.meta?.signature ?? [], evidence: m.meta?.evidence ?? [], sessions: m.meta?.sessions ?? null, runs: m.meta?.runs ?? null, attribution: m.meta?.attribution ?? null, startedAt: m.meta?.at ?? null, diagnosis: m.diagnosis, proposal: m.proposal, candidate: candidateOf(m), refusals: m.refusals.map((r) => ({ findings: r.findings, at: r.at })), evaluations: m.evaluations.map(evaluationOf), open: openEvaluation(m)?.evaluation ?? null, aggregate: m.validated ? aggregateOf(m.evaluations.filter((e) => e.settled && e.candidate === m.candidate?.pin && e.baseline === m.meta.pin), values) : null, gates: m.gates ? { rows: m.gates.rows, failed: m.gates.failed, at: m.gates.at } : null, awaiting: m.awaiting?.because ?? null, promotion: promotionOf(m), observations: m.observations.slice(-5), regression: m.regression, rollback: rollbackOf(m), blocked: m.blocked ? { stop: m.blocked.stop, needs: m.blocked.needs, because: m.blocked.because, at: m.blocked.at } : null, rejected: m.rejected, ended: m.ended ? { outcome: m.ended.outcome, because: m.ended.because, at: m.ended.at } : null, learned: m.learned, lastAt: m.lastAt };
}

export const opportunityView = (d) => (d?.unreadable ? { id: d.id, unreadable: d.unreadable } : d);

// One line for a list: what a terminal and a table row both start from.
export const campaignRow = (v) => ({ id: v.id, phase: v.phase, subject: v.subject.id, pin: v.pin, candidate: v.candidate?.pin ?? null, signal: v.signal, outcome: v.ended?.outcome ?? null, carrier: v.carrier, revision: v.revision, lastAt: v.lastAt });
