// The Azure CLI's sign-in, driven from Settings → Connectors. The flow's progress travels on the app stream
// (`connector.flow`, `connector.status`), not a stream of its own.
import { Body, Controller, Get, HttpCode, Inject, Module, Post } from "@nestjs/common";
import { checkAzureLogin, type AzureStatus, type LoginSnapshot } from "@orbit-web/contracts";
import { accepted } from "../../common/errors.js";
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
