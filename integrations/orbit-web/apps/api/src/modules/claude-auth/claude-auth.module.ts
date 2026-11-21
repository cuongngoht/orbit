// THE CLAUDE SIGN-IN'S ROUTES, and the account's own:
//
//   GET  /api/claude/status          public   what THIS browser is: signed in (its session), or what keeps it out,
//                                             with its own sign-in flow and nothing of another browser's
//   POST /api/claude/login           public   starts this browser's sign-in (sets the nonce cookie that binds it)
//   POST /api/claude/login/code      public   the code from the Claude page, for this browser's flow only
//   POST /api/claude/login/cancel    public
//   GET  /api/claude/login/events    public   this browser's flow, as it moves (SSE)
//   POST /api/claude/session         public   exchanges this browser's VERIFIED sign-in, once, for a session
//   DELETE /api/claude/session       owner    signs this browser out (the account and its other browsers stay)
//   POST /api/claude/logout          owner    signs the account out of the runtime's Claude CLI
//   GET|PUT /api/account             owner    the account: its display name, its identity, its browser sessions
//   DELETE /api/account/sessions/:id owner    ends one of the account's other browser sessions
//   GET /api/claude/models · /connectors (+ refresh, PUT)   owner, for the account of the session
import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Param, Post, Put, Req, Res } from "@nestjs/common";
import { checkClaudeLogin, checkLoginCode, checkUpdateAccount, checkUpdateConnectors, type AccountView, type ClaudeStatus, type ConnectorList, type LoginSnapshot, type ModelCatalog } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { openSse } from "../../infra/sse/sse.js";
import { cookieValue } from "../../infra/security/guards.js";
import { AccountsService } from "../auth/accounts.service.js";
import { Public } from "../auth/decorators.js";
import { LOGIN_COOKIE, PrincipalResolver, SESSION_COOKIE } from "../auth/principals.js";
import { ClaudeAuthService } from "./claude-auth.service.js";
import { ClaudeConnectorsService } from "./claude-connectors.service.js";
import { ClaudeModelsService } from "./claude-models.service.js";

const nonceOf = (req: Request): string | null => cookieValue(req.headers.cookie, LOGIN_COOKIE);

@Controller()
export class ClaudeAuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(ClaudeConnectorsService) private readonly connectors: ClaudeConnectorsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  // ---- the sign-in -------------------------------------------------------------------------------------------------

  @Get("claude/status")
  @Public()
  async status(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<ClaudeStatus> {
    res.setHeader("Cache-Control", "no-store");
    const r = await this.principals.resolve(req);
    return this.claude.status(r.principal.kind === "owner" ? r.principal : null, nonceOf(req));
  }

  @Post("claude/login")
  @Public()
  @HttpCode(202)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): Promise<LoginSnapshot> {
    accepted(checkClaudeLogin(body));
    const started = await this.claude.login(nonceOf(req));
    this.cookie(res, LOGIN_COOKIE, started.nonce, "/api/claude", this.config.limits.loginTimeoutMs + 15 * 60_000);
    return started.flow;
  }

  @Post("claude/login/code")
  @Public()
  @HttpCode(202)
  code(@Req() req: Request, @Body() body: unknown): LoginSnapshot {
    return this.claude.submitCode(nonceOf(req), accepted(checkLoginCode(body)).code);
  }

  @Post("claude/login/cancel")
  @Public()
  @HttpCode(200)
  cancel(@Req() req: Request): LoginSnapshot {
    return this.claude.cancel(nonceOf(req));
  }

  @Get("claude/login/events")
  @Public()
  events(@Req() req: Request, @Res() res: Response): void {
    let stop: () => void = () => undefined;
    const channel = openSse(req, res, () => stop());
    stop = this.claude.subscribe(nonceOf(req), (s) => channel.send(s));
  }

  // The exchange: this browser's verified sign-in, once, for a session (a new token: whatever it held before ends).
  @Post("claude/session")
  @Public()
  @HttpCode(200)
  async claim(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<ClaudeStatus> {
    const previous = cookieValue(req.headers.cookie, SESSION_COOKIE);
    const ua = req.headers["user-agent"];
    const issued = await this.claude.claim(nonceOf(req), previous, typeof ua === "string" ? ua : null);
    this.cookie(res, SESSION_COOKIE, issued.token, "/api", this.config.session.lifetimeMs);
    this.clear(res, LOGIN_COOKIE, "/api/claude");
    const resolved = await this.accounts.resolve(issued.token);
    return this.claude.status(resolved?.owner ?? null, null);
  }

  @Delete("claude/session")
  @HttpCode(200)
  async signOutBrowser(@Res({ passthrough: true }) res: Response): Promise<ClaudeStatus> {
    await this.accounts.endSession(viewer());
    this.clear(res, SESSION_COOKIE, "/api");
    return this.claude.status(null, null);
  }

  @Post("claude/logout")
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response): Promise<ClaudeStatus> {
    const out = await this.claude.logout(viewer());
    this.clear(res, SESSION_COOKIE, "/api");
    const status = await this.claude.status(null, null);
    return out.detail === null ? status : { ...status, detail: out.detail };
  }

  // ---- the account -------------------------------------------------------------------------------------------------

  @Get("account")
  async account(): Promise<AccountView> {
    return this.accountView();
  }

  @Put("account")
  async rename(@Body() body: unknown): Promise<AccountView> {
    const req = accepted(checkUpdateAccount(body));
    await this.accounts.rename(viewer().accountId, req.displayName);
    return this.accountView();
  }

  @Delete("account/sessions/:id")
  @HttpCode(204)
  async revoke(@Param("id") id: string): Promise<void> {
    if (!(await this.accounts.revokeSession(viewer(), id))) throw notFound("The session");
  }

  // ---- what the account may use ---------------------------------------------------------------------------------------

  @Get("claude/models")
  catalog(): Promise<ModelCatalog> {
    return this.models.catalog(viewer().accountId);
  }

  @Get("claude/connectors")
  connectorList(): Promise<ConnectorList> {
    return this.connectors.list(viewer().accountId);
  }

  @Post("claude/connectors/refresh")
  @HttpCode(200)
  refreshConnectors(): Promise<ConnectorList> {
    return this.connectors.list(viewer().accountId, true);
  }

  @Put("claude/connectors")
  updateConnectors(@Body() body: unknown): Promise<ConnectorList> {
    return this.connectors.update(viewer().accountId, accepted(checkUpdateConnectors(body)));
  }

  private async accountView(): Promise<AccountView> {
    const owner = viewer();
    const account = await this.accounts.account(owner.accountId);
    const identity = await this.accounts.identityOf(owner.accountId);
    if (account === null || identity === null) throw notFound("The account");
    const sessions = await this.accounts.openSessions(owner.accountId);
    return {
      id: account.id,
      displayName: account.displayName,
      email: identity.email,
      organization: identity.orgName,
      plan: identity.plan,
      createdAt: account.createdAt,
      sessions: sessions.map((s) => ({ id: s.id, current: s.id === owner.sessionId, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, userAgent: s.userAgent })),
    };
  }

  private cookie(res: Response, name: string, value: string, path: string, maxAgeMs: number): void {
    res.cookie(name, value, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path, maxAge: maxAgeMs });
  }

  private clear(res: Response, name: string, path: string): void {
    res.clearCookie(name, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path });
  }
}

@Module({
  providers: [ClaudeAuthService, ClaudeModelsService, ClaudeConnectorsService],
  controllers: [ClaudeAuthController],
  exports: [ClaudeAuthService, ClaudeModelsService, ClaudeConnectorsService],
})
export class ClaudeAuthModule {}
