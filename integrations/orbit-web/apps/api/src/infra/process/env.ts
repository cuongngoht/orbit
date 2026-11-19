// What each child process is given: an ALLOW-LIST of the server's own variables, plus the few each program needs.
// Nothing else of the server's environment reaches a child. In particular:
//   - gh never sees GH_TOKEN / GITHUB_TOKEN (they would override the stored sign-in, and `gh auth login` refuses
//     to run beside them), and nothing but gh is told where gh keeps its sign-in;
//   - Claude Code is never given any GH_* / GITHUB_* name, so the coding agent cannot find GitHub's credential;
//   - the CLI's own credential names (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN) are passed
//     to Claude Code BY NAME when the container was started with them, never written anywhere.
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

export function baseEnv(config: AppConfig): Record<string, string> {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ...pick(config.sourceEnv, PASS_THROUGH),
    HOME: config.data.home,
    NO_COLOR: "1",
  };
}

// Git as Orbit Web runs it: no system or global configuration, never a prompt, no optional index locks.
export function gitEnv(config: AppConfig): Record<string, string> {
  return {
    ...baseEnv(config),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

export function ghEnv(config: AppConfig): Record<string, string> {
  return {
    ...gitEnv(config),
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
  return { ...baseEnv(config), ...AZURE_PINS, AZURE_CONFIG_DIR: config.data.azure, BROWSER: "true" };
}

export const hasClaudeEnvCredential = (config: AppConfig): boolean => Object.keys(pick(config.sourceEnv, CLAUDE_CREDENTIAL_NAMES)).length > 0;

// `azure`: a person let Claude Code use the Azure CLI's sign-in, so its `az` finds the profile. Otherwise it is not
// told where the profile is (and its tools are refused the directory).
export function claudeEnv(config: AppConfig, o: { azure?: boolean } = {}): Record<string, string> {
  return {
    ...baseEnv(config),
    ...pick(config.sourceEnv, CLAUDE_CREDENTIAL_NAMES),
    CLAUDE_CONFIG_DIR: config.data.claude,
    ORBIT_STORE_DIR: config.data.orbit,
    DISABLE_AUTOUPDATER: "1",
    BROWSER: "true",
    ...(o.azure ? { ...AZURE_PINS, AZURE_CONFIG_DIR: config.data.azure } : {}),
  };
}

// Orbit's own read commands, run as the session's Claude Code would see them.
export function orbitEnv(config: AppConfig, orbitSession: string | null): Record<string, string> {
  return {
    ...baseEnv(config),
    ORBIT_STORE_DIR: config.data.orbit,
    ...(orbitSession ? { ORBIT_SESSION: orbitSession } : {}),
  };
}
