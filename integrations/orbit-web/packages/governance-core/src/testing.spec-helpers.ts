// Shared by the specs only: a real SHA-256 and the smallest valid records.
import { createHash } from "node:crypto";
import { AUDIT_SCHEMA_VERSION, seal, type AuditBody, type AuditEvent, type AuditEventType, type AuditPrincipalType } from "./audit.js";
import type { GovernanceRequest } from "./evaluate.js";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export const ACCOUNT = "acc-1";

export const ask = (over: Partial<GovernanceRequest> = {}): GovernanceRequest => ({
  principalId: "claude-code",
  principalType: "agent",
  accountId: ACCOUNT,
  workspaceId: "ws-1",
  researchWorkspaceId: null,
  action: "repository.write",
  resource: "ws-1",
  environment: "local",
  ...over,
});

export interface Sketch {
  type: AuditEventType;
  outcome?: string;
  principalType?: AuditPrincipalType;
  principalId?: string;
  agentId?: string | null;
  workspaceId?: string | null;
  data?: Record<string, unknown>;
  reasonCodes?: string[];
  at?: string;
}

const bodyOf = (s: Sketch, n: number): AuditBody => ({
  schemaVersion: AUDIT_SCHEMA_VERSION,
  eventId: `evt-${n}`,
  eventType: s.type,
  occurredAt: s.at ?? `2026-11-20T10:00:${String(n).padStart(2, "0")}.000Z`,
  recordedAt: s.at ?? `2026-11-20T10:00:${String(n).padStart(2, "0")}.000Z`,
  accountId: ACCOUNT,
  principalId: s.principalId ?? "agt-1",
  principalType: s.principalType ?? "agent",
  agentId: s.agentId === undefined ? "agt-1" : s.agentId,
  workspaceId: s.workspaceId === undefined ? "ws-1" : s.workspaceId,
  runId: null,
  correlationId: `cor-${n}`,
  causationId: null,
  policyRevision: "rev-1",
  decisionId: null,
  outcome: s.outcome ?? "recorded",
  reasonCodes: s.reasonCodes ?? [],
  evidenceRefs: [],
  data: (s.data ?? {}) as AuditBody["data"],
});

// A sealed chain of the sketched events, numbered from 1.
export function chainOf(sketches: readonly Sketch[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const [i, s] of sketches.entries()) events.push(seal(bodyOf(s, i + 1), i + 1, events[i - 1]?.hash ?? null, sha256));
  return events;
}
