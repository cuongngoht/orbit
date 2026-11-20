// THE SESSION'S PROJECT PLUGIN: Claude Code runs here with `--setting-sources user` (a repository's settings -- its env,
// its hooks -- are never loaded), and that also leaves a repository's own `.claude/skills`, `.claude/commands` and
// `.claude/agents` unread. Claude Code's documented way to carry them is a plugin made from those three directories,
// loaded with `--plugin-dir`: so on the workspace's first fetch they are COPIED (a snapshot, regular files only, no
// symlink, bounded) into /data/sessions/<id>/project-plugin, under a plugin named after the repository.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { within } from "./inventory.js";

export const PLUGIN_COPY_LIMITS = { files: 2_000, bytes: 20 * 1024 * 1024, fileBytes: 2 * 1024 * 1024, depth: 8 } as const;

interface Budget {
  files: number;
  bytes: number;
  truncated: boolean;
}

// A plugin name Claude Code accepts, from the repository's name (`owner/name`, `org/project/name`): its last part,
// lower-case, letters, digits and hyphens. Never "orbit", the plugin the image ships.
export function pluginNameOf(repository: string | null): string {
  const last = (repository ?? "workspace").split("/").at(-1) ?? "workspace";
  const name = last.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "workspace";
  return name === "orbit" ? "orbit-project" : name;
}

function copyTree(from: string, to: string, budget: Budget, depth = 0): number {
  if (depth > PLUGIN_COPY_LIMITS.depth) return 0;
  let copied = 0;
  mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(from).sort()) {
    const source = join(from, name);
    const s = lstatSync(source);
    if (s.isDirectory()) copied += copyTree(source, join(to, name), budget, depth + 1);
    if (!s.isFile()) continue;
    if (budget.files >= PLUGIN_COPY_LIMITS.files || budget.bytes + s.size > PLUGIN_COPY_LIMITS.bytes || s.size > PLUGIN_COPY_LIMITS.fileBytes) {
      budget.truncated = true;
      continue;
    }
    copyFileSync(source, join(to, name));
    budget.files += 1;
    budget.bytes += s.size;
    copied += 1;
  }
  return copied;
}

export interface BuiltPlugin {
  // Whether there was anything to carry (a plugin with no skill, command or agent is not built).
  built: boolean;
  name: string;
  files: number;
  truncated: boolean;
}

// Builds (or rebuilds) the plugin at `target` from the repository at `root`.
export function buildProjectPlugin(root: string, target: string, repository: string | null): BuiltPlugin {
  rmSync(target, { recursive: true, force: true });
  const name = pluginNameOf(repository);
  const budget: Budget = { files: 0, bytes: 0, truncated: false };
  let files = 0;
  for (const part of ["skills", "commands", "agents"]) {
    const from = within(root, ".claude", part);
    if (from !== null && lstatSync(from, { throwIfNoEntry: false })?.isDirectory() === true) files += copyTree(from, join(target, part), budget);
  }
  if (files === 0) {
    rmSync(target, { recursive: true, force: true });
    return { built: false, name, files: 0, truncated: budget.truncated };
  }
  mkdirSync(join(target, ".claude-plugin"), { recursive: true, mode: 0o700 });
  const manifest = { name, version: "0.0.0", description: `The skills, commands and agents of ${repository ?? "this workspace"}, as Orbit Web read them on the workspace's first fetch.` };
  writeFileSync(join(target, ".claude-plugin", "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { built: true, name, files, truncated: budget.truncated };
}
