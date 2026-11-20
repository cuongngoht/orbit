// THE CLAUDE ACCOUNT, which is also THE SIGN-IN OF ORBIT WEB, through the official CLI only: `claude auth status` says
// whether it is signed in and to which account, `claude auth login --claudeai` signs in (a person opens the URL it
// prints and pastes back the code the page shows, which is handed to that process's stdin and nowhere else),
// `claude auth logout` signs out. Only a Claude account signs Orbit Web in (`authMethod: "claude.ai"`): an API key or a
// token is not an account, and the container's own credential variables never reach the CLI (env.ts). Until an account
// is signed in, the API answers nothing but the health check, the access token and this sign-in
// (claude-sign-in.guard.ts). The CLI keeps its credential in CLAUDE_CONFIG_DIR (/data/claude); Orbit Web never reads it.
import { Inject, Injectable } from "@nestjs/common";
import { CLAUDE_ACCOUNT_METHOD, LOGIN_ACTIVE, type ClaudeStatus, type LoginSnapshot } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { conflict } from "../../common/errors.js";
import { LoginFlow, lastWords, type LoginDriver, type LoginFields } from "../../common/login-flow.js";
import { SignInChannel } from "../../infra/egress/sign-in-channel.js";
import { claudeEnv, egressProxyEnv, ignoredClaudeCredentials } from "../../infra/process/env.js";
import { endedHow, type ProcessPort } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SessionStore } from "../../infra/storage/stores.js";

// What the CLI says about the sign-in, without the flow that may be changing it.
export type ClaudeSignIn = Omit<ClaudeStatus, "flow">;

export interface CliStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
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
      orgName: text(json.orgName),
      subscriptionType: text(json.subscriptionType),
    };
  } catch {
    return null;
  }
}

// Whether what the CLI said signs Orbit Web in: only a Claude account does. `ignored` names the credential variables
// the container was started with, which never reach the CLI; the page says so.
export function signInOf(cli: CliStatus, ignored: readonly string[]): ClaudeSignIn {
  const note = ignored.length > 0 ? `This container was started with ${ignored.join(", ")}; Orbit Web ignores ${ignored.length === 1 ? "it" : "them"}: it signs in with a Claude account only.` : null;
  if (cli.loggedIn && cli.authMethod === CLAUDE_ACCOUNT_METHOD) {
    return { state: "connected", method: cli.authMethod, account: { email: cli.email, organization: cli.orgName, plan: cli.subscriptionType }, detail: note };
  }
  const other = cli.loggedIn ? `The Claude CLI is signed in with ${cli.authMethod ?? "a credential"}, which is not a Claude account. Sign in with your Claude account.` : null;
  return { state: "not_connected", method: cli.loggedIn ? cli.authMethod : null, account: null, detail: [other, note].filter((s) => s !== null).join(" ") || null };
}

const unavailable = (detail: string): ClaudeSignIn => ({ state: "unavailable", method: null, account: null, detail });

// What `claude auth login` printed so far: the URL after "visit:", and whether it asks for the code.
export function readClaudeLogin(output: string): LoginFields {
  const visit = [...output.matchAll(/visit:\s*(https:\/\/\S+)/g)].at(-1)?.[1] ?? null;
  const any = visit ?? [...output.matchAll(/(https:\/\/\S*(?:oauth|authorize)\S*)/g)].at(-1)?.[1] ?? null;
  return { url: any, needsCode: /paste code here/i.test(output) };
}

const CACHE_MS = 10_000;

@Injectable()
export class ClaudeAuthService {
  private readonly flow: LoginFlow;
  private cached: { at: number; value: Promise<ClaudeSignIn> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(SignInChannel) private readonly channel: SignInChannel,
  ) {
    this.flow = new LoginFlow(process);
    // The sign-in's way out (governed deployment) ends with the sign-in, however it ended.
    this.flow.subscribe((s) => {
      if (!LOGIN_ACTIVE.includes(s.state)) this.channel.close();
    });
  }

  async status(): Promise<ClaudeStatus> {
    return { ...(await this.account()), flow: this.flow.current() };
  }

  // The sign-in, asked of the CLI at most every few seconds: the gate asks it on every request.
  account(fresh = false): Promise<ClaudeSignIn> {
    if (!fresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = this.ask();
    this.cached = { at: Date.now(), value };
    return value;
  }

  login(): LoginSnapshot {
    this.cached = null;
    if (this.flow.active()) return this.flow.current();
    return this.flow.start(this.driver());
  }

  submitCode(code: string): LoginSnapshot {
    return this.flow.submit(code);
  }

  cancel(): LoginSnapshot {
    return this.flow.cancel();
  }

  subscribe(listener: (s: LoginSnapshot) => void): () => void {
    return this.flow.subscribe(listener);
  }

  flowSnapshot(): LoginSnapshot {
    return this.flow.current();
  }

  // Signing out signs Orbit Web out. Never while Claude Code works for the account (or a workspace is being prepared,
  // which ends by sending the chat's first message): what the account started would go on after it signed out.
  async logout(): Promise<ClaudeStatus> {
    this.refuseWhileWorking();
    const r = await this.process.run(this.config.binaries.claude, ["auth", "logout"], this.options());
    this.cached = null;
    this.flow.reset();
    const status = await this.status();
    if (r.code !== 0 && status.state === "connected") return { ...status, detail: `claude auth logout ${endedHow(r)}: ${tail(r.stderr || r.stdout, 3)}` };
    return status;
  }

  private refuseWhileWorking(): void {
    const running = this.sessions.withStatus("running").length;
    const preparing = this.sessions.withStatus("preparing").length;
    if (running > 0) throw conflict("run_active", `Claude is still working in ${running === 1 ? "a chat" : `${running} chats`}. Stop ${running === 1 ? "it" : "them"} before signing out.`);
    if (preparing > 0) throw conflict("workspace_preparing", "A chat's workspace is still being prepared. Wait until it is ready (or fails) before signing out.");
  }

  private options() {
    return { cwd: this.config.data.home, env: claudeEnv(this.config), timeoutMs: this.config.limits.commandTimeoutMs };
  }

  private async ask(): Promise<ClaudeSignIn> {
    const r = await this.process.run(this.config.binaries.claude, ["auth", "status", "--json"], this.options());
    if (r.spawnError !== null || r.timedOut) return unavailable(`claude auth status ${endedHow(r)}`);
    const parsed = parseClaudeStatus(r.stdout.trim());
    if (parsed === null) return unavailable(`claude auth status gave no answer (${endedHow(r)}): ${tail(r.stderr, 2)}`);
    return signInOf(parsed, ignoredClaudeCredentials(this.config));
  }

  // In the governed deployment the sign-in runs in the agent's container, whose only way out is the egress proxy: it
  // is given a channel of its own there (infra/egress/sign-in-channel.ts), for as long as a sign-in may take. In the
  // single deployment it goes out as it always did.
  private wayOut(): Record<string, string> {
    const g = this.config.governance;
    if (g.deployment !== "governed" || g.proxyPort === null) return {};
    return egressProxyEnv(g.agentControlHost, g.proxyPort, "signin", this.channel.open(this.config.limits.loginTimeoutMs + 60_000));
  }

  private driver(): LoginDriver {
    return {
      file: this.config.binaries.claude,
      args: ["auth", "login", "--claudeai"],
      cwd: this.config.data.home,
      env: { ...claudeEnv(this.config), ...this.wayOut() },
      timeoutMs: this.config.limits.loginTimeoutMs,
      read: readClaudeLogin,
      ready: (f) => typeof f.url === "string" && f.url.length > 0,
      verify: async () => {
        const account = await this.account(true);
        if (account.state === "connected") return { ok: true, message: `Signed in to Claude${account.account?.email ? ` as ${account.account.email}` : ""}.` };
        return { ok: false, message: account.detail ?? "The Claude CLI finished, but `claude auth status` does not report a Claude account." };
      },
      failure: (output, exit) => lastWords(output, exit),
    };
  }
}
