// What is installed here: the claude, gh and git programs, the Orbit plugin, and the versions the image was built
// with. Versions come from the image's build-info.json when it has one, else from the programs themselves.
import { Inject, Injectable } from "@nestjs/common";
import { ORBIT_WEB_VERSION, type BuildVersions, type ComponentCheck } from "@orbit-web/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { azureEnv, baseEnv } from "../../infra/process/env.js";
import { endedHow, succeeded, type ProcessPort } from "../../infra/process/process.port.js";

export interface Toolchain {
  claude: ComponentCheck;
  gh: ComponentCheck;
  git: ComponentCheck;
  az: ComponentCheck;
  orbitPlugin: ComponentCheck;
  versions: BuildVersions;
}

interface BuildInfo {
  web?: string;
  orbit?: string;
  orbitCommit?: string;
  claude?: string;
  gh?: string;
  git?: string;
  az?: string;
}

const CACHE_MS = 30_000;

// "2.1.328 (Claude Code)" -> 2.1.328; "gh version 2.89.0 (2026-03-26)" -> 2.89.0; "git version 2.43.0" -> 2.43.0
export const versionIn = (text: string): string | null => /\b(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)\b/.exec(text)?.[1] ?? null;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

@Injectable()
export class ToolchainService {
  private cached: { at: number; value: Promise<Toolchain> } | null = null;
  // The Azure CLI takes a second to start and is in the image or not: asked once.
  private azure: Promise<{ check: ComponentCheck; version: string | null }> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  get(): Promise<Toolchain> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = this.probe();
    this.cached = { at: Date.now(), value };
    return value;
  }

  private async probe(): Promise<Toolchain> {
    this.azure ??= this.version(this.config.binaries.az, ["version", "--output", "json"], azureEnv(this.config));
    const [claude, gh, git, az] = await Promise.all([this.version(this.config.binaries.claude), this.version(this.config.binaries.gh), this.version(this.config.binaries.git), this.azure]);
    const plugin = this.plugin();
    const info = readJson<BuildInfo>(this.config.buildInfoFile) ?? {};
    return {
      claude: claude.check,
      gh: gh.check,
      git: git.check,
      az: az.check,
      orbitPlugin: plugin.check,
      versions: {
        web: info.web ?? ORBIT_WEB_VERSION,
        orbit: plugin.version ?? info.orbit ?? null,
        orbitCommit: info.orbitCommit ?? null,
        claude: claude.version ?? info.claude ?? null,
        gh: gh.version ?? info.gh ?? null,
        git: git.version ?? info.git ?? null,
        az: az.version ?? info.az ?? null,
        node: process.versions.node,
      },
    };
  }

  private async version(file: string, args = ["--version"], env = baseEnv(this.config)): Promise<{ check: ComponentCheck; version: string | null }> {
    const r = await this.process.run(file, args, { cwd: this.config.data.home, env, timeoutMs: 60_000 });
    if (!succeeded(r)) return { check: { ok: false, detail: `not usable: ${endedHow(r)}` }, version: null };
    const version = versionIn(r.stdout);
    return { check: { ok: true, detail: version }, version };
  }

  // The plugin is present when its manifest names it "orbit".
  private plugin(): { check: ComponentCheck; version: string | null } {
    const manifest = readJson<{ name?: string; version?: string }>(join(this.config.pluginDir, ".claude-plugin", "plugin.json"));
    if (manifest?.name !== "orbit") return { check: { ok: false, detail: "the Orbit plugin is not installed" }, version: null };
    return { check: { ok: true, detail: manifest.version ?? null }, version: manifest.version ?? null };
  }
}
