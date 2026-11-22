// Orbit Web's configuration, read once from the environment at start. Everything an operator may change is an
// ORBIT_WEB_* variable (or ORBIT_PLUGIN_DIR); nothing is read from a file the browser could reach.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DataDirs {
  root: string;
  app: string;
  // The AI connections' config homes, one per connection: `<connections>/<OrbitId>/<connectionId>/{claude,codex,agy}`
  // (the CLI's own login lives there and nowhere else).
  connections: string;
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

// A browser's session, issued when a user of this browser signs in: it ends `lifetimeMs` after it began, or after
// `idleMs` with no request, whichever comes first.
export interface SessionConfig {
  lifetimeMs: number;
  idleMs: number;
}

// The cost of the password hash (scrypt). Production's is fixed here and read from no variable: only a test harness
// lowers it, by replacing `identity.kdf` on the configuration it made.
export interface KdfParams {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

export const PRODUCTION_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export interface IdentityConfig {
  kdf: KdfParams;
  // ORBIT_WEB_TRIAL=1: a localhost-only trial, pre-seeded with the account `admin` / `123456` (refused at start anywhere
  // else: trialRefusal).
  trial: boolean;
  // ORBIT_WEB_SETUP_CODE: a test installation's STANDING setup code -- shown filled in on the setup page while nobody is
  // set up, it makes the first administrator alone and is never stored or used up (so it survives every reset). Unset:
  // only a code printed on the server (`governance.js owner setup-code`) sets an installation up.
  setupCode: string | null;
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
  // Whether a subscription connection may be signed in from its card (ADR 0068): Orbit Web runs the CLI's own sign-in and
  // relays its URL, Codex's one-time code and the code a person pastes for Claude Code. ORBIT_WEB_SIGN_IN_ON_PAGE=0: only
  // the terminal's connect.js signs one in.
  signInOnPage: boolean;
  // `azureGitHelper`: the git credential helper an Azure Repos clone uses (shipped in the image).
  binaries: { claude: string; codex: string; agy: string; gh: string; git: string; az: string; python: string; node: string; azureGitHelper: string };
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
  identity: IdentityConfig;
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
    connections: join(root, "connections"),
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

// ORBIT_WEB_SETUP_CODE: the standing setup code as the operator wrote it (trimmed), held to the length a printed one
// may have -- the setup page sends it back as one.
function standingSetupCode(raw: string | undefined): string | null {
  const code = (raw ?? "").trim();
  if (code === "") return null;
  if (code.length < 8 || code.length > 64) throw new ConfigError("ORBIT_WEB_SETUP_CODE must be 8 to 64 characters");
  return code;
}

// ORBIT_WEB_TRIAL: "1" turns the localhost-only trial on; unset, empty or "0" leaves it off.
function trialFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === "" || raw === "0") return false;
  if (raw === "1") return true;
  throw new ConfigError("ORBIT_WEB_TRIAL must be 1 (the localhost-only trial) or 0");
}

// Why a trial may NOT start here (null: it may). The trial account's password is public (`admin` / `123456`), so the
// installation must be one nobody else can reach: loopback host names only (the host guard then refuses any other
// Host), no access token (a token means somebody meant to expose it), the single deployment, and nothing that says it
// is served to the world (a public origin, cookies for HTTPS).
export function trialRefusal(env: Readonly<Record<string, string | undefined>>, o: { widened: string[]; accessToken: string | null; deployment: Deployment }): string | null {
  if (o.widened.length > 0) return `ORBIT_WEB_ALLOWED_HOSTS names ${o.widened.join(", ")}: a trial answers loopback host names only (localhost, 127.0.0.1, ::1)`;
  if (o.accessToken !== null) return "ORBIT_WEB_ACCESS_TOKEN is set: a trial has no access token (it is never reachable from another machine)";
  if (o.deployment !== "single") return `ORBIT_WEB_DEPLOYMENT is ${o.deployment}: a trial is the single deployment only`;
  if ((env.ORBIT_WEB_PUBLIC_ORIGIN ?? "") !== "") return "ORBIT_WEB_PUBLIC_ORIGIN is set: a trial has no public origin";
  if (env.ORBIT_WEB_COOKIE_SECURE === "1") return "ORBIT_WEB_COOKIE_SECURE is set: a trial is not served over HTTPS to anybody";
  return null;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const extraHosts = hostList(env.ORBIT_WEB_ALLOWED_HOSTS);
  const accessToken = env.ORBIT_WEB_ACCESS_TOKEN && env.ORBIT_WEB_ACCESS_TOKEN.length > 0 ? env.ORBIT_WEB_ACCESS_TOKEN : null;
  const widened = extraHosts.filter((h) => !LOOPBACK_HOSTS.includes(h));
  // Another host name may be answered with or without an access token (ADR 0069): Orbit Web's own accounts are the gate
  // -- nothing but the sign-in, the setup with a one-time code from the server's terminal, the health check and a shared
  // chat's link answers without a browser session -- and a token, when set, is a perimeter in front of them. The
  // localhost-only trial, whose login is public, still answers loopback names alone (trialRefusal).
  if (accessToken !== null && accessToken.length < 16) throw new ConfigError("ORBIT_WEB_ACCESS_TOKEN must be at least 16 characters");
  const port = positiveInt(env.ORBIT_WEB_PORT, 3000, "ORBIT_WEB_PORT");
  const data = dataDirs(absolute(env.ORBIT_WEB_DATA_DIR, "/data", "ORBIT_WEB_DATA_DIR"));
  const governance = governedConfig(env, port);
  const trial = trialFlag(env.ORBIT_WEB_TRIAL);
  const refusal = trial ? trialRefusal(env, { widened, accessToken, deployment: governance.deployment }) : null;
  if (refusal !== null) throw new ConfigError(`ORBIT_WEB_TRIAL=1 refused: ${refusal}. The trial account's password is public, so a trial runs on this machine alone.`);
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
    signInOnPage: env.ORBIT_WEB_SIGN_IN_ON_PAGE !== "0",
    binaries: {
      claude: env.ORBIT_WEB_CLAUDE_BIN || "claude",
      codex: env.ORBIT_WEB_CODEX_BIN || "codex",
      agy: env.ORBIT_WEB_AGY_BIN || "agy",
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
    identity: { kdf: { ...PRODUCTION_KDF }, trial, setupCode: standingSetupCode(env.ORBIT_WEB_SETUP_CODE) },
  };
}
