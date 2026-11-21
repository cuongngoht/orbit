// THE GITHUB ACCOUNT, through GitHub CLI only: `gh auth login --web` (the device flow: the CLI prints a one-time
// code and https://github.com/login/device; a person enters the code there), `gh auth status` plus `gh api user` to
// decide whether it holds, `gh auth logout` to end it. No GitHub App, no OAuth app of Orbit Web's own, no personal
// access token typed anywhere. What is kept beside gh's own state is the account's login and name, never a token.
import { Inject, Injectable } from "@nestjs/common";
import type { ConnectionState, GitHubAccount, GitHubStatus, LoginSnapshot } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { EventBus, everyone } from "../../core/events/event-bus.js";
import { viewer } from "../../common/request-scope.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { LoginFlow, lastWords, type LoginDriver, type LoginFields } from "../../common/login-flow.js";
import { ghEnv } from "../../infra/process/env.js";
import { endedHow, succeeded, type ProcessPort } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SettingsStore } from "../../infra/storage/stores.js";
import { SettingsService } from "../settings/settings.module.js";
import { GhGateway, parseAuthHosts, parseUser } from "./gh.gateway.js";

export interface GitHubConnection {
  state: ConnectionState;
  account: GitHubAccount | null;
  detail: string | null;
}

const ACCOUNT_KEY = "github.account";
const CACHE_MS = 15_000;

// What `gh auth login --web` printed so far: its one-time code and the URL to enter it at.
export function readGhLogin(output: string): LoginFields {
  const code = [...output.matchAll(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/g)].at(-1)?.[1] ?? null;
  const url = [...output.matchAll(/continue in your web browser:\s*(https:\/\/\S+)/g)].at(-1)?.[1] ?? null;
  const done = /Authentication complete/i.test(output);
  return { code, url, message: done ? "GitHub accepted the sign-in; checking it with gh…" : null };
}

@Injectable()
export class GithubAuthService {
  private readonly flow: LoginFlow;
  private cached: { at: number; value: Promise<GitHubConnection> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) process: ProcessPort,
    @Inject(GhGateway) private readonly gh: GhGateway,
    @Inject(SettingsStore) private readonly settings: SettingsStore,
    @Inject(SettingsService) private readonly prefs: SettingsService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {
    this.flow = new LoginFlow(process);
    // The sign-in flow is told to every signed-in page on the app stream (GitHub CLI's sign-in is the deployment's, not
    // one account's); its end, with what gh says now.
    this.flow.subscribe((flow) => {
      this.bus.publishApp("connector.flow", { connector: "github", flow }, everyone);
      if (flow.state === "connected" || flow.state === "failed") void this.connection().then((c) => this.announce(c)).catch(() => undefined);
    });
  }

  private announce(c: GitHubConnection): void {
    this.bus.publishApp("connector.status", { connector: "github", state: c.state, account: c.account?.login ?? null }, everyone);
  }

  // As the account of the request sees it: whether ITS chats may use the sign-in is its own switch.
  async status(): Promise<GitHubStatus> {
    return { ...(await this.connection()), flow: this.flow.current(), availableToClaude: (await this.prefs.get(viewer().accountId)).githubForClaude };
  }

  connection(fresh = false): Promise<GitHubConnection> {
    if (!fresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = this.ask();
    this.cached = { at: Date.now(), value };
    return value;
  }

  login(): LoginSnapshot {
    this.cached = null;
    return this.flow.start(this.driver());
  }

  cancel(): LoginSnapshot {
    return this.flow.cancel();
  }

  // Ends gh's local sign-in for the account it holds. GitHub keeps the authorization it granted until a person
  // revokes it in their GitHub settings (Applications); the page says so.
  async logout(): Promise<GitHubStatus> {
    const hosts = parseAuthHosts((await this.gh.authStatus()).stdout);
    const logins = (hosts ?? []).map((h) => h.login).filter((l): l is string => l !== null);
    const failures: string[] = [];
    for (const login of logins) {
      const r = await this.gh.logout(login);
      if (!succeeded(r)) failures.push(`${login}: ${endedHow(r)} ${tail(r.stderr, 2)}`);
    }
    await this.settings.delete(ACCOUNT_KEY);
    this.cached = null;
    this.flow.reset();
    const status = await this.status();
    this.announce(status);
    return failures.length > 0 ? { ...status, detail: `gh auth logout did not finish: ${failures.join("; ")}` } : status;
  }

  private async ask(): Promise<GitHubConnection> {
    const r = await this.gh.authStatus();
    if (r.spawnError !== null || r.timedOut) return { state: "unavailable", account: null, detail: `gh auth status ${endedHow(r)}` };
    const hosts = parseAuthHosts(r.stdout);
    if (hosts === null) return { state: "unavailable", account: null, detail: `gh auth status gave no answer: ${tail(r.stderr, 2)}` };
    const active = hosts.find((h) => h.active) ?? hosts[0];
    if (active === undefined) return { state: "not_connected", account: null, detail: null };
    if (active.state !== "success") return { state: "expired", account: await this.remembered(), detail: `gh says the sign-in is ${active.state}${active.error ? `: ${active.error}` : ""}. Connect again.` };
    return this.verifiedByApi();
  }

  // A sign-in counts only when the API answers with it.
  private async verifiedByApi(): Promise<GitHubConnection> {
    const r = await this.gh.user();
    const user = succeeded(r) ? parseUser(r.stdout) : null;
    if (user === null) {
      const expired = /\b401\b|Bad credentials|token.*(expired|revoked)/i.test(r.stderr);
      return { state: expired ? "expired" : "unavailable", account: await this.remembered(), detail: `gh api user ${endedHow(r)}: ${tail(r.stderr, 2)}` };
    }
    const account = { login: user.login, name: user.name };
    await this.settings.set(ACCOUNT_KEY, { ...account, id: user.id, verifiedAt: new Date().toISOString() });
    return { state: "connected", account, detail: null };
  }

  private async remembered(): Promise<GitHubAccount | null> {
    const saved = await this.settings.get<{ login?: string; name?: string | null }>(ACCOUNT_KEY);
    return saved?.login ? { login: saved.login, name: saved.name ?? null } : null;
  }

  // The verified account's id, for a noreply commit address.
  async accountId(): Promise<number | null> {
    return (await this.settings.get<{ id?: number | null }>(ACCOUNT_KEY))?.id ?? null;
  }

  private driver(): LoginDriver {
    return {
      file: this.config.binaries.gh,
      args: this.gh.loginArgs(),
      cwd: this.config.controlHome,
      env: ghEnv(this.config),
      timeoutMs: this.config.limits.loginTimeoutMs,
      read: readGhLogin,
      ready: (f) => typeof f.url === "string" && typeof f.code === "string",
      verify: async () => {
        const c = await this.connection(true);
        return c.state === "connected" ? { ok: true, message: `Connected as ${c.account?.login}.` } : { ok: false, message: c.detail ?? "gh finished, but `gh auth status` does not report a sign-in." };
      },
      failure: (output, exit) => lastWords(output, exit),
    };
  }
}
