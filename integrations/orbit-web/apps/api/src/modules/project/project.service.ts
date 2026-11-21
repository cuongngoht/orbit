// A PROJECT'S SKILLS AND PLUGINS: read on the workspace's first fetch (the "project" step), kept beside the chat, and
// loaded for that chat's runs -- and only those:
//
//   the repository's .claude/skills, commands, agents  unless a person turned off "Load project skills" (on by
//                                                      default): a plugin built for the session (project-plugin.ts),
//                                                      --plugin-dir. Instructions only: frontmatter rebuilt from an
//                                                      allowlist (no hooks, no allowed-tools), pre-run `!` commands
//                                                      made text, no hook or MCP server of its own.
//   a plugin the repository is, or holds               only when a person turned on "Run project plugins"
//                                                      (Settings → Code; off by default): --plugin-dir that directory
//   a plugin the project declares (name@marketplace)   only then too: `claude plugin marketplace add` (once),
//                                                      `claude plugin install --scope user`, then `claude plugin
//                                                      disable --scope user` (so no other chat loads it -- and if that
//                                                      fails, `claude plugin uninstall`), and `--settings
//                                                      {"enabledPlugins": …}` on this project's runs
//
// A plugin RUNS CODE -- hooks at session start that no classifier reviews, MCP servers -- in this container, where the
// sign-ins are: that is why it waits for a person's switch. The repository's settings (env, hooks, permissions) are
// never loaded, and its .mcp.json servers are listed, never started. Every step is an event; a step that fails is
// reported in the inventory and never fails the workspace.
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ProjectInventory, ProjectPlugin } from "@orbit-web/contracts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { Db } from "../../infra/db/db.js";
import { baseEnv, claudeEnv } from "../../infra/process/env.js";
import { endedHow, succeeded, type ProcessPort, type RunResult } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { ProjectStore, type SessionRecord } from "../../infra/storage/stores.js";
import { SettingsService } from "../settings/settings.module.js";
import { isRegularDir, readRepository, within, type DeclaredMarketplace, type Readout } from "./inventory.js";
import { buildProjectPlugin, type BuiltPlugin } from "./project-plugin.js";

// The same reading, as a program the agent's placement runs (runner/project-load.ts): beside this module in the build.
const PROJECT_LOAD = fileURLToPath(new URL("../../runner/project-load.js", import.meta.url));

const CLI_TIMEOUT_MS = 3 * 60_000;

const marketplaceOf = (id: string): string => id.slice(id.indexOf("@") + 1);

function parseList(stdout: string, key: "id" | "name"): Set<string> {
  try {
    const rows = JSON.parse(stdout) as unknown;
    return new Set(Array.isArray(rows) ? rows.flatMap((r) => (typeof r === "object" && r !== null && typeof (r as Record<string, unknown>)[key] === "string" ? [(r as Record<string, string>)[key] as string] : [])) : []);
  } catch {
    return new Set();
  }
}

export interface ProjectRuntime {
  // Directories to load with --plugin-dir, beside Orbit's own.
  pluginDirs: string[];
  // The declared plugins this chat's runs enable (`--settings`); empty when none installed.
  enabledPlugins: Record<string, true>;
}

@Injectable()
export class ProjectService {
  private readonly logger = new Logger("Project");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(ProjectStore) private readonly store: ProjectStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(Db) private readonly db: Db,
  ) {}

  pluginDir(sessionId: string): string {
    return join(this.config.data.sessions, sessionId, "project-plugin");
  }

  get(sessionId: string): Promise<ProjectInventory | null> {
    return this.store.get(sessionId);
  }

  // The "project" step of preparing a workspace. Never throws: what fails is said in the inventory.
  async load(session: SessionRecord): Promise<ProjectInventory> {
    try {
      // The chat's own account decides what its project may run.
      const prefs = await this.settings.get(session.accountId);
      const runPlugins = prefs.projectPlugins;
      const { readout, built } = await this.read(session, prefs.projectSkills);
      const inventory = await this.save(session.id, this.inventoryOf(session, readout, runPlugins, built?.built === true, built?.truncated === true));
      return runPlugins ? await this.installDeclared(session, inventory, readout.marketplaces) : inventory;
    } catch (err) {
      this.logger.warn(`the project of ${session.id} could not be read: ${err instanceof Error ? err.message : String(err)}`);
      return this.save(session.id, this.inventoryOf(session, null, false, false, false));
    }
  }

  // The repository's project and the session's project plugin: read in this process (single deployment), or by the
  // agent's own placement (governed) -- the control plane never reads or writes what the agent can write.
  private async read(session: SessionRecord, build: boolean): Promise<{ readout: Readout; built: BuiltPlugin | null }> {
    if (this.config.governance.deployment !== "governed") return { readout: readRepository(session.workspacePath), built: build ? buildProjectPlugin(session.workspacePath, this.pluginDir(session.id), session.repository) : null };
    const r = await this.process.run(this.config.binaries.node, [PROJECT_LOAD, session.workspacePath, this.pluginDir(session.id), session.repository ?? "", build ? "1" : "0"], { cwd: "/", env: baseEnv(this.config), timeoutMs: CLI_TIMEOUT_MS, maxOutputBytes: 8 * 1024 * 1024 });
    if (!succeeded(r)) throw new Error(`the project could not be read (${endedHow(r)}): ${tail(r.stderr, 2)}`);
    return JSON.parse(r.stdout) as { readout: Readout; built: BuiltPlugin | null };
  }

  // What a run of this chat loads beside Orbit: the project plugin, the repository's own plugins, and the declared
  // plugins that installed.
  async runtime(session: SessionRecord): Promise<ProjectRuntime> {
    const inventory = await this.store.get(session.id);
    if (inventory === null) return { pluginDirs: [], enabledPlugins: {} };
    const dirs: string[] = [];
    if (inventory.loaded && isRegularDir(this.pluginDir(session.id))) dirs.push(this.pluginDir(session.id));
    for (const p of inventory.plugins) {
      if (p.kind !== "repository" || p.state !== "loaded" || p.path === null) continue;
      const dir = p.path === "." ? session.workspacePath : within(session.workspacePath, ...p.path.split("/"));
      if (dir !== null && isRegularDir(dir)) dirs.push(dir);
    }
    const enabledPlugins = Object.fromEntries(inventory.plugins.filter((p) => p.kind === "declared" && p.state === "installed").map((p) => [p.id, true as const]));
    return { pluginDirs: dirs, enabledPlugins };
  }

  private inventoryOf(session: SessionRecord, readout: Readout | null, runPlugins: boolean, built: boolean, truncated: boolean): ProjectInventory {
    const off = runPlugins ? null : "Not run: a plugin runs code (hooks, MCP servers) in this container. Turn on “Run project plugins” in Settings → Code to load the plugins of the repositories you open.";
    const plugins: ProjectPlugin[] = [
      ...(readout?.repositoryPlugins ?? []).map((p) => ({ id: p.name, kind: "repository" as const, source: p.path === "." ? "this repository" : `./${p.path}`, path: p.path, state: runPlugins ? ("loaded" as const) : ("declared" as const), detail: off })),
      ...(readout?.declaredPlugins ?? []).map((id) => ({ id, kind: "declared" as const, source: `marketplace ${marketplaceOf(id)}`, path: null, state: "declared" as const, detail: off })),
    ];
    return {
      repository: session.repository,
      loadedAt: new Date().toISOString(),
      skills: readout?.skills ?? [],
      commands: readout?.commands ?? [],
      agents: readout?.agents ?? [],
      claudeMd: readout?.claudeMd ?? false,
      mcpServers: readout?.mcpServers ?? [],
      marketplaces: (readout?.marketplaces ?? []).map(({ name, source }) => ({ name, source })),
      plugins,
      loaded: built,
      truncated: (readout?.truncated ?? false) || truncated,
    };
  }

  // Kept and told together: the event is journaled in the transaction that keeps the inventory.
  private async save(sessionId: string, inventory: ProjectInventory): Promise<ProjectInventory> {
    await this.db.tx(async () => {
      await this.store.set(sessionId, inventory);
      await this.bus.publishSession(sessionId, "project.inventory", { inventory });
    });
    return inventory;
  }

  private async setPlugin(sessionId: string, inventory: ProjectInventory, plugin: ProjectPlugin): Promise<ProjectInventory> {
    const next = { ...inventory, plugins: inventory.plugins.map((p) => (p.id === plugin.id && p.kind === plugin.kind ? plugin : p)) };
    await this.db.tx(async () => {
      await this.store.set(sessionId, next);
      await this.bus.publishSession(sessionId, "project.plugin", { plugin });
    });
    return next;
  }

  private async installDeclared(session: SessionRecord, start: ProjectInventory, marketplaces: DeclaredMarketplace[]): Promise<ProjectInventory> {
    const declared = start.plugins.filter((p) => p.kind === "declared");
    if (declared.length === 0) return start;
    const installed = parseList((await this.claude(["plugin", "list", "--json"])).stdout, "id");
    const known = parseList((await this.claude(["plugin", "marketplace", "list", "--json"])).stdout, "name");
    const added = new Map<string, string | null>();
    let inventory = start;
    for (const plugin of declared) {
      const marketplace = marketplaceOf(plugin.id);
      if (!added.has(marketplace)) added.set(marketplace, known.has(marketplace) ? null : await this.addMarketplace(session, marketplaces.find((m) => m.name === marketplace) ?? null));
      inventory = await this.setPlugin(session.id, inventory, { ...plugin, state: "installing", detail: null });
      inventory = await this.setPlugin(session.id, inventory, await this.install(plugin, installed.has(plugin.id), added.get(marketplace) ?? null));
    }
    return inventory;
  }

  // Adds a marketplace the project declares; the CLI's words when it could not (null when it did, or when the
  // marketplace is not declared here and may be one the CLI already knows).
  private async addMarketplace(session: SessionRecord, marketplace: DeclaredMarketplace | null): Promise<string | null> {
    if (marketplace === null) return null;
    const l = marketplace.location;
    const dir = l.kind === "directory" ? within(session.workspacePath, ...l.path.replace(/^\.\//, "").split("/")) : null;
    const arg = l.kind === "github" ? l.repo : l.kind === "git" || l.kind === "url" ? l.url : dir !== null && isRegularDir(dir) ? dir : null;
    if (arg === null) return `The marketplace ${marketplace.name} is not one Orbit Web can add (${marketplace.source}).`;
    const r = await this.claude(["plugin", "marketplace", "add", arg]);
    return succeeded(r) ? null : `claude plugin marketplace add ${marketplace.name} ${endedHow(r)}: ${tail(r.stderr || r.stdout, 2)}`;
  }

  private async install(plugin: ProjectPlugin, alreadyInstalled: boolean, marketplaceProblem: string | null): Promise<ProjectPlugin> {
    if (alreadyInstalled) return { ...plugin, state: "installed", detail: "Already installed here; enabled for this project's chats." };
    const r = await this.claude(["plugin", "install", plugin.id, "--scope", "user"]);
    if (!succeeded(r)) return { ...plugin, state: "failed", detail: marketplaceProblem ?? `claude plugin install ${endedHow(r)}: ${tail(r.stderr || r.stdout, 2)}` };
    // Installed for this project's chats only: switched off for the user, then enabled per run. A plugin that cannot be
    // switched off would run in every chat, so it is uninstalled instead.
    const off = await this.claude(["plugin", "disable", plugin.id, "--scope", "user"]);
    if (succeeded(off)) return { ...plugin, state: "installed", detail: null };
    const removed = await this.claude(["plugin", "uninstall", plugin.id, "--scope", "user"]);
    const after = succeeded(removed) ? "so it was uninstalled" : `and uninstalling it failed too (${tail(removed.stderr || removed.stdout, 2)}) -- remove it with \`claude plugin uninstall ${plugin.id}\``;
    return { ...plugin, state: "failed", detail: `It could not be switched off for other chats (${tail(off.stderr || off.stdout, 2)}), ${after}.` };
  }

  private claude(args: string[]): Promise<RunResult> {
    return this.process.run(this.config.binaries.claude, args, { cwd: this.config.data.home, env: claudeEnv(this.config), timeoutMs: CLI_TIMEOUT_MS });
  }
}
