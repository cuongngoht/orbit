// What a campaign TEACHES, as the ONE finding the learn port promotes (src/learn/promote.mjs, bound by cli/improve.mjs):
// learn's own ladder decides whether it is a lesson -- two independent sessions and nothing against it -- or an
// observation that is printed and never kept, and learn's own id makes the same claim UPDATE rather than append.
//
// Two claims, and only two:
//   improved   a campaign that evaluated a candidate: "<candidate> improves on <parent> for <steps>", supported by the
//              independent sessions it evaluated better in and CONTRADICTED by the ones it evaluated worse or the same
//              in, and by a regression after it was chosen -- so a later regression demotes the lesson it had earned
//   cause      a campaign that ended without a comparison: "<pin>'s <signal> on <steps> is <cause>", resting on the
//              sessions its opportunity came from
//
//   findingOf(model) -> a learn finding | null      (a campaign that has not ended teaches nothing yet)
import { independent } from "./signals.mjs";
import { causeRow, outcomeRow } from "./vocab.mjs";

const steps = (m) => (m.meta.signature?.length ? m.meta.signature.join(", ") : "its steps");

const evalSessions = (m, verdicts) => independent(m.evaluations.filter((e) => verdicts.includes(e.settled?.verdict)).map((e) => ({ session: e.session ?? null, host: e.host ?? null, at: e.at })));

const regressionSessions = (m) => m.regression?.sessions ?? 0;

const evaluated = (m) => m.evaluations.some((e) => e.settled && ["BETTER", "WORSE", "EQUIVALENT"].includes(e.settled.verdict));

const rowsOf = (m) => m.evaluations.filter((e) => e.settled).map((e) => ({ session: e.session ?? `${e.host ?? "?"}@${String(e.at).slice(0, 10)}`, at: e.at, verdict: e.settled.verdict, fe_commit: null }));

const base = (m) => ({ kind: "saw", family: "improvement", topic: "orbit-improvement", about: m.meta.subjectId, notes: 0, evidenceNotes: [], hosts: new Set(m.evaluations.map((e) => e.host ?? "?")).size || 1, firstSeen: m.meta.at ?? null, confirmed: m.ended?.at ?? m.lastAt ?? null });

const improvedOf = (m) => ({ ...base(m), key: m.candidate.pin, statement: `${m.candidate.pin} improves on ${m.meta.pin}: ${steps(m)} meet their contracts where it did not`, applies: [`the same ${m.meta.subjectKind} (${m.meta.subjectId}) on inputs like the ones it was evaluated on`], notWhen: ["a provider or the environment stopped the run — that is never the definition's"], for: evalSessions(m, ["BETTER"]), against: evalSessions(m, ["WORSE", "EQUIVALENT"]) + regressionSessions(m), runs: m.evaluations.reduce((n, e) => n + e.runs.length, 0), evidenceRuns: rowsOf(m), sessions: [], missing: [`ended ${m.ended.outcome}: ${outcomeRow(m.ended.outcome)?.say ?? ""}`.slice(0, 200)] });

const causeOf = (m) => ({ ...base(m), key: `${m.meta.pin}-${m.diagnosis?.cause ?? "inconclusive"}`, statement: `${m.meta.pin}'s ${m.meta.signal} on ${steps(m)}: ${causeRow(m.diagnosis?.cause ?? "inconclusive")?.say ?? "the evidence cannot tell why"}`, applies: [`${m.meta.subjectId} at ${m.meta.pin}`], notWhen: [], for: m.meta.sessions ?? 0, against: m.meta.against ?? 0, runs: m.meta.runs ?? 0, evidenceRuns: [], sessions: [], missing: (m.diagnosis?.unknowns ?? []).slice(0, 4) });

export const findingOf = (m) => (m?.ended && m.meta ? (evaluated(m) && m.candidate ? improvedOf(m) : causeOf(m)) : null);
