// One CLI sign-in as the page follows it: the snapshot the status last said, or a newer one that arrived live --
// GitHub's and Azure's on the app stream (`connector.flow`), Claude's on its own stream (it is the sign-in itself, open
// before anything else is).
import type { ConnectorName, LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { useAppEvent } from "../services/events/AppEvents";
import { subscribe } from "../services/sse";

export function newer(a: LoginSnapshot | null, b: LoginSnapshot | null): LoginSnapshot | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

export const flowActive = (s: LoginSnapshot | null): boolean => s !== null && (s.state === "starting" || s.state === "awaiting_user" || s.state === "verifying");

// A connector's flow (GitHub, Azure DevOps), from the app stream.
export function useConnectorFlow(connector: ConnectorName, fromStatus: LoginSnapshot | null): LoginSnapshot | null {
  const [streamed, setStreamed] = useState<LoginSnapshot | null>(null);
  useAppEvent("connector.flow", (e) => {
    if (e.data.connector === connector) setStreamed(e.data.flow);
  });
  return newer(fromStatus, streamed);
}

// The Claude sign-in's flow, from its own pre-sign-in stream.
export function useClaudeLoginFlow(fromStatus: LoginSnapshot | null): LoginSnapshot | null {
  const [streamed, setStreamed] = useState<LoginSnapshot | null>(null);
  useEffect(() => {
    const sub = subscribe<LoginSnapshot>("/api/claude/login/events", setStreamed);
    return () => sub.close();
  }, []);
  return newer(fromStatus, streamed);
}
