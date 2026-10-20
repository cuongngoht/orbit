import type { FollowVerdict, StepKind, TurnOutcome } from "./trace.types";

export const TRACE_PATH = "/trace";
export const turnPath = (id: string) => `${TRACE_PATH}/${encodeURIComponent(id)}`;

type BadgeColor = "success" | "danger" | "warning" | "informative" | "subtle";

// Every status carries a WORD, never a color alone.
export const FOLLOWED: Record<FollowVerdict, { label: string; color: BadgeColor }> = {
  followed: { label: "Followed", color: "success" },
  diverged: { label: "Went another way", color: "warning" },
  "not-invoked": { label: "Worked directly", color: "informative" },
  "nothing-suggested": { label: "Nothing suggested", color: "subtle" },
  "nothing-routed": { label: "Not routed", color: "subtle" },
};

export const OUTCOME: Record<TurnOutcome, { label: string; color: BadgeColor }> = {
  unknown: { label: "Outcome unknown", color: "subtle" },
  ok: { label: "OK", color: "success" },
  failed: { label: "A step failed", color: "danger" },
  refused: { label: "A switch refused a step", color: "warning" },
  open: { label: "Still open", color: "informative" },
};

export const KIND: Record<StepKind, string> = {
  skill: "Skill",
  agent: "Agent",
  orbit: "Orbit command",
  shell: "Command",
  tool: "Tool",
  opportunity: "Opportunity",
  decision: "Decision",
  gap: "Trail gap",
};

export const DAYS = [1, 7, 30] as const;
export type Days = (typeof DAYS)[number];

export const isDays = (value: unknown): value is Days => value === 1 || value === 7 || value === 30;

export function formatSpent(ms: number | null): string {
  if (ms === null) return "still open";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

// A step's place in its turn, counted from the prompt: "+4 s".
export const offsetFrom = (start: string, at: string) => `+${formatSpent(Math.max(0, Date.parse(at) - Date.parse(start)))}`;
