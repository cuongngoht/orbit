// WHAT HOLDS WORK FROM A RETRY (ADR 0063): an incident of runtime security that requires a person's review before the
// assignment may run again. Bound by the composition (office.module.ts) to the security context's store; with none
// bound, nothing holds a retry.
export const SECURITY_HOLDS = Symbol("SECURITY_HOLDS");

export interface SecurityHolds {
  heldBy(orbitId: string, assignmentId: string): Promise<{ id: string; title: string } | null>;
}
