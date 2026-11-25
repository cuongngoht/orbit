// What each child process is given: an ALLOW-LIST of the server's own variables, plus the few each program needs.
// Nothing else of the server's environment reaches a child. In particular:
//   - gh never sees GH_TOKEN / GITHUB_TOKEN (they would override the stored sign-in, and `gh auth login` refuses
//     to run beside them), and nothing but gh is told where gh keeps its sign-in;
//   - Claude Code is given no GH_* / GITHUB_* name, so the coding agent cannot find GitHub's credential -- unless a
//     person lets it use GitHub CLI's sign-in (Settings), and then only where gh keeps it (never a token variable);
//   - the CLI's own credential names (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN) are NEVER
//     passed from the server's environment: each Claude Code run belongs to one AI connection of one account, and finds
//     that connection's login in that connection's own config home (CLAUDE_CONFIG_DIR) -- an API-key connection is
//     handed its own key, from the credential store, by whoever starts it (modules/connections). A container started
//     with one of those variables gives it to nobody;
//   - Claude Code's telemetry (OTEL_*) reaches Claude Code alone, and only once the container names a collector.
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";

const PASS_THROUGH = [
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
];

export const CLAUDE_CREDENTIAL_NAMES = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

const pick = (source: AppConfig["sourceEnv"], names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.flatMap((n) => (typeof source[n] === "string" && source[n] !== "" ? [[n, source[n] as string]] : [])));

const PROXY_NAMES = new Set(["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"]);

// `home`: the agent's HOME (/data/home) unless a control-plane program is given its own. In the governed deployment the
// agent's programs never inherit the server's proxy variables: their only way out is the control plane's own proxy.
export function baseEnv(config: AppConfig, home = config.data.home, agent = home === config.data.home): Record<string, string> {
  const names = config.governance.deployment === "governed" && agent ? PASS_THROUGH.filter((n) => !PROXY_NAMES.has(n)) : PASS_THROUGH;
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ...pick(config.sourceEnv, names),
    HOME: home,
    NO_COLOR: "1",
  };
}

// The environment of a program the CONTROL PLANE runs (a credential's CLI, a clone, a push): its own HOME.
export const controlEnv = (config: AppConfig): Record<string, string> => baseEnv(config, config.controlHome, false);

// Git as Orbit Web runs it: no system or global configuration, never a prompt, no optional index locks.
export function gitEnv(config: AppConfig, base: Record<string, string> = baseEnv(config)): Record<string, string> {
  return {
    ...base,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

export function ghEnv(config: AppConfig): Record<string, string> {
  return {
    ...gitEnv(config, controlEnv(config)),
    GH_CONFIG_DIR: config.data.github,
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
    GH_SPINNER_DISABLED: "1",
    GH_BROWSER: "true",
    BROWSER: "true",
    CLICOLOR: "0",
  };
}

// The Azure CLI as Orbit itself pins it (catalog/tools.json, the azure-cli row): no broker, no new login experience
// (whose subscription picker would wait for a keyboard), no telemetry, a plain-file token cache (a container has no
// keyring) -- and its profile in /data/azure, Orbit Web's own, never Orbit's (Orbit keeps a profile of its own).
const AZURE_PINS = {
  AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: "false",
  AZURE_CORE_ENABLE_BROKER_ON_MAC: "false",
  AZURE_CORE_LOGIN_EXPERIENCE_V2: "off",
  AZURE_CORE_COLLECT_TELEMETRY: "false",
  AZURE_CORE_ENCRYPT_TOKEN_CACHE: "false",
  AZURE_CORE_NO_COLOR: "true",
};

export function azureEnv(config: AppConfig): Record<string, string> {
  return { ...controlEnv(config), ...AZURE_PINS, AZURE_CONFIG_DIR: config.data.azure, BROWSER: "true" };
}

// Git cloning an Azure Repos repository: git's own hardening, and the Azure CLI's profile for the one-shot credential
// helper git runs (it asks `az` for a token for that clone; git hands it to the server; nothing is written).
export function azureGitEnv(config: AppConfig): Record<string, string> {
  return { ...gitEnv(config, controlEnv(config)), ...AZURE_PINS, AZURE_CONFIG_DIR: config.data.azure, BROWSER: "true" };
}

// Git as the CONTROL PLANE runs it on its own repositories (/data/repos): a fetch or a push with GitHub CLI's
// credential helper for github.com alone, named in git's environment (no git configuration file is written).
export function githubGitEnv(config: AppConfig): Record<string, string> {
  return {
    ...gitEnv(config, controlEnv(config)),
    GH_CONFIG_DIR: config.data.github,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
    GIT_CONFIG_VALUE_0: `!${config.binaries.gh} auth git-credential`,
  };
}

// CLAUDE CODE'S TELEMETRY: OpenTelemetry as a person's own Claude Code sends it, and only once the container names a
// collector (OTEL_EXPORTER_OTLP_ENDPOINT, or a signal's own `…_ENDPOINT`). Where it goes and the collector's token
// (OTEL_EXPORTER_OTLP_HEADERS) come from the container's environment; every other attribute is fixed here: metrics,
// logs and traces over OTLP http/protobuf; metrics that say which repository, version, entrypoint, session and account;
// events with tool details -- never a prompt, a response, a tool's content or a raw API body. An OTEL_* variable the
// container sets wins over its default. Claude Code alone is given any of it: git, gh, az and Orbit's own commands never
// see the token.
export const TELEMETRY_DEFAULTS: Readonly<Record<string, string>> = {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
  OTEL_METRICS_INCLUDE_REPOSITORY: "1",
  OTEL_METRICS_INCLUDE_VERSION: "1",
  OTEL_METRICS_INCLUDE_ENTRYPOINT: "1",
  OTEL_METRICS_INCLUDE_SESSION_ID: "1",
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: "1",
  OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES: "1",
  OTEL_LOG_USER_PROMPTS: "0",
  OTEL_LOG_ASSISTANT_RESPONSES: "0",
  OTEL_LOG_TOOL_DETAILS: "1",
  OTEL_LOG_TOOL_CONTENT: "0",
  OTEL_LOG_RAW_API_BODIES: "0",
  OTEL_LOG_MANAGED_SETTINGS: "1",
};

const TELEMETRY_NAME = /^(?:OTEL_[A-Z0-9_]+|CLAUDE_CODE_ENABLE_TELEMETRY)$/;
const COLLECTOR = /^OTEL_EXPORTER_OTLP_(?:[A-Z]+_)?ENDPOINT$/;

export function telemetryEnv(config: AppConfig): Record<string, string> {
  const set = Object.fromEntries(Object.entries(config.sourceEnv).filter((e): e is [string, string] => TELEMETRY_NAME.test(e[0]) && typeof e[1] === "string" && e[1] !== ""));
  return Object.keys(set).some((name) => COLLECTOR.test(name)) ? { ...TELEMETRY_DEFAULTS, ...set } : {};
}

// The Claude credential variables the container was started with, by name: given to nobody, and said so.
export const ignoredClaudeCredentials = (config: AppConfig): string[] => Object.keys(pick(config.sourceEnv, CLAUDE_CREDENTIAL_NAMES));

// A config directory of Claude Code that belongs to NO connection and holds no login: what a question of the binary
// itself is asked with (its version, its flags, auto mode's defaults), so no account's home is read for it.
export const neutralClaudeDir = (config: AppConfig): string => join(config.data.home, ".claude");

// Codex and Antigravity, for one connection's home (Codex: CODEX_HOME; Antigravity keeps its settings under HOME).
export function codexEnv(config: AppConfig, codexHome: string): Record<string, string> {
  return { ...baseEnv(config), CODEX_HOME: codexHome, BROWSER: "true" };
}

export function agyEnv(config: AppConfig, home: string): Record<string, string> {
  return { ...baseEnv(config, home, true), BROWSER: "true" };
}

// GitHub CLI's sign-in, for a Claude Code a person let use it: gh finds its configuration, never prompts, and git asks gh
// for the credential of github.com -- and of github.com alone -- as a helper named in git's environment (no git config
// file is written, and the token never passes through Orbit Web).
function githubForClaude(config: AppConfig): Record<string, string> {
  return {
    GH_CONFIG_DIR: config.data.github,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
    GH_SPINNER_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
    GIT_CONFIG_VALUE_0: `!${config.binaries.gh} auth git-credential`,
  };
}

// A Claude Code process of ONE connection: `configDir` is that connection's own config home (CLAUDE_CONFIG_DIR) -- where
// its login is, its sessions and the plugins installed for it. `azure` / `github`: a person let Claude Code use that
// CLI's sign-in, so its `az` finds the profile, or its `gh` and `git push` find GitHub's. Otherwise it is not told where
// the sign-in is (and its tools are refused the directory).
export function claudeEnv(config: AppConfig, configDir: string, o: { azure?: boolean; github?: boolean; orbitStore?: string } = {}): Record<string, string> {
  return {
    ...baseEnv(config),
    CLAUDE_CONFIG_DIR: configDir,
    ORBIT_STORE_DIR: o.orbitStore ?? config.data.orbit,
    DISABLE_AUTOUPDATER: "1",
    BROWSER: "true",
    ...telemetryEnv(config),
    ...(o.azure ? { ...AZURE_PINS, AZURE_CONFIG_DIR: config.data.azure } : {}),
    ...(o.github ? githubForClaude(config) : {}),
  };
}

// Each account's own Orbit machine store: what its chats' Orbit learns and records, and all a run's sandbox mounts of
// Orbit's data (sandbox/ids.ts `sessionMounts`) -- never another account's.
export const orbitStoreOf = (config: AppConfig, accountId: string): string => join(config.data.orbit, "accounts", accountId);

// Orbit's own read commands, run as the session's Claude Code would see them (its account's store).
export function orbitEnv(config: AppConfig, accountId: string, orbitSession: string | null): Record<string, string> {
  return {
    ...baseEnv(config),
    ORBIT_STORE_DIR: orbitStoreOf(config, accountId),
    ...(orbitSession ? { ORBIT_SESSION: orbitSession } : {}),
  };
}

// How a process in the agent's container is pointed at its only way out (governed deployment): the control plane's
// egress proxy, with a credential that says whose connections they are -- `run:<token>` for a run, `signin:<token>`
// for the Claude sign-in (the proxy reads the token, never the name) -- and no traffic Claude Code calls
// non-essential. The control plane itself is reached directly (the agent gateway).
export function egressProxyEnv(controlHost: string, proxyPort: number, user: "run" | "signin", token: string): Record<string, string> {
  const proxy = `http://${user}:${token}@${controlHost}:${proxyPort}`;
  return { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: controlHost, no_proxy: controlHost, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
}
