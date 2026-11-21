// Research as the API answers it, for the web app's tests.
import type { ResearchCitation, ResearchSessionDetail, ResearchSessionSummary, ResearchSourceContent, ResearchSourceSummary, ResearchWorkspaceDetail, ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { act } from "@testing-library/react";
import { FakeEventSource } from "./fakeEventSource";

export const WORKSPACE_ID = "aaaaaaaa-1111-4222-8333-444444444444";
export const RESEARCH_ID = "bbbbbbbb-1111-4222-8333-444444444444";
export const SOURCE_A = "cccccccc-1111-4222-8333-444444444444";
export const SOURCE_B = "dddddddd-1111-4222-8333-444444444444";
export const REVISION_A = "eeeeeeee-1111-4222-8333-444444444444";
export const REVISION_B = "ffffffff-1111-4222-8333-444444444444";
const AT = "2026-11-20T00:00:00.000Z";

export function workspace(over: Partial<ResearchWorkspaceDetail> = {}): ResearchWorkspaceDetail {
  return { id: WORKSPACE_ID, name: "AI Governance Research", description: "", access: "owner", owner: "octo@example.com", sourceCount: 2, sessionCount: 1, noteCount: 0, findingCount: 0, storage: "On the Orbit server.", createdAt: AT, updatedAt: AT, ...over };
}

export const workspaceSummary = (over: Partial<ResearchWorkspaceSummary> = {}): ResearchWorkspaceSummary => {
  const { noteCount: _n, findingCount: _f, storage: _s, ...rest } = workspace();
  return { ...rest, ...over };
};

export function source(over: Partial<ResearchSourceSummary> = {}): ResearchSourceSummary {
  return {
    id: SOURCE_A,
    workspaceId: WORKSPACE_ID,
    kind: "upload",
    title: "NIST policy",
    origin: "NIST policy.pdf",
    mediaType: "pdf",
    state: "ready",
    stateReason: null,
    revision: { id: REVISION_A, number: 1, contentHash: "a".repeat(64), pages: 2, chars: 120, chunks: 2, fetchedAt: null, indexedAt: AT },
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

export function citation(over: Partial<ResearchCitation> = {}): ResearchCitation {
  return {
    id: "c1111111-1111-4222-8333-444444444444",
    label: "S1",
    messageId: "m-answer",
    runId: "r1",
    sessionId: RESEARCH_ID,
    sourceId: SOURCE_A,
    revisionId: REVISION_A,
    revisionNumber: 1,
    sourceTitle: "NIST policy",
    sourceAvailable: true,
    revisionCurrent: true,
    chunkOrdinal: 1,
    page: 2,
    section: null,
    charStart: 40,
    charEnd: 90,
    quote: "Network egress is denied by default.",
    match: "fts",
    rank: 1,
    score: -1.2,
    createdAt: AT,
    ...over,
  };
}

export function researchSummary(over: Partial<ResearchSessionSummary> = {}): ResearchSessionSummary {
  return { kind: "research", id: RESEARCH_ID, workspaceId: WORKSPACE_ID, workspaceName: "AI Governance Research", title: "Egress research", model: "sonnet", effort: "medium", status: "completed", statusReason: null, access: "owner", owner: "octo@example.com", selectedSources: 1, createdAt: AT, updatedAt: AT, ...over };
}

export function researchDetail(over: Partial<ResearchSessionDetail> = {}): ResearchSessionDetail {
  return {
    ...researchSummary(),
    lastSeq: 0,
    selection: [SOURCE_A],
    draftQuestion: null,
    messages: [
      { id: "m-question", role: "user", text: "What about egress?", runId: "r1", partial: false, createdAt: AT, citations: [] },
      { id: "m-answer", role: "assistant", text: "Egress is denied by default [S1].", runId: "r1", partial: false, createdAt: AT, citations: [citation()] },
    ],
    lastRun: null,
    ...over,
  };
}

export function content(over: Partial<ResearchSourceContent> = {}): ResearchSourceContent {
  return {
    sourceId: SOURCE_A,
    revisionId: REVISION_A,
    revisionNumber: 1,
    current: true,
    title: "NIST policy",
    mediaType: "pdf",
    totalChunks: 2,
    chunks: [
      { ordinal: 0, page: 1, section: null, charStart: 0, charEnd: 38, text: "Agents run in isolated containers." },
      { ordinal: 1, page: 2, section: null, charStart: 40, charEnd: 90, text: "Network egress is denied by default." },
    ],
    ...over,
  };
}

let next = 0;

// Events on one research session's stream, numbered as its journal numbers them (a delta has no number).
export function researchStream(sessionId: string): (type: string, data: unknown, durable?: boolean) => void {
  let seq = 0;
  return (type, data, durable = true) =>
    act(() => FakeEventSource.last(`/api/research/sessions/${sessionId}/events`).emit({ id: `rv-${++next}`, type, stream: "research", sessionId, seq: durable ? ++seq : null, runId: "r2", at: AT, data }));
}
