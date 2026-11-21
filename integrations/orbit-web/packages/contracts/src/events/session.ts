// The payloads of the SESSION stream: the life of one chat, from its workspace to each run. Orbit Web's own names,
// mapped from Claude Code's native stream-json lines by one pure mapper on the server -- the native names are never
// assumed to be these.
import type { ImageRef } from "../images.js";
import type { EffortChoice, ModeChoice, ModelChoice } from "../models.js";
import type { OrbitPanel } from "../orbit.js";
import type { ProjectInventory, ProjectPlugin } from "../project.js";
import type { SessionStatus } from "../status.js";

// The steps of preparing a chat's workspace, in order. `clone` (a repository) or `init` (none), then the rest.
export const WORKSPACE_STEPS = ["clone", "init", "branch", "identity", "orbit", "project"] as const;

export type WorkspaceStep = (typeof WORKSPACE_STEPS)[number];

export interface WorkspacePreparingData {
  // The repository's display name and branch; both null for a workspace with no repository.
  repository: string | null;
  branch: string | null;
  step: WorkspaceStep;
}

export interface WorkspaceReadyData {
  repository: string | null;
  branch: string | null;
  workBranch: string;
  baseCommit: string;
  orbitSeated: boolean;
}

// The working branch moved: to an existing branch (`created` false), or to a new one made from the work as it was.
export interface WorkspaceBranchData {
  from: string | null;
  workBranch: string;
  created: boolean;
  // What the chat's changes are now read against.
  baseCommit: string;
}

export interface WorkspaceFailedData {
  step: string;
  message: string;
}

export interface ProjectInventoryData {
  inventory: ProjectInventory;
}

export interface ProjectPluginData {
  plugin: ProjectPlugin;
}

export interface SessionStatusData {
  status: SessionStatus;
  reason: string | null;
}

export interface PluginInfo {
  name: string;
  version: string | null;
}

// The CLI's own init line, as it said it, and what Orbit Web asked of it.
export interface SessionStartedData {
  claudeSessionId: string;
  claudeCodeVersion: string | null;
  model: string | null;
  requestedModel: ModelChoice;
  requestedEffort: EffortChoice;
  requestedMode: ModeChoice;
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
  // A person's message: the images it carried, by reference -- never their bytes.
  images?: ImageRef[];
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

// Plan mode proposed a plan: the ExitPlanMode tool's own `plan` input (markdown), as the model wrote it.
export interface PlanProposedData {
  toolUseId: string | null;
  plan: string;
  truncated: boolean;
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
  // `governance`: the run was refused before it started (a governed workspace whose Constitution, agent or isolation
  // does not let it run); the message says why.
  reason: "cli_error" | "exit" | "spawn" | "no_result" | "governance";
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

export interface SessionEventDataMap {
  "workspace.preparing": WorkspacePreparingData;
  "workspace.ready": WorkspaceReadyData;
  "workspace.failed": WorkspaceFailedData;
  "workspace.branch": WorkspaceBranchData;
  "project.inventory": ProjectInventoryData;
  "project.plugin": ProjectPluginData;
  "session.status": SessionStatusData;
  "session.started": SessionStartedData;
  "message.started": MessageStartedData;
  "message.delta": MessageDeltaData;
  "message.completed": MessageCompletedData;
  "tool.started": ToolStartedData;
  "tool.completed": ToolFinishedData;
  "tool.failed": ToolFinishedData;
  "permission.denied": PermissionDeniedData;
  "plan.proposed": PlanProposedData;
  "run.notice": RunNoticeData;
  "orbit.updated": OrbitUpdatedData;
  "verification.updated": VerificationUpdatedData;
  "session.completed": SessionCompletedData;
  "session.failed": SessionFailedData;
  "session.interrupted": SessionInterruptedData;
}

// What a client should hold after applying a delta to text it already has. Pure, shared by tests on both sides.
export function applyDelta(current: string, delta: MessageDeltaData): string {
  if (delta.offset > current.length) return current;
  const overlap = current.length - delta.offset;
  if (overlap >= delta.text.length) return current;
  return current + delta.text.slice(overlap);
}
