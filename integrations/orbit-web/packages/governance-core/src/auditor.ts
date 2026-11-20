// THE DETERMINISTIC AUDITOR: findings worked out from audit records by rules, never by a model. The same records
// always give the same findings, and every finding names the records it stands on -- a finding with no evidence id
// does not exist.
//
// A status says how much the records show:
//   CONFIRMED     the records themselves are the event (a refusal that was recorded IS the attempt).
//   SUSPECTED     the records fit the finding and something else as well.
//   INCONCLUSIVE  a record that would settle it is not among those read.
// A finding is about what was ATTEMPTED and recorded. Whether the attempt was prevented is said by the decision's
// enforcement point, not by the finding.
import type { AuditEvent, ChainCheck } from "./audit.js";

export const FINDING_KINDS = [
  "POLICY_DENIED_ACTION",
  "REPEATED_DENIED_ACCESS",
  "UNAUTHORIZED_POLICY_CHANGE",
  "AGENT_PRIVILEGE_ESCALATION",
  "APPROVAL_REPLAY",
  "CROSS_WORKSPACE_ACCESS",
  "CREDENTIAL_ACCESS_ATTEMPT",
  "AUDIT_INTEGRITY_FAILURE",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_STATUSES = ["CONFIRMED", "SUSPECTED", "INCONCLUSIVE"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  // Stable: the kind and the first record it stands on, so reading the same records again adds nothing.
  id: string;
  kind: FindingKind;
  status: FindingStatus;
  severity: Severity;
  title: string;
  summary: string;
  evidenceIds: string[];
  agentId: string | null;
  workspaceId: string | null;
  firstSeen: string;
  lastSeen: string;
  count: number;
}

export interface AuditorInput {
  events: readonly AuditEvent[];
  chain: ChainCheck;
  // Whether `events` starts at the first record ever written: an absence only means something when it does.
  complete: boolean;
}

export const REPEAT_THRESHOLD = 3;

const ESCALATION_ACTIONS = ["governance.policy.modify", "governance.role.grant", "governance.approval.decide", "governance.audit.modify", "settings.privileged.write"];

function finding(kind: FindingKind, status: FindingStatus, severity: Severity, events: readonly AuditEvent[], title: string, summary: string): Finding {
  const first = events[0] as AuditEvent;
  const last = events[events.length - 1] as AuditEvent;
  return { id: `${kind}:${first.eventId}`, kind, status, severity, title, summary, evidenceIds: events.map((e) => e.eventId), agentId: first.agentId, workspaceId: first.workspaceId, firstSeen: first.occurredAt, lastSeen: last.occurredAt, count: events.length };
}

function grouped(events: readonly AuditEvent[], key: (e: AuditEvent) => string): AuditEvent[][] {
  const groups = new Map<string, AuditEvent[]>();
  for (const e of events) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  return [...groups.values()];
}

const isDeniedDecision = (e: AuditEvent): boolean => e.eventType === "policy.decision" && e.outcome === "deny";
const byAgent = (e: AuditEvent): boolean => e.principalType === "agent";
const who = (e: AuditEvent): string => (e.agentId !== null ? `agent ${e.agentId}` : `${e.principalType} ${e.principalId}`);
const targetOf = (e: AuditEvent): string => `${String(e.data.action)} on ${String(e.data.resource)}`;
const sameAsk = (e: AuditEvent): string => [e.principalId, e.workspaceId, e.data.action, e.data.resource].join("\u0001");

function deniedActions(events: readonly AuditEvent[]): Finding[] {
  const denied = events.filter((e) => isDeniedDecision(e) && byAgent(e));
  return grouped(denied, sameAsk).map((g) => finding("POLICY_DENIED_ACTION", "CONFIRMED", "low", g, "An agent asked for an action the policy denies", `${who(g[0] as AuditEvent)} asked for ${targetOf(g[0] as AuditEvent)} and was denied ${g.length} time(s).`));
}

function repeatedDenials(events: readonly AuditEvent[]): Finding[] {
  const denied = events.filter((e) => isDeniedDecision(e) && byAgent(e));
  return grouped(denied, sameAsk)
    .filter((g) => g.length >= REPEAT_THRESHOLD)
    .map((g) => finding("REPEATED_DENIED_ACCESS", "CONFIRMED", "medium", g, "An agent kept asking for a denied action", `${who(g[0] as AuditEvent)} asked for ${targetOf(g[0] as AuditEvent)} ${g.length} times after being denied.`));
}

const isPolicyRefusal = (e: AuditEvent): boolean =>
  (e.eventType === "authz.denied" && String(e.data.permission ?? "").startsWith("constitution.")) || (isDeniedDecision(e) && e.data.action === "governance.policy.modify");

function unapprovedPublications(input: AuditorInput): Finding[] {
  const approved = new Set(input.events.filter((e) => e.eventType === "constitution.approved").map((e) => `${String(e.data.revisionId)}\u0001${String(e.data.digest)}`));
  return input.events
    .filter((e) => e.eventType === "constitution.published" && !approved.has(`${String(e.data.revisionId)}\u0001${String(e.data.digest)}`))
    .map((e) => {
      const status: FindingStatus = input.complete ? "SUSPECTED" : "INCONCLUSIVE";
      const tail = input.complete ? "No approval of that content is recorded." : "The records read do not reach back to where its approval would be.";
      return finding("UNAUTHORIZED_POLICY_CHANGE", status, "critical", [e], "A revision is in effect with no recorded approval of its content", `Revision ${String(e.data.revisionId)} was published. ${tail}`);
    });
}

function policyChanges(input: AuditorInput): Finding[] {
  const refused = grouped(input.events.filter(isPolicyRefusal), (e) => `${e.principalType}\u0001${e.principalId}`).map((g) =>
    finding("UNAUTHORIZED_POLICY_CHANGE", "CONFIRMED", "high", g, "A change of the Constitution was attempted without the authority", `${who(g[0] as AuditEvent)} tried ${g.length} time(s) and was refused.`),
  );
  return [...refused, ...unapprovedPublications(input)];
}

const isEscalation = (e: AuditEvent): boolean =>
  (e.eventType === "boundary.violation" && e.data.kind === "agent_outside_gateway") ||
  (e.eventType === "settings.privileged.refused" && byAgent(e)) ||
  (isDeniedDecision(e) && byAgent(e) && ESCALATION_ACTIONS.includes(String(e.data.action)));

// A refused privileged change from a caller nobody verified fits an agent reaching for authority, and a person who
// has not signed in as an operator: suspected, never confirmed.
const isUnverifiedReach = (e: AuditEvent): boolean => e.eventType === "settings.privileged.refused" && e.principalType === "anonymous";

function escalations(events: readonly AuditEvent[]): Finding[] {
  const confirmed = grouped(events.filter(isEscalation), (e) => `${e.principalId}\u0001${e.workspaceId}`).map((g) =>
    finding("AGENT_PRIVILEGE_ESCALATION", "CONFIRMED", "critical", g, "An agent reached for authority it does not have", `${who(g[0] as AuditEvent)} made ${g.length} attempt(s) at an administrative or privileged operation; each was refused.`),
  );
  const suspected = grouped(events.filter(isUnverifiedReach), (e) => String(e.data.setting)).map((g) =>
    finding("AGENT_PRIVILEGE_ESCALATION", "SUSPECTED", "high", g, "Somebody unverified tried to turn on a privileged setting", `${g.length} refused attempt(s) on ${String((g[0] as AuditEvent).data.setting)} came from a caller with no operator session: an agent, or a person who had not signed in.`),
  );
  return [...confirmed, ...suspected];
}

const REPLAY_CAUSES = ["APPROVAL_CONSUMED", "FINGERPRINT_MISMATCH"];

function approvalReplays(events: readonly AuditEvent[]): Finding[] {
  const replays = events.filter((e) => e.eventType === "approval.consume.refused" && REPLAY_CAUSES.includes(String(e.data.cause)));
  return grouped(replays, (e) => String(e.data.approvalId)).map((g) =>
    finding("APPROVAL_REPLAY", "CONFIRMED", "high", g, "An approval was presented again, or for another action", `Approval ${String((g[0] as AuditEvent).data.approvalId)} was refused ${g.length} time(s) (${[...new Set(g.map((e) => String(e.data.cause)))].join(", ")}).`),
  );
}

function crossWorkspace(events: readonly AuditEvent[]): Finding[] {
  const reaches = events.filter((e) => e.eventType === "boundary.violation" && e.data.kind === "cross_workspace");
  return grouped(reaches, (e) => `${e.principalId}\u0001${String(e.data.target)}`).map((g) =>
    finding("CROSS_WORKSPACE_ACCESS", "CONFIRMED", "high", g, "An agent reached for another workspace", `${who(g[0] as AuditEvent)} used its run's authority on workspace ${String((g[0] as AuditEvent).data.target)}, which is not its own; refused ${g.length} time(s).`),
  );
}

const isCredentialReach = (e: AuditEvent): boolean => (e.eventType === "policy.decision" && e.data.action === "credential.read_raw") || (e.eventType === "boundary.violation" && e.data.kind === "credential");

function credentialAttempts(events: readonly AuditEvent[]): Finding[] {
  return grouped(events.filter(isCredentialReach), (e) => `${e.principalId}\u0001${e.workspaceId}`).map((g) =>
    finding("CREDENTIAL_ACCESS_ATTEMPT", "CONFIRMED", "critical", g, "A stored credential was reached for", `${who(g[0] as AuditEvent)} asked for a raw credential ${g.length} time(s).`),
  );
}

function integrity(input: AuditorInput): Finding[] {
  if (input.chain.ok) return [];
  const { brokenAt, eventId, problem } = input.chain;
  const at = input.events.find((e) => e.eventId === eventId);
  const when = at?.recordedAt ?? "";
  return [{ id: `AUDIT_INTEGRITY_FAILURE:${eventId}`, kind: "AUDIT_INTEGRITY_FAILURE", status: "CONFIRMED", severity: "critical", title: "The audit chain does not hold", summary: `Record ${brokenAt} fails its check (${problem}): it, or a record before it, was changed, removed or reordered.`, evidenceIds: [eventId], agentId: null, workspaceId: null, firstSeen: when, lastSeen: when, count: 1 }];
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Every rule over the same records, most severe first, then in the order the evidence was recorded.
export function findingsOf(input: AuditorInput): Finding[] {
  const { events } = input;
  const all = [...integrity(input), ...escalations(events), ...credentialAttempts(events), ...policyChanges(input), ...approvalReplays(events), ...crossWorkspace(events), ...repeatedDenials(events), ...deniedActions(events)];
  return all.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.firstSeen.localeCompare(b.firstSeen) || a.id.localeCompare(b.id));
}
