// THE THREE AI CLIs, as Orbit Web asks them -- pure: what to run, and what its answer means. Every word a connection
// shows is read from the CLI's OWN answer at that moment: its version (installed), its own auth-status command run
// against the connection's home (connected / disconnected / authentication required / error), its own `--help`
// (capabilities). Nothing is inferred from a file being there or a setting being saved; and `connected` always names
// the identity the CLI says it is signed in as -- an identity Orbit cannot name is never called connected, because it
// could not be held to ONE Orbit account.
//
//   Claude Code   `claude --version`; `claude auth status --json` (CLAUDE_CONFIG_DIR=<home>/claude); `claude --help`
//   OpenAI Codex  `codex --version`; `codex login status` (CODEX_HOME=<home>/codex) -- it prints its answer, and names an
//                 API key only masked (sk-…ABCDE) and a ChatGPT sign-in without an account (codex-cli 0.169.0: "Logged
//                 in using ChatGPT"): so a ChatGPT sign-in is named by the CLI's own app server, `account/read`
//                 (`codex app-server`, its JSON-RPC: the account's email, its workspace and the workspace's id)
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

// Whether `codex login status` says a ChatGPT sign-in is there but names no account: then its app server is asked.
export const chatgptUnnamed = (r: RunResult): boolean => /logged in using chatgpt/i.test(`${r.stdout}\n${r.stderr}`) && EMAIL.exec(`${r.stdout}\n${r.stderr}`) === null;

// What `codex app-server` is asked (one line each, JSON-RPC over stdio): initialize, initialized, then account/read
// without refreshing a token. It answers only while its input stays open (probe.ts keeps it open until the answer).
export const CODEX_ACCOUNT_REQUEST = `${[
  { method: "initialize", id: 0, params: { clientInfo: { name: "orbit_web", title: "Orbit Web", version: "0.8.0" } } },
  { method: "initialized" },
  { method: "account/read", id: 1, params: { refreshToken: false } },
]
  .map((m) => JSON.stringify(m))
  .join("\n")}\n`;

export interface CodexAccount {
  email: string;
  workspace: string | null;
  // The ChatGPT workspace's id: another workspace of the same email is another identity.
  workspaceId: string | null;
}

const recordOf = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// One line the app server printed: the answer to account/read (`undefined`: not that answer) -- the ChatGPT account it
// names, or null when it names none (signed out, or an API key).
export function codexAccountOf(line: string): CodexAccount | null | undefined {
  let msg: Record<string, unknown> | null;
  try {
    msg = recordOf(JSON.parse(line));
  } catch {
    return undefined;
  }
  if (msg === null || msg.id !== 1) return undefined;
  const result = recordOf(msg.result);
  const account = recordOf(result?.account);
  const email = account?.type === "chatgpt" ? text(account.email) : null;
  if (email === null) return null;
  return { email: email.toLowerCase(), workspace: text(account?.workspaceName), workspaceId: text(recordOf(result?.workspaceRouting)?.chatgptAccountId) };
}

// A ChatGPT sign-in its app server named: connected as that email, in that workspace.
export function codexAccountReading(a: CodexAccount): StatusReading {
  return reading("connected", null, a.workspace !== null ? `${a.email} (${a.workspace})` : a.email, `chatgpt:${a.email}|${a.workspaceId ?? ""}`);
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

// What OpenAI Codex's binary says of itself: its commands (`codex --help`), its exec's (`codex exec --help`), and what its
// configuration answers to a web_search mode it does not know (asked in a scratch home: it lists the modes it takes,
// and stops before any sign-in or model). A run is `codex exec --json`, its stream the JSONL events (a turn's usage
// with them), resumed by `codex exec resume`, cancelled by a signal (Codex interrupts its turn). Plugins are not
// observed. The tool plane split is not read from help at all: an employee's model plane is held by what the binary is
// SEEN to offer a model (Phase 4), never by a list of switches -- so it stays unknown here.
export interface CodexHelp {
  top: string;
  exec: string;
  webSearch: string | null;
}

export function codexCapabilities(help: CodexHelp | null): RuntimeCapabilities {
  if (help === null) return UNKNOWN_CAPABILITIES;
  const json = has(help.exec, "--json");
  const modes = help.webSearch === null ? null : /web_search/.test(help.webSearch) && /`live`/.test(help.webSearch) && /`disabled`/.test(help.webSearch);
  return {
    start: yes(has(help.top, "exec")),
    stream: yes(json),
    cancel: "yes",
    resume: yes(has(help.exec, "resume")),
    usage: yes(json),
    webSearch: modes === null ? "unknown" : yes(modes),
    toolPlaneSplit: "unknown",
    pluginObservation: "no",
  };
}

// What Codex's config is asked to show which web_search modes it takes: an unknown one, in a scratch home, with nothing
// signed in -- it refuses the configuration and names the modes, before anything else.
export const CODEX_WEB_SEARCH_PROBE = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-c", 'web_search="?"', "-"];

// Antigravity: nothing is claimed that was not observed. It documents only deny rules: the tool plane cannot be split
// from it, so it stays unknown.
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
