// THE DAILY AUDIT REPORT: one UTC day of audit records, counted and listed. It is a fold over records and findings --
// no model writes a word of it -- and every line that claims something carries the ids of the records it rests on.
import type { AuditEvent, ChainCheck } from "./audit.js";
import type { Finding } from "./auditor.js";

export interface AgentActivity {
  agentId: string;
  runsStarted: number;
  runsRefused: number;
  runsFinished: number;
  decisions: Record<string, number>;
  evidenceIds: string[];
}

export interface DeniedAction {
  eventId: string;
  at: string;
  principalType: string;
  principalId: string;
  agentId: string | null;
  workspaceId: string | null;
  action: string;
  resource: string;
  enforcement: string;
  reasonCodes: string[];
}

export interface ApprovalLine {
  approvalId: string;
  action: string;
  fingerprint: string;
  // The last thing recorded about it that day.
  state: string;
  evidenceIds: string[];
}

export interface DailyReport {
  day: string;
  organizationId: string;
  generatedAt: string;
  recordCount: number;
  integrity: { ok: boolean; count: number; head: string | null; problem: string | null; brokenAt: number | null };
  agents: AgentActivity[];
  authorization: { total: number; byVerdict: Record<string, number>; byAction: Record<string, number>; evidenceIds: string[] };
  denied: DeniedAction[];
  approvals: ApprovalLine[];
  findings: Finding[];
  // Findings nobody has closed, by id: what still needs a person.
  unresolved: string[];
}

export interface ReportInput {
  day: string;
  organizationId: string;
  generatedAt: string;
  // The day's records, in the order they were recorded.
  events: readonly AuditEvent[];
  // The check of the WHOLE chain, not of the day.
  chain: ChainCheck;
  findings: readonly Finding[];
  // Ids of findings a person has closed.
  resolved: readonly string[];
}

const count = (keys: readonly string[]): Record<string, number> => keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

function agentsOf(events: readonly AuditEvent[]): AgentActivity[] {
  const ids = [...new Set(events.flatMap((e) => (e.agentId === null ? [] : [e.agentId])))].sort();
  return ids.map((agentId) => {
    const own = events.filter((e) => e.agentId === agentId);
    const of = (type: string): number => own.filter((e) => e.eventType === type).length;
    const decisions = own.filter((e) => e.eventType === "policy.decision");
    return { agentId, runsStarted: of("run.started"), runsRefused: of("run.refused"), runsFinished: of("run.finished"), decisions: count(decisions.map((e) => e.outcome)), evidenceIds: own.map((e) => e.eventId) };
  });
}

const deniedOf = (e: AuditEvent): DeniedAction => ({
  eventId: e.eventId,
  at: e.occurredAt,
  principalType: e.principalType,
  principalId: e.principalId,
  agentId: e.agentId,
  workspaceId: e.workspaceId,
  action: String(e.data.action),
  resource: String(e.data.resource),
  enforcement: String(e.data.enforcement),
  reasonCodes: e.reasonCodes,
});

function approvalsOf(events: readonly AuditEvent[]): ApprovalLine[] {
  const lines = new Map<string, ApprovalLine>();
  for (const e of events.filter((x) => x.eventType.startsWith("approval.") || x.eventType.startsWith("protected."))) {
    const id = String(e.data.approvalId);
    const line = lines.get(id) ?? { approvalId: id, action: "", fingerprint: "", state: "", evidenceIds: [] };
    lines.set(id, { ...line, action: e.data.action === undefined ? line.action : String(e.data.action), fingerprint: e.data.fingerprint === undefined ? line.fingerprint : String(e.data.fingerprint), state: e.eventType, evidenceIds: [...line.evidenceIds, e.eventId] });
  }
  return [...lines.values()];
}

const integrityOf = (chain: ChainCheck): DailyReport["integrity"] =>
  chain.ok ? { ok: true, count: chain.count, head: chain.head, problem: null, brokenAt: null } : { ok: false, count: chain.count, head: null, problem: chain.problem, brokenAt: chain.brokenAt };

export function dailyReport(input: ReportInput): DailyReport {
  const decisions = input.events.filter((e) => e.eventType === "policy.decision");
  return {
    day: input.day,
    organizationId: input.organizationId,
    generatedAt: input.generatedAt,
    recordCount: input.events.length,
    integrity: integrityOf(input.chain),
    agents: agentsOf(input.events),
    authorization: { total: decisions.length, byVerdict: count(decisions.map((e) => e.outcome)), byAction: count(decisions.map((e) => String(e.data.action))), evidenceIds: decisions.map((e) => e.eventId) },
    denied: decisions.filter((e) => e.outcome === "deny").map(deniedOf),
    approvals: approvalsOf(input.events),
    findings: [...input.findings],
    unresolved: input.findings.filter((f) => !input.resolved.includes(f.id)).map((f) => f.id),
  };
}

const tally = (counts: Record<string, number>): string =>
  Object.keys(counts)
    .sort()
    .map((k) => `${k} ${counts[k]}`)
    .join(" · ") || "none";

const refs = (ids: readonly string[], most = 6): string => (ids.length === 0 ? "" : ` [${ids.slice(0, most).join(", ")}${ids.length > most ? `, +${ids.length - most}` : ""}]`);

function integrityLines(r: DailyReport): string[] {
  if (r.integrity.ok) return [`The chain holds: ${r.integrity.count} record(s), head \`${r.integrity.head ?? "none"}\`.`];
  return [`**The chain does not hold**: record ${r.integrity.brokenAt} fails its check (${r.integrity.problem}). Nothing below it can be relied on until that is explained.`];
}

function list<T>(items: readonly T[], line: (item: T) => string, none: string): string[] {
  return items.length === 0 ? [none] : items.map((i) => `- ${line(i)}`);
}

// The same report as text: what a person reads, with the ids a person can look up.
export function renderReport(r: DailyReport): string {
  const parts: string[][] = [
    [`# Governance audit report — ${r.day}`, "", `Organization \`${r.organizationId}\` · generated ${r.generatedAt} · ${r.recordCount} record(s) that day`],
    ["## Audit integrity", "", ...integrityLines(r)],
    ["## Agent activity", "", ...list(r.agents, (a) => `\`${a.agentId}\`: ${a.runsStarted} run(s) started, ${a.runsRefused} refused, ${a.runsFinished} ended; decisions: ${tally(a.decisions)}${refs(a.evidenceIds)}`, "No agent did anything that was recorded.")],
    ["## Authorization", "", `${r.authorization.total} decision(s): ${tally(r.authorization.byVerdict)}`, `By action: ${tally(r.authorization.byAction)}`],
    ["## Denied actions", "", ...list(r.denied, (d) => `${d.at} · ${d.principalType} \`${d.agentId ?? d.principalId}\` · ${d.action} on \`${d.resource}\` · held by: ${d.enforcement} · ${d.reasonCodes.join(", ")} [${d.eventId}]`, "Nothing was denied.")],
    ["## Protected approvals", "", ...list(r.approvals, (a) => `\`${a.approvalId}\` · ${a.action} · \`${a.fingerprint.slice(0, 16)}\` · last: ${a.state}${refs(a.evidenceIds)}`, "No protected action was asked for.")],
    ["## Security findings", "", ...list(r.findings, (f) => `**${f.kind}** · ${f.status} · ${f.severity} — ${f.summary}${refs(f.evidenceIds)}`, "No finding.")],
    ["## Unresolved", "", ...list(r.unresolved, (id) => `\`${id}\``, "Nothing is waiting for a person.")],
  ];
  return `${parts.map((p) => p.join("\n")).join("\n\n")}\n`;
}
