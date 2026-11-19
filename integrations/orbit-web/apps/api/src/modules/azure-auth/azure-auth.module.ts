import { Body, Controller, Get, HttpCode, Inject, Module, Post, Req, Res } from "@nestjs/common";
import { checkAzureLogin, type AzureStatus, type LoginSnapshot } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { accepted } from "../../common/errors.js";
import { openSse } from "../../infra/sse/sse.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AzureAuthService } from "./azure-auth.service.js";

@Controller("azure")
export class AzureAuthController {
  constructor(@Inject(AzureAuthService) private readonly azure: AzureAuthService) {}

  @Get("status")
  status(): Promise<AzureStatus> {
    return this.azure.status();
  }

  @Post("login")
  @HttpCode(202)
  login(@Body() body: unknown): LoginSnapshot {
    return this.azure.login(accepted(checkAzureLogin(body)).tenant);
  }

  @Post("login/cancel")
  @HttpCode(200)
  cancel(): LoginSnapshot {
    return this.azure.cancel();
  }

  @Get("login/events")
  events(@Req() req: Request, @Res() res: Response): void {
    let stop: () => void = () => undefined;
    const channel = openSse(req, res, () => stop());
    channel.send(this.azure.flowSnapshot());
    stop = this.azure.subscribe((s) => channel.send(s));
  }

  @Post("logout")
  @HttpCode(200)
  logout(): Promise<AzureStatus> {
    return this.azure.logout();
  }
}

@Module({
  imports: [SettingsModule],
  providers: [AzureAuthService],
  controllers: [AzureAuthController],
  exports: [AzureAuthService],
})
export class AzureAuthModule {}
