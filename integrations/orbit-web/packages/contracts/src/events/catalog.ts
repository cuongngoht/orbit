// THE EVENT CATALOG: every event Orbit Web publishes, the one stream it travels on, and whether it is DURABLE. It is
// the single list of what exists -- the server's event bus refuses to publish a type that is not here or on the wrong
// stream, and a payload's type comes from the data maps beside it -- so adding an event is one row here, its payload
// type, its producer and its handlers.
//
//   session stream  `GET /api/sessions/:id/events`: one chat. DURABLE events are stored with a per-session sequence
//                   number (`seq`, never reused) and replayed after `Last-Event-ID`; TRANSIENT ones (`message.delta`,
//                   text still being written) carry none and are superseded by a durable event.
//   research stream `GET /api/research/sessions/:id/events`: one research session, numbered and replayed like a chat's,
//                   in a journal of its own -- a research session is not a chat and shares none of a chat's records.
//   executive stream `GET /api/executive/conversations/:id/events`: one CEO Chat conversation, numbered and replayed
//                   like a research session's, in a journal of its own.
//   app stream      `GET /api/events`: notifications for every page (sidebar, connectors, customizations). None is
//                   durable: a client that (re)connects reads the read models again, then applies them.
import type { AppEventDataMap } from "./app.js";
import type { ExecutiveEventDataMap } from "./executive.js";
import type { ResearchEventDataMap } from "./research.js";
import type { SessionEventDataMap } from "./session.js";

export type StreamKind = "session" | "research" | "executive" | "app";

export interface EventSpec {
  stream: StreamKind;
  durable: boolean;
  summary: string;
}

export const EVENT_CATALOG = {
  "workspace.preparing": { stream: "session", durable: true, summary: "A step of preparing the chat's workspace started." },
  "workspace.ready": { stream: "session", durable: true, summary: "The workspace is ready: the chat accepts messages." },
  "workspace.failed": { stream: "session", durable: true, summary: "Preparing the workspace failed at a step." },
  "workspace.branch": { stream: "session", durable: true, summary: "The chat's working branch changed: another branch, or a new one from the work." },
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
  "governance.changed": { stream: "app", durable: false, summary: "Something governance keeps changed (operators, the Constitution, agents, workspaces, audit, findings, reports): read it again." },
  "approval.changed": { stream: "app", durable: false, summary: "A protected action's approval was asked for, decided or spent." },
  "claude.models": { stream: "app", durable: false, summary: "The models the account's default Claude Code connection may use were read again." },
  "research.status": { stream: "research", durable: true, summary: "A research session's status changed." },
  "research.run.started": { stream: "research", durable: true, summary: "A research run started, its evidence frozen to the sources and revisions it names." },
  "research.message.started": { stream: "research", durable: true, summary: "A research message started." },
  "research.message.delta": { stream: "research", durable: false, summary: "A piece of a research answer still being written." },
  "research.message.completed": { stream: "research", durable: true, summary: "A research message is complete (or was cut off)." },
  "research.citation.recorded": { stream: "research", durable: true, summary: "An answer's citations, each verified against the passages its run was given." },
  "research.run.completed": { stream: "research", durable: true, summary: "A research run completed." },
  "research.run.failed": { stream: "research", durable: true, summary: "A research run failed or was refused." },
  "research.run.interrupted": { stream: "research", durable: true, summary: "A research run was stopped or cut short by a restart." },
  "research.run.notice": { stream: "research", durable: true, summary: "Something a person should know about a research run (a rate limit)." },
  "research.workspace.changed": { stream: "app", durable: false, summary: "A research workspace was created or changed." },
  "research.workspace.removed": { stream: "app", durable: false, summary: "A research workspace was deleted." },
  "research.session.summary": { stream: "app", durable: false, summary: "A research session was created or changed: its summary as it is now." },
  "research.session.removed": { stream: "app", durable: false, summary: "A research session was deleted." },
  "research.source.changed": { stream: "app", durable: false, summary: "A research source was added, or its state moved (queued, processing, ready, failed, stale)." },
  "research.source.removed": { stream: "app", durable: false, summary: "A research source was deleted." },
  "research.evidence.changed": { stream: "app", durable: false, summary: "A research note or finding was created, changed or deleted." },
  "office.changed": { stream: "app", durable: false, summary: "Something in the account's virtual office changed (roster, missions, inbox, schedules, connections): read it again." },
  "connections.changed": { stream: "app", durable: false, summary: "One of the account's AI connections was created, changed, checked, disconnected or removed: read the connections again." },
  "executive.conversation.created": { stream: "app", durable: false, summary: "A CEO Chat conversation was started: read the conversations again." },
  "executive.message.created": { stream: "executive", durable: true, summary: "A message was added to a CEO Chat conversation: the owner's, the CEO's, or Orbit's records." },
  "executive.message.changed": { stream: "executive", durable: true, summary: "A message changed: its mission proposal was given or set aside." },
  "executive.turn.waiting": { stream: "executive", durable: true, summary: "The CEO's answer waits: queued, or until the CEO's current run ends or resources free up." },
  "executive.response.started": { stream: "executive", durable: true, summary: "The CEO started answering." },
  "executive.response.delta": { stream: "executive", durable: false, summary: "A piece of the CEO's answer still being written." },
  "executive.response.completed": { stream: "executive", durable: true, summary: "The CEO's answer is complete (or was cut off)." },
  "executive.response.failed": { stream: "executive", durable: true, summary: "The CEO's answer failed, was stopped, or was cut short by a restart: nothing was answered." },
  "executive.mission.linked": { stream: "executive", durable: true, summary: "A mission was given to the CEO from this conversation." },
} as const satisfies Record<string, EventSpec>;

export type EventType = keyof typeof EVENT_CATALOG;

type Catalog = typeof EVENT_CATALOG;

export type SessionEventType = { [K in EventType]: Catalog[K]["stream"] extends "session" ? K : never }[EventType];
export type AppStreamEventType = { [K in EventType]: Catalog[K]["stream"] extends "app" ? K : never }[EventType];
export type ResearchEventType = { [K in EventType]: Catalog[K]["stream"] extends "research" ? K : never }[EventType];
export type ExecutiveEventType = { [K in EventType]: Catalog[K]["stream"] extends "executive" ? K : never }[EventType];
export type DurableEventType = { [K in EventType]: Catalog[K]["durable"] extends true ? K : never }[EventType];
export type DurableSessionEventType = Extract<DurableEventType, SessionEventType>;
export type DurableResearchEventType = Extract<DurableEventType, ResearchEventType>;
export type DurableExecutiveEventType = Extract<DurableEventType, ExecutiveEventType>;
export type TransientEventType = Exclude<SessionEventType, DurableEventType>;

export type EventDataMap = SessionEventDataMap & AppEventDataMap & ResearchEventDataMap & ExecutiveEventDataMap;

export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

export const DURABLE_EVENT_TYPES = EVENT_TYPES.filter((t) => EVENT_CATALOG[t].durable) as DurableEventType[];

export const isEventType = (type: unknown): type is EventType => typeof type === "string" && Object.hasOwn(EVENT_CATALOG, type);

export const isDurableType = (type: string): type is DurableEventType => isEventType(type) && EVENT_CATALOG[type].durable;

export const streamOf = (type: EventType): StreamKind => EVENT_CATALOG[type].stream;
