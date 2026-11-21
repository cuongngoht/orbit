// One connector's CLI sign-in (GitHub, Azure DevOps) as the page follows it: the snapshot the status last said, or a
// newer one that arrived live on the app stream (`connector.flow`). Orbit's own sign-in is not one of these: it is a
// username and a password (pages/SignInPage.tsx), and an AI CLI is connected in Settings → AI Connections.
import type { ConnectorName, LoginSnapshot } from "@orbit-web/contracts";
import { useState } from "react";
import { useAppEvent } from "../services/events/AppEvents";

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
