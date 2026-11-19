// Application events: what the API streams to the browser over Server-Sent Events. They are Orbit Web's own names,
// mapped from Claude Code's native stream-json lines by one pure mapper on the server -- the native names are never
// assumed to be these.
//
// DURABLE events are stored with a per-session sequence number (`seq`) that is never reused, and replayed to a client
// that reconnects with `Last-Event-ID`. TRANSIENT events (`message.delta`) carry no `seq`: they are the text of an
// assistant message still being written, kept in memory only while it is written, and superseded by that message's
// durable `message.completed`.
import type { ModelChoice } from "./models.js";
import type { OrbitPanel } from "./orbit.js";
import type { SessionStatus } from "./status.js";

export const DURABLE_EVENT_TYPES = [
  "workspace.preparing",
  "workspace.ready",
  "workspace.failed",
  "session.status",
  "session.started",
  "message.started",
  "message.completed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "permission.denied",
  "run.notice",
  "orbit.updated",
  "verification.updated",
  "session.completed",
  "session.failed",
  "session.interrupted",
] as const;

export const TRANSIENT_EVENT_TYPES = ["message.delta"] as const;

export type DurableEventType = (typeof DURABLE_EVENT_TYPES)[number];
export type TransientEventType = (typeof TRANSIENT_EVENT_TYPES)[number];
export type AppEventType = DurableEventType | TransientEventType;

export interface WorkspacePreparingData {
  repository: string;
  branch: string;
  step: "clone" | "branch" | "identity" | "orbit";
}

export interface WorkspaceReadyData {
  repository: string;
  branch: string;
  workBranch: string;
  baseCommit: string;
  orbitSeated: boolean;
}

export interface WorkspaceFailedData {
  step: string;
  message: string;
}

export interface SessionStatusData {
  status: SessionStatus;
  reason: string | null;
}

export interface PluginInfo {
  name: string;
  version: string | null;
}

// The CLI's own init line, as it said it.
export interface SessionStartedData {
  claudeSessionId: string;
  claudeCodeVersion: string | null;
  model: string | null;
  requestedModel: ModelChoice;
  permissionMode: string | null;
  plugins: PluginInfo[];
  orbitLoaded: boolean;
  orbitVersion: string | null;
  resumed: boolean;
}

export type MessageRole = "user" | "assistant";

export interface MessageStartedData {
  messageId: string;
  role: MessageRole;
  parentToolUseId: string | null;
}

export interface MessageDeltaData {
  messageId: string;
  // Where `text` starts within the message, in UTF-16 code units: a client that already holds more than `offset`
  // characters keeps only the part it does not have, so a replayed piece never doubles text.
  offset: number;
  text: string;
}

export interface MessageCompletedData {
  messageId: string;
  role: MessageRole;
  text: string;
  parentToolUseId: string | null;
  // The message was cut off (the run ended while it was written); `text` is what had arrived.
  partial: boolean;
  truncated: boolean;
}

export interface AgentAttribution {
  // The Agent tool's own input: the subagent type and description the model asked for. Nothing is inferred.
  subagentType: string | null;
  description: string | null;
}

export interface ToolStartedData {
  toolUseId: string;
  name: string;
  title: string;
  input: string;
  inputTruncated: boolean;
  parentToolUseId: string | null;
  agent: AgentAttribution | null;
}

export interface ToolFinishedData {
  toolUseId: string;
  output: string;
  truncated: boolean;
  isError: boolean;
  interrupted: boolean;
  parentToolUseId: string | null;
}

export interface PermissionDeniedData {
  toolName: string;
  toolUseId: string | null;
  input: string;
}

export interface RunNoticeData {
  kind: "rate_limit" | "stderr" | "info";
  message: string;
}

export interface OrbitUpdatedData {
  panel: OrbitPanel;
}

export interface VerificationUpdatedData {
  word: OrbitPanel["verdict"]["word"];
  label: string;
  source: string;
}

export interface RunUsage {
  costUsd: number | null;
  turns: number | null;
  durationMs: number | null;
}

export interface SessionCompletedData extends RunUsage {
  subtype: string;
  result: string;
  permissionDenials: number;
}

export interface SessionFailedData extends RunUsage {
  reason: "cli_error" | "exit" | "spawn" | "no_result";
  subtype: string | null;
  message: string;
  exitCode: number | null;
  signal: string | null;
  permissionDenials: number;
}

export interface SessionInterruptedData {
  reason: "user_stop" | "server_restart";
  exitCode: number | null;
  signal: string | null;
}

export interface EventDataMap {
  "workspace.preparing": WorkspacePreparingData;
  "workspace.ready": WorkspaceReadyData;
  "workspace.failed": WorkspaceFailedData;
  "session.status": SessionStatusData;
  "session.started": SessionStartedData;
  "message.started": MessageStartedData;
  "message.delta": MessageDeltaData;
  "message.completed": MessageCompletedData;
  "tool.started": ToolStartedData;
  "tool.completed": ToolFinishedData;
  "tool.failed": ToolFinishedData;
  "permission.denied": PermissionDeniedData;
  "run.notice": RunNoticeData;
  "orbit.updated": OrbitUpdatedData;
  "verification.updated": VerificationUpdatedData;
  "session.completed": SessionCompletedData;
  "session.failed": SessionFailedData;
  "session.interrupted": SessionInterruptedData;
}

export interface AppEvent<T extends AppEventType = AppEventType> {
  type: T;
  sessionId: string;
  // Durable events only; null for a transient one.
  seq: number | null;
  runId: string | null;
  at: string;
  data: EventDataMap[T];
}

export type AnyAppEvent = { [T in AppEventType]: AppEvent<T> }[AppEventType];

export const isDurableType = (type: string): type is DurableEventType =>
  (DURABLE_EVENT_TYPES as readonly string[]).includes(type);

// What a client should hold after applying a delta to text it already has. Pure, shared by tests on both sides.
export function applyDelta(current: string, delta: MessageDeltaData): string {
  if (delta.offset > current.length) return current;
  const overlap = current.length - delta.offset;
  if (overlap >= delta.text.length) return current;
  return current + delta.text.slice(overlap);
}
