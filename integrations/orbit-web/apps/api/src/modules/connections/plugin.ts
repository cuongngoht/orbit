// THE ORBIT PLUGIN as this installation has it: its version (its manifest) and a DIGEST of what it is -- the SHA-256 of
// every file of the parts Claude Code loads and runs from it (its manifest, hooks, skills, agents, commands and the code
// they call), path by path. An account owner's consent to load it (plugin_grants) is for exactly one digest: an
// upgraded plugin is a new one, and is not loaded until its owner confirms it.
//
// Read once per process (the plugin directory is the image's, read-only), and never through a symbolic link.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PluginInfo {
  installed: boolean;
  version: string | null;
  digest: string | null;
}

// What of the plugin directory makes the plugin: what Claude Code loads, and what those parts run.
const PARTS = [".claude-plugin", "hooks", "skills", "agents", "commands", "cli", "src", "catalog", "templates", "schemas", "hooks.json", "plugin.json", "package.json", ".mcp.json"];
const SKIP = new Set(["node_modules", ".git"]);
const MAX_FILES = 20_000;

async function filesOf(root: string, rel: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
    if (e.isDirectory()) await filesOf(root, path, out);
    else if (e.isFile()) out.push(path);
  }
}

async function readInfo(dir: string): Promise<PluginInfo> {
  let version: string | null = null;
  try {
    const manifest = JSON.parse(await readFile(join(dir, ".claude-plugin", "plugin.json"), "utf8")) as { name?: unknown; version?: unknown };
    if (manifest.name !== "orbit") return { installed: false, version: null, digest: null };
    version = typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return { installed: false, version: null, digest: null };
  }
  const files: string[] = [];
  const top = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const part of PARTS) {
    const entry = top.find((e) => e.name === part);
    if (entry === undefined || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await filesOf(dir, part, files);
    else if (entry.isFile()) files.push(part);
  }
  const all = createHash("sha256");
  for (const path of files) {
    const bytes = await readFile(join(dir, path)).catch(() => null);
    if (bytes === null) continue;
    all.update(`${path}\0${createHash("sha256").update(bytes).digest("hex")}\n`);
  }
  return { installed: true, version, digest: all.digest("hex") };
}

const known = new Map<string, Promise<PluginInfo>>();

// The plugin at `dir`, read once.
export function orbitPlugin(dir: string): Promise<PluginInfo> {
  let info = known.get(dir);
  if (info === undefined) {
    info = readInfo(dir);
    known.set(dir, info);
  }
  return info;
}
