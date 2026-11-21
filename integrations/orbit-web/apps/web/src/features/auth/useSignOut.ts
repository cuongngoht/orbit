// SIGNING OUT, two ways: this browser alone (its session ends; the account and its other browsers stay signed in), or
// the whole account (every browser of it, and the runtime's Claude CLI: `claude auth logout`). The API refuses the second
// while Claude Code works for the account (or a workspace is being prepared); that refusal is said, and nothing changes.
import type { ClaudeStatus } from "@orbit-web/contracts";
import { useCallback, useState } from "react";
import { errorText, send } from "../../services/api";

export interface SignOut {
  // This browser only.
  signOut: () => Promise<void>;
  // The account: every browser, and the Claude CLI.
  signOutAccount: () => Promise<void>;
  busy: boolean;
  error: string | null;
  clear: () => void;
}

export function useSignOut(onSignedOut: (status: ClaudeStatus) => void): SignOut {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (method: "DELETE" | "POST", path: string) => {
      setBusy(true);
      setError(null);
      try {
        const status = await send<ClaudeStatus>(method, path);
        if (status.detail !== null && status.runtime === "connected" && method === "POST") setError(status.detail);
        onSignedOut(status);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [onSignedOut],
  );
  const signOut = useCallback(() => run("DELETE", "/api/claude/session"), [run]);
  const signOutAccount = useCallback(() => run("POST", "/api/claude/logout"), [run]);
  return { signOut, signOutAccount, busy, error, clear: () => setError(null) };
}
