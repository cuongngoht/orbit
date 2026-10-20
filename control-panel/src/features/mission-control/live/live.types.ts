import type { Action, Approval, Blocked, Ended, Lifecycle, Paused, Stage, TaskEvent, TaskView } from "../mission.types";
import type { Tone } from "../missionWords";
import type { Observation } from "./observation";

// Orbit Live, as the page holds it. Every line comes from a journal the engine keeps -- the task's own, or
// an investigation begun against its sandbox -- through control-server/src/live/. Nothing here is a
// second state of the task: the TaskView the stream sends is the same view every card reads.

/** The QA activity an investigation's lines say (src/investigation/activity.mjs ACTIVITY). */
export const QA_KINDS = ["qa.started", "qa.plan", "qa.decision", "qa.step", "qa.console", "qa.network", "qa.check", "qa.security", "qa.finding", "qa.reproduction", "qa.run", "qa.draft", "qa.settled", "qa.question", "qa.answer", "qa.resumed", "qa.ended"] as const;

export type QaKind = (typeof QA_KINDS)[number];

export const isQaKind = (kind: string): kind is QaKind => (QA_KINDS as readonly string[]).includes(kind);

/** One line of a live task: `source` is "task", or the investigation it came from. */
export interface LiveEvent extends TaskEvent {
  source: string;
}

/** One line is one row: its source, its index in that source, and what it says. */
export const liveKey = (e: LiveEvent) => `${e.source}:${e.n}:${e.kind}`;

export const isTaskEvent = (e: LiveEvent) => e.source === "task";

/** Whether the page holds a healthy stream -- never whether the task is still going. */
export type ConnectionState = "connecting" | "live" | "reconnecting" | "degraded" | "offline" | "finished";

export type Glyph = "state" | "started" | "ok" | "failed" | "decision" | "file" | "evidence" | "warning" | "paused" | "person" | "qa";

export type LiveGroup = "state" | "action" | "decision" | "file" | "qa" | "approval";

export type LiveFilter = "all" | "decisions" | "actions" | "qa" | "files" | "errors" | "approvals";

export interface LiveRow {
  key: string;
  source: string;
  n: number;
  at: string;
  kind: string;
  glyph: Glyph;
  tone: Tone;
  group: LiveGroup;
  line: string;
  detail: string | null;
  failed: boolean;
  /** A stage line: drawn as a heading of the loop (IMPLEMENT → BUILD → TEST → DIAGNOSE → FIX …). */
  stage: boolean;
}

/** What one investigation has done so far, folded from its qa.* lines -- only what they said. */
export interface QaProgress {
  id: string;
  mode: string | null;
  origin: string | null;
  startedAt: string;
  step: { verb: string; on: string | null; url: string | null; state: string | null; at: string } | null;
  url: string | null;
  lastFailure: { method: string | null; endpoint: string | null; status: number | null } | null;
  consoleErrors: number;
  screenshots: number;
  steps: number;
  runs: { passed: number; failed: number };
  findings: number;
  ended: { at: string; lifecycle: string | null } | null;
}

/** What the task is doing now, derived in an order: what ended, then what waits for a person, then what runs. */
export type CurrentActivity =
  | { kind: "ended"; ended: Ended; lifecycle: Lifecycle }
  | { kind: "approval"; approval: Approval }
  | { kind: "paused"; paused: Paused }
  | { kind: "blocked"; blocked: Blocked }
  | { kind: "qa"; qa: QaProgress; stage: Stage | null }
  | { kind: "dispatch"; action: Action; via: string; provider: string | null; label: string; stage: Stage | null }
  | { kind: "action"; action: Action; label: string; stage: Stage | null }
  | { kind: "diagnosing"; lastFailure: string | null; next: string | null }
  | { kind: "stage"; stage: Stage | null; lifecycle: Lifecycle };

/** GET …/activity: the merged feed from a cursor, the task as of now, and the cursor after it. */
export interface ActivityResponse {
  version: number;
  task: string;
  cursor: string;
  terminal: boolean;
  view: TaskView | null;
  events: LiveEvent[];
  /** 1.8.5: what each check was observed doing, by action id -- unchecked until `observationsOf` reads it. */
  activity?: unknown;
}

export interface LiveState {
  cursor: string | null;
  rows: LiveRow[];
  /** Rows trimmed off the front of the bounded window; "Load earlier" brings them back. */
  hidden: number;
  unbounded: boolean;
  seen: ReadonlySet<string>;
  qa: Readonly<Record<string, QaProgress>>;
  /** What each check was observed doing while it ran, by action id: a projection replaced, never merged (observation.ts). */
  activity: Readonly<Record<string, Observation>>;
  view: TaskView | null;
  connection: ConnectionState;
  /** The page opened on a task that had already ended: what it shows is a replay of the journal. */
  replay: boolean;
  lastEventAt: string | null;
  following: boolean;
  newSinceFollow: number;
}
