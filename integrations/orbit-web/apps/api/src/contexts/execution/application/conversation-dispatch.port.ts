// THE CONVERSATION DISPATCH PORT (Execution → its caller, ADR 0062): what the worker hands a conversation run once the
// admission pass decided about it. Execution admits, leases, recovers and releases a conversation run; WHAT it runs (the
// CEO's answer in CEO Chat) is its caller's, bound here by whoever composes the module (the executive context).
export const CONVERSATION_DISPATCH = Symbol("CONVERSATION_DISPATCH");

export interface ConversationDispatch {
  // Admitted: its compute is reserved and its lease is this process's -- run it now (and renew the lease while it runs).
  admitted(orbitId: string, runId: string): void;
  // Still waiting (why), or refused for good: it can never start as things are configured.
  held(orbitId: string, runId: string, outcome: { kind: "wait" | "unschedulable"; reason: string }): Promise<void>;
  // Its process was lost (a restart, an expired lease): interrupted, its compute released, never run again.
  interrupted(orbitId: string, runId: string, reason: string): Promise<void>;
}
