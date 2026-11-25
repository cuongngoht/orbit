// ONE CEO CHAT CONVERSATION, folded: the page reads it once (its last page and its stream's head), then follows its
// stream after that head. Durable events apply once, by their sequence number (a replay after a reconnect changes
// nothing); the answer being written grows by offset (applyDelta), so a piece sent twice is not doubled.
import { applyDelta, type AnyExecutiveEvent, type ExecutiveConversationDetail, type ExecutiveMessage, type ExecutiveMissionLink, type ExecutiveTurn } from "@orbit-web/contracts";

export interface LiveAnswer {
  messageId: string;
  turnId: string | null;
  authorName: string;
  text: string;
}

export interface ExecutiveView {
  lastSeq: number;
  messages: ExecutiveMessage[];
  hasOlder: boolean;
  turns: ExecutiveTurn[];
  links: ExecutiveMissionLink[];
  live: LiveAnswer | null;
}

export type ExecutiveAction = { type: "loaded"; detail: ExecutiveConversationDetail } | { type: "older"; messages: ExecutiveMessage[]; hasOlder: boolean } | { type: "event"; event: AnyExecutiveEvent };

export const EMPTY: ExecutiveView = { lastSeq: 0, messages: [], hasOlder: false, turns: [], links: [], live: null };

const byPosition = (a: ExecutiveMessage, b: ExecutiveMessage): number => a.position - b.position;

function upsertMessage(list: readonly ExecutiveMessage[], m: ExecutiveMessage): ExecutiveMessage[] {
  const at = list.findIndex((x) => x.id === m.id);
  return (at === -1 ? [...list, m] : list.map((x, i) => (i === at ? m : x))).sort(byPosition);
}

function upsertTurn(list: readonly ExecutiveTurn[], t: ExecutiveTurn): ExecutiveTurn[] {
  const at = list.findIndex((x) => x.id === t.id);
  return at === -1 ? [...list, t] : list.map((x, i) => (i === at ? t : x));
}

function durable(s: ExecutiveView, e: AnyExecutiveEvent): ExecutiveView {
  switch (e.type) {
    case "executive.message.created":
    case "executive.message.changed":
      return { ...s, messages: upsertMessage(s.messages, e.data.message) };
    case "executive.turn.waiting":
      return { ...s, turns: upsertTurn(s.turns, e.data.turn) };
    case "executive.response.started":
      return { ...s, turns: upsertTurn(s.turns, e.data.turn), live: { messageId: e.data.messageId, turnId: e.data.turn.id, authorName: e.data.authorName, text: "" } };
    case "executive.response.completed":
      return { ...s, turns: upsertTurn(s.turns, e.data.turn), messages: upsertMessage(s.messages, e.data.message), live: null };
    case "executive.response.failed":
      return { ...s, turns: upsertTurn(s.turns, e.data.turn), live: s.live?.turnId === e.data.turn.id ? null : s.live };
    case "executive.mission.linked":
      return { ...s, links: s.links.some((l) => l.missionId === e.data.link.missionId) ? s.links : [...s.links, e.data.link], messages: e.data.message === null ? s.messages : upsertMessage(s.messages, e.data.message) };
    default:
      return s;
  }
}

export function executiveReducer(s: ExecutiveView, a: ExecutiveAction): ExecutiveView {
  if (a.type === "loaded") return { lastSeq: a.detail.lastSeq, messages: [...a.detail.messages].sort(byPosition), hasOlder: a.detail.hasOlder, turns: a.detail.turns, links: a.detail.links, live: null };
  if (a.type === "older") return { ...s, messages: [...a.messages.filter((m) => !s.messages.some((x) => x.id === m.id)), ...s.messages].sort(byPosition), hasOlder: a.hasOlder };
  const e = a.event;
  if (e.type === "executive.response.delta") {
    // A piece of the answer of a turn whose start this page has not seen (it connected mid-answer) starts it.
    const live = s.live !== null && s.live.messageId === e.data.messageId ? s.live : s.live === null ? { messageId: e.data.messageId, turnId: e.runId, authorName: s.turns.find((t) => t.id === e.runId)?.authorName ?? "", text: "" } : s.live;
    return live.messageId === e.data.messageId ? { ...s, live: { ...live, text: applyDelta(live.text, e.data) } } : s;
  }
  if (e.seq === null || e.seq <= s.lastSeq) return s;
  return { ...durable(s, e), lastSeq: e.seq };
}

// The turns not ended, and the newest one.
export const openTurns = (s: ExecutiveView): ExecutiveTurn[] => s.turns.filter((t) => t.state === "queued" || t.state === "waiting" || t.state === "running");
