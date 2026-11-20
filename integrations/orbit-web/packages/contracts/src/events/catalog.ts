// THE EVENT CATALOG: every event Orbit Web publishes, the one stream it travels on, and whether it is DURABLE. It is
// the single list of what exists -- the server's event bus refuses to publish a type that is not here or on the wrong
// stream, and a payload's type comes from the data maps beside it -- so adding an event is one row here, its payload
// type, its producer and its handlers.
//
//   session stream  `GET /api/sessions/:id/events`: one chat. DURABLE events are stored with a per-session sequence
//                   number (`seq`, never reused) and replayed after `Last-Event-ID`; TRANSIENT ones (`message.delta`,
//                   text still being written) carry none and are superseded by a durable event.
//   app stream      `GET /api/events`: notifications for every page (sidebar, connectors, customizations). None is
//                   durable: a client that (re)connects reads the read models again, then applies them.
import type { AppEventDataMap } from "./app.js";
import type { SessionEventDataMap } from "./session.js";

export type StreamKind = "session" | "app";

export interface EventSpec {
  stream: StreamKind;
  durable: boolean;
  summary: string;
}

export const EVENT_CATALOG = {
  "workspace.preparing": { stream: "session", durable: true, summary: "A step of preparing the chat's workspace started." },
  "workspace.ready": { stream: "session", durable: true, summary: "The workspace is ready: the chat accepts messages." },
  "workspace.failed": { stream: "session", durable: true, summary: "Preparing the workspace failed at a step." },
  "project.inventory": { stream: "session", durable: true, summary: "The repository's skills, commands, agents and plugins, read on its first fetch." },
  "project.plugin": { stream: "session", durable: true, summary: "One project plugin changed state (installing, installed, loaded, failed)." },
  "session.status": { stream: "session", durable: true, summary: "The chat's status changed." },
  "session.started": { stream: "session", durable: true, summary: "Claude Code started a run (its own init line)." },
  "message.started": { stream: "session", durable: true, summary: "A message started." },
  "message.delta": { stream: "session", durable: false, summary: "A piece of an assistant message still being written." },
  "message.completed": { stream: "session", durable: true, summary: "A message is complete (or was cut off)." },
  "tool.started": { stream: "session", durable: true, summary: "Claude Code called a tool." },
  "tool.completed": { stream: "session", durable: true, summary: "A tool answered." },
  "tool.failed": { stream: "session", durable: true, summary: "A tool failed or was interrupted." },
  "permission.denied": { stream: "session", durable: true, summary: "A tool call was refused by the permission rules." },
  "plan.proposed": { stream: "session", durable: true, summary: "Plan mode proposed a plan." },
  "run.notice": { stream: "session", durable: true, summary: "Something a person should know about a run (a rate limit, a lost conversation)." },
  "orbit.updated": { stream: "session", durable: true, summary: "Orbit's own record of the work changed." },
  "verification.updated": { stream: "session", durable: true, summary: "Orbit's verdict changed." },
  "session.completed": { stream: "session", durable: true, summary: "A run completed." },
  "session.failed": { stream: "session", durable: true, summary: "A run failed." },
  "session.interrupted": { stream: "session", durable: true, summary: "A run was stopped or cut short by a restart." },
  "session.summary": { stream: "app", durable: false, summary: "A chat was created or changed: its summary as it is now." },
  "session.removed": { stream: "app", durable: false, summary: "A chat was deleted." },
  "connector.status": { stream: "app", durable: false, summary: "A connector's sign-in changed." },
  "connector.flow": { stream: "app", durable: false, summary: "A connector's sign-in flow moved." },
  "customizations.changed": { stream: "app", durable: false, summary: "A project's skills or plugins changed." },
} as const satisfies Record<string, EventSpec>;

export type EventType = keyof typeof EVENT_CATALOG;

type Catalog = typeof EVENT_CATALOG;

export type SessionEventType = { [K in EventType]: Catalog[K]["stream"] extends "session" ? K : never }[EventType];
export type AppStreamEventType = { [K in EventType]: Catalog[K]["stream"] extends "app" ? K : never }[EventType];
export type DurableEventType = { [K in EventType]: Catalog[K]["durable"] extends true ? K : never }[EventType];
export type TransientEventType = Exclude<SessionEventType, DurableEventType>;

export type EventDataMap = SessionEventDataMap & AppEventDataMap;

export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

export const DURABLE_EVENT_TYPES = EVENT_TYPES.filter((t) => EVENT_CATALOG[t].durable) as DurableEventType[];

export const isEventType = (type: unknown): type is EventType => typeof type === "string" && Object.hasOwn(EVENT_CATALOG, type);

export const isDurableType = (type: string): type is DurableEventType => isEventType(type) && EVENT_CATALOG[type].durable;

export const streamOf = (type: EventType): StreamKind => EVENT_CATALOG[type].stream;
