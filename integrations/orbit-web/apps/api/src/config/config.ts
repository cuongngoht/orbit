// Orbit Web's configuration, read once from the environment at start. Everything an operator may change is an
// ORBIT_WEB_* variable (or ORBIT_PLUGIN_DIR); nothing is read from a file the browser could reach.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DataDirs {
  root: string;
  app: string;
  claude: string;
  github: string;
  azure: string;
  orbit: string;
  sessions: string;
  workspaces: string;
  home: string;
}

export interface Limits {
  // A sign-in that nobody finishes is stopped after this long (GitHub's device codes expire after 15 minutes).
  loginTimeoutMs: number;
  // A short CLI call (a status, a version, an API read).
  commandTimeoutMs: number;
  // Cloning one repository.
  cloneTimeoutMs: number;
  // SIGINT, then SIGTERM after this, then SIGKILL after twice this.
  stopGraceMs: number;
  // How often the Orbit panel may be read again while a run is active.
  orbitRefreshMs: number;
}

export interface AppConfig {
  port: number;
  bind: string;
  data: DataDirs;
  pluginDir: string;
  webDist: string | null;
  buildInfoFile: string;
  allowedHosts: string[];
  accessToken: string | null;
  // The access cookie is marked Secure: set when Orbit Web is reached through an HTTPS proxy.
  secureCookie: boolean;
  maxBudgetUsd: number | null;
  binaries: { claude: string; gh: string; git: string; az: string; node: string };
  // The server's own environment: the only place allow-listed variables are copied from for a child process.
  sourceEnv: Readonly<Record<string, string | undefined>>;
  limits: Limits;
}

export class ConfigError extends Error {}

// Loopback names: the only Host values accepted unless an operator widens the list (and then sets a token).
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

export const DEFAULT_LIMITS: Limits = {
  loginTimeoutMs: 15 * 60_000,
  commandTimeoutMs: 30_000,
  cloneTimeoutMs: 15 * 60_000,
  stopGraceMs: 5_000,
  orbitRefreshMs: 4_000,
};

export function dataDirs(root: string): DataDirs {
  return {
    root,
    app: join(root, "app"),
    claude: join(root, "claude"),
    github: join(root, "github"),
    azure: join(root, "azure"),
    orbit: join(root, "orbit"),
    sessions: join(root, "sessions"),
    workspaces: join(root, "workspaces"),
    home: join(root, "home"),
  };
}

const positiveInt = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new ConfigError(`${name} must be a port number`);
  return n;
};

const budget = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError("ORBIT_WEB_MAX_BUDGET_USD must be a positive number of US dollars");
  return n;
};

const absolute = (raw: string | undefined, fallback: string, name: string): string => {
  const value = raw && raw.length > 0 ? raw : fallback;
  if (!isAbsolute(value)) throw new ConfigError(`${name} must be an absolute path`);
  return resolve(value);
};

const hostList = (raw: string | undefined): string[] =>
  (raw ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);

// The built web app sits beside the API in the image (and in the workspace): apps/web/dist.
function defaultWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, "..", "..", "..", "web", "dist");
  return existsSync(join(candidate, "index.html")) ? candidate : null;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const extraHosts = hostList(env.ORBIT_WEB_ALLOWED_HOSTS);
  const accessToken = env.ORBIT_WEB_ACCESS_TOKEN && env.ORBIT_WEB_ACCESS_TOKEN.length > 0 ? env.ORBIT_WEB_ACCESS_TOKEN : null;
  const widened = extraHosts.filter((h) => !LOOPBACK_HOSTS.includes(h));
  if (widened.length > 0 && accessToken === null) {
    throw new ConfigError(`ORBIT_WEB_ALLOWED_HOSTS names ${widened.join(", ")} beyond this machine: set ORBIT_WEB_ACCESS_TOKEN as well, or Orbit Web would answer anyone who can reach it`);
  }
  if (accessToken !== null && accessToken.length < 16) throw new ConfigError("ORBIT_WEB_ACCESS_TOKEN must be at least 16 characters");
  return {
    port: positiveInt(env.ORBIT_WEB_PORT, 3000, "ORBIT_WEB_PORT"),
    bind: env.ORBIT_WEB_BIND && env.ORBIT_WEB_BIND.length > 0 ? env.ORBIT_WEB_BIND : "127.0.0.1",
    data: dataDirs(absolute(env.ORBIT_WEB_DATA_DIR, "/data", "ORBIT_WEB_DATA_DIR")),
    pluginDir: absolute(env.ORBIT_PLUGIN_DIR, "/opt/orbit/plugin", "ORBIT_PLUGIN_DIR"),
    webDist: env.ORBIT_WEB_STATIC_DIR ? absolute(env.ORBIT_WEB_STATIC_DIR, "", "ORBIT_WEB_STATIC_DIR") : defaultWebDist(),
    buildInfoFile: absolute(env.ORBIT_WEB_BUILD_INFO, "/opt/orbit-web/build-info.json", "ORBIT_WEB_BUILD_INFO"),
    allowedHosts: [...new Set([...LOOPBACK_HOSTS, ...extraHosts])],
    accessToken,
    secureCookie: env.ORBIT_WEB_COOKIE_SECURE === "1",
    maxBudgetUsd: budget(env.ORBIT_WEB_MAX_BUDGET_USD),
    binaries: {
      claude: env.ORBIT_WEB_CLAUDE_BIN || "claude",
      gh: env.ORBIT_WEB_GH_BIN || "gh",
      git: env.ORBIT_WEB_GIT_BIN || "git",
      az: env.ORBIT_WEB_AZ_BIN || "az",
      node: process.execPath,
    },
    sourceEnv: { ...env },
    limits: { ...DEFAULT_LIMITS },
  };
}
