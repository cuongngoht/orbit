// What Execution reports to Work about a run (synchronous port, in the worker's transaction). Execution says what HAPPENED
// (the run started, a handoff was submitted, a question was asked, the run ended and how); Work decides what it MEANS
// for the assignment. Work registers its implementation, so Execution imports nothing of Work.
import type { EmployeeProfile, RunState } from "@orbit-web/contracts";
import type { Actor } from "../../shared/application/commands.js";

export interface StagedArtifact {
  name: string;
  kind: "deliverable" | "attachment";
  mediaType: string;
  size: number;
  sha256: string;
}

export interface SubmittedHandoff {
  runId: string;
  summary: string;
  artifacts: StagedArtifact[];
  claims: { text: string; sources: { label: string; sourceId: string; revisionId: string; locator: string; excerpt: string }[]; supported: boolean; web?: { url: string; readAt: string } | null }[];
  // Idempotency of a submission: the same key never makes a second handoff.
  submissionKey: string;
}

export interface RunEnd {
  state: RunState;
  // Why, in words (masked).
  detail: string | null;
  // The run ended because Orbit stopped it for this reason (a pause, a cancel, a lost lease, a dispatch refusal).
  stoppedFor: "pause" | "cancel" | "recover" | "timeout" | "refused" | null;
}

// A research source revision the mission was given (pinned: immutable), with the label the employee cites it by.
export interface PinnedSource {
  label: string;
  revisionId: string;
  sourceId: string;
  workspaceId: string;
  title: string;
  mediaType: string;
  contentHash: string;
  fileName: string | null;
}

// The assignment as an attempt sees it, and the employee it runs as -- re-checked at every dispatch.
export interface AttemptContext {
  // This attempt's fence is the current one and the assignment still holds its employee (not paused, not cancelling).
  current: boolean;
  missionId: string;
  missionTitle: string;
  brief: { goal: string; deliverables: { name: string; required: boolean }[]; acceptanceCriteria: string[]; revisions: { criteria: string }[]; answers: { question: string; answer: string }[] };
  deliverables: { name: string; required: boolean }[];
  // The research sources the mission was pinned to, in their labelled order (S1, S2 ...).
  sources: PinnedSource[];
  // Its team: whether this employee may give parts of the work to colleagues (and who they are), the parts it gave and
  // what each handed in, and the mission's team room (null: none).
  team: {
    canDelegate: boolean;
    colleagues: { id: string; name: string; title: string }[];
    units: { key: string; assignmentId: string; employeeId: string; employeeName: string; state: string; dependsOn: string[]; handoff: { revision: number; summary: string; artifacts: { name: string; sha256: string }[] } | null }[];
    room: { id: string; quotaMiB: number } | null;
  };
  employee: {
    id: string;
    name: string;
    // The profile revision the assignment pinned when it was claimed.
    profile: EmployeeProfile | null;
    // May it run now (employment, its Personal Sandbox, its connection): the dispatch check.
    eligible: boolean;
    reason: string | null;
    sandboxId: string | null;
  };
}

export interface RunOutcomes {
  // The assignment as the run sees it: may this attempt still act (its fence is the current one, the assignment holds)?
  current(orbitId: string, assignmentId: string, fence: number): Promise<AttemptContext | null>;
  started(actor: Actor, assignmentId: string, fence: number): Promise<void>;
  handoff(actor: Actor, assignmentId: string, fence: number, h: SubmittedHandoff): Promise<{ revision: number; digest: string; missing: string[] }>;
  question(actor: Actor, assignmentId: string, fence: number, question: string): Promise<void>;
  ended(actor: Actor, assignmentId: string, fence: number, end: RunEnd): Promise<void>;
  recovering(actor: Actor, assignmentId: string, fence: number, reason: string): Promise<void>;
  // A manager's plan: parts of its assignment given to colleagues (refused whole, with why).
  delegate(actor: Actor, assignmentId: string, fence: number, units: DelegatedUnit[]): Promise<{ parts: number }>;
  // A manager's decision on one part it reviews.
  reviewUnit(actor: Actor, assignmentId: string, fence: number, unitKey: string, decision: "accept" | "revise", criteria: string): Promise<string>;
  // The team room as an attempt left it.
  teamRoomChanged(orbitId: string, roomId: string, by: { runId: string; assignmentId: string; employeeId: string }, files: { path: string; sha256: string; size: number }[]): Promise<number>;
}

export interface DelegatedUnit {
  key: string;
  employeeId: string;
  title: string;
  goal: string;
  deliverables: { name: string; required: boolean }[];
  acceptanceCriteria: string[];
  dependsOn: string[];
}

export const RUN_OUTCOMES = Symbol("RUN_OUTCOMES");
