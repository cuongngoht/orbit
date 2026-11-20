// GET/PATCH /api/settings: a person's preferences (the default model, effort and mode of a new chat, whether the
// plugins a repository is or declares are run -- off unless a person turns it on: they run code --, whether Claude may
// use the web tools, theme).
// POST /api/access: in token mode, trades the access token for an HttpOnly, SameSite=Strict cookie (asked for before the
// Claude sign-in, so it is reachable before it).
import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Patch, Post, Res } from "@nestjs/common";
import { checkUpdateSettings, DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, isEffortChoice, isModeChoice, isModelChoice, isTheme, type Settings } from "@orbit-web/contracts";
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
      defaultEffort: isEffortChoice(saved.defaultEffort) ? saved.defaultEffort : DEFAULT_EFFORT,
      defaultMode: isModeChoice(saved.defaultMode) ? saved.defaultMode : DEFAULT_MODE,
      projectSkills: saved.projectSkills !== false,
      projectPlugins: saved.projectPlugins === true,
      webTools: saved.webTools !== false,
      githubForClaude: saved.githubForClaude === true,
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
