// THIS BROWSER'S OPERATOR SESSION: whether governance is set up and who (if anybody) is signed in to it here -- read
// from the API (GET /api/operator/state), never assumed. The session itself is an HttpOnly cookie the page cannot read;
// what the page keeps is the session's CSRF token, which every change carries (services/api.ts). One store for the
// whole page, so the Governance console and a chat's Push agree on who is signed in.
import { useSyncExternalStore } from "react";
import type { GovernanceState } from "@orbit-web/contracts";
import type { Permission } from "@orbit-web/governance-core";
import { errorText, get } from "./api";

interface Snapshot {
  state: GovernanceState | null;
  error: string | null;
  loaded: boolean;
}

let snapshot: Snapshot = { state: null, error: null, loaded: false };
let csrf: string | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

const publish = (next: Snapshot): void => {
  snapshot = next;
  csrf = next.state?.session?.csrfToken ?? null;
  for (const l of listeners) l();
};

export const operatorCsrf = (): string | null => csrf;

// Reads the operator state again (after a sign-in, a sign-out, or a refusal that says the session ended).
export function refreshOperator(): Promise<void> {
  pending ??= get<GovernanceState>("/api/operator/state")
    .then((state) => publish({ state, error: null, loaded: true }))
    .catch((err: unknown) => publish({ state: snapshot.state, error: errorText(err), loaded: true }))
    .finally(() => (pending = null));
  return pending;
}

// A state the API just answered with (a sign-in, an enrolment): taken as it is.
export const acceptOperatorState = (state: GovernanceState): void => publish({ state, error: null, loaded: true });

export function useOperator(): Snapshot & { can: (p: Permission) => boolean; reload: () => Promise<void> } {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!snapshot.loaded && pending === null) void refreshOperator();
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
  const permissions = current.state?.session?.permissions ?? [];
  return { ...current, can: (p) => permissions.includes(p), reload: refreshOperator };
}

// For tests: forget everything.
export const resetOperatorStore = (): void => publish({ state: null, error: null, loaded: false });
