// SIGNING OUT of Orbit, two ways: this browser alone (its session ends; the others stay signed in), or every session of
// the user ("Sign out everywhere"). Neither touches an AI connection: a connected CLI stays connected, because signing in
// to Orbit and connecting a provider are two different things. Afterwards the page reads its sign-in again.
import { useCallback, useState } from "react";
import { rememberSession } from "../../services/account";
import { errorText, send } from "../../services/api";
import { notifyMobileSignedOut } from "../../services/mobileBridge";

export interface SignOut {
  // This browser only.
  signOut: () => Promise<void>;
  // Every session of this user, this one included.
  signOutEverywhere: () => Promise<void>;
  busy: boolean;
  error: string | null;
  clear: () => void;
}

export function useSignOut(onSignedOut: () => void): SignOut {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
      try {
        await send<void>("POST", path);
        rememberSession(null);
        notifyMobileSignedOut(path === "/api/auth/logout-all");
        onSignedOut();
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [onSignedOut],
  );
  const signOut = useCallback(() => run("/api/auth/logout"), [run]);
  const signOutEverywhere = useCallback(() => run("/api/auth/logout-all"), [run]);
  return { signOut, signOutEverywhere, busy, error, clear: useCallback(() => setError(null), []) };
}
