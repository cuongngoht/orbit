// WHO IS ASKING, as Orbit Web itself established it -- never as a request says. Four kinds:
//
//   owner      a person whose browser signed in to Orbit with a username and a password: a session Orbit Web issued to
//              THAT browser (kept as its hash), for the USER who signed in, in that user's account. The person is the
//              owner of that account -- of its chats, its research, its AI connections and its governance. Nothing a
//              request carries names the account: it is the session's. No AI CLI's sign-in has any part in it.
//   agent      a run of an agent, by the token Orbit Web minted when it started that run and handed to that run's
//              process alone. An agent is never a person: it holds no session, owns nothing and decides nothing.
//   anonymous  everybody else -- including a caller that passed the access token. `agentNetwork`: the request came from
//              the agent container's network.
//   system     Orbit Web itself (a start, a scheduled report, the installation's own terminal), for an account or for
//              the deployment.
import { randomUUID } from "node:crypto";
import type { AuditPrincipalType } from "@orbit-web/governance-core";
import type { RunBinding } from "../../infra/governance/stores.js";

export interface Owner {
  kind: "owner";
  accountId: string;
  userId: string;
  // The browser session this request carried.
  sessionId: string;
  username: string;
  fullName: string;
  // The user's SHARE ADDRESS (contracts: shareAddressOf): their verified email, or `<username>@users.orbit.local` --
  // what others share with this user by, and what a share is matched against. Never an address mail is sent to.
  email: string;
  csrfToken: string;
  expiresAt: string;
}

export type Principal = Owner | { kind: "agent"; binding: RunBinding } | { kind: "anonymous"; agentNetwork: boolean } | { kind: "system"; id: string; accountId: string | null };

// What a governance write is made under: who, the account it concerns (null: the deployment's own record -- the system
// account's chain), and one correlation id per request.
export interface GovernanceContext {
  correlationId: string;
  principal: Principal;
  accountId: string | null;
}

// The account a principal acts for: an owner's, a run's, a system task's. Anonymous acts for none.
export function accountOf(p: Principal): string | null {
  if (p.kind === "owner") return p.accountId;
  if (p.kind === "agent") return p.binding.accountId;
  if (p.kind === "system") return p.accountId;
  return null;
}

export const contextOf = (principal: Principal, correlationId: string = randomUUID()): GovernanceContext => ({ correlationId, principal, accountId: accountOf(principal) });

export const systemContext = (id: string, accountId: string | null = null): GovernanceContext => contextOf({ kind: "system", id, accountId });

// How a principal is named in the audit record.
export function auditPrincipalOf(p: Principal): { principalId: string; principalType: AuditPrincipalType; agentId: string | null } {
  if (p.kind === "owner") return { principalId: `owner:${p.accountId}`, principalType: "human", agentId: null };
  if (p.kind === "agent") return { principalId: p.binding.agentId, principalType: "agent", agentId: p.binding.agentId };
  if (p.kind === "system") return { principalId: p.id, principalType: "system", agentId: null };
  return { principalId: p.agentNetwork ? "agent-network" : "anonymous", principalType: "anonymous", agentId: null };
}

// How a principal is named where a record says who did something (created_by, decided_by ...).
export function labelOf(p: Principal): string {
  if (p.kind === "owner") return `owner:${p.accountId}`;
  if (p.kind === "agent") return `agent:${p.binding.agentId}`;
  if (p.kind === "system") return `system:${p.id}`;
  return "anonymous";
}
