// The operator's own routes, and an owner's management of operators:
//
//   GET  /api/operator/state                 whether governance is set up, and this browser's operator session
//   POST /api/operator/bootstrap             the first owner, with the one-time code from Orbit Web's own log
//   POST /api/operator/login | logout        an operator's session (an HttpOnly, SameSite=Strict cookie)
//   POST /api/operator/password              changing one's own password (other sessions end)
//
//   GET  /api/governance/operators                       operators.read
//   POST /api/governance/operators                       operators.manage (and roles.manage to give roles)
//   POST /api/governance/operators/:id/suspend|reinstate operators.manage
//   POST /api/governance/operators/:id/roles             roles.manage   { grant, revoke }
//   POST /api/governance/operators/:id/sessions/revoke   operators.manage
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { GovernanceState, OperatorList, OperatorView } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { OperatorOnly, RequirePermission } from "./decorators.js";
import { OPERATOR_COOKIE, OperatorService, SESSION_LIFETIME_MS, type OpenedSession } from "./operator.service.js";
import { PrincipalResolver } from "./principals.js";

const COOKIE_PATH = "/api";

@Controller("operator")
export class OperatorController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OperatorService) private readonly operators: OperatorService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get("state")
  state(@Req() req: Request, @Res({ passthrough: true }) res: Response): GovernanceState {
    res.setHeader("Cache-Control", "no-store");
    return this.operators.state(this.principals.of(req));
  }

  @Post("bootstrap")
  async bootstrap(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<GovernanceState> {
    return this.opened(res, await this.operators.bootstrap(this.principals.context(req), body));
  }

  @Post("login")
  @HttpCode(200)
  async login(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<GovernanceState> {
    return this.opened(res, await this.operators.login(this.principals.context(req), body));
  }

  @Post("logout")
  @OperatorOnly()
  @HttpCode(204)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    this.operators.logout(this.principals.context(req));
    res.clearCookie(OPERATOR_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: "strict", secure: this.config.secureCookie });
  }

  @Post("password")
  @OperatorOnly()
  @HttpCode(204)
  async password(@Req() req: Request, @Body() body: unknown): Promise<void> {
    await this.operators.changePassword(this.principals.context(req), body);
  }

  private opened(res: Response, opened: OpenedSession): GovernanceState {
    res.setHeader("Cache-Control", "no-store");
    res.cookie(OPERATOR_COOKIE, opened.token, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path: COOKIE_PATH, maxAge: SESSION_LIFETIME_MS });
    return opened.state;
  }
}

@Controller("governance/operators")
export class OperatorsController {
  constructor(
    @Inject(OperatorService) private readonly operators: OperatorService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get()
  @RequirePermission("operators.read")
  list(): OperatorList {
    return { operators: this.operators.list() };
  }

  @Post()
  @RequirePermission("operators.manage")
  create(@Req() req: Request, @Body() body: unknown): Promise<OperatorView> {
    return this.operators.create(this.principals.context(req), body);
  }

  @Post(":id/suspend")
  @RequirePermission("operators.manage")
  @HttpCode(200)
  suspend(@Req() req: Request, @Param("id") id: string): OperatorView {
    return this.operators.suspend(this.principals.context(req), id);
  }

  @Post(":id/reinstate")
  @RequirePermission("operators.manage")
  @HttpCode(200)
  reinstate(@Req() req: Request, @Param("id") id: string): OperatorView {
    return this.operators.reinstate(this.principals.context(req), id);
  }

  @Post(":id/roles")
  @RequirePermission("roles.manage")
  @HttpCode(200)
  roles(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): OperatorView {
    return this.operators.changeRoles(this.principals.context(req), id, body);
  }

  @Post(":id/sessions/revoke")
  @RequirePermission("operators.manage")
  @HttpCode(200)
  revoke(@Req() req: Request, @Param("id") id: string): { sessions: number } {
    return this.operators.revokeSessions(this.principals.context(req), id);
  }
}
