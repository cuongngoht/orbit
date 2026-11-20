// What a route asks of its caller, said where the route is declared and enforced by one global guard
// (governance.guard.ts) on every request:
//
//   @RequirePermission(p)  an operator whose roles hold `p` (and, for a change, the session's CSRF token)
//   @OperatorOnly()        any operator signed in (signing out, changing one's own password)
//   @AgentGateway()        a governed run's own token, and nothing else -- the one door an agent has
//
// A route that says none of these is a workspace route: a person passes it (the access token and the Claude sign-in
// stand in front), and an agent presenting its run token there is refused as outside its gateway.
import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@orbit-web/governance-core";

export const GOVERNANCE_ROUTE = "orbit-web:governance-route";

export type RouteRule = { kind: "permission"; permission: Permission } | { kind: "operator" } | { kind: "agent" };

export const RequirePermission = (permission: Permission) => SetMetadata(GOVERNANCE_ROUTE, { kind: "permission", permission } satisfies RouteRule);

export const OperatorOnly = () => SetMetadata(GOVERNANCE_ROUTE, { kind: "operator" } satisfies RouteRule);

export const AgentGateway = () => SetMetadata(GOVERNANCE_ROUTE, { kind: "agent" } satisfies RouteRule);
