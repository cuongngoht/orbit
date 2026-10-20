import { isRecord, numberOf, parsedJson, stringOf } from "../../../shared/json";
import type { TaskView } from "../mission.types";
import type { LiveEvent } from "./live.types";
import { observationOf, type Observation } from "./observation";

// The browser's side of a Server-Sent Events stream, as small as it can be: something that can be listened
// to and closed. EventSource is the real one; a test hands in its own. A browser without EventSource gets
// none, and the page reads the feed every few seconds instead -- and says so.

export interface StreamSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  readonly readyState: number;
}

export type OpenStream = (url: string) => StreamSource;

/** EventSource.CLOSED: the browser has given up on this stream and will not reconnect it itself. */
export const CLOSED = 2;

export const browserStream = (): OpenStream | null => (typeof EventSource === "function" ? (url: string) => new EventSource(url) : null);

export type Frame =
  | { type: "line"; event: LiveEvent; id: string | null }
  | { type: "view"; view: TaskView; id: string | null }
  | { type: "activity"; observation: Observation }
  | { type: "end"; reason: string }
  | { type: "ping" };

/** One task line or QA line from the server, checked field by field. */
export function parseLiveEvent(value: unknown): LiveEvent | null {
  if (!isRecord(value)) return null;
  const source = stringOf(value.source);
  const n = numberOf(value.n);
  const at = stringOf(value.at);
  const kind = stringOf(value.kind);
  return source !== null && n !== null && at !== null && kind !== null ? { ...value, source, n, at, kind } : null;
}

const LIFECYCLES = new Set(["QUEUED", "PREPARING", "EXECUTING", "VERIFYING", "WAITING_APPROVAL", "PAUSED", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED"]);

/** The task view, held to the fields every card reads before it is trusted to be one. */
export function isTaskView(value: unknown): value is TaskView {
  if (!isRecord(value) || !isRecord(value.task) || !isRecord(value.attempt) || !isRecord(value.budget) || !isRecord(value.readiness) || !isRecord(value.changes)) return false;
  const lists = [value.actions, value.attempts, value.approvals, value.decisions, value.receipts, value.verification];
  return numberOf(value.revision) !== null && LIFECYCLES.has(String(value.lifecycle)) && typeof value.terminal === "boolean" && lists.every(Array.isArray);
}

const lastIdOf = (event: Event) => (event instanceof MessageEvent && typeof event.lastEventId === "string" && event.lastEventId.length > 0 ? event.lastEventId : null);

const dataOf = (event: Event): unknown => (event instanceof MessageEvent && typeof event.data === "string" ? parsedJson(event.data) : null);

/** What a named server event says; anything malformed is null and is dropped. */
export function frameOf(name: string, event: Event): Frame | null {
  const data = dataOf(event);
  if (name === "ping") return { type: "ping" };
  if (name === "end") return { type: "end", reason: stringOf(isRecord(data) ? data.reason : null) ?? "ended" };
  if (name === "task-view") return isRecord(data) && isTaskView(data.view) ? { type: "view", view: data.view, id: lastIdOf(event) } : null;
  if (name === "activity-view") return activityFrameOf(data);
  const line = parseLiveEvent(data);
  return line ? { type: "line", event: line, id: lastIdOf(event) } : null;
}

// A check's observation (1.8.5): the frame's own `action` must be the projection's, or it is dropped.
function activityFrameOf(data: unknown): Frame | null {
  const observation = isRecord(data) ? observationOf(data.view) : null;
  return observation !== null && isRecord(data) && data.action === observation.action ? { type: "activity", observation } : null;
}

/** The named events a task stream sends. */
export const FRAME_NAMES = ["task-event", "qa-event", "task-view", "activity-view", "ping", "end"] as const;
