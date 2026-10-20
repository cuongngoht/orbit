// What the Orbit Live pane keeps in the session's state: the last picture the engine answered (`live pane`), the lease
// token that makes this pane the session's viewer while it is open, and which view a person picked.

/** One run of text and the tone Orbit gave it (the engine's words; the pane adds none). */
export type PaneSegment = { text: string; tone: string | null }

/** One row of the workspace: what is on its left, what is on its right, how deep it sits, what it came to. */
export type PaneRow = { left: PaneSegment[]; right: PaneSegment[]; depth: number; status: string | null; label: string | null; /** 0.0.2: the card it is drawn in */ box?: string | null }

/** A view a person switches to under the workspace: its id, its label, its rows. */
export type PaneView = { id: string; label: string; rows: PaneRow[]; /** 0.0.2: what the view shows, beside the tabs */ hint?: string | null }

/** 0.0.2: the header in three parts -- where the viewer stands, the badge (drawn in a border), what the task is and how old. */
export type PaneHeader = { left: PaneSegment[]; badge: PaneSegment[]; right: PaneSegment[] }

/** 0.0.3: one of the header's two orbits -- the parked text the engine's header holds for it, and every frame of its one row. */
export type PaneOrbitRing = { size: string; parked: string; frames: PaneSegment[][] }

/** 0.0.3 (ADR 0029): what turning the header's orbits takes -- whether they turn at all (the animation is not off), one
 * revolution's length, and their rings, turned at one angle. It holds no time: a quiet task's answer stays the same. */
export type PaneOrbit = { moving: boolean; revMs: number; rings: PaneOrbitRing[] }

/** `node <engine>/cli/live.mjs pane --host=claude`'s one JSON object, as the pane draws it. */
export type PaneModel = {
  version: number
  lease: string | null
  held: boolean
  task: string | null
  header: PaneSegment[]
  /** 0.0.2: the same header in its parts; null when the answer has none. */
  headerParts?: PaneHeader | null
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
  /** 0.0.3: the header's orbits, turned by the pane on its own clock in every state; null when the answer has none. */
  orbit?: PaneOrbit | null
}

declare module 'claude-code' {
  interface PluginState {
    orbit: {
      model: PaneModel
      lease: string
      view: string
      /** 0.0.3: the share of a revolution the orbits were drawn at, in steps of the largest ring; 0 while parked. */
      spin: number
    }
  }
}
