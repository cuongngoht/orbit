// The LIVE INDICATOR (1.8.6, ADR 0022): what a pane, a status bar and a status line show of a session's view of its
// task in ONE word -- the viewer's own state (presentation.mjs) and the task's lifecycle (its journal's fold) read
// together, in an ordered table, the first row that holds deciding and the last always answering. Only ACTIVE pulses,
// and only on EVIDENCE: its phase is the newest evidence's (presentation.mjs `pulse`), and a person who asked for no
// motion (`pane.animation: off`) gets the still glyph. A tick, a refresh or a heartbeat moves nothing here.
//
//   indicatorOf(snap, settings?) -> { state, word, glyph, tone, pulse, lastAt, animate, fresh, evidence, since }
//     pulse      the frame of PULSE to draw, or null when the indicator does not pulse
//     lastAt     the newest evidence's time (presentation.mjs `lastActivityAt`, 1.8.8), or null: what the orbit
//                (orbit.mjs, 0.0.1) takes its phase from while the indicator is ACTIVE
//     fresh      evidence arrived within FRESH_MS: a drawer may light the word for that beat
//     since      milliseconds since the newest evidence, or null
import { INDICATOR_WORDS, LIFECYCLE_WORDS, PULSE } from "./words.mjs";

export const FRESH_MS = 5_000;

const life = (s) => s?.view?.lifecycle ?? null;

const presented = (s) => s?.presentation?.state ?? null;

export const INDICATOR = [
  { state: "DISCONNECTED", when: (s) => ["UNAVAILABLE", "RECONNECTING", "CONNECTING"].includes(presented(s)) },
  { state: "NONE", when: (s) => !s?.view },
  { state: "COMPLETED", when: (s) => life(s) === "COMPLETED" },
  { state: "FAILED", when: (s) => life(s) === "FAILED" },
  { state: "CANCELLED", when: (s) => life(s) === "CANCELLED" },
  { state: "WAITING", when: (s) => ["WAITING_APPROVAL", "PAUSED"].includes(life(s)), word: (s) => LIFECYCLE_WORDS[life(s)].word },
  { state: "BLOCKED", when: (s) => life(s) === "BLOCKED" },
  { state: "DEGRADED", when: (s) => presented(s) === "DEGRADED" },
  { state: "ACTIVE", when: (s) => presented(s) === "LIVE", pulses: true },
  { state: "IDLE", when: () => true },
];

export const INDICATOR_STATES = INDICATOR.map((r) => r.state);

const animates = (settings) => settings?.pane?.animation !== "off";

const pulseOf = (row, s, animate) => (row.pulses && animate && Number.isInteger(s.presentation?.pulse) ? s.presentation.pulse : null);

export function indicatorOf(snap, settings) {
  const row = INDICATOR.find((r) => r.when(snap));
  const words = INDICATOR_WORDS[row.state];
  const pulse = pulseOf(row, snap ?? {}, animates(settings));
  return { state: row.state, word: row.word?.(snap) ?? words.word, glyph: pulse === null ? words.glyph : PULSE[pulse], tone: words.tone, pulse, lastAt: snap?.presentation?.lastActivityAt ?? null, animate: animates(settings), fresh: row.pulses === true && (snap?.presentation?.sinceLastActivityMs ?? Infinity) <= FRESH_MS, evidence: snap?.presentation?.evidence ?? null, since: snap?.presentation?.sinceLastActivityMs ?? null };
}
