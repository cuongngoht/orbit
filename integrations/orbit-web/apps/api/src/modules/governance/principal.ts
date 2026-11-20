// WHO IS ASKING, as Orbit Web itself established it -- never as a request says. Four kinds:
//
//   operator   a person who signed in to governance with their own credential: a session Orbit Web issued, kept as
//              its hash, with the roles read from the store on this very request.
//   agent      a governed run of an agent, by the token Orbit Web minted when it started that run and handed to that
//              run's process alone. An agent is never a human principal and holds no role.
//   anonymous  everybody else -- including whoever passed the Claude sign-in and the access token: those open the
//              workspace, never governance. `agentNetwork` says the request came from the agent container's network.
//   system     Orbit Web itself (a start, a scheduled report, the installation's own terminal).
import { randomUUID } from "node:crypto";
import type { AuditPrincipalType, OperatorRole, Permission } from "@orbit-web/governance-core";
import type { RunBinding } from "../../infra/governance/stores.js";

// The agent a RESEARCH run is bound as (modules/research): it has no tool and no workspace, and the agent gateway refuses
// its token (principals.ts) -- in the governed deployment the token is its credential for the egress proxy alone.
export const RESEARCH_AGENT = "research";

export type Principal =
  | { kind: "operator"; operatorId: string; username: string; sessionId: string; roles: OperatorRole[]; permissions: Permission[]; csrfToken: string; expiresAt: string }
  | { kind: "agent"; binding: RunBinding }
  | { kind: "anonymous"; agentNetwork: boolean }
  | { kind: "system"; id: string };

export interface GovernanceContext {
  correlationId: string;
  principal: Principal;
}

export const SYSTEM: Principal = { kind: "system", id: "orbit-web" };

export const systemContext = (id = "orbit-web"): GovernanceContext => ({ correlationId: randomUUID(), principal: { kind: "system", id } });

// How a principal is named in the audit record.
export function auditPrincipalOf(p: Principal): { principalId: string; principalType: AuditPrincipalType; agentId: string | null } {
  if (p.kind === "operator") return { principalId: p.operatorId, principalType: "human", agentId: null };
  if (p.kind === "agent") return { principalId: p.binding.agentId, principalType: "agent", agentId: p.binding.agentId };
  if (p.kind === "system") return { principalId: p.id, principalType: "system", agentId: null };
  return { principalId: p.agentNetwork ? "agent-network" : "anonymous", principalType: "anonymous", agentId: null };
}

// How a principal is named where a record says who did something (created_by, decided_by ...).
export function labelOf(p: Principal): string {
  if (p.kind === "operator") return p.operatorId;
  if (p.kind === "agent") return `agent:${p.binding.agentId}`;
  if (p.kind === "system") return `system:${p.id}`;
  return "anonymous";
}
