// One CLI sign-in as the page follows it: the API's snapshots over SSE while the card is on screen.
import type { LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { subscribe } from "../services/sse";

export type LoginKind = "claude" | "github";

export function useLoginFlow(kind: LoginKind, initial: LoginSnapshot | null): LoginSnapshot | null {
  const [snapshot, setSnapshot] = useState<LoginSnapshot | null>(initial);
  useEffect(() => {
    const sub = subscribe<LoginSnapshot>(`/api/${kind}/login/events`, setSnapshot);
    return () => sub.close();
  }, [kind]);
  useEffect(() => {
    if (initial && (!snapshot || initial.updatedAt > snapshot.updatedAt)) setSnapshot(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  return snapshot;
}

export const flowActive = (s: LoginSnapshot | null): boolean => s !== null && (s.state === "starting" || s.state === "awaiting_user" || s.state === "verifying");
