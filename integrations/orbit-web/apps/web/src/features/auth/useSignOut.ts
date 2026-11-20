// Signing out of the Claude account signs Orbit Web out: `claude auth logout`, then the sign-in page. The API refuses
// while Claude Code works in a chat (or a workspace is being prepared); that refusal is said, and nothing changes.
import type { ClaudeStatus } from "@orbit-web/contracts";
import { useCallback, useState } from "react";
import { errorText, send } from "../../services/api";

export interface SignOut {
  signOut: () => Promise<void>;
  busy: boolean;
  error: string | null;
  clear: () => void;
}

export function useSignOut(onSignedOut: (status: ClaudeStatus) => void): SignOut {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await send<ClaudeStatus>("POST", "/api/claude/logout");
      if (status.state === "connected") setError(status.detail ?? "The Claude CLI is still signed in.");
      onSignedOut(status);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [onSignedOut]);
  return { signOut, busy, error, clear: () => setError(null) };
}
