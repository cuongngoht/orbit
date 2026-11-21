import { Body, Controller, Get, HttpCode, Inject, Module, Post, Put, Req, Res } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { checkClaudeLogin, checkLoginCode, checkUpdateConnectors, type ClaudeStatus, type ConnectorList, type LoginSnapshot, type ModelCatalog } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { BeforeClaudeSignIn } from "../../common/before-claude-sign-in.js";
import { accepted } from "../../common/errors.js";
import { openSse } from "../../infra/sse/sse.js";
import { ClaudeAuthService } from "./claude-auth.service.js";
import { ClaudeConnectorsService } from "./claude-connectors.service.js";
import { ClaudeModelsService } from "./claude-models.service.js";
import { ClaudeSignInGuard } from "./claude-sign-in.guard.js";

// Everything but sign-out is reachable before the sign-in: it IS the sign-in.
@Controller("claude")
export class ClaudeAuthController {
  constructor(
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(ClaudeConnectorsService) private readonly connectors: ClaudeConnectorsService,
  ) {}

  // The models (and their efforts) the signed-in account may use -- after the sign-in, like everything else.
  @Get("models")
  catalog(): Promise<ModelCatalog> {
    return this.models.catalog();
  }

  // The signed-in account's connectors (claude.ai, and installed plugins' servers), each with where it may be used.
  @Get("connectors")
  connectorList(): Promise<ConnectorList> {
    return this.connectors.list();
  }

  // Read again from the account's Claude CLI.
  @Post("connectors/refresh")
  @HttpCode(200)
  refreshConnectors(): Promise<ConnectorList> {
    return this.connectors.list(true);
  }

  // Where each connector may be used, as this account's person sets it.
  @Put("connectors")
  updateConnectors(@Body() body: unknown): Promise<ConnectorList> {
    return this.connectors.update(accepted(checkUpdateConnectors(body)));
  }

  @Get("status")
  @BeforeClaudeSignIn()
  status(): Promise<ClaudeStatus> {
    return this.claude.status();
  }

  @Post("login")
  @BeforeClaudeSignIn()
  @HttpCode(202)
  login(@Body() body: unknown): LoginSnapshot {
    accepted(checkClaudeLogin(body));
    return this.claude.login();
  }

  @Post("login/code")
  @BeforeClaudeSignIn()
  @HttpCode(202)
  code(@Body() body: unknown): LoginSnapshot {
    return this.claude.submitCode(accepted(checkLoginCode(body)).code);
  }

  @Post("login/cancel")
  @BeforeClaudeSignIn()
  @HttpCode(200)
  cancel(): LoginSnapshot {
    return this.claude.cancel();
  }

  @Get("login/events")
  @BeforeClaudeSignIn()
  events(@Req() req: Request, @Res() res: Response): void {
    let stop: () => void = () => undefined;
    const channel = openSse(req, res, () => stop());
    channel.send(this.claude.flowSnapshot());
    stop = this.claude.subscribe((s) => channel.send(s));
  }

  @Post("logout")
  @HttpCode(200)
  logout(): Promise<ClaudeStatus> {
    return this.claude.logout();
  }
}

@Module({
  providers: [ClaudeAuthService, ClaudeModelsService, ClaudeConnectorsService, { provide: APP_GUARD, useClass: ClaudeSignInGuard }],
  controllers: [ClaudeAuthController],
  exports: [ClaudeAuthService, ClaudeModelsService, ClaudeConnectorsService],
})
export class ClaudeAuthModule {}
