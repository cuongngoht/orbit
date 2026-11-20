// ONE RESEARCH SESSION'S STREAM, folded into what its chat shows: the conversation (each message whole, or the answer
// still being written), the run going on now (its frozen sources, how many passages it was given), and how the last run
// ended. Durable events are applied once, by their sequence number -- a replay after a reconnect changes nothing --;
// the text of an answer in progress grows by offset (applyDelta), so a piece sent twice is not doubled.
import { applyDelta, type AnyResearchEvent, type ResearchSessionStatus } from "@orbit-web/contracts";

export interface LiveMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  partial: boolean;
  runId: string | null;
}

export interface LiveRun {
  runId: string | null;
  sources: { sourceId: string; revisionId: string; title: string }[];
  passages: number;
  matched: number;
}

export interface ResearchState {
  lastSeq: number;
  messages: LiveMessage[];
  status: ResearchSessionStatus | null;
  run: LiveRun | null;
  // How the last run ended, when it did not complete.
  ended: { kind: "failed" | "interrupted"; message: string } | null;
  notice: string | null;
  // Moves each time citations were recorded: the session's citations are read again.
  citations: number;
}

export const INITIAL: ResearchState = { lastSeq: 0, messages: [], status: null, run: null, ended: null, notice: null, citations: 0 };

function upsert(messages: LiveMessage[], id: string, make: () => LiveMessage, change: (m: LiveMessage) => LiveMessage): LiveMessage[] {
  const at = messages.findIndex((m) => m.id === id);
  if (at === -1) return [...messages, change(make())];
  return messages.map((m, i) => (i === at ? change(m) : m));
}

const fresh = (id: string, role: "user" | "assistant", runId: string | null): LiveMessage => ({ id, role, text: "", streaming: role === "assistant", partial: false, runId });

function durable(state: ResearchState, e: AnyResearchEvent): ResearchState {
  switch (e.type) {
    case "research.status":
      return { ...state, status: e.data.status, ...(e.data.status === "running" ? { ended: null, notice: null } : {}) };
    case "research.run.started":
      return { ...state, run: { runId: e.runId, sources: e.data.sources, passages: e.data.passages, matched: e.data.matched } };
    case "research.message.started":
      return { ...state, messages: upsert(state.messages, e.data.messageId, () => fresh(e.data.messageId, e.data.role, e.runId), (m) => m) };
    case "research.message.completed":
      return { ...state, messages: upsert(state.messages, e.data.messageId, () => fresh(e.data.messageId, e.data.role, e.runId), (m) => ({ ...m, text: e.data.text, streaming: false, partial: e.data.partial })) };
    case "research.citation.recorded":
      return { ...state, citations: state.citations + 1 };
    case "research.run.completed":
      return { ...state, run: null, ended: null };
    case "research.run.failed":
      return { ...state, run: null, ended: { kind: "failed", message: e.data.message } };
    case "research.run.interrupted":
      return { ...state, run: null, ended: { kind: "interrupted", message: e.data.reason === "user_stop" ? "Stopped: the answer was cut off where it was." : "Orbit Web restarted while this answer was being written; it was cut off and is not resumed on its own." } };
    case "research.run.notice":
      return { ...state, notice: e.data.message };
    default:
      return state;
  }
}

export function researchReducer(state: ResearchState, e: AnyResearchEvent): ResearchState {
  if (e.type === "research.message.delta") {
    return { ...state, messages: upsert(state.messages, e.data.messageId, () => fresh(e.data.messageId, "assistant", e.runId), (m) => (m.streaming ? { ...m, text: applyDelta(m.text, e.data) } : m)) };
  }
  if (e.seq === null || e.seq <= state.lastSeq) return state;
  return { ...durable(state, e), lastSeq: e.seq };
}
