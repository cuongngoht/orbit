// SETTINGS → SYSTEM'S UPDATES: GET /api/system/updates says what was found the last time the publishers were asked (and
// asks nobody); POST /api/system/updates/check asks them now -- at most once a minute: within that, it answers what the
// last check found. Where ORBIT_WEB_UPDATE_CHECK is not "off", they are also asked a minute after start and once a day.
import { Controller, Get, HttpCode, Inject, Injectable, Logger, Post, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { UPDATE_COMPONENTS, type SystemUpdates, type UpdateComponent } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ToolchainService } from "./toolchain.service.js";
import { checkUpdates, HOW_TO_UPDATE, UPDATE_FEED, type FetchJson } from "./updates.js";

const MIN_INTERVAL_MS = 60_000;
const DAILY_MS = 24 * 60 * 60_000;

@Injectable()
export class UpdatesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Updates");
  private last: SystemUpdates | null = null;
  private running: Promise<SystemUpdates> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
    @Inject(UPDATE_FEED) private readonly feed: FetchJson,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.updateCheck) return;
    const run = () => void this.check().catch((err: unknown) => this.logger.warn(`the update check failed: ${err instanceof Error ? err.message : String(err)}`));
    this.timers = [setTimeout(run, 60_000), setInterval(run, DAILY_MS)];
    for (const t of this.timers) t.unref();
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  // What the last check found; before any, each component as not checked yet.
  async view(): Promise<SystemUpdates> {
    if (this.last !== null) return this.last;
    const installed = await this.installed();
    return { checkedAt: null, components: UPDATE_COMPONENTS.map((component) => ({ component, installed: installed[component], latest: null, state: "not_checked", security: null, detail: "Not checked yet." })), howToUpdate: HOW_TO_UPDATE };
  }

  check(): Promise<SystemUpdates> {
    if (this.last?.checkedAt && Date.now() - Date.parse(this.last.checkedAt) < MIN_INTERVAL_MS) return Promise.resolve(this.last);
    this.running ??= this.checkNow().finally(() => (this.running = null));
    return this.running;
  }

  private async checkNow(): Promise<SystemUpdates> {
    const components = await checkUpdates(await this.installed(), this.feed);
    this.last = { checkedAt: new Date().toISOString(), components, howToUpdate: HOW_TO_UPDATE };
    return this.last;
  }

  private async installed(): Promise<Record<UpdateComponent, string | null>> {
    const v = (await this.toolchain.get()).versions;
    return { claude: v.claude, codex: v.codex, gh: v.gh, az: v.az, node: v.node, orbit: v.orbit, agy: v.agy, git: v.git, python: v.python };
  }
}

@Controller("system/updates")
export class UpdatesController {
  constructor(@Inject(UpdatesService) private readonly updates: UpdatesService) {}

  @Get()
  view(): Promise<SystemUpdates> {
    return this.updates.view();
  }

  @Post("check")
  @HttpCode(200)
  check(): Promise<SystemUpdates> {
    return this.updates.check();
  }
}
