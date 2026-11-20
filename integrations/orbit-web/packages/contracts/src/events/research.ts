// The payloads of a RESEARCH stream (`GET /api/research/sessions/:id/events`): one research session's runs. Durable
// events are journaled with the session's own sequence number and replayed after Last-Event-ID; the text still being
// written (`research.message.delta`) is transient and superseded by `research.message.completed`.
import type { EffortChoice, ModelChoice } from "../models.js";
import type { ResearchCitation, ResearchSessionStatus } from "../research.js";
import type { MessageDeltaData, RunUsage } from "./session.js";

export interface ResearchStatusData {
  status: ResearchSessionStatus;
  reason: string | null;
}

// A run started: the exact sources and revisions its evidence is frozen to (a selection changed meanwhile applies to
// the next run), and how many passages it was given.
export interface ResearchRunStartedData {
  model: ModelChoice;
  effort: EffortChoice | null;
  sources: { sourceId: string; revisionId: string; title: string }[];
  passages: number;
  // How many of them matched the question's words; the rest are the openings of the selected sources.
  matched: number;
}

export interface ResearchMessageStartedData {
  messageId: string;
  role: "user" | "assistant";
}

export interface ResearchMessageCompletedData {
  messageId: string;
  role: "user" | "assistant";
  // An answer's text with every citation label the server could not verify removed.
  text: string;
  partial: boolean;
  truncated: boolean;
}

// The citations of one answer, each verified against the passages its run was given; `rejected` names the labels the
// model wrote that no passage of the run had (removed from the text, never shown as evidence).
export interface ResearchCitationRecordedData {
  messageId: string;
  citations: ResearchCitation[];
  rejected: string[];
}

export interface ResearchRunCompletedData extends RunUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ResearchRunFailedData extends RunUsage {
  // `tool_use_refused`: the process reported a tool or tried to use one -- a research run has none, so it was stopped.
  reason: "cli_error" | "exit" | "spawn" | "no_result" | "governance" | "tool_use_refused";
  message: string;
}

export interface ResearchRunInterruptedData {
  reason: "user_stop" | "server_restart";
}

export interface ResearchRunNoticeData {
  kind: "rate_limit" | "info";
  message: string;
}

export interface ResearchEventDataMap {
  "research.status": ResearchStatusData;
  "research.run.started": ResearchRunStartedData;
  "research.message.started": ResearchMessageStartedData;
  "research.message.delta": MessageDeltaData;
  "research.message.completed": ResearchMessageCompletedData;
  "research.citation.recorded": ResearchCitationRecordedData;
  "research.run.completed": ResearchRunCompletedData;
  "research.run.failed": ResearchRunFailedData;
  "research.run.interrupted": ResearchRunInterruptedData;
  "research.run.notice": ResearchRunNoticeData;
}
