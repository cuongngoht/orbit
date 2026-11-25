// A session's events as the page follows them: everything stored so far, then live. The reducer applies each durable
// event once, so the browser's own reconnect (which resends Last-Event-ID) never doubles anything.
import type { AnySessionEvent } from "@orbit-web/contracts";
import { useEffect, useReducer, useState } from "react";
import { chatReducer, emptyChat, type ChatState } from "../features/chat/chatReducer";
import { subscribe } from "../services/sse";

export function useSessionStream(sessionId: string): { state: ChatState; connected: boolean } {
  const [state, dispatch] = useReducer(chatReducer, undefined, emptyChat);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const sub = subscribe<AnySessionEvent>(`/api/sessions/${encodeURIComponent(sessionId)}/events`, dispatch, setConnected);
    return () => sub.close();
  }, [sessionId]);
  return { state, connected };
}
