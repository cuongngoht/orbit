// A campaign as its journal says it is: the ONE fold every reader uses -- the loop, the CLI, Orbit Live and Orbit
// Control -- and where it stands, DERIVED on every read. Nothing about a campaign is kept beside its journal to drift
// from it. A line that carries an `eid` already folded is the same event delivered twice, and is folded once.
//
//   modelOf(lines) -> { meta, diagnosis, proposal, generating, candidate, refusals, validated, evaluations, qualified,
//                       gates, awaiting, promotion, promoted, rejected, observations, regression, rollback, rolledBack,
//                       blocked, ended, learned, position, materialAt, lastAt }
//   phaseOf(model) -> a PHASES word, or the phase of the outcome it ended with
import { outcomeRow, isMaterial } from "./vocab.mjs";

const empty = () => ({ meta: null, diagnosis: null, proposal: null, generating: null, candidate: null, refusals: [], validated: null, evaluations: [], qualified: null, gates: null, awaiting: null, promotion: null, promoted: null, rejected: null, observations: [], regression: null, rollback: null, rolledBack: null, blocked: null, ended: null, learned: null, position: 0, materialAt: [], seen: [], lastAt: null });

const onEvaluation = (m, id, change) => ({ ...m, evaluations: m.evaluations.map((e) => (e.evaluation === id ? change(e) : e)) });

export const FOLDS = {
  started: (m, r) => ({ ...m, meta: r }),
  diagnosed: (m, r) => ({ ...m, diagnosis: r }),
  proposed: (m, r) => ({ ...m, proposal: r }),
  generating: (m, r) => ({ ...m, generating: r }),
  generated: (m, r) => ({ ...m, candidate: r, refusals: [] }),
  "generation-refused": (m, r) => ({ ...m, refusals: [...m.refusals, r] }),
  validated: (m, r) => ({ ...m, validated: r }),
  "evaluation-started": (m, r) => ({ ...m, blocked: null, evaluations: [...m.evaluations, { ...r, runs: [], settled: null, interrupted: null }] }),
  "evaluation-run": (m, r) => onEvaluation(m, r.evaluation, (e) => ({ ...e, runs: [...e.runs, r] })),
  "evaluation-settled": (m, r) => onEvaluation(m, r.evaluation, (e) => ({ ...e, settled: r })),
  "evaluation-interrupted": (m, r) => onEvaluation(m, r.evaluation, (e) => ({ ...e, interrupted: r })),
  qualified: (m, r) => ({ ...m, qualified: r }),
  gated: (m, r) => ({ ...m, gates: r }),
  "awaiting-authority": (m, r) => ({ ...m, awaiting: r, promotion: null }),
  "promotion-started": (m, r) => ({ ...m, promotion: r }),
  // Read back from the owner after a crash: nothing was chosen, so the campaign stands where it stood before.
  "promotion-interrupted": (m) => ({ ...m, promotion: null }),
  promoted: (m, r) => ({ ...m, promoted: r, awaiting: null, blocked: null }),
  rejected: (m, r) => ({ ...m, rejected: r, promotion: m.promoted ? m.promotion : null }),
  observed: (m, r) => ({ ...m, observations: [...m.observations, r].slice(-50) }),
  regression: (m, r) => ({ ...m, regression: r }),
  "rollback-started": (m, r) => ({ ...m, rollback: r }),
  "rollback-interrupted": (m) => ({ ...m, rollback: null }),
  "rolled-back": (m, r) => ({ ...m, rolledBack: r, blocked: null }),
  linked: (m, r) => onEvaluation(m, r.evaluation, (e) => ({ ...e, links: [...(e.links ?? []), r] })),
  blocked: (m, r) => ({ ...m, blocked: r, promotion: m.promoted ? m.promotion : null }),
  unblocked: (m) => ({ ...m, blocked: null }),
  ended: (m, r) => ({ ...m, ended: r }),
  learned: (m, r) => ({ ...m, learned: r }),
};

const keep = (m) => m;

const duplicate = (m, line) => Boolean(line.eid) && m.seen.includes(line.eid);

const stamped = (m, line, i) => ({ ...m, position: i + 1, lastAt: line.at ?? m.lastAt, materialAt: isMaterial(line.kind) ? [...m.materialAt, i + 1] : m.materialAt, seen: line.eid ? [...m.seen, line.eid] : m.seen });

const folded = (m, line, i) => stamped(duplicate(m, line) ? m : (FOLDS[line.kind] ?? keep)(m, line), line, i);

export const modelOf = (lines) => (lines ?? []).reduce(folded, empty());

// Where a campaign stands, as an ordered table: the first row that holds decides, and the last always does.
export const PHASES = [
  { id: "ENDED", when: (m) => Boolean(m.ended), say: "ended — its outcome says how" },
  { id: "BLOCKED", when: (m) => Boolean(m.blocked), say: "waiting for a person or the environment — its stop says which" },
  { id: "ROLLED_BACK", when: (m) => Boolean(m.rolledBack), say: "the version a promotion replaced runs again" },
  { id: "ROLLING_BACK", when: (m) => Boolean(m.rollback), say: "a regression was established; the replaced version is being chosen again" },
  { id: "MONITORING", when: (m) => Boolean(m.promoted) && m.observations.length > 0, say: "chosen; later runs are being read against the evidence it was chosen on" },
  { id: "PROMOTED", when: (m) => Boolean(m.promoted), say: "chosen to run for new work; tasks that pinned the old version keep it" },
  { id: "PROMOTING", when: (m) => Boolean(m.promotion), say: "being chosen through its owner's door" },
  { id: "REJECTED", when: (m) => Boolean(m.rejected), say: "rejected — it will never run" },
  { id: "AWAITING_AUTHORITY", when: (m) => Boolean(m.awaiting), say: "qualified; a person promotes it in Orbit Control" },
  { id: "QUALIFIED", when: (m) => Boolean(m.qualified), say: "evaluated better in independent sessions; the promotion gates decide" },
  { id: "EVALUATING", when: (m) => m.evaluations.length > 0, say: "compared with the version it would replace, on the same inputs" },
  { id: "VALIDATED", when: (m) => Boolean(m.validated), say: "held to its owner's contract and the improvement rules" },
  { id: "GENERATED", when: (m) => Boolean(m.candidate), say: "a candidate exists, offered to nobody" },
  { id: "GENERATING", when: (m) => Boolean(m.generating), say: "a successor draft waits for the host to write what changes" },
  { id: "PROPOSED", when: (m) => Boolean(m.proposal), say: "the smallest change and what it must show are proposed" },
  { id: "DIAGNOSED", when: (m) => Boolean(m.diagnosis), say: "what the evidence shows about its cause is recorded" },
  { id: "DETECTED", when: () => true, say: "a recurring problem with enough independent evidence" },
];

export const PHASE_IDS = [...PHASES.map((p) => p.id).filter((id) => id !== "ENDED"), "COMPLETED", "INCONCLUSIVE"];

export const phaseOf = (m) => ((row) => (row.id === "ENDED" ? outcomeRow(m.ended.outcome)?.phase ?? "INCONCLUSIVE" : row.id))(PHASES.find((p) => p.when(m)));

export const openEvaluation = (m) => m.evaluations.find((e) => !e.settled && !e.interrupted) ?? null;

export const settledEvaluations = (m) => m.evaluations.filter((e) => e.settled);

// A campaign at a glance: the words every reader shows, never a percentage nobody measured.
export const stateOf = (m) => ({ phase: phaseOf(m), revision: m.position, terminal: Boolean(m.ended), outcome: m.ended?.outcome ?? null, stop: m.blocked?.stop ?? null, open: openEvaluation(m)?.evaluation ?? null });
