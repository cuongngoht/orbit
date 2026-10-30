// The PROMOTION GATES a qualified candidate passes before it may be chosen to run, every one asked every time, in
// order; the first that does not hold decides what happens instead (`onFail`). Pure: what the owners answer now -- the
// candidate read back by its pin, the owner's contract held to it today, the version in place, a person's switches --
// is gathered by the loop through ports and handed in.
//
//   c: { m, aggregate, open, candidate, validation, current, weakened, widened, runs, regressions, values, door, revisionOk }
//   gatesOf(c) -> [{ id, holds, onFail, say }]      decisionOf(rows) -> { decision, gate }
//
//   onFail   reject     the candidate is never chosen, and the campaign ends
//            supersede  the version it would replace is no longer the one in place: the comparison is stale
//            wait       the evidence is not complete yet
//            block      a person's switch holds it: nothing moves until a person moves it
//            await      a person promotes it in Orbit Control (automatic promotion is off)
//            stale      a person decided on a revision the campaign has moved past
import { improvementOf } from "./policy.mjs";

const PROVING = ["RUNTIME_BOUND", "HOST_OBSERVED"];

const candidateRuns = (c) => (c.runs ?? []).filter((r) => r.side === "candidate");

export const PROMOTION_GATES = [
  { id: "CANDIDATE_INTACT", onFail: "reject", holds: (c) => c.candidate?.intact === true && c.candidate.digest === c.m.candidate?.digest, say: () => "the candidate read back by its pin is what was staged and evaluated" },
  { id: "CAPABILITIES_PROVIDED", onFail: "reject", holds: (c) => c.validation?.ok === true, say: (c) => (c.validation?.ok ? "its owner's contract still holds it today: every capability it needs is provided" : `its owner's contract refuses it today: ${(c.validation?.findings ?? []).map((f) => f.id).slice(0, 3).join(", ")}`) },
  { id: "PARENT_CURRENT", onFail: "supersede", holds: (c) => c.current?.pin === c.m.meta.pin, say: (c) => `the version it was compared with (${c.m.meta.pin}) is the one in place${c.current?.pin && c.current.pin !== c.m.meta.pin ? ` — it is ${c.current.pin} now` : ""}` },
  { id: "EVALUATION_COMPLETE", onFail: "wait", holds: (c) => c.aggregate?.verdict === "BETTER" && !c.open, say: (c) => `every evaluation settled and together they say ${c.aggregate?.verdict ?? "nothing yet"}` },
  { id: "EVIDENCE_INDEPENDENT", onFail: "wait", holds: (c) => c.aggregate.sessions >= improvementOf(c.values).minSessions && candidateRuns(c).every((r) => PROVING.includes(r.attribution)), say: (c) => `${c.aggregate.sessions} independent session(s), every run bound by the engine or observed by the host — never only reported` },
  { id: "REQUIRED_CHECKS", onFail: "reject", holds: (c) => candidateRuns(c).length > 0 && candidateRuns(c).every((r) => r.met), say: (c) => `${candidateRuns(c).filter((r) => r.met).length} of ${candidateRuns(c).length} candidate run(s) met every required check` },
  { id: "NO_CRITICAL_REGRESSION", onFail: "reject", holds: (c) => (c.regressions ?? []).length === 0, say: (c) => ((c.regressions ?? []).length ? `it newly failed ${c.regressions.join(", ")}` : "no step the baseline met failed on the candidate") },
  { id: "NO_NEW_PERMISSIONS", onFail: "reject", holds: (c) => (c.widened ?? []).length === 0, say: (c) => ((c.widened ?? []).length ? `it asks for ${c.widened.join(", ")}` : "it asks for nothing the version it succeeds did not have") },
  { id: "ORACLE_UNCHANGED", onFail: "reject", holds: (c) => (c.weakened ?? []).length === 0, say: (c) => ((c.weakened ?? []).length ? c.weakened[0].says : "every acceptance rule of the version it succeeds holds, no looser") },
  { id: "NOT_WITHHELD", onFail: "block", holds: (c) => c.current?.status === "active" && c.current.archived !== true && c.current.revoked !== true, say: (c) => (c.current?.status === "active" && !c.current.revoked ? "a person has not switched it off or revoked it" : `${c.m.meta.subjectId} is ${c.current?.revoked ? "revoked" : c.current?.archived ? "archived" : c.current?.status ?? "gone"} — a person's switch always wins`) },
  { id: "POLICY_ALLOWS", onFail: "await", holds: (c) => c.door === "control" || improvementOf(c.values).promote === true, say: (c) => (c.door === "control" ? "a person promotes it in Orbit Control" : improvementOf(c.values).promote === true ? "a person lets the engine promote on evaluated evidence (improvement.promote)" : "automatic promotion is off — a person promotes it in Orbit Control") },
  { id: "REVISION_CURRENT", onFail: "stale", holds: (c) => c.revisionOk !== false, say: () => "the campaign is what the decision was made on" },
];

export const GATE_IDS = PROMOTION_GATES.map((g) => g.id);

export const gatesOf = (c) => PROMOTION_GATES.map((g) => ({ id: g.id, holds: g.holds(c) === true, onFail: g.onFail, say: String(g.say(c)).slice(0, 240) }));

export const decisionOf = (rows) => ((failed) => ({ decision: failed ? failed.onFail : "promote", gate: failed?.id ?? null, because: failed?.say ?? "every gate holds" }))(rows.find((r) => !r.holds));
