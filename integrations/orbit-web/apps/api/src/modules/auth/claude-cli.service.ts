// WHAT THE RUNTIME'S CLAUDE CLI SAYS about its own sign-in, through the official CLI only (`claude auth status --json`),
// asked at most every few seconds. This is the RUNTIME's sign-in -- the one Claude Code runs under -- and never, by
// itself, a browser's: a browser is signed in only when it finished a sign-in (accounts.service.ts).
//
// Only a Claude account counts (`authMethod: "claude.ai"`): an API key or a token is not an account, and the container's
// own credential variables never reach the CLI (env.ts). The identity is the CLI's account email (lower case) in the
// organization it names by id -- never by its display name.
import { Inject, Injectable } from "@nestjs/common";
import { CLAUDE_ACCOUNT_METHOD, type ClaudeAccount, type ConnectionState } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { claudeEnv, ignoredClaudeCredentials } from "../../infra/process/env.js";
import { endedHow, type ProcessPort } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import type { VerifiedIdentity } from "./accounts.service.js";

export interface CliStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgId: string | null;
  orgName: string | null;
  subscriptionType: string | null;
}

// What the CLI says about the runtime's sign-in.
export interface RuntimeSignIn {
  state: ConnectionState;
  method: string | null;
  account: ClaudeAccount | null;
  detail: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// `claude auth status --json`; anything else is not an answer.
export function parseClaudeStatus(stdout: string): CliStatus | null {
  try {
    const json = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof json.loggedIn !== "boolean") return null;
    return {
      loggedIn: json.loggedIn,
      authMethod: text(json.authMethod),
      apiProvider: text(json.apiProvider),
      email: text(json.email),
      orgId: text(json.orgId),
      orgName: text(json.orgName),
      subscriptionType: text(json.subscriptionType),
    };
  } catch {
    return null;
  }
}

// The identity a Claude account sign-in is (null: no Claude account, or one the CLI names no email for). The organization
// is the CLI's id for it; when the CLI names none the identity is the email alone -- a display name never stands in.
export function identityOf(cli: CliStatus): VerifiedIdentity | null {
  if (!cli.loggedIn || cli.authMethod !== CLAUDE_ACCOUNT_METHOD || cli.email === null) return null;
  const email = cli.email.toLowerCase();
  const orgKey = cli.orgId ?? "";
  return { email, orgKey, orgName: cli.orgName, plan: cli.subscriptionType, key: `${email}|${orgKey}` };
}

// Whether what the CLI said signs the runtime in: only a Claude account does. `ignored` names the credential variables the
// container was started with, which never reach the CLI; the page says so.
export function signInOf(cli: CliStatus, ignored: readonly string[]): RuntimeSignIn {
  const note = ignored.length > 0 ? `This container was started with ${ignored.join(", ")}; Orbit Web ignores ${ignored.length === 1 ? "it" : "them"}: it signs in with a Claude account only.` : null;
  if (cli.loggedIn && cli.authMethod === CLAUDE_ACCOUNT_METHOD) {
    return { state: "connected", method: cli.authMethod, account: { email: cli.email, organization: cli.orgName, plan: cli.subscriptionType }, detail: note };
  }
  const other = cli.loggedIn ? `The Claude CLI is signed in with ${cli.authMethod ?? "a credential"}, which is not a Claude account. Sign in with your Claude account.` : null;
  return { state: "not_connected", method: cli.loggedIn ? cli.authMethod : null, account: null, detail: [other, note].filter((s) => s !== null).join(" ") || null };
}

interface Asked {
  signIn: RuntimeSignIn;
  identity: VerifiedIdentity | null;
}

const unavailable = (detail: string): Asked => ({ signIn: { state: "unavailable", method: null, account: null, detail }, identity: null });

const CACHE_MS = 10_000;

@Injectable()
export class ClaudeCli {
  private cached: { at: number; value: Promise<Asked> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  // The runtime's sign-in, asked of the CLI at most every few seconds (the gate asks it on every request).
  async signIn(fresh = false): Promise<RuntimeSignIn> {
    return (await this.asked(fresh)).signIn;
  }

  // The identity the runtime's CLI holds (null: none, or not a Claude account with an email).
  async identity(fresh = false): Promise<VerifiedIdentity | null> {
    return (await this.asked(fresh)).identity;
  }

  // What was read before is stale (a sign-in or a sign-out just ran).
  forget(): void {
    this.cached = null;
  }

  private asked(fresh: boolean): Promise<Asked> {
    if (!fresh && this.cached !== null && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = this.ask();
    this.cached = { at: Date.now(), value };
    return value;
  }

  private async ask(): Promise<Asked> {
    const r = await this.process.run(this.config.binaries.claude, ["auth", "status", "--json"], { cwd: this.config.data.home, env: claudeEnv(this.config), timeoutMs: this.config.limits.commandTimeoutMs });
    if (r.spawnError !== null || r.timedOut) return unavailable(`claude auth status ${endedHow(r)}`);
    const parsed = parseClaudeStatus(r.stdout.trim());
    if (parsed === null) return unavailable(`claude auth status gave no answer (${endedHow(r)}): ${tail(r.stderr, 2)}`);
    return { signIn: signInOf(parsed, ignoredClaudeCredentials(this.config)), identity: identityOf(parsed) };
  }
}
