// What the Orbit Live pane keeps in the session's state: the last picture the engine answered (`live pane`), the lease
// token that makes this pane the session's viewer while it is open, and which view a person picked.

/** One run of text and the tone Orbit gave it (the engine's words; the pane adds none). */
export type PaneSegment = { text: string; tone: string | null }

/** One row of the workspace: what is on its left, what is on its right, how deep it sits, what it came to. */
export type PaneRow = { left: PaneSegment[]; right: PaneSegment[]; depth: number; status: string | null; label: string | null }

/** A view a person switches to under the workspace: its id, its label, its rows. */
export type PaneView = { id: string; label: string; rows: PaneRow[] }

/** 0.0.1: what turning the header's orbit takes -- its frames, whether it moves, the newest evidence's time it turns from. */
export type PaneOrbit = { moving: boolean; tone: string | null; frames: string[]; parked: string; lastAt: string | null; kickMs: number; fps: { kick: number; cruise: number } }

/** `node <engine>/cli/live.mjs pane --host=claude`'s one JSON object, as the pane draws it. */
export type PaneModel = {
  version: number
  lease: string | null
  held: boolean
  task: string | null
  header: PaneSegment[]
  overview: PaneSegment[][]
  now: PaneSegment[][]
  tier: string | null
  titles: { checklist: string; current: string }
  checklist: PaneRow[]
  current: PaneRow[]
  statusBar: PaneRow | null
  views: PaneView[]
  /** 1.8.6: task progress and test progress, over the denominators their owners recorded -- two rows, or none. */
  progress: PaneRow[]
  look: { widthPercent: number; focusCli: boolean }
  hints: { inline: string | null }
  /** 0.0.1: the header's orbit, turned by the pane while it moves; null when the answer has none. */
  orbit?: PaneOrbit | null
}

declare module 'claude-code' {
  interface PluginState {
    orbit: {
      model: PaneModel
      lease: string
      view: string
      spin: string
    }
  }
}
