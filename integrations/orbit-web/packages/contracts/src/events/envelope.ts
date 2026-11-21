// One envelope for every event on every stream. `id` is unique per event (a client can drop one it already applied);
// `seq` is the session stream's durable sequence number, null for anything transient and for the app stream.
import type { AppStreamEventType, EventDataMap, EventType, ResearchEventType, SessionEventType, StreamKind } from "./catalog.js";

export interface StreamEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  stream: StreamKind;
  // The chat a session-stream event belongs to; null on the app stream.
  sessionId: string | null;
  seq: number | null;
  runId: string | null;
  at: string;
  data: EventDataMap[T];
}

export interface SessionEvent<T extends SessionEventType = SessionEventType> extends StreamEvent<T> {
  stream: "session";
  sessionId: string;
}

export type AnySessionEvent = { [T in SessionEventType]: SessionEvent<T> }[SessionEventType];

export interface AppStreamEvent<T extends AppStreamEventType = AppStreamEventType> extends StreamEvent<T> {
  stream: "app";
  sessionId: null;
  seq: null;
}

export type AnyAppStreamEvent = { [T in AppStreamEventType]: AppStreamEvent<T> }[AppStreamEventType];

// One research session's event: `sessionId` is the research session's id.
export interface ResearchEvent<T extends ResearchEventType = ResearchEventType> extends StreamEvent<T> {
  stream: "research";
  sessionId: string;
}

export type AnyResearchEvent = { [T in ResearchEventType]: ResearchEvent<T> }[ResearchEventType];
