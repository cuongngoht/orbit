// What a route asks of its caller, said where the route is declared and enforced by ONE global guard (auth.guard.ts)
// on every request. A route that says nothing is the OWNER's: a person whose browser finished the Claude sign-in, for
// the account of that sign-in -- with this session's CSRF token on every change.
//
//   @Public()        reachable before the sign-in: the health check, the access token, the Claude sign-in itself, a
//                    shared chat's link. Nothing else.
//   @AgentGateway()  a chat run's own token, and nothing else -- the one door an agent has.
import { SetMetadata } from "@nestjs/common";

export const ROUTE_RULE = "orbit-web:route-rule";

export type RouteRule = "public" | "agent";

export const Public = () => SetMetadata(ROUTE_RULE, "public" satisfies RouteRule);

export const AgentGateway = () => SetMetadata(ROUTE_RULE, "agent" satisfies RouteRule);
