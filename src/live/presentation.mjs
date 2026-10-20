// What a VIEWER may say about its own view of a task -- never about the task. A task's lifecycle (EXECUTING,
// WAITING_APPROVAL, BLOCKED, COMPLETED ...) is the journal's, read off the fold; this is whether the viewer
// could read that journal, how much of it, and whether anything has happened lately. An ordered table, first
// row wins, the last always matches. A refresh, a tick or a heartbeat is never progress: LIVE needs EVIDENCE that
// the task moved (1.8.6, ADR 0022) -- an action that started and has not ended, a line of a running check's
// observation written lately (what its command printed, stamped by the check runner as it read it, ADR 0020), or a
// journal line written lately. And the LIVE pulse's PHASE is the newest such timestamp's, never the clock that
// redraws: it moves when evidence arrives and stands still when none does.
//
//   presentationOf(facts) -> { state, sinceLastLineMs, sinceLastActivityMs, lastActivityAt, evidence, pulse }
//   facts: { reads, failures, good, partial, terminal, running, lastEventAt, lastObservedAt, evidenceMark, now, idleAfterMs, retries }
//     reads     how many reads were attempted          failures  how many failed in a row since the last good one
//     good      whether any read ever succeeded         partial   a held tail, a newer schema, a source unreadable, a spent deadline
//     terminal  the task's lifecycle is terminal        running   an action started and not ended
//     lastEventAt  the newest line's `at`, or null      lastObservedAt  the newest observation line's `at`, or null
//     evidenceMark  how many lines of evidence there are -- every source's last index, every observation's sequence
//     now / idleAfterMs   in milliseconds
export const RETRIES = 3;
export const IDLE_AFTER_MS = 120_000;

const recentAt = (f, at) => typeof at === "string" && Number.isFinite(Date.parse(at)) && f.now - Date.parse(at) <= (f.idleAfterMs ?? IDLE_AFTER_MS);

// What counts as the task MOVING, in order: the first row that holds is the evidence a viewer names.
export const EVIDENCE = [
  { kind: "action", when: (f) => Boolean(f.running) },
  { kind: "observation", when: (f) => recentAt(f, f.lastObservedAt) },
  { kind: "line", when: (f) => recentAt(f, f.lastEventAt) },
];

const evidenceOf = (f) => EVIDENCE.find((r) => r.when(f))?.kind ?? null;

export const STATES = [
  { state: "CONNECTING", when: (f) => f.reads === 0 },
  { state: "UNAVAILABLE", when: (f) => f.failures > 0 && (!f.good || f.failures > (f.retries ?? RETRIES)) },
  { state: "RECONNECTING", when: (f) => f.failures > 0 },
  { state: "DEGRADED", when: (f) => f.partial },
  { state: "FINISHED", when: (f) => f.terminal },
  { state: "LIVE", when: (f) => evidenceOf(f) !== null },
  { state: "IDLE", when: () => true },
];

export const STATE_NAMES = STATES.map((r) => r.state);

const ageAt = (f, at) => (typeof at === "string" && Number.isFinite(Date.parse(at)) ? Math.max(0, f.now - Date.parse(at)) : null);

// The newest moment the task was seen to move: a journal line or an observation line, whichever is later.
export const lastActivityOf = (f) => [f.lastEventAt, f.lastObservedAt].filter((at) => typeof at === "string" && Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;

// The pulse's phase: one of PULSE's frames, moved one frame by every new line of evidence (`evidenceMark`) -- so the
// glyph changes exactly when evidence arrives, however close together, and never by itself. Where no mark is known
// (a single fact handed in), the second the newest evidence was written. Null with no evidence at all.
export const PULSE_FRAMES = 4;

const pulseOf = (f, at) => (at === null ? null : Number.isInteger(f.evidenceMark) ? f.evidenceMark % PULSE_FRAMES : Math.floor(Date.parse(at) / 1000) % PULSE_FRAMES);

export function presentationOf(facts) {
  const row = STATES.find((r) => r.when(facts));
  const last = lastActivityOf(facts);
  return { state: row.state, sinceLastLineMs: ageAt(facts, facts.lastEventAt), sinceLastActivityMs: ageAt(facts, last), lastActivityAt: last, evidence: row.state === "LIVE" ? evidenceOf(facts) : null, pulse: pulseOf(facts, last) };
}
