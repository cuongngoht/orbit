// THE SLASH MENU'S SOURCE: what a person can type after `/` in a chat, read from the plugin directories that chat's runs
// load -- Orbit's own, and the project's (project.service.ts `runtime`) -- by the names Claude Code gives them: a skill
// is `<plugin>:<its directory>` (never its frontmatter name), a command `<plugin>:<its path, ':' between folders>`, and
// a skill whose frontmatter says `user-invocable: false` is not one a person runs. The plugin is named by its own
// manifest. Read like a repository (inventory.ts): regular files and directories only, never through a symlink,
// bounded, and a file that does not parse is skipped.
import type { SlashCommand } from "@orbit-web/contracts";
import { join } from "node:path";
import { frontmatter, frontmatterValue } from "./frontmatter.js";
import { entries, INVENTORY_LIMITS, isRegularDir, readSmall, within } from "./inventory.js";

const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

type Origin = SlashCommand["origin"];

function manifestName(dir: string): string | null {
  const file = within(dir, ".claude-plugin", "plugin.json");
  const text = file === null ? null : readSmall(file);
  if (text === null) return null;
  try {
    const name = (JSON.parse(text) as { name?: unknown }).name;
    return typeof name === "string" && PLUGIN_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

function commandOf(text: string, name: string, kind: SlashCommand["kind"], origin: Origin): SlashCommand {
  return { name, description: frontmatter(text).description, argumentHint: frontmatterValue(text, "argument-hint"), kind, origin };
}

function skills(dir: string, plugin: string, origin: Origin): SlashCommand[] {
  const root = within(dir, "skills");
  if (root === null || !isRegularDir(root)) return [];
  return entries(root).flatMap((name) => {
    const text = isRegularDir(join(root, name)) ? readSmall(join(root, name, "SKILL.md")) : null;
    if (text === null || frontmatterValue(text, "user-invocable") === "false") return [];
    return [commandOf(text, `${plugin}:${name}`, "skill", origin)];
  });
}

function commands(dir: string, plugin: string, origin: Origin, depth = 0, prefix = ""): SlashCommand[] {
  if (depth > INVENTORY_LIMITS.depth || !isRegularDir(dir)) return [];
  return entries(dir).flatMap((name) => {
    const path = join(dir, name);
    if (isRegularDir(path)) return commands(path, plugin, origin, depth + 1, `${prefix}${name}:`);
    const text = name.endsWith(".md") ? readSmall(path) : null;
    return text === null ? [] : [commandOf(text, `${plugin}:${prefix}${name.slice(0, -3)}`, "command", origin)];
  });
}

// One plugin directory's skills, then its commands; nothing when it has no manifest name Claude Code would accept. The
// directory is one Orbit Web chose (its plugin, a session's, a repository's that `runtime` checked); what is inside it
// is read as untrusted.
export function pluginCommands(dir: string, origin: Origin): SlashCommand[] {
  const plugin = manifestName(dir);
  if (plugin === null) return [];
  const root = within(dir, "commands");
  return [...skills(dir, plugin, origin).slice(0, INVENTORY_LIMITS.items), ...(root === null ? [] : commands(root, plugin, origin)).slice(0, INVENTORY_LIMITS.items)];
}
