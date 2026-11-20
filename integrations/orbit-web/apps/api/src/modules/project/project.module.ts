// What Claude Code is given beside the conversation: Orbit's own skills and agents (the plugin in the image), and each
// project's skills, commands, agents and plugins (read on its workspace's first fetch).
//
//   GET /api/sessions/:id/project   one chat's project inventory (null until its workspace is prepared)
//   GET /api/customizations         Orbit's own, and every chat's project
//
// A projection turns a project's session events into the app stream's `customizations.changed`, so Settings → Skills
// and Plugins follow without polling.
import { Controller, Get, Inject, Injectable, Module, Param, type OnModuleInit } from "@nestjs/common";
import type { Customizations, OrbitCustomizations, ProjectInventory, ProjectItem } from "@orbit-web/contracts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { ProjectStore, SessionStore } from "../../infra/storage/stores.js";
import { SettingsModule } from "../settings/settings.module.js";
import { frontmatter } from "./frontmatter.js";
import { isRegularDir, readSmall } from "./inventory.js";
import { ProjectService } from "./project.service.js";

// Orbit's own skills (`skills/<name>/SKILL.md`) and agents (`agents/*.md`), read once from the plugin directory.
export function readOrbitPlugin(pluginDir: string): OrbitCustomizations {
  const list = (dir: string) => (isRegularDir(dir) ? readdirSync(dir).sort() : []);
  const itemOf = (file: string, fallback: string, path: string): ProjectItem | null => {
    const text = readSmall(file);
    if (text === null) return null;
    const fm = frontmatter(text);
    return { name: fm.name ?? fallback, description: fm.description, path };
  };
  const skills = list(join(pluginDir, "skills"))
    .map((name) => itemOf(join(pluginDir, "skills", name, "SKILL.md"), name, `skills/${name}/SKILL.md`))
    .filter((i): i is ProjectItem => i !== null);
  const agents = list(join(pluginDir, "agents"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => itemOf(join(pluginDir, "agents", name), name.slice(0, -3), `agents/${name}`))
    .filter((i): i is ProjectItem => i !== null);
  return { version: versionOf(pluginDir), skills, agents };
}

function versionOf(pluginDir: string): string | null {
  try {
    const manifest = JSON.parse(readSmall(join(pluginDir, ".claude-plugin", "plugin.json")) ?? "{}") as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

@Injectable()
export class CustomizationsService implements OnModuleInit {
  private orbit: OrbitCustomizations | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ProjectStore) private readonly projects: ProjectStore,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["project.inventory", "project.plugin"] }, (e) => {
      if (e.sessionId !== null) this.bus.publishApp("customizations.changed", { sessionId: e.sessionId });
    });
  }

  all(): Customizations {
    this.orbit ??= readOrbitPlugin(this.config.pluginDir);
    const projects = this.projects.list().flatMap(({ sessionId, inventory }) => {
      const session = this.sessions.get(sessionId);
      return session === null ? [] : [{ sessionId, title: session.title, inventory }];
    });
    return { orbit: this.orbit, projects };
  }
}

@Controller()
export class ProjectController {
  constructor(
    @Inject(ProjectService) private readonly project: ProjectService,
    @Inject(CustomizationsService) private readonly customizations: CustomizationsService,
    @Inject(SessionStore) private readonly sessions: SessionStore,
  ) {}

  @Get("sessions/:id/project")
  inventory(@Param("id") id: string): { inventory: ProjectInventory | null } {
    if (!isSessionId(id) || this.sessions.get(id) === null) throw notFound("Session");
    return { inventory: this.project.get(id) };
  }

  @Get("customizations")
  all(): Customizations {
    return this.customizations.all();
  }
}

@Module({
  imports: [SettingsModule],
  providers: [ProjectService, CustomizationsService],
  controllers: [ProjectController],
  exports: [ProjectService],
})
export class ProjectModule {}
