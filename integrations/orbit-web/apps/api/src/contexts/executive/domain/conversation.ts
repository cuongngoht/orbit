// A CEO CHAT CONVERSATION (Executive, pure; ADR 0062): the company's, never a CEO's. What it is called, and how a turn
// moves: queued (behind the conversation's running answer) → waiting (for the CEO's run, or resources) → running → an end.
// A turn that has not started answers every owner message sent before it starts (coalesced); one sent while a turn runs
// is answered by the next.
import { EXECUTIVE_LIMITS, type ExecutiveTurnState } from "@orbit-web/contracts";

export const OPEN_TURN_STATES: readonly ExecutiveTurnState[] = ["queued", "waiting", "running"];
export const PENDING_TURN_STATES: readonly ExecutiveTurnState[] = ["queued", "waiting"];
export const ENDED_TURN_STATES: readonly ExecutiveTurnState[] = ["completed", "failed", "interrupted", "cancelled"];

export const isOpenTurn = (s: ExecutiveTurnState): boolean => OPEN_TURN_STATES.includes(s);

// A conversation's title: the first line of its first message, cut short.
export function titleOf(text: string): string {
  const first = text.split("\n").find((l) => l.trim().length > 0) ?? text;
  const line = first.trim().replace(/\s+/g, " ");
  return line.length <= EXECUTIVE_LIMITS.titleLength ? line : `${line.slice(0, EXECUTIVE_LIMITS.titleLength - 1)}…`;
}

// What happens to an owner's new message: it joins the turn that waits to start, or a new turn answers it.
export function placeOf(open: readonly { state: ExecutiveTurnState }[]): "join" | "new" {
  return open.some((t) => PENDING_TURN_STATES.includes(t.state)) ? "join" : "new";
}

// Why a turn could not answer, in the words the conversation shows.
export const TURN_FAILURES = {
  ceo_changed: "The CEO changed after you sent this, so it was not answered: ask again to have the new CEO answer.",
  ceo_unavailable: "The CEO could not answer:",
  runtime_unsupported: "The CEO runs on an AI CLI that CEO Chat cannot hold to answering without tools:",
  governance: "The company's policy did not let the CEO answer:",
  unschedulable: "The answer cannot start as resources are configured:",
  tool_refused: "The CEO's AI CLI tried to use a tool, which CEO Chat never gives it, so the answer was stopped.",
  cli_error: "The CEO's AI CLI failed:",
  stopped: "Stopped: the answer was cut off where it was.",
  server_restart: "Orbit Web restarted while the CEO was answering: the answer was cut off, and is not resumed on its own.",
  connection_disconnected: "The CEO's AI connection was disconnected while it answered.",
  time_limit: "The answer took longer than an answer may, and was stopped where it was.",
  lost: "The process that ran this answer was lost: it was cut off, and is not resumed on its own.",
} as const;

export type TurnFailure = keyof typeof TURN_FAILURES;
