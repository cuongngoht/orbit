// GET/PATCH /api/settings: a person's preferences (default model, whether Claude may use the web tools, theme).
// POST /api/access: in token mode, trades the access token for an HttpOnly, SameSite=Strict cookie (asked for before the
// Claude sign-in, so it is reachable before it).
import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Patch, Post, Res } from "@nestjs/common";
import { checkUpdateSettings, DEFAULT_MODEL, isModelChoice, isTheme, type Settings } from "@orbit-web/contracts";
import type { Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { BeforeClaudeSignIn } from "../../common/before-claude-sign-in.js";
import { accepted, ApiError, badRequest } from "../../common/errors.js";
import { ACCESS_COOKIE, accessTokenMatches } from "../../infra/security/guards.js";
import { SettingsStore } from "../../infra/storage/stores.js";

const KEY = "preferences";

@Injectable()
export class SettingsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SettingsStore) private readonly store: SettingsStore,
  ) {}

  get(): Settings {
    const saved = this.store.get<Partial<Settings>>(KEY) ?? {};
    return {
      defaultModel: isModelChoice(saved.defaultModel) ? saved.defaultModel : DEFAULT_MODEL,
      webTools: saved.webTools === true,
      azureForClaude: saved.azureForClaude === true,
      theme: isTheme(saved.theme) ? saved.theme : "system",
      maxBudgetUsd: this.config.maxBudgetUsd,
    };
  }

  update(body: unknown): Settings {
    const change = accepted(checkUpdateSettings(body));
    const { maxBudgetUsd: _ignored, ...current } = this.get();
    this.store.set(KEY, { ...current, ...change });
    return this.get();
  }
}

@Controller()
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get("settings")
  get(): Settings {
    return this.settings.get();
  }

  @Patch("settings")
  update(@Body() body: unknown): Settings {
    return this.settings.update(body);
  }

  @Post("access")
  @BeforeClaudeSignIn()
  @HttpCode(204)
  access(@Body() body: unknown, @Res({ passthrough: true }) res: Response): void {
    const token = typeof (body as { token?: unknown } | null)?.token === "string" ? (body as { token: string }).token : null;
    if (this.config.accessToken === null) throw badRequest("This Orbit Web has no access token configured.");
    if (token === null || !accessTokenMatches(this.config, token)) throw new ApiError(401, "access_token_invalid", "That is not this Orbit Web's access token.");
    res.cookie(ACCESS_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path: "/" });
  }
}

@Module({
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
