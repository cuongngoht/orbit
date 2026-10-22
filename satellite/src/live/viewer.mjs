// The VIEWER's own state -- connecting, live (said ORBITING), idle, finished -- kept apart from the mission's
// lifecycle and computed by Orbit Live's own table (src/live/presentation.mjs). A tick moves how long ago the last line
// was; it never moves the view, a lifecycle or a piece of evidence.
import { presentationOf } from "../../../src/live/presentation.mjs";
import { PRESENTATION_WORDS } from "../../../src/live/words.mjs";
import { TERMINAL } from "../mission/vocab.mjs";

export function viewerStateOf(view, read, nowMs) {
  const p = presentationOf({ reads: read.reads ?? 1, failures: read.failures ?? 0, good: read.good ?? 1, partial: false, terminal: TERMINAL.includes(view.mission.lifecycle), running: view.execution.open.length > 0, lastEventAt: view.meta.lastEventAt, lastObservedAt: null, evidenceMark: view.meta.seq, now: nowMs, idleAfterMs: read.idleAfterMs });
  return { ...p, word: PRESENTATION_WORDS[p.state]?.word ?? p.state, glyph: PRESENTATION_WORDS[p.state]?.glyph ?? "", tone: PRESENTATION_WORDS[p.state]?.tone ?? null };
}
