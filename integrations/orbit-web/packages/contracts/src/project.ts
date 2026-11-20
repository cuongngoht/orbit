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
  // instructions only).
  loaded: boolean;
  // More than the bounds allow was found; what is listed is a prefix.
  truncated: boolean;
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
