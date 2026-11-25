// How a run ended, decided from facts only: whether a person (or a restart) stopped it, whether the program could
// start, the CLI's own result line, and the real exit status. The model's words never decide it, and a stopped run
// is never `completed`.
import type { EventDataMap, SessionStatus } from "@orbit-web/contracts";
import type { ExitInfo } from "../../infra/process/process.port.js";
import type { ResultInfo } from "./stream-mapper.js";

export type Outcome =
  | { status: Extract<SessionStatus, "completed">; type: "session.completed"; data: EventDataMap["session.completed"] }
  | { status: Extract<SessionStatus, "failed">; type: "session.failed"; data: EventDataMap["session.failed"] }
  | { status: Extract<SessionStatus, "interrupted">; type: "session.interrupted"; data: EventDataMap["session.interrupted"] };

export interface OutcomeFacts {
  stoppedBy: "user_stop" | "server_restart" | null;
  exit: ExitInfo;
  result: ResultInfo | null;
  stderrTail: string;
  // The CLI the run was, as its messages name it.
  cli?: string;
}

export function decideOutcome(f: OutcomeFacts): Outcome {
  const usage = { costUsd: f.result?.costUsd ?? null, turns: f.result?.turns ?? null, durationMs: f.result?.durationMs ?? null };
  const denials = f.result?.permissionDenials ?? 0;
  if (f.stoppedBy !== null) return { status: "interrupted", type: "session.interrupted", data: { reason: f.stoppedBy, exitCode: f.exit.code, signal: f.exit.signal } };
  if (f.exit.spawnError !== null) {
    return { status: "failed", type: "session.failed", data: { reason: "spawn", subtype: null, message: `${f.cli ?? "Claude Code"} could not be started (${f.exit.spawnError}).`, exitCode: null, signal: null, permissionDenials: 0, ...usage } };
  }
  if (f.result !== null && !f.result.isError && f.result.subtype === "success" && f.exit.code === 0) {
    return { status: "completed", type: "session.completed", data: { subtype: f.result.subtype, result: f.result.text, permissionDenials: denials, ...usage } };
  }
  if (f.result !== null) {
    const message = f.result.text.trim() || `${f.cli ?? "Claude Code"} ended with ${f.result.subtype}.`;
    return { status: "failed", type: "session.failed", data: { reason: "cli_error", subtype: f.result.subtype, message, exitCode: f.exit.code, signal: f.exit.signal, permissionDenials: denials, ...usage } };
  }
  const how = f.exit.signal !== null ? `was stopped by ${f.exit.signal}` : `exited with code ${f.exit.code}`;
  const message = f.stderrTail.trim() ? `${f.cli ?? "Claude Code"} ${how}: ${f.stderrTail.trim()}` : `${f.cli ?? "Claude Code"} ${how} without a result.`;
  return { status: "failed", type: "session.failed", data: { reason: f.exit.code === 0 ? "no_result" : "exit", subtype: null, message, exitCode: f.exit.code, signal: f.exit.signal, permissionDenials: 0, ...usage } };
}

// The CLI could not find the conversation to resume (it was never stored): the next turn must start a new one.
// Claude Code: "No conversation found"; OpenAI Codex: "no rollout found for thread id".
export const lostConversation = (text: string): boolean => /No conversation found|no rollout found for thread id/i.test(text);
