// THE GATE: one global guard, after the host guard and the access token (middleware), that holds every route to what it
// declares (decorators.ts). It decides on the principal Orbit Web established (principals.ts), never on a role, a name,
// an account id or a flag a request carries. In this order:
//
//   1. a run token that is not a live chat run's            refused (401), and recorded
//   2. the agent gateway                                    a live chat run's own token, and nothing else
//   3. an agent anywhere else (its token, or its network)   refused (403) and recorded: it is reaching outside its door
//   4. a public route                                       passes (the sign-in itself, the health check, a link)
//   5. anything else                                        the OWNER of a browser session -- this browser finished a
//                                                           Claude sign-in, and the runtime's CLI still holds that same
//                                                           identity; the CLI being signed in is not enough (401)
//   6. a change                                             that session's own CSRF token (403), and recorded
//   7. a route about one record (a chat)                    its owner module's check (404 when not this owner's)
//
// When the runtime's CLI no longer holds the identity a session is for -- signed out, or signed in as somebody else from
// a terminal -- the account's sessions end here, at once: a page of account A never reads anything while the CLI is B.
import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CLAUDE_SIGN_IN_REQUIRED, CSRF_HEADER, CSRF_INVALID } from "@orbit-web/contracts";
import type { Request } from "express";
import { ApiError } from "../../common/errors.js";
import { setPrincipal } from "../../common/request-scope.js";
import { routedPath } from "../../infra/security/guards.js";
import { AccountsService } from "./accounts.service.js";
import { AuthHooks } from "./auth-hooks.js";
import { ClaudeCli } from "./claude-cli.service.js";
import { ROUTE_RULE, type RouteRule } from "./decorators.js";
import { contextOf, type Owner } from "./principal.js";
import { PrincipalResolver, type Resolution } from "./principals.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const isChange = (req: Request): boolean => !SAFE.has(req.method);

export const routeOf = (req: Request): string => `${req.method} ${routedPath(req.path)}`.slice(0, 200);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(ClaudeCli) private readonly cli: ClaudeCli,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<Request>();
    const rule = this.reflector.getAllAndOverride<RouteRule | undefined>(ROUTE_RULE, [context.getHandler(), context.getClass()]);
    const resolved = await this.principals.resolve(req);
    const principal = resolved.principal;
    setPrincipal(principal);
    if (resolved.invalidRunToken) return this.refuse(req, HttpStatus.UNAUTHORIZED, "run_token_invalid", "That run token is not a running chat run's.", "run_token_invalid");
    if (rule === "agent") return principal.kind === "agent" ? true : this.refuse(req, HttpStatus.UNAUTHORIZED, "run_token_required", "The agent gateway answers a running chat run's own token only.", "no_run_token");
    if (principal.kind === "agent" || (principal.kind === "anonymous" && principal.agentNetwork)) return this.outsideGateway(req);
    if (rule === "public") return true;
    if (principal.kind !== "owner") return this.signInRequired(null);
    await this.holdsIdentity(principal, resolved);
    if (isChange(req) && !this.accounts.csrfMatches(principal, headerOf(req, CSRF_HEADER))) {
      return this.refuse(req, HttpStatus.FORBIDDEN, CSRF_INVALID, "This change does not carry this browser session's own token: reload the page and try again.", "csrf");
    }
    await this.hooks.checkResource(req, principal);
    return true;
  }

  // The runtime's CLI still holds the identity this session is for; otherwise the account's sessions end now.
  private async holdsIdentity(owner: Owner, resolved: Resolution): Promise<void> {
    const signIn = await this.cli.signIn();
    if (signIn.state === "unavailable") this.signInRequired(signIn.detail);
    const identity = await this.cli.identity();
    if (identity !== null && identity.key === resolved.identityKey) return;
    await this.accounts.endAccount(owner.accountId, identity === null ? "cli_signed_out" : "identity_changed");
    this.signInRequired(identity === null ? "The Claude CLI is no longer signed in to this account." : "The Claude CLI was signed in to another account: sign in again here.");
  }

  private signInRequired(detail: string | null): never {
    throw new ApiError(HttpStatus.UNAUTHORIZED, CLAUDE_SIGN_IN_REQUIRED, `Sign in to Orbit Web with your Claude account first.${detail ? ` ${detail}` : ""}`);
  }

  // An agent -- by its run's token, or by the network its container is on -- on a route that is not its gateway: what it
  // is trying is administration, and it is recorded as such.
  private async outsideGateway(req: Request): Promise<never> {
    await this.hooks.refused(this.principals.context(req), { kind: "boundary", route: routeOf(req), cause: "agent_outside_gateway", target: routedPath(req.path), change: isChange(req) });
    throw new ApiError(HttpStatus.FORBIDDEN, "agent_outside_gateway", "A run reaches Orbit Web through its gateway only.");
  }

  private async refuse(req: Request, status: number, code: string, message: string, cause: string): Promise<never> {
    if (isChange(req) || status === HttpStatus.FORBIDDEN) await this.hooks.refused(contextOf(this.principals.of(req)), { kind: "authz", route: routeOf(req), cause, change: isChange(req) });
    throw new ApiError(status, code, message);
  }
}

const headerOf = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};
