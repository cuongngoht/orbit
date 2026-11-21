// One research session's stream (`/api/research/sessions/:id/events`), folded by researchReducer. The browser's
// EventSource reconnects on its own and sends Last-Event-ID; the reducer drops what it already has.
import type { AnyResearchEvent } from "@orbit-web/contracts";
import { useEffect, useReducer, useState } from "react";
import { subscribe } from "../../services/sse";
import { INITIAL, researchReducer, type ResearchState } from "./researchReducer";

export function useResearchStream(sessionId: string): { state: ResearchState; connected: boolean } {
  const [state, dispatch] = useReducer(researchReducer, INITIAL);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const sub = subscribe<AnyResearchEvent>(`/api/research/sessions/${sessionId}/events`, dispatch, setConnected);
    return () => sub.close();
  }, [sessionId]);
  return { state, connected };
}
