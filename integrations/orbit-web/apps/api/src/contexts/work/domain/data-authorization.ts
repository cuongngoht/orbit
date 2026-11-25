// WHAT ONE ATTEMPT MAY READ (Work, pure; ADR 0061 §9). Worked out from facts alone by ONE function, used when the
// attempt's inputs are staged, at every read of one of them, and again while it runs (a revoked share, a moved employee):
//
//   - the ROOT of a mission (the assignment a person gave) reads the mission's sources and -- when its employee may read
//     them -- the mission's repositories;
//   - a PART reads only what its lead SHARED with it on purpose: a source the lead itself may read (never more), the
//     ACCEPTED hand-in of a part it waits for directly (as its summary or in full), and the mission's repositories when
//     its lead shared them (each recipient's own Access grants are still checked at attempt start);
//   - a LEAD reads, by supervision, the latest hand-in (submitted or accepted) of each of its DIRECT parts -- never a part
//     of a part, which its own lead reviews;
//   - nothing else: a sibling's work it does not wait for, another department's room, a hand-in nobody shared.
//
// What is withheld is said (a share that names more than its lead may give, a hand-in not accepted yet), never an error:
// the attempt runs with what it may read.

export type ShareMode = "summary" | "full";
export const SHARE_MODES: readonly ShareMode[] = ["summary", "full"];

export interface SourceShareFact {
  id: string;
  kind: "source";
  revisionId: string;
}

export interface HandoffShareFact {
  id: string;
  kind: "handoff";
  originAssignmentId: string;
  mode: ShareMode;
}

export type ShareFact = SourceShareFact | HandoffShareFact;

export interface DataFacts {
  // The assignment's lead (null: it is its mission's root).
  leadId: string | null;
  // The source revisions the mission pins.
  missionSources: readonly string[];
  // The mission brings repositories and this employee may read them (a root only).
  repositories: boolean;
  // Whether this assignment's lead holds mission repository access (unused for a root).
  leadRepositories?: boolean;
  // Whether the lead explicitly shared mission repositories with this delegated part.
  shareRepositories?: boolean;
  // What the lead may read itself (its own grant's sources); unused for a root.
  leadSources: readonly string[];
  // The shares to this assignment that were not revoked.
  shares: readonly ShareFact[];
  // The parts this one waits for directly (its plan's waits), each with its accepted hand-in once there is one.
  waitsFor: readonly { assignmentId: string; unitKey: string; accepted: string | null }[];
  // Its own direct parts, each with its latest hand-in that is submitted or accepted.
  parts: readonly { assignmentId: string; unitKey: string; latest: string | null }[];
}

export interface GrantedSource {
  revisionId: string;
  origin: "mission" | "share";
  // The share that gave it (null: the mission's own).
  ref: string | null;
}

export interface GrantedHandoff {
  handoffId: string;
  assignmentId: string;
  unitKey: string;
  mode: ShareMode;
  origin: "share" | "supervision";
  ref: string | null;
}

export interface DataGrant {
  sources: GrantedSource[];
  handoffs: GrantedHandoff[];
  repositories: boolean;
  // Why a share gives nothing (yet), one line each.
  withheld: string[];
}

const supervised = (f: DataFacts): GrantedHandoff[] =>
  f.parts.flatMap((p) => (p.latest === null ? [] : [{ handoffId: p.latest, assignmentId: p.assignmentId, unitKey: p.unitKey, mode: "full" as const, origin: "supervision" as const, ref: null }]));

// One entry per hand-in: the widest mode any share (or supervision) gives it.
function mergeHandoffs(list: readonly GrantedHandoff[]): GrantedHandoff[] {
  const out = new Map<string, GrantedHandoff>();
  for (const h of list) {
    const had = out.get(h.handoffId);
    if (had === undefined || (had.mode === "summary" && h.mode === "full")) out.set(h.handoffId, had === undefined ? h : { ...had, mode: "full" });
  }
  return [...out.values()];
}

export function grantOf(f: DataFacts): DataGrant {
  if (f.leadId === null) {
    const sources = [...new Set(f.missionSources)].map((revisionId) => ({ revisionId, origin: "mission" as const, ref: null }));
    return { sources, handoffs: mergeHandoffs(supervised(f)), repositories: f.repositories, withheld: [] };
  }
  const lead = new Set(f.leadSources);
  const waits = new Map(f.waitsFor.map((w) => [w.assignmentId, w]));
  const sources = new Map<string, GrantedSource>();
  const shared: GrantedHandoff[] = [];
  const withheld: string[] = [];
  for (const s of f.shares) {
    if (s.kind === "source") {
      if (!lead.has(s.revisionId)) withheld.push(`A source shared with it (${s.revisionId}) is not one its lead may read: it is not given.`);
      else if (!sources.has(s.revisionId)) sources.set(s.revisionId, { revisionId: s.revisionId, origin: "share", ref: s.id });
      continue;
    }
    const w = waits.get(s.originAssignmentId);
    if (w === undefined) withheld.push("A hand-in shared with it is not of a part it waits for: it is not given.");
    else if (w.accepted === null) withheld.push(`The hand-in of "${w.unitKey}" is shared with it once its lead accepts it.`);
    else shared.push({ handoffId: w.accepted, assignmentId: w.assignmentId, unitKey: w.unitKey, mode: s.mode, origin: "share", ref: s.id });
  }
  let repositories = false;
  if (f.shareRepositories === true) {
    if (f.leadRepositories === true) repositories = true;
    else withheld.push("Mission repositories were requested for this part, but its lead does not hold repository access.");
  }
  return { sources: [...sources.values()], handoffs: mergeHandoffs([...supervised(f), ...shared]), repositories, withheld };
}

// What a lead may hand on of its sources: every one it reads ("all"), or the labels it named -- each of which it must
// read itself. The labels it named that it does not read are returned as problems (a plan naming them is refused).
export function sharedSourcesOf(asked: readonly string[], held: readonly { label: string; revisionId: string }[]): { revisionIds: string[]; problems: string[] } {
  const byLabel = new Map(held.map((h) => [h.label.toUpperCase(), h.revisionId]));
  if (asked.some((a) => a.trim().toLowerCase() === "all")) return { revisionIds: held.map((h) => h.revisionId), problems: [] };
  const revisionIds: string[] = [];
  const problems: string[] = [];
  for (const a of asked) {
    const id = byLabel.get(a.trim().toUpperCase());
    if (id === undefined) problems.push(`"${a}" is not a source you were given: you can share only what you read yourself.`);
    else if (!revisionIds.includes(id)) revisionIds.push(id);
  }
  return { revisionIds, problems };
}
