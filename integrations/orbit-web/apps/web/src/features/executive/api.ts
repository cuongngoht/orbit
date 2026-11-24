// CEO CHAT's routes (ADR 0062), as the page asks them. Every one but `state` is the company's: with no company the API
// answers 409 office_not_set_up, and the page never asks.
import type {
  ExecutiveConversationDetail,
  ExecutiveConversationList,
  ExecutiveMessage,
  ExecutiveMessagePage,
  ExecutiveMissionRequest,
  ExecutiveReportKind,
  ExecutiveSent,
  ExecutiveState,
  ExecutiveTurn,
  MissionAccepted,
} from "@orbit-web/contracts";
import { useState } from "react";
import { useResource, type Resource } from "../../hooks/useResource";
import { get, idempotent, send } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";

const id = (v: string): string => encodeURIComponent(v);
const at = (conversationId: string): string => `/api/executive/conversations/${id(conversationId)}`;

export const executive = {
  state: () => get<ExecutiveState>("/api/executive"),
  conversations: (cursor: string | null = null) => get<ExecutiveConversationList>(`/api/executive/conversations${cursor !== null ? `?cursor=${id(cursor)}` : ""}`),
  conversation: (conversationId: string) => get<ExecutiveConversationDetail>(at(conversationId)),
  older: (conversationId: string, before: number) => get<ExecutiveMessagePage>(`${at(conversationId)}/messages?before=${before}`),
  start: (text: string, key: string) => send<ExecutiveSent>("POST", "/api/executive/conversations", { text }, idempotent(key)),
  startWithReport: (kind: ExecutiveReportKind, key: string) => send<{ conversationId: string; message: ExecutiveMessage }>("POST", "/api/executive/conversations", { report: kind }, idempotent(key)),
  startWithMission: (body: Omit<ExecutiveMissionRequest, "proposalMessageId">, key: string) => send<{ conversationId: string; mission: MissionAccepted }>("POST", "/api/executive/conversations", body, idempotent(key)),
  send: (conversationId: string, text: string, key: string) => send<ExecutiveSent>("POST", `${at(conversationId)}/messages`, { text }, idempotent(key)),
  stop: (conversationId: string, turnId: string) => send<{ turn: ExecutiveTurn }>("POST", `${at(conversationId)}/turns/${id(turnId)}/stop`, {}),
  retry: (conversationId: string, turnId: string) => send<{ turn: ExecutiveTurn }>("POST", `${at(conversationId)}/turns/${id(turnId)}/retry`, {}),
  report: (conversationId: string, kind: ExecutiveReportKind) => send<{ message: ExecutiveMessage }>("POST", `${at(conversationId)}/reports`, { kind }),
  give: (conversationId: string, body: ExecutiveMissionRequest, key: string) => send<MissionAccepted>("POST", `${at(conversationId)}/missions`, body, idempotent(key)),
  dismiss: (conversationId: string, messageId: string) => send<{ message: ExecutiveMessage }>("POST", `${at(conversationId)}/proposals/${id(messageId)}/dismiss`, {}),
  eventsUrl: (conversationId: string, after: number) => `${at(conversationId)}/events?after=${after}`,
};

// What CEO Chat is for this account now: read again when the office changes (a company set up, an appointment, a hire),
// when a connection changes, and whenever the app stream reopens.
export function useExecutiveState(): Resource<ExecutiveState> {
  const { generation } = useAppStream();
  const [changed, setChanged] = useState(0);
  useAppEvent("office.changed", () => setChanged((n) => n + 1));
  useAppEvent("connections.changed", () => setChanged((n) => n + 1));
  return useResource<ExecutiveState>(() => executive.state(), [generation, changed]);
}
