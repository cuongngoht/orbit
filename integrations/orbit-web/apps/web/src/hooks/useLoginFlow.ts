// One CLI sign-in as the page follows it: the API's snapshots over SSE while the card is on screen, or the status
// the page last read, whichever is newer.
import type { LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { subscribe } from "../services/sse";

export type LoginKind = "claude" | "github" | "azure";

export function newer(a: LoginSnapshot | null, b: LoginSnapshot | null): LoginSnapshot | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

export function useLoginFlow(kind: LoginKind, fromStatus: LoginSnapshot | null): LoginSnapshot | null {
  const [streamed, setStreamed] = useState<LoginSnapshot | null>(null);
  useEffect(() => {
    const sub = subscribe<LoginSnapshot>(`/api/${kind}/login/events`, setStreamed);
    return () => sub.close();
  }, [kind]);
  return newer(fromStatus, streamed);
}

export const flowActive = (s: LoginSnapshot | null): boolean => s !== null && (s.state === "starting" || s.state === "awaiting_user" || s.state === "verifying");
