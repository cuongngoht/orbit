// THE THREE AI CLIs, as Orbit Web asks them -- pure: what to run, and what its answer means. Every word a connection
// shows is read from the CLI's OWN answer at that moment: its version (installed), its own auth-status command run
// against the connection's home (connected / disconnected / authentication required / error), its own `--help`
// (capabilities). Nothing is inferred from a file being there or a setting being saved; and `connected` always names
// the identity the CLI says it is signed in as -- an identity Orbit cannot name is never called connected, because it
// could not be held to ONE Orbit account.
//
//   Claude Code   `claude --version`; `claude auth status --json` (CLAUDE_CONFIG_DIR=<home>/claude); `claude --help`
//   OpenAI Codex  `codex --version`; `codex login status` (CODEX_HOME=<home>/codex) -- it prints its answer, and names an
//                 API key only masked (sk-…ABCDE) and a ChatGPT sign-in without an account: so a ChatGPT sign-in is
//                 connected only once its status names the account
//   Antigravity   `agy --version`; it documents no status command: its connections are not offered (methods.ts)
import { CLAUDE_ACCOUNT_METHOD, type AuthMethod, type AuthState, type Capability, type InstallationState, type RuntimeCapabilities, type RuntimeKind } from "@orbit-web/contracts";
import { endedHow, type RunResult } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";
import { sha256 } from "../../infra/accounts/stores.js";

export const UNKNOWN_CAPABILITIES: RuntimeCapabilities = { start: "unknown", stream: "unknown", cancel: "unknown", resume: "unknown", usage: "unknown", webSearch: "unknown", toolPlaneSplit: "unknown", pluginObservation: "unknown" };

// ---- installed? --------------------------------------------------------------------------------------------------------

export interface InstallationReading {
  state: InstallationState;
  version: string | null;
  detail: string | null;
}

const SEMVER = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

export function readVersion(label: string, r: RunResult): InstallationReading {
  if (r.spawnError === "ENOENT") return { state: "not_installed", version: null, detail: `${label} is not installed on this server.` };
  if (r.spawnError !== null || r.timedOut || r.code !== 0) return { state: "error", version: null, detail: redactSecrets(`${label} --version ${endedHow(r)}: ${tail(r.stderr || r.stdout, 2)}`).slice(0, 300) };
  const version = SEMVER.exec(`${r.stdout}\n${r.stderr}`)?.[1] ?? null;
  return version === null ? { state: "error", version: null, detail: `${label} --version printed no version Orbit Web could read.` } : { state: "installed", version, detail: null };
}

// ---- what the CLI says about its sign-in ------------------------------------------------------------------------------

export interface StatusReading {
  auth: AuthState;
  reason: string | null;
  // The identity the CLI says it is signed in as (shown), and what tells it apart from any other (never shown).
  identity: string | null;
  identityKey: string | null;
}

const reading = (auth: AuthState, reason: string | null, identity: string | null = null, identityKey: string | null = null): StatusReading => ({ auth, reason, identity, identityKey });

// What tells two API keys apart without keeping either: a hash of the key, and a short fingerprint of it to show.
export const keyIdentity = (key: string): { key: string; fingerprint: string } => {
  const h = sha256(`orbit-web/api-key/${key}`);
  return { key: `api_key:${h}`, fingerprint: `sha256:${h.slice(0, 12)}` };
};

export interface ClaudeCliStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgId: string | null;
  orgName: string | null;
  subscriptionType: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// `claude auth status --json`; anything else is not an answer.
export function parseClaudeStatus(stdout: string): ClaudeCliStatus | null {
  try {
    const json = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof json.loggedIn !== "boolean") return null;
    return { loggedIn: json.loggedIn, authMethod: text(json.authMethod), apiProvider: text(json.apiProvider), email: text(json.email), orgId: text(json.orgId), orgName: text(json.orgName), subscriptionType: text(json.subscriptionType) };
  } catch {
    return null;
  }
}

// What Claude Code's status means for a connection of `method`. A subscription is a Claude account (`claude.ai`) the CLI
// names by its email, in the organization it names by id -- never by its display name. An API key is the key Orbit
// handed the CLI: named by the key's fingerprint.
export function readClaudeStatus(cli: ClaudeCliStatus, method: AuthMethod, apiKey: string | null): StatusReading {
  if (!cli.loggedIn) {
    if (method === "api_key") return reading("auth_required", "Claude Code did not take this API key: enter the key again.");
    return reading("disconnected", "Nobody is signed in in this connection's home: sign it in (Sign in on its card, or the command shown, in a terminal of the server).");
  }
  if (method === "api_key") {
    if (apiKey === null) return reading("auth_required", "This connection has no API key any more: enter one.");
    const id = keyIdentity(apiKey);
    return reading("connected", null, `Anthropic API key (${id.fingerprint})`, id.key);
  }
  if (cli.authMethod !== CLAUDE_ACCOUNT_METHOD) return reading("auth_required", `Claude Code is signed in here with ${cli.authMethod ?? "a credential"}, which is not a Claude subscription: sign in again (Reconnect on its card, or the command shown).`);
  if (cli.email === null) return reading("error", "Claude Code is signed in, but names no email for the account: nothing here can be held to one Orbit account.");
  const email = cli.email.toLowerCase();
  return reading("connected", null, cli.orgName !== null ? `${email} (${cli.orgName})` : email, `claude.ai:${email}|${cli.orgId ?? ""}`);
}

const MASKED_KEY = /Logged in using an API key\s*-\s*(\S+)/i;
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

// `codex login status`: "Logged in using ChatGPT", "Logged in using an API key - sk-…", or "Not logged in" (the CLI
// prints it on standard error).
export function readCodexStatus(r: RunResult, method: AuthMethod, apiKey: string | null): StatusReading {
  const said = `${r.stdout}\n${r.stderr}`;
  if (/not logged in/i.test(said)) return reading(method === "api_key" ? "auth_required" : "disconnected", method === "api_key" ? "Codex did not take this API key: enter the key again." : "Nobody is signed in in this connection's home: sign it in (Sign in on its card, or the command shown, in a terminal of the server).");
  if (r.code !== 0 && !/logged in using/i.test(said)) return reading("error", redactSecrets(`codex login status ${endedHow(r)}: ${tail(r.stderr || r.stdout, 2)}`).slice(0, 300));
  const masked = MASKED_KEY.exec(said)?.[1] ?? null;
  if (masked !== null) {
    if (method !== "api_key") return reading("auth_required", "Codex is signed in here with an API key, not a ChatGPT sign-in: sign in again (Reconnect on its card, or the command shown).");
    if (apiKey === null) return reading("auth_required", "This connection has no API key any more: enter one.");
    const id = keyIdentity(apiKey);
    return reading("connected", null, `OpenAI API key (${id.fingerprint})`, id.key);
  }
  if (/logged in using chatgpt/i.test(said)) {
    if (method === "api_key") return reading("auth_required", "Codex is signed in here with ChatGPT, not with this API key: enter the key again.");
    const email = EMAIL.exec(said)?.[0]?.toLowerCase() ?? null;
    if (email === null) return reading("error", "codex login status says it is signed in with ChatGPT but names no account, so Orbit cannot tell which identity this is or hold it to one Orbit account: it is not used.");
    return reading("connected", null, email, `chatgpt:${email}`);
  }
  return reading("error", "codex login status said nothing Orbit Web could read.");
}

// ---- what the binary can do (observed on THIS binary) ---------------------------------------------------------------

const has = (help: string, flag: string): boolean => new RegExp(`(^|[\\s,])${flag.replace(/[-]/g, "\\-")}(?=[\\s,=<\\[]|$)`, "m").test(help);
const yes = (ok: boolean): Capability => (ok ? "yes" : "no");

// Claude Code: what its `--help` lists. The tool plane can be split from the model plane only when the binary has all of
// `--tools` (no built-in tool), `--restricted` and `--strict-mcp-config` -- checked on the binary installed, never taken
// from documentation.
export function claudeCapabilities(help: string | null): RuntimeCapabilities {
  if (help === null) return UNKNOWN_CAPABILITIES;
  return {
    start: yes(has(help, "--print") || has(help, "-p")),
    stream: yes(has(help, "--output-format")),
    cancel: "yes",
    resume: yes(has(help, "--resume")),
    usage: yes(has(help, "--output-format")),
    webSearch: yes(has(help, "--allowedTools") || has(help, "--allowed-tools")),
    toolPlaneSplit: yes(has(help, "--tools") && has(help, "--restricted") && has(help, "--strict-mcp-config")),
    pluginObservation: yes(has(help, "--plugin-dir")),
  };
}

// Codex and Antigravity: nothing is claimed that was not observed. Codex documents switching its shell tool off
// (`features.shell_tool=false`) but nothing for its patch and exec tools; Antigravity documents only deny rules: the
// tool plane cannot be split from either, so it stays unknown.
export const otherCapabilities = (installed: boolean): RuntimeCapabilities => ({ ...UNKNOWN_CAPABILITIES, start: installed ? "unknown" : "no" });

// ---- per runtime ----------------------------------------------------------------------------------------------------------

export interface RuntimeSpec {
  runtime: RuntimeKind;
  label: string;
  // The official sign-in of a subscription -- run from its card (connection-sign-in.service.ts) or by a person in a
  // terminal of the server (cli/connect.ts) -- null: none offered.
  login: string[] | null;
  logout: string[] | null;
  status: string[] | null;
}

export const RUNTIME_SPECS: Record<RuntimeKind, RuntimeSpec> = {
  claude: { runtime: "claude", label: "Claude Code", login: ["auth", "login", "--claudeai"], logout: ["auth", "logout"], status: ["auth", "status", "--json"] },
  codex: { runtime: "codex", label: "OpenAI Codex", login: ["login", "--device-auth"], logout: ["logout"], status: ["login", "status"] },
  agy: { runtime: "agy", label: "Google Antigravity", login: null, logout: null, status: null },
};
