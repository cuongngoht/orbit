// A mission's VERDICT, derived on every read: VERIFIED only when every acceptance criterion the intent recorded has at
// least one evidence row that is VERIFIED by an INDEPENDENT owner, from a run that ended succeeded after its unit's
// last reset, and nothing is still open. A tool that completed, a report that holds to its contract and an agent's
// word are evidence of themselves -- never of the outcome.
import { list } from "../store/text.mjs";
import { openActions } from "../mission/state.mjs";
import { rankOf, strongest } from "./vocab.mjs";

const succeededRun = (m, row) => ((run, unit) => Boolean(run?.ended) && run.ended.outcome === "succeeded" && (!unit || run.n > unit.resetAt))(m.runs.get(row.agentRun), m.units.get(row.unit));

// The rows that still count: from a succeeded run of a unit that was not reset since.
export const countedEvidence = (m) => [...m.evidence.values()].filter((row) => succeededRun(m, row));

const standing = (rows) => ({ level: strongest(rows.map((r) => r.level)), independent: rows.some((r) => r.independent && r.level === "VERIFIED"), verified: rows.some((r) => r.verified), refs: rows.filter((r) => rankOf(r.level) >= rankOf("TOOL_COMPLETED")).map((r) => r.ref) });

export const acceptanceOf = (m, rows = countedEvidence(m)) => list(m.intent?.acceptanceCriteria).map((c) => ({ id: c.id, statement: c.statement, ...standing(rows.filter((r) => list(r.acceptance).includes(c.id))) }));

export function verdictOf(m, settled) {
  const acceptance = acceptanceOf(m);
  const owed = acceptance.filter((a) => !a.verified).map((a) => ({ acceptance: a.id, has: a.level, needs: "VERIFIED from an independent owner (an engineering task's verification, a declared check, a QA investigation)" }));
  const verified = acceptance.length > 0 && owed.length === 0 && openActions(m).length === 0;
  return { verdict: verified ? "VERIFIED" : settled ? "NOT_VERIFIED" : "PENDING", acceptance, owed };
}

const HYPOTHESIS = [
  { status: "confirmed", when: (rows) => rows.supports.some((r) => r.independent && r.level === "VERIFIED") },
  { status: "refuted", when: (rows) => rows.refutes.some((r) => r.independent && rankOf(r.level) >= rankOf("BEHAVIOR_OBSERVED")) },
  { status: "contested", when: (rows) => rows.refutes.length > 0 },
  { status: "supported", when: (rows) => rows.supports.length > 0 },
  { status: "open", when: () => true },
];

// What evidence says about each hypothesis: only an independent owner's record ever confirms or refutes one.
export const hypothesesOf = (m, rows = countedEvidence(m)) => list(m.intent?.hypotheses).map((h) => ((r) => ({ id: h.id, statement: h.statement, status: HYPOTHESIS.find((x) => x.when(r)).status }))({ supports: rows.filter((x) => list(x.supports).includes(h.id)), refutes: rows.filter((x) => list(x.refutes).includes(h.id)) }));
