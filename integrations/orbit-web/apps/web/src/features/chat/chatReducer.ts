// The conversation as the page holds it, rebuilt from the session's events: durable ones are applied once each
// (by sequence number, so a replay after a reconnect changes nothing), transient deltas only add text a message does
// not hold yet. Pure: the same events always give the same timeline.
import {
  applyDelta,
  type AnyAppEvent,
  type OrbitPanel,
  type PermissionDeniedData,
  type RunNoticeData,
  type SessionCompletedData,
  type SessionFailedData,
  type SessionInterruptedData,
  type SessionStartedData,
  type SessionStatus,
  type VerificationUpdatedData,
  type AgentAttribution,
} from "@orbit-web/contracts";

export interface MessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  partial: boolean;
  parentToolUseId: string | null;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  name: string;
  title: string;
  input: string;
  output: string | null;
  state: "running" | "done" | "failed";
  interrupted: boolean;
  truncated: boolean;
  parentToolUseId: string | null;
  agent: AgentAttribution | null;
}

export interface RunStartItem {
  kind: "run-start";
  id: string;
  data: SessionStartedData;
}

export type RunEnd =
  | { type: "session.completed"; data: SessionCompletedData }
  | { type: "session.failed"; data: SessionFailedData }
  | { type: "session.interrupted"; data: SessionInterruptedData };

export interface RunEndItem {
  kind: "run-end";
  id: string;
  end: RunEnd;
}

export interface NoticeItem {
  kind: "notice";
  id: string;
  notice: RunNoticeData;
}

export interface DeniedItem {
  kind: "denied";
  id: string;
  denied: PermissionDeniedData;
}

export interface WorkspaceItem {
  kind: "workspace";
  id: string;
  step: string;
  state: "preparing" | "ready" | "failed";
  message: string | null;
  workBranch: string | null;
}

export type TimelineItem = MessageItem | ToolItem | RunStartItem | RunEndItem | NoticeItem | DeniedItem | WorkspaceItem;

export interface ChatState {
  lastSeq: number;
  items: TimelineItem[];
  status: SessionStatus | null;
  statusReason: string | null;
  orbit: OrbitPanel | null;
  verification: VerificationUpdatedData | null;
}

export const emptyChat = (): ChatState => ({ lastSeq: 0, items: [], status: null, statusReason: null, orbit: null, verification: null });

const replace = <T extends TimelineItem>(items: TimelineItem[], index: number, item: T): TimelineItem[] => [...items.slice(0, index), item, ...items.slice(index + 1)];

const findIndex = (items: TimelineItem[], kind: TimelineItem["kind"], id: string): number => items.findIndex((i) => i.kind === kind && i.id === id);

function upsertMessage(state: ChatState, id: string, update: (m: MessageItem) => MessageItem, base: Omit<MessageItem, "kind" | "id">): ChatState {
  const index = findIndex(state.items, "message", id);
  if (index === -1) return { ...state, items: [...state.items, update({ kind: "message", id, ...base })] };
  return { ...state, items: replace(state.items, index, update(state.items[index] as MessageItem)) };
}

function updateTool(state: ChatState, id: string, update: (t: ToolItem) => ToolItem): ChatState {
  const index = findIndex(state.items, "tool", id);
  return index === -1 ? state : { ...state, items: replace(state.items, index, update(state.items[index] as ToolItem)) };
}

function workspace(state: ChatState, patch: Omit<WorkspaceItem, "kind" | "id">): ChatState {
  const index = findIndex(state.items, "workspace", "workspace");
  const item: WorkspaceItem = { kind: "workspace", id: "workspace", ...patch };
  return index === -1 ? { ...state, items: [...state.items, item] } : { ...state, items: replace(state.items, index, item) };
}

// Messages still streaming when a run ends stop streaming (their completion, partial or not, arrives as an event).
const settleStreaming = (items: TimelineItem[]): TimelineItem[] => items.map((i) => (i.kind === "message" && i.streaming ? { ...i, streaming: false } : i));

function applyDurable(state: ChatState, e: AnyAppEvent): ChatState {
  switch (e.type) {
    case "workspace.preparing":
      return workspace(state, { step: e.data.step, state: "preparing", message: null, workBranch: null });
    case "workspace.ready":
      return workspace(state, { step: "ready", state: "ready", message: null, workBranch: e.data.workBranch });
    case "workspace.failed":
      return workspace(state, { step: e.data.step, state: "failed", message: e.data.message, workBranch: null });
    case "session.status":
      return { ...state, status: e.data.status, statusReason: e.data.reason };
    case "session.started":
      return { ...state, items: [...state.items, { kind: "run-start", id: `start-${e.seq}`, data: e.data }] };
    case "message.started":
      return upsertMessage(state, e.data.messageId, (m) => m, { role: e.data.role, text: "", streaming: true, partial: false, parentToolUseId: e.data.parentToolUseId });
    case "message.completed":
      return upsertMessage(state, e.data.messageId, (m) => ({ ...m, text: e.data.text, streaming: false, partial: e.data.partial }), { role: e.data.role, text: "", streaming: false, partial: false, parentToolUseId: e.data.parentToolUseId });
    case "tool.started":
      return findIndex(state.items, "tool", e.data.toolUseId) !== -1
        ? state
        : { ...state, items: [...state.items, { kind: "tool", id: e.data.toolUseId, name: e.data.name, title: e.data.title, input: e.data.input, output: null, state: "running", interrupted: false, truncated: false, parentToolUseId: e.data.parentToolUseId, agent: e.data.agent }] };
    case "tool.completed":
    case "tool.failed":
      return updateTool(state, e.data.toolUseId, (t) => ({ ...t, output: e.data.output, truncated: e.data.truncated, interrupted: e.data.interrupted, state: e.type === "tool.failed" ? "failed" : "done" }));
    case "permission.denied":
      return { ...state, items: [...state.items, { kind: "denied", id: `denied-${e.seq}`, denied: e.data }] };
    case "run.notice":
      return { ...state, items: [...state.items, { kind: "notice", id: `notice-${e.seq}`, notice: e.data }] };
    case "orbit.updated":
      return { ...state, orbit: e.data.panel };
    case "verification.updated":
      return { ...state, verification: e.data };
    case "session.completed":
    case "session.failed":
    case "session.interrupted":
      return { ...state, items: [...settleStreaming(state.items), { kind: "run-end", id: `end-${e.seq}`, end: { type: e.type, data: e.data } as RunEnd }] };
    default:
      return state;
  }
}

export function chatReducer(state: ChatState, e: AnyAppEvent): ChatState {
  if (e.type === "message.delta") {
    return upsertMessage(state, e.data.messageId, (m) => ({ ...m, text: applyDelta(m.text, e.data), streaming: true }), { role: "assistant", text: "", streaming: true, partial: false, parentToolUseId: null });
  }
  if (e.seq === null || e.seq <= state.lastSeq) return state;
  return { ...applyDurable(state, e), lastSeq: e.seq };
}

export const isRunning = (s: ChatState): boolean => s.status === "running";

// The items a reader sees at the top level; a subagent's messages and tools sit under the Agent call that ran them.
export function childrenOf(items: TimelineItem[], parent: string | null): TimelineItem[] {
  return items.filter((i) => (i.kind === "message" || i.kind === "tool" ? i.parentToolUseId === parent : parent === null));
}
