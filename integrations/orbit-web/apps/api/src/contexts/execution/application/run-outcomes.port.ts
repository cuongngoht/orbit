// What Execution reports to Work about a run (synchronous port, in the worker's transaction). Execution says what HAPPENED
// (the run started, a handoff was submitted, a question was asked, the run ended and how); Work decides what it MEANS
// for the assignment. Work registers its implementation, so Execution imports nothing of Work.
import type { EmployeeProfile, RunState } from "@orbit-web/contracts";
import type { Actor } from "../../shared/application/commands.js";
import type { AttemptRepository } from "./repository-bundles.port.js";

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
  // When the attempt started running (null: it never did): what it could have been shown.
  startedAt?: string | null;
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

// A source this attempt may read: the mission's own (its root), or one its lead shared with it (the share's id).
export type GrantedSourceInput = PinnedSource & { origin: "mission" | "share"; ref: string | null };

// A hand-in this attempt may read: one of its direct parts' (supervision: every file), or the accepted hand-in of a part
// it waits for, shared by its lead -- its summary alone, or in full.
export interface GrantedHandoffInput {
  handoffId: string;
  assignmentId: string;
  unitKey: string;
  revision: number;
  digest: string;
  summary: string;
  mode: "summary" | "full";
  origin: "share" | "supervision";
  ref: string | null;
  artifacts: { name: string; sha256: string }[];
}

// WHAT THIS ATTEMPT MAY READ (ADR 0061 §9), worked out again at every look: what it stages, what each read of an input
// is held to, what the access watch checks while it runs.
export interface AttemptData {
  sources: GrantedSourceInput[];
  handoffs: GrantedHandoffInput[];
  // The mission's repositories come with it (its root only, when its employee may read them).
  repositories: boolean;
  // A share that gives nothing (yet), and why -- said to the employee.
  withheld: string[];
}

// The assignment as an attempt sees it, and the employee it runs as -- re-checked at every dispatch.
export interface AttemptContext {
  // This attempt's fence is the current one and the assignment still holds its employee (not paused, not cancelling).
  current: boolean;
  missionId: string;
  // Who gave the work (a person's label, or the lead whose plan made this part): what the run's records name as its
  // cause -- never the worker that dispatches it.
  createdBy: string;
  missionTitle: string;
  brief: { goal: string; deliverables: { name: string; required: boolean }[]; acceptanceCriteria: string[]; revisions: { criteria: string }[]; answers: { question: string; answer: string }[] };
  deliverables: { name: string; required: boolean }[];
  // The research sources THIS attempt may read, in the mission's labelled order (S1, S2 ...): the mission's own for its
  // root, what its lead shared for a part.
  sources: GrantedSourceInput[];
  // The hand-ins it may read, and the shares that give nothing yet.
  data: Pick<AttemptData, "handoffs" | "withheld">;
  // The repositories the mission brings in (the root assignment's attempts only).
  repositories: AttemptRepository[];
  // Its team: whether this employee may give parts of the work to colleagues (and who they are), the parts it gave and
  // what each handed in, and the mission's team room (null: none).
  team: {
    canDelegate: boolean;
    colleagues: { id: string; name: string; title: string }[];
    units: { key: string; assignmentId: string; employeeId: string; employeeName: string; state: string; dependsOn: string[]; handoff: { revision: number; digest: string; summary: string; artifacts: { name: string; sha256: string }[] } | null }[];
    // The room of its data domain (its department's, else the company's) when the mission has a team: null otherwise.
    room: TeamRoom | null;
  };
  employee: {
    id: string;
    name: string;
    // Its department NOW (the dispatch's): whose policy decides with the company's for this attempt.
    departmentId: string | null;
    // The profile revision the assignment pinned when it was claimed.
    profile: EmployeeProfile | null;
    // May it run now (employment, its Personal Sandbox, its connection): the dispatch check.
    eligible: boolean;
    reason: string | null;
    sandboxId: string | null;
  };
}

export interface TeamRoom {
  id: string;
  quotaMiB: number;
  // Whose room it is: one department's members on this mission, or the company's (employees of no department).
  domain: "department" | "company";
}

export interface RunOutcomes {
  // The assignment as the run sees it: may this attempt still act (its fence is the current one, the assignment holds)?
  current(orbitId: string, assignmentId: string, fence: number): Promise<AttemptContext | null>;
  // What the attempt may read now (null: the assignment is gone): the input reader and the access watch ask it again.
  data(orbitId: string, assignmentId: string): Promise<AttemptData | null>;
  // The team room of an attempt's data domain (its department at dispatch, else the company's), opened when the mission
  // has a team and that domain has no room yet; null when the mission has no team.
  roomFor(orbitId: string, assignmentId: string, departmentId: string | null): Promise<TeamRoom | null>;
  started(actor: Actor, assignmentId: string, fence: number): Promise<void>;
  // Whether this employee may publish a hand-in of this assignment now (artifact.publish, decided as the employee):
  // asked BEFORE its files are staged.
  mayPublish(actor: Actor, assignmentId: string, fence: number): Promise<void>;
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
  // What the lead shares with this part on purpose: source labels it reads itself ("all": every one), and the accepted
  // hand-in of a part it waits for -- its summary, or in full.
  shareSources: string[];
  receives: { from: string; as: "summary" | "full" }[];
}

export const RUN_OUTCOMES = Symbol("RUN_OUTCOMES");
