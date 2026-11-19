// THE CLAUDE ACCOUNT, through the official CLI only: `claude auth status` says whether it is signed in,
// `claude auth login` signs in (a person opens the URL it prints and pastes back the code the page shows, which is
// handed to that process's stdin and nowhere else), `claude auth logout` signs out. The CLI keeps its credential in
// CLAUDE_CONFIG_DIR (/data/claude); Orbit Web never reads it.
import { Inject, Injectable } from "@nestjs/common";
import type { ClaudeLoginMode, ClaudeStatus, ConnectionState, LoginSnapshot } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { LoginFlow, lastWords, type LoginDriver, type LoginFields } from "../../common/login-flow.js";
import { claudeEnv, hasClaudeEnvCredential } from "../../infra/process/env.js";
import { endedHow, type ProcessPort } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";

export interface ClaudeAccount {
  state: ConnectionState;
  method: string | null;
  source: "cli" | "environment" | null;
  detail: string | null;
}

interface CliStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
}

// `claude auth status` prints JSON (its default); anything else is not an answer.
export function parseClaudeStatus(stdout: string): CliStatus | null {
  try {
    const json = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof json.loggedIn !== "boolean") return null;
    return {
      loggedIn: json.loggedIn,
      authMethod: typeof json.authMethod === "string" ? json.authMethod : null,
      apiProvider: typeof json.apiProvider === "string" ? json.apiProvider : null,
    };
  } catch {
    return null;
  }
}

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
  private cached: { at: number; value: Promise<ClaudeAccount> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
  ) {
    this.flow = new LoginFlow(process);
  }

  async status(): Promise<ClaudeStatus> {
    return { ...(await this.account()), flow: this.flow.current() };
  }

  account(fresh = false): Promise<ClaudeAccount> {
    if (!fresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = this.ask();
    this.cached = { at: Date.now(), value };
    return value;
  }

  login(mode: ClaudeLoginMode): LoginSnapshot {
    this.cached = null;
    return this.flow.start(this.driver(mode));
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

  async logout(): Promise<ClaudeStatus> {
    const r = await this.process.run(this.config.binaries.claude, ["auth", "logout"], this.options());
    this.cached = null;
    this.flow.reset();
    const status = await this.status();
    if (r.code !== 0 && status.state === "connected") return { ...status, detail: `claude auth logout ${endedHow(r)}: ${tail(r.stderr || r.stdout, 3)}` };
    return status;
  }

  private options() {
    return { cwd: this.config.data.home, env: claudeEnv(this.config), timeoutMs: this.config.limits.commandTimeoutMs };
  }

  private async ask(): Promise<ClaudeAccount> {
    const r = await this.process.run(this.config.binaries.claude, ["auth", "status", "--json"], this.options());
    if (r.spawnError !== null || r.timedOut) return { state: "unavailable", method: null, source: null, detail: `claude auth status ${endedHow(r)}` };
    const parsed = parseClaudeStatus(r.stdout.trim());
    if (parsed === null) return { state: "unavailable", method: null, source: null, detail: `claude auth status gave no answer (${endedHow(r)}): ${tail(r.stderr, 2)}` };
    const environment = hasClaudeEnvCredential(this.config);
    return {
      state: parsed.loggedIn ? "connected" : "not_connected",
      method: parsed.authMethod,
      source: parsed.loggedIn ? (environment ? "environment" : "cli") : null,
      detail: environment ? "The container was started with a Claude credential variable; Claude Code uses it before any sign-in." : null,
    };
  }

  private driver(mode: ClaudeLoginMode): LoginDriver {
    return {
      file: this.config.binaries.claude,
      args: ["auth", "login", mode === "console" ? "--console" : "--claudeai"],
      cwd: this.config.data.home,
      env: claudeEnv(this.config),
      timeoutMs: this.config.limits.loginTimeoutMs,
      read: readClaudeLogin,
      ready: (f) => typeof f.url === "string" && f.url.length > 0,
      verify: async () => {
        const account = await this.account(true);
        return account.state === "connected"
          ? { ok: true, message: "Signed in to Claude." }
          : { ok: false, message: "The Claude CLI finished, but `claude auth status` does not report a sign-in." };
      },
      failure: (output, exit) => lastWords(output, exit),
    };
  }
}
