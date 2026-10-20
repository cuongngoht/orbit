// What a step CAME TO, as task operations: an ordered table over the evidence read back and -- only where no
// evidence decides -- what the host reported. The first matching row decides; the last always does.
//
//   satisfied   the owner proves it: the evidence linked, a verification `satisfied` citing it, the step
//               SUCCEEDED, its action completed
//   violated    the owner shows it ended without it: verification `violated`, the step FAILED
//   blocked     the owner waits for someone: the step BLOCKED and the task blocked, naming who
//   reported    the engine has no record to prove it by (project context): REPORTED, `not-verified` --
//               never `satisfied`, whatever anybody says
//   host words  `blocked` and `failed` are taken as the host says them -- a failure needs no proof
//   open        the owner's work still runs: refused, nothing written -- settle again when it ends
//   unreadable  a step that may stand on a report is REPORTED; a strict one is refused until its evidence
//               names something the engine can read back
import { Refused } from "../errors.mjs";
import { DOMAIN, NEEDS, STEP_WORD, STOP } from "./vocab.mjs";

const keyOf = (r) => `${r.domain}:${r.ref}`;

const clip = (text) => String(text ?? "").slice(0, 240) || undefined;

const stepReceipt = (s, word, summary) => ["link-receipt", { domain: DOMAIN.STEP, ref: s.step.id, outcome: word, action: s.act, summary: clip(summary) }];

const evidence = (s) => (s.read.receipt ? [["link-receipt", { ...s.read.receipt, action: s.act }]] : []);

const verified = (s, state) => (s.read.receipt ? [["link-verification", { subject: `${DOMAIN.STEP}:${s.step.id}`, obligation: s.kind.obligation, evidence: keyOf(s.read.receipt), state }]] : [["link-verification", { subject: `${DOMAIN.STEP}:${s.step.id}`, obligation: s.kind.obligation, state: "not-verified" }]]);

const completed = (s, outcome, summary) => ["act-complete", { action: s.act, outcome, receipt: s.read.receipt ? keyOf(s.read.receipt) : undefined, summary: clip(summary) }];

const failed = (s, reason) => ["act-fail", { action: s.act, reason: clip(reason), receipt: s.read.receipt ? keyOf(s.read.receipt) : undefined }];

const blockedBy = (needs) => (needs === NEEDS.REQUIREMENT ? STOP.REQUIREMENT_BLOCKED : STOP.ENVIRONMENT_BLOCKED);

const NEED_WORDS = Object.values(NEEDS);

const needsOf = (s) => (NEED_WORDS.includes(s.read.needs) ? s.read.needs : NEEDS.PERSON);

const block = (s, because) => ["block", { stop: blockedBy(needsOf(s)), needs: needsOf(s), because: clip(`step ${s.step.id}: ${because}`) }];

const summaryOf = (s) => s.read.receipt?.summary ?? s.read.summary ?? s.outcome?.summary;

const hostBecause = (s) => (s.outcome?.blockingReasons ?? []).join("; ") || s.outcome?.summary || "the host could not go on";

const says = (s, word) => s.outcome?.executionState === word;

export const SETTLED = [
  { id: "satisfied", when: (s) => s.read.verdict === "satisfied", ops: (s) => [...evidence(s), ...verified(s, "satisfied"), stepReceipt(s, STEP_WORD.SUCCEEDED, summaryOf(s)), completed(s, "succeeded", summaryOf(s))] },
  { id: "violated", when: (s) => s.read.verdict === "violated", ops: (s) => [...evidence(s), ...verified(s, "violated"), stepReceipt(s, STEP_WORD.FAILED, s.read.because ?? summaryOf(s)), completed(s, "failed", s.read.because ?? summaryOf(s))] },
  { id: "blocked", when: (s) => s.read.verdict === "blocked", ops: (s) => [...evidence(s), stepReceipt(s, STEP_WORD.BLOCKED, s.read.because), failed(s, s.read.because ?? "blocked"), block(s, s.read.because ?? "its owner waits for someone")] },
  { id: "reported", when: (s) => s.read.verdict === "reported", ops: (s) => [...verified(s, "not-verified"), stepReceipt(s, STEP_WORD.REPORTED, summaryOf(s)), completed(s, "succeeded", `reported, not proven: ${summaryOf(s) ?? "nothing to read back"}`)] },
  { id: "host-blocked", when: (s) => says(s, "blocked"), ops: (s) => [stepReceipt(s, STEP_WORD.BLOCKED, hostBecause(s)), failed(s, hostBecause(s)), block({ ...s, read: { needs: NEEDS.PERSON } }, hostBecause(s))] },
  { id: "host-failed", when: (s) => says(s, "failed"), ops: (s) => [...evidence(s), stepReceipt(s, STEP_WORD.FAILED, hostBecause(s)), completed(s, "failed", hostBecause(s))] },
  { id: "open", when: (s) => s.read.verdict === "open", ops: (s) => refuse("STILL_RUNNING", `${s.read.receipt ? keyOf(s.read.receipt) : "its owner"} is still going (${s.read.receipt?.outcome ?? "running"}) — settle it again once it ends; nothing was written`) },
  { id: "may-report", when: (s) => !s.kind.strict, ops: (s) => SETTLED.find((r) => r.id === "reported").ops(s) },
  { id: "unproven", when: () => true, ops: (s) => refuse("EVIDENCE_REQUIRED", `step ${s.step.id} is settled only on evidence its owner keeps (${s.kind.domains.map((d) => `${d}:<id>`).join(", ")}) — ${s.read.because ?? "none was named"}; nothing was written`) },
];

function refuse(id, say) {
  throw Object.assign(new Refused(`${id}: ${say}`), { code: id });
}

// s: { step, kind, act, read, outcome? } -> { row, ops }
export const settledOf = (s) => ((row) => ({ row: row.id, ops: row.ops(s) }))(SETTLED.find((r) => r.when(s)));

// An action that never settled because what ran it is gone: closed, and the step FAILED -- never re-run.
export const interruptedOps = (step, act, because) => [stepReceipt({ step, act }, STEP_WORD.FAILED, because), ["act-fail", { action: act, reason: clip(because) }]];
