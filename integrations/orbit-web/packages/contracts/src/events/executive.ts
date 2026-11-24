// The payloads of an EXECUTIVE stream (`GET /api/executive/conversations/:id/events`): one CEO Chat conversation.
// Durable events are journaled with the conversation's own sequence number and replayed after Last-Event-ID; the answer
// still being written (`executive.response.delta`) is transient and superseded by `executive.response.completed`. What
// the CEO said is the CEO's (its message names its author); what Orbit's records said is a system message -- a system
// event never speaks as the CEO.
import type { ExecutiveMessage, ExecutiveMissionLink, ExecutiveTurn } from "../executive.js";
import type { MessageDeltaData } from "./session.js";

// A message was added: the owner's, the CEO's, or Orbit's records (a report, a notice about a mission of this
// conversation).
export interface ExecutiveMessageData {
  message: ExecutiveMessage;
}

// A turn is queued, or waits (for the CEO's run to end, for resources) -- with why.
export interface ExecutiveTurnData {
  turn: ExecutiveTurn;
}

// The CEO started answering: the message its answer will be.
export interface ExecutiveResponseStartedData {
  turn: ExecutiveTurn;
  messageId: string;
  authorName: string;
  model: string | null;
}

export interface ExecutiveResponseCompletedData {
  turn: ExecutiveTurn;
  message: ExecutiveMessage;
}

export interface ExecutiveMissionLinkedData {
  link: ExecutiveMissionLink;
  // The proposal it came from, given (null: the owner's own words).
  message: ExecutiveMessage | null;
}

export interface ExecutiveEventDataMap {
  "executive.message.created": ExecutiveMessageData;
  "executive.message.changed": ExecutiveMessageData;
  "executive.turn.waiting": ExecutiveTurnData;
  "executive.response.started": ExecutiveResponseStartedData;
  "executive.response.delta": MessageDeltaData;
  "executive.response.completed": ExecutiveResponseCompletedData;
  "executive.response.failed": ExecutiveTurnData;
  "executive.mission.linked": ExecutiveMissionLinkedData;
}
