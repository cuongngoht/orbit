// How an AGENT RUN ENDS, decided by the engine from the evidence its owners hold -- one function, used when its report
// comes back (report.mjs) and when reconcile reads an owner back after the reporter is gone (reconcile.mjs).
//
//   blocked       the run said it could not go on, or an owner's record is BLOCKED
//   violated      the primary checkout changed while the run was open: what it says cannot be told apart from what
//                 changed, so none of its evidence counts
//   succeeded     some piece of evidence reaches the unit's verificationContract (from an independent owner when the
//                 contract asks for one)
//   insufficient  everything else -- a failed attempt, retried while attempts are left
import { canonicalJson, short } from "../../../src/hash.mjs";
import { atLeast, strongest } from "../evidence/vocab.mjs";
import { triggered } from "../execution/triggers.mjs";
import { nextId } from "../store/ids.mjs";
import { clip, list } from "../store/text.mjs";
import { noteSession } from "../hosts/sessions.mjs";
import { endedRunsOf, repeatsOf } from "./state.mjs";

const reached = (c) => c.rows.some((r) => atLeast(r.level, c.unit.verificationContract.min) && (c.unit.verificationContract.owner !== "independent" || r.independent));

export const OUTCOMES = Object.freeze([
  { outcome: "blocked", when: (c) => c.state === "blocked" },
  { outcome: "violated", when: (c) => c.rows.some((r) => r.owner === "checkout" && r.level === "BLOCKED") },
  { outcome: "succeeded", when: reached },
  { outcome: "blocked", when: (c) => c.rows.some((r) => r.level === "BLOCKED") },
  { outcome: "insufficient", when: () => true },
]);

export const outcomeOf = (c) => OUTCOMES.find((o) => o.when(c)).outcome;

const signatureOf = (c, outcome) => (outcome === "succeeded" ? undefined : short(canonicalJson({ unit: c.unit.id, outcome, levels: c.rows.map((r) => `${r.owner}:${r.level}`).sort() }), 12));

function linkedRows(lw, run, c) {
  const extra = { acceptance: list(c.unit.acceptanceCriteriaRefs), supports: list(c.supports), refutes: list(c.refutes) };
  return c.rows.map((r) => lw.append("evidence.linked", { id: nextId(lw.m, "evidence.linked"), action: run.action, unit: c.unit.id, agentRun: run.id, owner: r.owner, ref: r.ref, level: r.level, independent: r.independent === true, digest: r.digest, ...extra, verified: r.level === "VERIFIED" && r.independent === true, say: clip(r.say) }).id);
}

// c: { unit, rows, state, supports, refutes, proposes, summary } -> what the run came to, written.
export function concludeRun(ports, lw, run, c) {
  const outcome = outcomeOf(c);
  lw.append("action.recorded", { id: run.action, outcome, level: strongest(c.rows.map((r) => r.level)), summary: clip(c.summary ?? `${run.id} ${outcome}`) });
  const evidence = linkedRows(lw, run, c);
  lw.append("agentrun.ended", { id: run.id, outcome, failureSignature: signatureOf(c, outcome) });
  return { run: run.id, outcome, evidence, trigger: afterRun(ports, lw, run, c, outcome)?.id ?? null };
}

function afterRun(ports, lw, run, c, outcome) {
  noteSession(ports.io, ports.rooms, { session: ports.session, mission: lw.id, runs: [{ mission: lw.id, agentRunId: run.id, agentType: String(run.agent).split(":")[1], actionId: run.action, profile: run.profile, startedAt: null, endedAt: ports.now() }], at: ports.now() });
  const attemptsLeft = Math.min(c.unit.executionBudget.maxAttempts, lw.limits.maxAttempts) - endedRunsOf(lw.m, c.unit).length;
  return triggered(lw, { at: "ended", outcome, repeats: repeatsOf(lw.m, c.unit), attemptsLeft, proposes: c.proposes, unit: c.unit.id });
}
