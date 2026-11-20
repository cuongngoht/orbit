// WHAT A REPOSITORY BRINGS FOR CLAUDE CODE, read from its files on the workspace's first fetch: its skills
// (`.claude/skills/<name>/SKILL.md`), commands (`.claude/commands/**/*.md`), agents (`.claude/agents/*.md`), whether it
// has a CLAUDE.md, the servers its `.mcp.json` names, the plugins and marketplaces its `.claude/settings.json` declares
// (`enabledPlugins`, `extraKnownMarketplaces` -- nothing else of that file is read), and the plugins it is or holds
// (`.claude-plugin/plugin.json`, a `.claude-plugin/marketplace.json` of relative plugins).
//
// A repository is untrusted input: only regular files and directories are read (a symlink is skipped, so nothing
// outside the repository is reached), every count and size is bounded, and a file that does not parse is skipped.
import { lstatSync, readdirSync, readFileSync, type Stats } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ProjectItem, ProjectMarketplace } from "@orbit-web/contracts";
import { frontmatter } from "./frontmatter.js";

export const INVENTORY_LIMITS = { items: 200, fileBytes: 256 * 1024, depth: 4, entries: 2_000 } as const;

// A marketplace a project declares, in the form `claude plugin marketplace add` takes; `unknown` is listed only.
export type MarketplaceSource = { kind: "github"; repo: string } | { kind: "git"; url: string } | { kind: "url"; url: string } | { kind: "directory"; path: string } | { kind: "unknown"; said: string };

export interface DeclaredMarketplace extends ProjectMarketplace {
  location: MarketplaceSource;
}

export interface RepositoryPlugin {
  name: string;
  // Relative to the repository root ("." when the repository is the plugin).
  path: string;
}

export interface Readout {
  skills: ProjectItem[];
  commands: ProjectItem[];
  agents: ProjectItem[];
  claudeMd: boolean;
  mcpServers: string[];
  marketplaces: DeclaredMarketplace[];
  // `name@marketplace` ids the project enables.
  declaredPlugins: string[];
  repositoryPlugins: RepositoryPlugin[];
  truncated: boolean;
}

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}@[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

function stat(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

export const isRegularFile = (path: string): boolean => stat(path)?.isFile() === true;
export const isRegularDir = (path: string): boolean => stat(path)?.isDirectory() === true;

// `root` joined with `parts` when every directory on the way is a real one: lstat follows a symlink in any component
// but the last, so a symlinked `.claude` would otherwise lead out of the repository.
export function within(root: string, ...parts: string[]): string | null {
  let path = root;
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    if (i < parts.length - 1 && !isRegularDir(path)) return null;
  }
  return path;
}

// A regular file's text when it is small enough; null for anything else.
export function readSmall(path: string): string | null {
  const s = stat(path);
  if (s === null || !s.isFile() || s.size > INVENTORY_LIMITS.fileBytes) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path: string): Record<string, unknown> | null {
  const text = readSmall(path);
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function entries(dir: string): string[] {
  if (!isRegularDir(dir)) return [];
  try {
    return readdirSync(dir).sort().slice(0, INVENTORY_LIMITS.entries);
  } catch {
    return [];
  }
}

const posix = (path: string): string => path.split(sep).join("/");

const item = (root: string, file: string, fallbackName: string): ProjectItem | null => {
  const text = readSmall(file);
  if (text === null) return null;
  const fm = frontmatter(text);
  return { name: fm.name ?? fallbackName, description: fm.description, path: posix(relative(root, file)) };
};

function skills(root: string): ProjectItem[] {
  const dir = within(root, ".claude", "skills");
  if (dir === null) return [];
  return entries(dir)
    .filter((name) => isRegularDir(join(dir, name)))
    .map((name) => item(root, join(dir, name, "SKILL.md"), name))
    .filter((i): i is ProjectItem => i !== null);
}

// Commands may sit in subdirectories; Claude Code names those `dir:name`.
function commands(root: string, dir = within(root, ".claude", "commands"), depth = 0, prefix = ""): ProjectItem[] {
  if (dir === null || depth > INVENTORY_LIMITS.depth) return [];
  return entries(dir).flatMap((name) => {
    const path = join(dir, name);
    if (isRegularDir(path)) return commands(root, path, depth + 1, `${prefix}${name}:`);
    if (!name.endsWith(".md")) return [];
    const found = item(root, path, `${prefix}${name.slice(0, -3)}`);
    return found === null ? [] : [{ ...found, name: `${prefix}${name.slice(0, -3)}` }];
  });
}

function agents(root: string): ProjectItem[] {
  const dir = within(root, ".claude", "agents");
  if (dir === null) return [];
  return entries(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => item(root, join(dir, name), name.slice(0, -3)))
    .filter((i): i is ProjectItem => i !== null);
}

function mcpServers(root: string): string[] {
  const servers = readJson(join(root, ".mcp.json"))?.mcpServers;
  return typeof servers === "object" && servers !== null && !Array.isArray(servers) ? Object.keys(servers).slice(0, INVENTORY_LIMITS.items) : [];
}

const said = (source: Record<string, unknown>): string => JSON.stringify(source).slice(0, 200);

// One declared marketplace source, as `claude plugin marketplace add` takes it. A directory must be inside the
// repository; anything not understood is listed, never added.
export function locationOf(source: unknown): MarketplaceSource {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return { kind: "unknown", said: String(source).slice(0, 200) };
  const s = source as Record<string, unknown>;
  if (s.source === "github" && typeof s.repo === "string" && GITHUB_REPO.test(s.repo)) return { kind: "github", repo: s.repo };
  if (s.source === "git" && typeof s.url === "string" && /^https:\/\/[^\s@]+$/.test(s.url)) return { kind: "git", url: s.url };
  if (s.source === "url" && typeof s.url === "string" && /^https:\/\/[^\s@]+$/.test(s.url)) return { kind: "url", url: s.url };
  if (s.source === "directory" && typeof s.path === "string" && !s.path.startsWith("/") && !s.path.split(/[\\/]/).includes("..")) return { kind: "directory", path: s.path };
  return { kind: "unknown", said: said(s) };
}

const describe = (l: MarketplaceSource): string =>
  l.kind === "github" ? `GitHub ${l.repo}` : l.kind === "git" || l.kind === "url" ? l.url : l.kind === "directory" ? `./${l.path.replace(/^\.\//, "")}` : `not understood: ${l.said}`;

function settingsDeclarations(root: string): { marketplaces: DeclaredMarketplace[]; declaredPlugins: string[] } {
  const file = within(root, ".claude", "settings.json");
  const settings = file === null ? null : readJson(file);
  const enabled = settings?.enabledPlugins;
  const declaredPlugins =
    typeof enabled === "object" && enabled !== null && !Array.isArray(enabled)
      ? Object.entries(enabled)
          .filter(([id, on]) => on === true && PLUGIN_ID.test(id))
          .map(([id]) => id)
          .slice(0, INVENTORY_LIMITS.items)
      : [];
  const known = settings?.extraKnownMarketplaces;
  const marketplaces =
    typeof known === "object" && known !== null && !Array.isArray(known)
      ? Object.entries(known)
          .filter(([name]) => PLUGIN_NAME.test(name))
          .slice(0, INVENTORY_LIMITS.items)
          .map(([name, entry]) => {
            const location = locationOf(typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).source : entry);
            return { name, source: describe(location), location };
          })
      : [];
  return { marketplaces, declaredPlugins };
}

function repositoryPlugins(root: string): RepositoryPlugin[] {
  const manifest = (name: string) => {
    const file = within(root, ".claude-plugin", name);
    return file === null ? null : readJson(file);
  };
  const own = manifest("plugin.json");
  const found: RepositoryPlugin[] = typeof own?.name === "string" && PLUGIN_NAME.test(own.name) ? [{ name: own.name, path: "." }] : [];
  const listed = manifest("marketplace.json")?.plugins;
  for (const p of Array.isArray(listed) ? listed.slice(0, INVENTORY_LIMITS.items) : []) {
    const entry = typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
    const path = typeof entry.source === "string" ? entry.source.replace(/^\.\//, "").replace(/\/$/, "") : null;
    if (typeof entry.name !== "string" || !PLUGIN_NAME.test(entry.name) || path === null || path === "" || path.startsWith("/") || path.split("/").includes("..")) continue;
    const dir = within(root, ...path.split("/"));
    if (path === "." || dir === null || !isRegularDir(dir)) continue;
    if (!found.some((f) => f.name === entry.name)) found.push({ name: entry.name, path });
  }
  return found;
}

export function readRepository(root: string): Readout {
  const all = { skills: skills(root), commands: commands(root), agents: agents(root) };
  const truncated = Object.values(all).some((list) => list.length > INVENTORY_LIMITS.items);
  return {
    skills: all.skills.slice(0, INVENTORY_LIMITS.items),
    commands: all.commands.slice(0, INVENTORY_LIMITS.items),
    agents: all.agents.slice(0, INVENTORY_LIMITS.items),
    claudeMd: isRegularFile(join(root, "CLAUDE.md")),
    mcpServers: mcpServers(root),
    ...settingsDeclarations(root),
    repositoryPlugins: repositoryPlugins(root),
    truncated,
  };
}
