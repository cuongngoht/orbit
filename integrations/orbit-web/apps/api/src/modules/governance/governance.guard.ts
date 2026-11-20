// THE GOVERNANCE GATE: one global guard, after the Claude sign-in gate, that holds every route to what it declares
// (decorators.ts). What it decides on is the principal Orbit Web established (principals.ts) -- an operator's session,
// a run's token, or nobody -- never a role, a name or a flag a request carries.
//
//   an agent route          only a live run's own token
//   anything else           never an agent: a run token presented outside the gateway is refused and recorded
//   a permission route      an operator whose roles hold it, and for a change the session's CSRF token
//
// A refusal of a change is an audit record: who tried, which route, why.
import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CSRF_INVALID, OPERATOR_CSRF_HEADER, OPERATOR_REQUIRED, PERMISSION_REQUIRED } from "@orbit-web/contracts";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "../../common/errors.js";
import { routedPath } from "../../infra/security/guards.js";
import { AuditService } from "./audit.service.js";
import { GOVERNANCE_ROUTE, type RouteRule } from "./decorators.js";
import type { GovernanceContext, Principal } from "./principal.js";
import { PrincipalResolver } from "./principals.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const isChange = (req: Request): boolean => !SAFE.has(req.method);

export const routeOf = (req: Request): string => `${req.method} ${routedPath(req.path)}`.slice(0, 200);

export function csrfMatches(req: Request, principal: Principal): boolean {
  if (principal.kind !== "operator") return false;
  const given = req.headers[OPERATOR_CSRF_HEADER];
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(principal.csrfToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class GovernanceGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const rule = this.reflector.getAllAndOverride<RouteRule | undefined>(GOVERNANCE_ROUTE, [context.getHandler(), context.getClass()]);
    const resolved = this.principals.resolve(req);
    const ctx = this.principals.context(req);
    if (resolved.invalidRunToken) return this.refuse(ctx, req, HttpStatus.UNAUTHORIZED, "run_token_invalid", "That run token is not a running run's.", "run_token_invalid");
    if (rule?.kind === "agent") return this.agentRoute(ctx, req);
    if (ctx.principal.kind === "agent" || (ctx.principal.kind === "anonymous" && ctx.principal.agentNetwork)) return this.outsideGateway(ctx, req);
    if (rule === undefined) return true;
    if (ctx.principal.kind !== "operator") return this.refuse(ctx, req, HttpStatus.UNAUTHORIZED, OPERATOR_REQUIRED, "Sign in as an Orbit operator (Governance) first.", "no_operator", rule);
    if (rule.kind === "permission" && !ctx.principal.permissions.includes(rule.permission)) return this.refuse(ctx, req, HttpStatus.FORBIDDEN, PERMISSION_REQUIRED, `This needs the ${rule.permission} permission, which none of your roles holds.`, "permission", rule);
    if (isChange(req) && !csrfMatches(req, ctx.principal)) return this.refuse(ctx, req, HttpStatus.FORBIDDEN, CSRF_INVALID, "This change does not carry this session's own token: reload the page and try again.", "csrf", rule);
    return true;
  }

  private agentRoute(ctx: GovernanceContext, req: Request): boolean {
    if (ctx.principal.kind === "agent") return true;
    return this.refuse(ctx, req, HttpStatus.UNAUTHORIZED, "run_token_required", "The agent gateway answers a governed run's own token only.", "no_run_token");
  }

  // An agent -- by its run's token, or by the network its container is on -- on a route that is not its gateway: what it
  // is trying is administration, and it is recorded as such.
  private outsideGateway(ctx: GovernanceContext, req: Request): boolean {
    this.audit.record(ctx, { type: "boundary.violation", outcome: "refused", data: { kind: "agent_outside_gateway", route: routeOf(req), target: routedPath(req.path) } });
    throw new ApiError(HttpStatus.FORBIDDEN, "agent_outside_gateway", "A governed run reaches Orbit Web through its gateway only.");
  }

  private refuse(ctx: GovernanceContext, req: Request, status: number, code: string, message: string, cause: string, rule?: RouteRule): never {
    if (isChange(req) || status === HttpStatus.FORBIDDEN) {
      this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { permission: rule?.kind === "permission" ? rule.permission : (rule?.kind ?? "none"), route: routeOf(req), cause } });
    }
    throw new ApiError(status, code, message);
  }
}
