// GET/PATCH /api/settings: a person's preferences (the default model, effort and mode of a new chat, whether the
// plugins a repository is or declares are run -- off unless a person turns it on: they run code --, whether Claude may
// use the web tools, theme).
// POST /api/access: in token mode, trades the access token for an HttpOnly, SameSite=Strict cookie kept 30 days (asked for
// before the Claude sign-in, so it is reachable before it). GET /api/access/link: the token again, for whoever is in.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Patch, Post, Req, Res } from "@nestjs/common";
import { checkUpdateSettings, DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, isEffortChoice, isModeChoice, isModelChoice, isTheme, type AccessLink, type Settings } from "@orbit-web/contracts";
import { PRIVILEGED_SETTINGS } from "@orbit-web/governance-core";
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { BeforeClaudeSignIn } from "../../common/before-claude-sign-in.js";
import { accepted, ApiError, badRequest } from "../../common/errors.js";
import { ACCESS_COOKIE, accessTokenMatches, accessTokenPresented } from "../../infra/security/guards.js";
import { SettingsStore } from "../../infra/storage/stores.js";
import { GovernanceModule } from "../governance/governance.module.js";
import type { GovernanceContext } from "../governance/principal.js";
import { PrincipalResolver } from "../governance/principals.js";
import { PrivilegedSettingsGate } from "../governance/settings-gate.js";

const KEY = "preferences";

// A browser is asked for the access token once, then keeps the cookie this long (not just until it closes): a restart
// of the browser or of Orbit Web asks for nothing again. A changed token ends it at once.
const ACCESS_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SettingsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SettingsStore) private readonly store: SettingsStore,
    @Inject(PrivilegedSettingsGate) private readonly gate: PrivilegedSettingsGate,
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

  // A change of a person's preferences. Turning a PRIVILEGED setting on is authorized first (settings-gate.ts: an
  // operator, and the Constitution in effect), and recorded before it is written; turning one off is recorded.
  update(body: unknown, ctx: GovernanceContext, req: Request): Settings {
    const change = accepted(checkUpdateSettings(body));
    const { maxBudgetUsd: _ignored, ...current } = this.get();
    const widened = PRIVILEGED_SETTINGS.filter((k) => change[k] === true && current[k] !== true);
    const narrowed = PRIVILEGED_SETTINGS.filter((k) => change[k] === false && current[k] === true);
    if (widened.length > 0) this.gate.authorize(ctx, req, widened);
    this.store.set(KEY, { ...current, ...change });
    if (narrowed.length > 0) this.gate.narrowed(ctx, narrowed);
    return this.get();
  }
}

@Controller()
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get("settings")
  get(): Settings {
    return this.settings.get();
  }

  @Patch("settings")
  update(@Req() req: Request, @Body() body: unknown): Settings {
    return this.settings.update(body, this.principals.context(req), req);
  }

  // The access link's token, for whoever is already in: the access gate and the Claude sign-in gate stand in front of
  // this route, so it tells nobody anything they could not already do. Never cached.
  @Get("access/link")
  link(@Req() req: Request, @Res({ passthrough: true }) res: Response): AccessLink {
    res.setHeader("Cache-Control", "no-store");
    // Given only to a request that itself carries the token -- checked here too, whatever the gate decided.
    if (this.config.accessToken !== null && !accessTokenPresented(this.config, req)) throw new ApiError(401, "access_token_required", "This Orbit Web needs its access token.");
    return { token: this.config.accessToken };
  }

  @Post("access")
  @BeforeClaudeSignIn()
  @HttpCode(204)
  access(@Body() body: unknown, @Res({ passthrough: true }) res: Response): void {
    const token = typeof (body as { token?: unknown } | null)?.token === "string" ? (body as { token: string }).token : null;
    if (this.config.accessToken === null) throw badRequest("This Orbit Web has no access token configured.");
    if (token === null || !accessTokenMatches(this.config, token)) throw new ApiError(401, "access_token_invalid", "That is not this Orbit Web's access token.");
    res.cookie(ACCESS_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: this.config.secureCookie, path: "/", maxAge: ACCESS_COOKIE_MAX_AGE_MS });
  }
}

@Module({
  imports: [GovernanceModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
