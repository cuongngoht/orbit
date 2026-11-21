// What Claude Code is given beside the conversation: Orbit's own skills and agents (the plugin in the image), and each
// project's skills, commands, agents and plugins (read on its workspace's first fetch).
//
//   GET /api/sessions/:id/project   one chat's project inventory (null until its workspace is prepared)
//   GET /api/customizations         Orbit's own, and every chat's project
//   GET /api/sessions/:id/commands  what a person can type after `/` in that chat: the skills and commands of the
//                                   plugins its runs load (slash-commands.ts), the project's first, then Orbit's
//   GET /api/commands               the same for a new chat: Orbit's, and -- with ?source=…&repository=… -- the
//                                   project's as an earlier chat of that repository read them (a repository is read
//                                   only once a chat opens it), said in a note
//
// A projection turns a project's session events into the app stream's `customizations.changed`, so Settings → Skills
// and Plugins follow without polling.
import { Controller, Get, Inject, Injectable, Logger, Module, Param, Query, type OnModuleInit } from "@nestjs/common";
import { REPOSITORY_SOURCES, type Customizations, type OrbitCustomizations, type ProjectInventory, type ProjectItem, type RepositorySource, type SlashCommand, type SlashCommands } from "@orbit-web/contracts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { badRequest, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { isSessionId } from "../../common/workspace-path.js";
import { ProjectStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { AccessModule } from "../access/access.module.js";
import { OwnershipService } from "../access/ownership.service.js";
import { ConnectionsModule } from "../connections/connections.module.js";
import { SettingsModule, SettingsService } from "../settings/settings.module.js";
import { frontmatter } from "./frontmatter.js";
import { isRegularDir, readSmall } from "./inventory.js";
import { ProjectService } from "./project.service.js";
import { pluginCommands } from "./slash-commands.js";

// What the slash menu says about the project's part when it is not simply the chat's own.
export const SLASH_NOTES = {
  notRead: "This repository's own skills are listed once a chat has opened it.",
  preparing: "This repository's own skills are listed once its workspace is ready.",
  off: "This repository's own skills are not loaded: “Load project skills” is off in Settings → Code.",
  earlier: (title: string) => `This repository's own skills as the chat “${title}” read them; a new chat reads them again.`,
} as const;

const hasOwn = (inventory: ProjectInventory): boolean => inventory.skills.length + inventory.commands.length > 0;

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
  private readonly logger = new Logger("Customizations");
  private orbit: OrbitCustomizations | null = null;
  private orbitSlash: SlashCommand[] | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ProjectStore) private readonly projects: ProjectStore,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(ProjectService) private readonly project: ProjectService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  // A chat's project changed: the pages of whoever may open that chat (its owner, and who it is shared with) are told.
  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["project.inventory", "project.plugin"] }, (e) => {
      if (e.sessionId !== null) void this.changed(e.sessionId);
    });
  }

  private async changed(sessionId: string): Promise<void> {
    try {
      const session = await this.sessions.get(sessionId);
      if (session !== null) this.bus.publishApp("customizations.changed", { sessionId }, await this.ownership.audience(session));
    } catch (err) {
      this.logger.warn(`customizations.changed for ${sessionId} was not sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Orbit's own, and the projects of the chats this account may open (another account's are not its to see).
  async all(visible: readonly SessionRecord[]): Promise<Customizations> {
    this.orbit ??= readOrbitPlugin(this.config.pluginDir);
    const titles = new Map(visible.map((s) => [s.id, s.title]));
    const projects = (await this.projects.list([...titles.keys()])).flatMap(({ sessionId, inventory }) => {
      const title = titles.get(sessionId);
      return title === undefined ? [] : [{ sessionId, title, inventory }];
    });
    return { orbit: this.orbit, projects };
  }

  // An open chat: what its next run loads (the project's plugins, as `runtime` names them, then Orbit's).
  async forSession(session: SessionRecord): Promise<SlashCommands> {
    const project = (await this.project.runtime(session)).pluginDirs.flatMap((dir) => pluginCommands(dir, "project"));
    return { commands: [...project, ...this.orbitCommands()], note: this.sessionNote(session, await this.projects.get(session.id)) };
  }

  // A new chat: Orbit's, and the project's as the newest earlier chat of that repository that loaded them read them --
  // an earlier chat this account may open. Whether project skills load is the account's own preference.
  async forRepository(source: RepositorySource | null, repositoryId: string | null, accountId: string, visible: readonly SessionRecord[]): Promise<SlashCommands> {
    const orbit = this.orbitCommands();
    if (source === null || repositoryId === null) return { commands: orbit, note: null };
    if (!(await this.settings.get(accountId)).projectSkills) return { commands: orbit, note: SLASH_NOTES.off };
    const earlier: { session: SessionRecord; inventory: ProjectInventory }[] = [];
    for (const s of visible) {
      const inventory = s.source === source && s.repositoryId === repositoryId ? await this.projects.get(s.id) : null;
      if (inventory !== null) earlier.push({ session: s, inventory });
    }
    const loaded = earlier.find((e) => e.inventory.loaded);
    if (loaded !== undefined) return { commands: [...pluginCommands(this.project.pluginDir(loaded.session.id), "project"), ...orbit], note: SLASH_NOTES.earlier(loaded.session.title) };
    return { commands: orbit, note: earlier[0] !== undefined && !hasOwn(earlier[0].inventory) ? null : SLASH_NOTES.notRead };
  }

  private orbitCommands(): SlashCommand[] {
    this.orbitSlash ??= pluginCommands(this.config.pluginDir, "orbit");
    return this.orbitSlash;
  }

  private sessionNote(session: SessionRecord, inventory: ProjectInventory | null): string | null {
    if (session.repository === null) return null;
    if (inventory === null) return session.status === "preparing" ? SLASH_NOTES.preparing : null;
    return hasOwn(inventory) && !inventory.loaded ? SLASH_NOTES.off : null;
  }
}

const REPOSITORY_ID_MAX = 300;

@Controller()
export class ProjectController {
  constructor(
    @Inject(ProjectService) private readonly project: ProjectService,
    @Inject(CustomizationsService) private readonly customizations: CustomizationsService,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  @Get("sessions/:id/project")
  async inventory(@Param("id") id: string): Promise<{ inventory: ProjectInventory | null }> {
    if (!isSessionId(id) || (await this.sessions.get(id)) === null) throw notFound("Session");
    return { inventory: await this.project.get(id) };
  }

  @Get("customizations")
  async all(): Promise<Customizations> {
    return this.customizations.all(await this.ownership.visible(viewer()));
  }

  @Get("sessions/:id/commands")
  async sessionCommands(@Param("id") id: string): Promise<SlashCommands> {
    const session = isSessionId(id) ? await this.sessions.get(id) : null;
    if (session === null) throw notFound("Session");
    return this.customizations.forSession(session);
  }

  @Get("commands")
  async commands(@Query("source") source?: unknown, @Query("repository") repository?: unknown): Promise<SlashCommands> {
    const who = viewer();
    if (source === undefined && repository === undefined) return this.customizations.forRepository(null, null, who.accountId, []);
    const known = typeof source === "string" && (REPOSITORY_SOURCES as readonly string[]).includes(source);
    if (!known || typeof repository !== "string" || repository.length === 0 || repository.length > REPOSITORY_ID_MAX) throw badRequest(`source must be ${REPOSITORY_SOURCES.join(" or ")}, with the repository's id`);
    return this.customizations.forRepository(source as RepositorySource, repository, who.accountId, await this.ownership.visible(who));
  }
}

@Module({
  imports: [SettingsModule, AccessModule, ConnectionsModule],
  providers: [ProjectService, CustomizationsService],
  controllers: [ProjectController],
  exports: [ProjectService],
})
export class ProjectModule {}
