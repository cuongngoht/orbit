// ORBIT'S OWN SIGN-IN, as routes (identity.service.ts does the work):
//
//   GET    /api/auth/status          public   what this browser is: signed in (its session, user, account), signed out,
//                                             or a deployment with nobody set up yet; and the trial's login, in a trial
//   POST   /api/auth/login           public   { username, password } -> a NEW session for this browser (HttpOnly,
//                                             SameSite=Strict cookie; Secure behind HTTPS); 401 invalid_credentials,
//                                             429 too_many_attempts (Retry-After), 409 setup_required
//   POST   /api/auth/setup           public   { code, username, password, fullName, companyName?, timezone,
//                                             contactEmail? } with a one-time code: the first administrator, another
//                                             account, or (a reset code) a new password -- and a session
//   POST   /api/auth/logout          owner    this browser's session ends
//   POST   /api/auth/logout-all      owner    every session of this user ends, this one with them
//   POST   /api/auth/password        owner    { currentPassword, newPassword }; the user's other sessions end
//   GET    /api/auth/sessions        owner    this user's open sessions
//   DELETE /api/auth/sessions/:id    owner    one of them ends (another user's is not found)
//   PATCH  /api/auth/profile         owner    { fullName?, email? } (If-Match: "<user version>", optional)
//   GET    /api/account              owner    the account (ETag: its version)
//   PATCH  /api/account              owner    { displayName?, companyName?, contactEmail?, timezone?, locale? } with
//                                             If-Match: "<version>" (412 stale_version, 428 without it)
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { AuthAccount, AuthStatus, AuthUser, SessionView } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ApiError, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { cookieValue } from "../../infra/security/guards.js";
import { AccountsService, type Issued } from "./accounts.service.js";
import { Public } from "./decorators.js";
import { IdentityService, type ClientOf } from "./identity.service.js";
import { PrincipalResolver, SESSION_COOKIE } from "./principals.js";

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

@Controller()
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get("auth/status")
  @Public()
  async status(@Req() req: Request): Promise<AuthStatus> {
    const r = await this.principals.resolve(req);
    return this.identity.status(r.principal.kind === "owner" ? r.principal : null);
  }

  @Post("auth/login")
  @Public()
  @HttpCode(200)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): Promise<AuthStatus> {
    return this.signedIn(res, await this.retryAfter(res, () => this.identity.login(body, this.client(req))));
  }

  @Post("auth/setup")
  @Public()
  @HttpCode(200)
  async setup(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): Promise<AuthStatus> {
    return this.signedIn(res, await this.retryAfter(res, () => this.identity.setup(body, this.client(req))));
  }

  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response): Promise<AuthStatus> {
    await this.accounts.endSession(viewer());
    this.clear(res);
    return this.identity.status(null);
  }

  @Post("auth/logout-all")
  @HttpCode(200)
  async logoutAll(@Res({ passthrough: true }) res: Response): Promise<AuthStatus> {
    await this.accounts.endUserSessions(viewer().userId, "signed_out_everywhere");
    this.clear(res);
    return this.identity.status(null);
  }

  @Post("auth/password")
  @HttpCode(200)
  async password(@Res({ passthrough: true }) res: Response, @Body() body: unknown): Promise<AuthUser> {
    return this.retryAfter(res, () => this.identity.changePassword(viewer(), body));
  }

  @Get("auth/sessions")
  sessions(): Promise<SessionView[]> {
    return this.accounts.openSessions(viewer());
  }

  @Delete("auth/sessions/:id")
  @HttpCode(204)
  async revoke(@Param("id") id: string): Promise<void> {
    if (!(await this.accounts.revokeSession(viewer(), id))) throw notFound("The session");
  }

  @Patch("auth/profile")
  async profile(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): Promise<AuthUser> {
    const user = await this.identity.updateProfile(viewer(), body, header(req, "if-match"));
    res.setHeader("ETag", `"${user.version}"`);
    return user;
  }

  @Get("account")
  async account(@Res({ passthrough: true }) res: Response): Promise<AuthAccount> {
    const account = await this.identity.account(viewer());
    res.setHeader("ETag", `"${account.version}"`);
    return account;
  }

  @Patch("account")
  async updateAccount(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): Promise<AuthAccount> {
    const account = await this.identity.updateAccount(viewer(), body, header(req, "if-match"));
    res.setHeader("ETag", `"${account.version}"`);
    return account;
  }

  private client(req: Request): ClientOf {
    const ua = req.headers["user-agent"];
    return { address: req.socket.remoteAddress, previousToken: cookieValue(req.headers.cookie, SESSION_COOKIE), userAgent: typeof ua === "string" ? ua : null };
  }

  // A refusal that says how long to wait says it in Retry-After too.
  private async retryAfter<T>(res: Response, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const wait = err instanceof ApiError ? (err.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds : undefined;
      if (typeof wait === "number") res.setHeader("Retry-After", String(wait));
      throw err;
    }
  }

  private async signedIn(res: Response, issued: Issued): Promise<AuthStatus> {
    res.cookie(SESSION_COOKIE, issued.token, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path: "/api", maxAge: this.config.session.lifetimeMs });
    return this.identity.status(issued.owner);
  }

  private clear(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path: "/api" });
  }
}
