// THE ORBIT (0.0.1, ADR 0027): the planet a viewer's header opens with -- every viewer's, from the one view model
// (tui/sections/top.mjs `headerRow`): `live tui`, the terminal's pane layout and the docked pane -- its satellite going
// round while the task moves.
//
// HOW IT MOVES, said out loud because a clock moves it (as the starship lane it replaced did, 1.8.8): the satellite
// turns only while the LIVE indicator is ACTIVE, that is only while LIVE's own evidence rule (ADR 0022) holds, and its
// PHASE is the newest evidence's: each new line launches it from the top of its ring, fast for KICK_MS and then
// cruising, so a task that writes shows it at once and one that goes quiet slows. The moment the indicator is anything
// else it rests on its parked frame in a quiet tone, so a tick, a refresh or a heartbeat moves nothing once the
// evidence stops. It is NOT progress: it wraps, it says no share. `pane.animation: off` (reduced motion) keeps it parked
// in the brand's tone while the task moves. The `nowMs` is the one the view model already carries; with none (a docked
// pane's header, whose answer must not change on every ask) it is parked, and the pane turns it on its own clock from
// `orbitTrackOf`, with this file's numbers.
//
//   orbitOf(indicator, { ascii?, nowMs? }) -> { text, tone, moving }
//   orbitTrackOf(indicator, { ascii? }) -> { moving, tone, frames, parked, lastAt, kickMs, fps }
//   phaseOf(sinceMs) -> how many frames the satellite has gone since the newest evidence
//   motionOf(indicator) -> the MOTION row that holds
import { ORBIT_GLYPHS } from "./words.mjs";

export const KICK_MS = 3_000;
export const FPS = Object.freeze({ kick: 10, cruise: 4 });

export const phaseOf = (sinceMs) => Math.floor((FPS.kick * Math.min(sinceMs, KICK_MS) + FPS.cruise * Math.max(0, sinceMs - KICK_MS)) / 1000);

// How the orbit moves, by the indicator: an ordered table, the first row that holds deciding, the last always answering.
export const MOTION = Object.freeze([
  { pose: "orbiting", tone: "brand", when: (i) => i?.state === "ACTIVE" && i.animate !== false },
  { pose: "still", tone: "brand", when: (i) => i?.state === "ACTIVE" },
  { pose: "parked", tone: "subtle", when: () => true },
]);

export const motionOf = (indicator) => MOTION.find((r) => r.when(indicator));

const glyphsOf = (ascii) => ORBIT_GLYPHS[ascii ? "ascii" : "unicode"];

// How long since the newest evidence; with no time recorded, the clock alone, so it cruises.
const sinceOf = (i, nowMs) => ((t) => (Number.isFinite(t) ? Math.max(0, nowMs - t) : nowMs))(Date.parse(i?.lastAt ?? ""));

const frameAt = (g, i, nowMs) => g.frames[phaseOf(sinceOf(i, nowMs)) % g.frames.length];

export function orbitOf(indicator, { ascii = false, nowMs = null } = {}) {
  const m = motionOf(indicator);
  const g = glyphsOf(ascii);
  const moving = m.pose === "orbiting" && Number.isFinite(nowMs);
  return { text: moving ? frameAt(g, indicator, nowMs) : g.parked, tone: m.tone, moving };
}

export const orbitTrackOf = (indicator, { ascii = false } = {}) => ((m, g) => ({ moving: m.pose === "orbiting", tone: m.tone, frames: g.frames, parked: g.parked, lastAt: indicator?.lastAt ?? null, kickMs: KICK_MS, fps: FPS }))(motionOf(indicator), glyphsOf(ascii));
