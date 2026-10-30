// What ONE run showed, read off its OWNER's record -- a coordinator task's receipts for a declared playbook's run, a
// Satellite mission's conclusion for an agent run -- never off what a host or an agent said about it; and the EVIDENCE
// GROUPS an opportunity is made of: every run of one version that showed one signal on the same steps, with the
// independent sessions they came from and the runs of the same version that held.
//
//   skill run      (src/skill-factory/history.mjs)  { task, run, pin, word, at, session, host, steps: [{ id, word, block, required, retries }] }
//   satellite run  (a port reads the mission)       { kind: "satellite", mission, run, rolePin, at, session, host, outcome, level, signature, attribution }
//
//   signalOf(record) -> { signal, steps }    the first row of its table that holds
//   groupsOf(records) -> [group]             one per (subject, pin, signal, steps)
import { dayOf } from "../memory/session.mjs";
import { signalRow } from "./vocab.mjs";

const required = (r) => (r.steps ?? []).filter((s) => s.required !== false);

const withWord = (r, words) => required(r).filter((s) => words.includes(s.word));

const blockedBy = (r, blocks) => required(r).filter((s) => s.word === "BLOCKED" && blocks.includes(s.block));

const stopped = (r) => ["BLOCKED", "INTERRUPTED"].includes(r.word) || required(r).some((s) => ["BLOCKED", "INTERRUPTED", "AMBIGUOUS"].includes(s.word));

const ids = (steps) => [...new Set(steps.map((s) => s.id))].sort();

// A declared playbook's run, by the words its own receipts carry (src/automation/skill-run-vocab.mjs): a contract the
// definition declares and its providers' answers do not meet is the definition's; a provider that failed, a person's
// approval and an environment that stopped the run are not -- and a run still open says nothing yet.
export const RUN_SIGNALS = [
  { signal: "contract-violation", steps: (r) => withWord(r, ["VERIFY_FAILED"]) },
  { signal: "input-missing", steps: (r) => blockedBy(r, ["INPUT_MISSING", "INPUT_MOVED"]) },
  { signal: "budget-spent", steps: (r) => blockedBy(r, ["BUDGET"]) },
  { signal: "provider-failure", steps: (r) => withWord(r, ["FAILED", "REFUSED"]) },
  { signal: "approval-wait", steps: (r) => blockedBy(r, ["APPROVAL_REQUIRED", "APPROVAL_REJECTED"]) },
  { signal: "environment-blocked", steps: (r) => (stopped(r) ? required(r).filter((s) => s.word !== "CONTRACT_MET" && s.word !== "VERIFIED") : []), any: (r) => stopped(r) },
  { signal: "excessive-retries", steps: (r) => (r.word === "VERIFIED" || r.word === "REPORTED" ? (r.steps ?? []).filter((s) => s.retries > 0) : []) },
  { signal: "verified", steps: () => [], any: (r) => r.word === "VERIFIED" },
  { signal: "answered", steps: () => [], any: (r) => r.word === "REPORTED" },
];

// A Satellite agent run, by the conclusion its mission's engine reached on its owners' records
// (satellite/src/mission/conclude.mjs): evidence that never reached the unit's contract is what its role made of the
// work; a run blocked, or one whose checkout changed under it, is the environment's.
export const SATELLITE_SIGNALS = [
  { signal: "verified", any: (r) => r.outcome === "succeeded" && r.level === "VERIFIED" },
  { signal: "answered", any: (r) => r.outcome === "succeeded" },
  { signal: "unverified-outcome", any: (r) => r.outcome === "insufficient" },
  { signal: "environment-blocked", any: (r) => r.outcome === "blocked" || r.outcome === "violated" },
];

const skillSignal = (r) => ((row) => (row ? { signal: row.signal, steps: ids(row.steps(r)) } : { signal: null, steps: [] }))(RUN_SIGNALS.find((row) => (row.any ? row.any(r) : row.steps(r).length > 0)));

const satelliteSignal = (r) => ((row) => ({ signal: row?.signal ?? null, steps: r.signature ? [r.signature] : [] }))(SATELLITE_SIGNALS.find((row) => row.any(r)));

export const signalOf = (r) => (r.kind === "satellite" ? satelliteSignal(r) : skillSignal(r));

// ---- independence -----------------------------------------------------------------------------------------------

// The ONE rule for how many INDEPENDENT sessions a set of runs came from (src/memory/session.mjs's): two real host
// sessions are two; a run with no host session is its machine's UTC day, and the same session as a real one on that
// machine and day. A retry inside one session is never a second confirmation.
const dayKey = (r) => `${r.host ?? "?"}@${dayOf(r)}`;

export function sessionKeys(runs) {
  const real = runs.filter((r) => r.session);
  const days = new Set(real.map(dayKey));
  const synthetic = runs.filter((r) => !r.session).map(dayKey).filter((d) => !days.has(d));
  return [...new Set([...real.map((r) => `r:${r.session}`), ...synthetic.map((d) => `s:${d}`)])];
}

export const independent = (runs) => sessionKeys(runs).length;

// ---- evidence groups ---------------------------------------------------------------------------------------------

const subjectOf = (r) => (r.kind === "satellite" ? { kind: "satellite", id: String(r.rolePin ?? "").split(":")[0], pin: r.rolePin ?? null } : { kind: "skill", id: String(r.pin ?? "").split(":")[0], pin: r.pin ?? null });

const refOf = (r) => (r.kind === "satellite" ? `agentrun:${r.mission}/${r.run}` : `skillrun:${r.task}/${r.run}`);

const attributionOf = (r) => (r.kind === "satellite" ? r.attribution ?? "REPORTED" : "RUNTIME_BOUND");

const classified = (r) => ((s) => ({ ...r, signal: s.signal, signature: s.steps, subject: subjectOf(r) }))(signalOf(r));

const keyOf = (c) => `${c.subject.kind}|${c.subject.pin}|${c.signal}|${c.signature.join(",")}`;

// Every provider the failing steps were answered through: more than one, and the answer's shape may be theirs.
const providersOf = (runs) => [...new Set(runs.flatMap((r) => (r.steps ?? []).filter((s) => r.signature.includes(s.id)).flatMap((s) => [...(s.providers ?? []), ...(s.bound ? [s.bound] : [])])))].sort();

const byKey = (rows) => rows.reduce((m, c) => m.set(keyOf(c), [...(m.get(keyOf(c)) ?? []), c]), new Map());

const healthyOf = (all, pin) => all.filter((c) => c.subject.pin === pin && signalRow(c.signal)?.healthy === true);

const attribution = (runs) => ({ bound: runs.filter((r) => attributionOf(r) !== "REPORTED" && attributionOf(r) !== "UNATTRIBUTED").length, of: runs.length, words: [...new Set(runs.map(attributionOf))].sort() });

const groupOf = (all) => (runs) => ((first, healthy) => ({ subject: { kind: first.subject.kind, id: first.subject.id }, pin: first.subject.pin, signal: first.signal, category: signalRow(first.signal)?.category ?? null, signature: first.signature, providers: providersOf(runs), runs: runs.length, sessions: independent(runs), sessionKeys: sessionKeys(runs), against: independent(healthy), hosts: new Set(runs.map((r) => r.host ?? "?")).size, evidence: runs.map(refOf).slice(-12), first: runs.map((r) => r.at).sort()[0] ?? null, last: runs.map((r) => r.at).sort().at(-1) ?? null, attribution: attribution(runs), tasks: [...new Set(runs.map((r) => r.task).filter(Boolean))].slice(-12) }))(runs[0], healthyOf(all, runs[0].subject.pin));

// Every group of runs that showed a problem -- the healthy runs are only ever counted AGAINST one.
export function groupsOf(records) {
  const all = (records ?? []).map(classified).filter((c) => c.signal && c.subject.pin);
  return [...byKey(all.filter((c) => signalRow(c.signal)?.healthy === false)).values()].map(groupOf(all));
}
