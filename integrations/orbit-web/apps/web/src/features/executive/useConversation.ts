// One CEO Chat conversation, live: read once (its last page and its stream's head), then its stream followed after that
// head (the browser reconnects on its own with Last-Event-ID; the reducer drops what it already has). Older pages come
// on demand.
import type { AnyExecutiveEvent } from "@orbit-web/contracts";
import { useCallback, useEffect, useReducer, useState } from "react";
import { errorText } from "../../services/api";
import { subscribe } from "../../services/sse";
import { executive } from "./api";
import { EMPTY, executiveReducer, type ExecutiveView } from "./executiveReducer";

export interface Conversation {
  view: ExecutiveView;
  loading: boolean;
  error: string | null;
  connected: boolean;
  loadOlder: () => Promise<void>;
  reload: () => void;
}

export function useConversation(conversationId: string | null): Conversation {
  const [view, dispatch] = useReducer(executiveReducer, EMPTY);
  const [loading, setLoading] = useState(conversationId !== null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (conversationId === null) return undefined;
    let live = true;
    let sub: { close(): void } | null = null;
    setLoading(true);
    setError(null);
    executive
      .conversation(conversationId)
      .then((detail) => {
        if (!live) return;
        dispatch({ type: "loaded", detail });
        setLoading(false);
        sub = subscribe<AnyExecutiveEvent>(executive.eventsUrl(conversationId, detail.lastSeq), (event) => dispatch({ type: "event", event }), setConnected);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(errorText(err));
        setLoading(false);
      });
    return () => {
      live = false;
      sub?.close();
    };
  }, [conversationId, round]);

  const first = view.messages[0]?.position ?? null;
  const loadOlder = useCallback(async () => {
    if (conversationId === null || first === null) return;
    const page = await executive.older(conversationId, first);
    dispatch({ type: "older", messages: page.messages, hasOlder: page.hasOlder });
  }, [conversationId, first]);

  return { view, loading, error, connected, loadOlder, reload: () => setRound((n) => n + 1) };
}
