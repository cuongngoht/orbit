// What a repository brings for Claude Code -- its skills, commands, agents, plugins -- as Orbit Web read it on the
// workspace's first fetch, and what Orbit Web did with each. Read from files only (regular files, no symlink, bounded):
// nothing here is the repository's settings, which are never loaded.

// A skill, command or agent: its name and description as its frontmatter says them, and where it was found.
export interface ProjectItem {
  name: string;
  description: string | null;
  // Relative to the repository root.
  path: string;
}

// What happened to one plugin the project declares or is.
//   declared   the project names it; not run ("Run project plugins" is off in Settings)
//   installing the CLI is fetching it
//   installed  installed and enabled for this project's runs only
//   loaded     part of the repository itself, loaded with --plugin-dir
//   failed     the CLI refused or could not fetch it (`detail` says what it said)
export const PROJECT_PLUGIN_STATES = ["declared", "installing", "installed", "loaded", "failed"] as const;

export type ProjectPluginState = (typeof PROJECT_PLUGIN_STATES)[number];

export interface ProjectPlugin {
  // `name@marketplace` for a declared plugin, the plugin's own name for one in the repository.
  id: string;
  kind: "declared" | "repository";
  // Where it comes from, as a person reads it: a marketplace, a path in the repository.
  source: string;
  // For a plugin in the repository: its directory, relative to the repository root ("." for the repository itself).
  path: string | null;
  state: ProjectPluginState;
  detail: string | null;
}

export interface ProjectMarketplace {
  name: string;
  source: string;
}

export interface ProjectInventory {
  // The repository it was read from (its display name), or null for a workspace with none.
  repository: string | null;
  loadedAt: string;
  skills: ProjectItem[];
  commands: ProjectItem[];
  agents: ProjectItem[];
  // A CLAUDE.md at the repository root (Claude Code reads it from the working directory itself).
  claudeMd: boolean;
  // Servers the repository's .mcp.json names: listed, never started.
  mcpServers: string[];
  marketplaces: ProjectMarketplace[];
  plugins: ProjectPlugin[];
  // Whether the repository's own skills, commands and agents are loaded for its runs (a plugin built for the session,
  // instructions only); false when there were none, or "Load project skills" is off.
  loaded: boolean;
  // More than the bounds allow was found; what is listed is a prefix.
  truncated: boolean;
}

// WHAT A PERSON CAN TYPE AFTER `/` IN A CHAT: the skills and commands of the plugins that chat's runs load, by the
// names Claude Code gives them -- `<plugin>:<skill directory>`, `<plugin>:<command path, ':' between folders>` -- read
// from those plugins' own files. A message that starts with one runs it (headless Claude Code reads the slash itself).
export interface SlashCommand {
  name: string;
  description: string | null;
  // What to type after the name, as the file's `argument-hint` says.
  argumentHint: string | null;
  kind: "skill" | "command";
  // Orbit's own (the plugin in the image), or the project's (a plugin built from, or in, the chat's repository).
  origin: "orbit" | "project";
}

// GET /api/sessions/:id/commands (an open chat), GET /api/commands?source=…&repository=… (a new one).
export interface SlashCommands {
  // The project's first, then Orbit's.
  commands: SlashCommand[];
  // One sentence when the project's part is not simply this chat's own: not read yet, read in an earlier chat of the
  // same repository, or switched off. Null otherwise.
  note: string | null;
}

// GET /api/customizations: what Claude Code is given, Orbit's own and each project's.
export interface OrbitCustomizations {
  version: string | null;
  skills: ProjectItem[];
  agents: ProjectItem[];
}

export interface ProjectCustomizations {
  sessionId: string;
  title: string;
  inventory: ProjectInventory;
}

export interface Customizations {
  orbit: OrbitCustomizations;
  projects: ProjectCustomizations[];
}
