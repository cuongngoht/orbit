// Orbit Web's configuration, read once from the environment at start. Everything an operator may change is an
// ORBIT_WEB_* variable (or ORBIT_PLUGIN_DIR); nothing is read from a file the browser could reach.
import { existsSync, readFileSync } from "node:fs";
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
  // The control plane's own copies of the repositories it fetches and pushes (governed deployment: read-only to the
  // agent), and its own HOME for the programs it runs with a credential.
  repos: string;
  control: string;
  // Research: the files each workspace's sources were read from, named by their content's hash (the control plane's
  // alone: never mounted where the agent runs, never in a workspace or a repository).
  research: string;
}

export const DEPLOYMENTS = ["single", "governed"] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];

// How the agent runtime is placed. `single` (the default): Claude Code runs in the API's own container, as its own user
// -- isolation from the control plane is NOT proven there. `governed`: Claude Code and everything that touches a
// workspace run in a container of their own (the runner), which holds no credential, no governance record and no
// database, and reaches the internet only through the control plane's egress proxy.
export interface GovernedConfig {
  deployment: Deployment;
  // governed: where the agent container's runner listens.
  runner: { host: string; port: number } | null;
  // governed: the networks the agent container's requests come from. Such a request reaches the agent gateway alone.
  agentNetworks: string[];
  // governed: the port of the egress proxy the control plane runs for the agent.
  proxyPort: number | null;
  // How the agent reaches the control plane: the gateway (http://<host>:<port>) and, governed, the proxy.
  agentControlHost: string;
  // governed: internal ranges (CIDR) the egress proxy may reach -- none unless the installation names them; the
  // Constitution still decides each connection.
  egressPrivateAllow: string[];
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
  // Reading an account's connectors: asked again this often until the list settles (its claude.ai connectors arrive a
  // moment after the CLI starts), and given up after the deadline.
  connectorPollMs: number;
  connectorDeadlineMs: number;
}

// RESEARCH's bounds, each an ORBIT_WEB_RESEARCH_* variable.
export interface ResearchConfig {
  // An uploaded file, and what a URL may answer, at most.
  maxUploadBytes: number;
  maxUrlBytes: number;
  // Whether a source may be imported from a URL at all (the fetcher reaches the public internet only).
  urlImport: boolean;
  // How many sources are read and indexed at once.
  ingestConcurrency: number;
  // How much retrieved text one question gives the model, at most (characters).
  contextChars: number;
  // Reading one file, and fetching one URL, at most.
  extractTimeoutMs: number;
  fetchTimeoutMs: number;
}

// THE DATABASE: PostgreSQL with pgvector, the one place Orbit Web keeps its records. Required: Orbit Web does not start
// without it, and never falls back to anything else.
export interface DatabaseConfig {
  url: string;
  poolMax: number;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
}

// A browser's session, issued when that browser finishes a Claude sign-in: it ends `lifetimeMs` after it began, or after
// `idleMs` with no request, whichever comes first.
export interface SessionConfig {
  lifetimeMs: number;
  idleMs: number;
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
  // `azureGitHelper`: the git credential helper an Azure Repos clone uses (shipped in the image).
  binaries: { claude: string; gh: string; git: string; az: string; python: string; node: string; azureGitHelper: string };
  // The server's own environment: the only place allow-listed variables are copied from for a child process.
  sourceEnv: Readonly<Record<string, string | undefined>>;
  limits: Limits;
  governance: GovernedConfig;
  // Where GitHub's repositories are fetched from and pushed to by the control plane (the push broker): GitHub itself.
  // A test points it at local bare repositories (file:///…); nothing else ever changes it.
  githubUrl: string;
  // HOME for the programs the control plane runs with a credential (gh, az, a clone, a push): /data/home in the single
  // deployment, as before; in the governed deployment a directory of the control plane's own, never the agent's.
  controlHome: string;
  research: ResearchConfig;
  database: DatabaseConfig;
  session: SessionConfig;
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
  connectorPollMs: 1_500,
  connectorDeadlineMs: 25_000,
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
    repos: join(root, "repos"),
    control: join(root, "control"),
    research: join(root, "research"),
  };
}

const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

const isCidr = (v: string): boolean => {
  const m = CIDR.exec(v);
  return m !== null && m.slice(1, 5).every((o) => Number(o) <= 255) && Number(m[5]) <= 32;
};

function hostPort(raw: string | undefined, name: string): { host: string; port: number } | null {
  if (raw === undefined || raw === "") return null;
  const at = raw.lastIndexOf(":");
  const host = raw.slice(0, at);
  const port = Number(raw.slice(at + 1));
  if (at <= 0 || !/^[A-Za-z0-9.-]+$/.test(host) || !Number.isInteger(port) || port <= 0 || port > 65535) throw new ConfigError(`${name} must be host:port`);
  return { host, port };
}

function githubUrlOf(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "https://github.com";
  if (!/^(https:\/\/[A-Za-z0-9.-]+(:\d+)?|file:\/\/\/[^\s]+)$/.test(raw)) throw new ConfigError("ORBIT_WEB_GITHUB_URL must be an https:// origin or a file:/// directory");
  return raw.replace(/\/+$/, "");
}

// The governed deployment is all or nothing: every part of it is named, or Orbit Web refuses to start.
function governedConfig(env: Readonly<Record<string, string | undefined>>, port: number): GovernedConfig {
  const deployment = env.ORBIT_WEB_DEPLOYMENT === undefined || env.ORBIT_WEB_DEPLOYMENT === "" ? "single" : env.ORBIT_WEB_DEPLOYMENT;
  if (deployment !== "single" && deployment !== "governed") throw new ConfigError("ORBIT_WEB_DEPLOYMENT must be single or governed");
  if (deployment === "single") return { deployment, runner: null, agentNetworks: [], proxyPort: null, agentControlHost: "127.0.0.1", egressPrivateAllow: [] };
  const runner = hostPort(env.ORBIT_WEB_RUNNER, "ORBIT_WEB_RUNNER");
  const agentNetworks = hostList(env.ORBIT_WEB_AGENT_NETWORKS);
  const host = env.ORBIT_WEB_AGENT_CONTROL_HOST ?? "";
  if (runner === null) throw new ConfigError("ORBIT_WEB_DEPLOYMENT=governed needs ORBIT_WEB_RUNNER (the agent container's runner, host:port)");
  if (agentNetworks.length === 0 || !agentNetworks.every(isCidr)) throw new ConfigError("ORBIT_WEB_DEPLOYMENT=governed needs ORBIT_WEB_AGENT_NETWORKS (the agent network, as CIDR)");
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new ConfigError("ORBIT_WEB_DEPLOYMENT=governed needs ORBIT_WEB_AGENT_CONTROL_HOST (this container's name on the agent network)");
  const proxyPort = positiveInt(env.ORBIT_WEB_EGRESS_PROXY_PORT, 3128, "ORBIT_WEB_EGRESS_PROXY_PORT");
  if (proxyPort === port) throw new ConfigError("ORBIT_WEB_EGRESS_PROXY_PORT must differ from ORBIT_WEB_PORT");
  const egressPrivateAllow = hostList(env.ORBIT_WEB_EGRESS_PRIVATE_ALLOW);
  if (!egressPrivateAllow.every(isCidr)) throw new ConfigError("ORBIT_WEB_EGRESS_PRIVATE_ALLOW must be IPv4 CIDR ranges");
  return { deployment, runner, agentNetworks, proxyPort, agentControlHost: host, egressPrivateAllow };
}

const positiveInt = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new ConfigError(`${name} must be a port number`);
  return n;
};

// A whole number within bounds, or the default when unset.
const bounded = (raw: string | undefined, fallback: number, min: number, max: number, name: string): number => {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};

const MB = 1024 * 1024;

export const DEFAULT_RESEARCH: ResearchConfig = {
  maxUploadBytes: 25 * MB,
  maxUrlBytes: 10 * MB,
  urlImport: true,
  ingestConcurrency: 2,
  contextChars: 24_000,
  extractTimeoutMs: 120_000,
  fetchTimeoutMs: 30_000,
};

function researchConfig(env: Readonly<Record<string, string | undefined>>): ResearchConfig {
  const flag = env.ORBIT_WEB_RESEARCH_URL_IMPORT;
  if (flag !== undefined && flag !== "" && flag !== "on" && flag !== "off") throw new ConfigError("ORBIT_WEB_RESEARCH_URL_IMPORT must be on or off");
  return {
    ...DEFAULT_RESEARCH,
    maxUploadBytes: bounded(env.ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB, 25, 1, 200, "ORBIT_WEB_RESEARCH_MAX_UPLOAD_MB") * MB,
    maxUrlBytes: bounded(env.ORBIT_WEB_RESEARCH_MAX_URL_MB, 10, 1, 100, "ORBIT_WEB_RESEARCH_MAX_URL_MB") * MB,
    urlImport: flag !== "off",
    ingestConcurrency: bounded(env.ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY, 2, 1, 8, "ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY"),
    contextChars: bounded(env.ORBIT_WEB_RESEARCH_CONTEXT_CHARS, 24_000, 2_000, 200_000, "ORBIT_WEB_RESEARCH_CONTEXT_CHARS"),
  };
}

// ORBIT_WEB_DATABASE_URL, or the file ORBIT_WEB_DATABASE_URL_FILE names (a container secret): a postgres:// URL.
function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const file = env.ORBIT_WEB_DATABASE_URL_FILE;
  let url = env.ORBIT_WEB_DATABASE_URL ?? "";
  if (file !== undefined && file !== "") {
    if (url !== "") throw new ConfigError("Set ORBIT_WEB_DATABASE_URL or ORBIT_WEB_DATABASE_URL_FILE, not both");
    const path = absolute(file, "", "ORBIT_WEB_DATABASE_URL_FILE");
    try {
      url = readFileSync(path, "utf8").trim();
    } catch {
      throw new ConfigError("ORBIT_WEB_DATABASE_URL_FILE names a file that cannot be read");
    }
  }
  if (url === "") throw new ConfigError("ORBIT_WEB_DATABASE_URL is required: Orbit Web keeps its records in PostgreSQL with pgvector (postgres://user:password@host:5432/database)");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("ORBIT_WEB_DATABASE_URL is not a URL (postgres://user:password@host:5432/database)");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new ConfigError("ORBIT_WEB_DATABASE_URL must be a postgres:// URL");
  if (parsed.pathname.length <= 1) throw new ConfigError("ORBIT_WEB_DATABASE_URL must name a database (…:5432/orbit)");
  return url;
}

export const DEFAULT_SESSION: SessionConfig = { lifetimeMs: 7 * 24 * 3_600_000, idleMs: 24 * 3_600_000 };

function sessionConfig(env: Readonly<Record<string, string | undefined>>): SessionConfig {
  const lifetime = bounded(env.ORBIT_WEB_SESSION_HOURS, 168, 1, 24 * 90, "ORBIT_WEB_SESSION_HOURS");
  const idle = bounded(env.ORBIT_WEB_SESSION_IDLE_HOURS, 24, 1, 24 * 90, "ORBIT_WEB_SESSION_IDLE_HOURS");
  if (idle > lifetime) throw new ConfigError("ORBIT_WEB_SESSION_IDLE_HOURS must not be longer than ORBIT_WEB_SESSION_HOURS");
  return { lifetimeMs: lifetime * 3_600_000, idleMs: idle * 3_600_000 };
}

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
  const port = positiveInt(env.ORBIT_WEB_PORT, 3000, "ORBIT_WEB_PORT");
  const data = dataDirs(absolute(env.ORBIT_WEB_DATA_DIR, "/data", "ORBIT_WEB_DATA_DIR"));
  const governance = governedConfig(env, port);
  return {
    port,
    bind: env.ORBIT_WEB_BIND && env.ORBIT_WEB_BIND.length > 0 ? env.ORBIT_WEB_BIND : "127.0.0.1",
    data,
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
      python: env.ORBIT_WEB_PYTHON_BIN || "python3",
      azureGitHelper: env.ORBIT_WEB_AZURE_GIT_HELPER || "/opt/orbit-web/docker/git-credential-azure-cli.mjs",
      node: process.execPath,
    },
    sourceEnv: { ...env },
    limits: { ...DEFAULT_LIMITS },
    governance,
    controlHome: governance.deployment === "governed" ? join(data.control, "home") : data.home,
    githubUrl: githubUrlOf(env.ORBIT_WEB_GITHUB_URL),
    research: researchConfig(env),
    database: {
      url: databaseUrl(env),
      poolMax: bounded(env.ORBIT_WEB_DATABASE_POOL_MAX, 10, 1, 100, "ORBIT_WEB_DATABASE_POOL_MAX"),
      connectTimeoutMs: 10_000,
      statementTimeoutMs: 60_000,
    },
    session: sessionConfig(env),
  };
}
