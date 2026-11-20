// THE AZURE ACCOUNT, through the official Azure CLI only: `az login --use-device-code` (the CLI prints a URL and a
// one-time code; a person enters the code there), `az account show` to say whether a sign-in is held, `az logout` to end
// it. The CLI keeps its sign-in in AZURE_CONFIG_DIR (/data/azure), a profile of Orbit Web's own -- never Orbit's own
// Azure CLI profile, which Orbit keeps for its own connections (ADR 0043). Orbit Web never asks the CLI for a token.
// Optional: the chat workspace never waits for it, and Claude Code is given it only when a person allows it.
import { Inject, Injectable } from "@nestjs/common";
import type { AzureAccount, AzureStatus, ConnectionState, LoginSnapshot } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { LoginFlow, lastWords, type LoginDriver, type LoginFields } from "../../common/login-flow.js";
import { azureEnv } from "../../infra/process/env.js";
import { endedHow, succeeded, type ProcessPort } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SettingsService } from "../settings/settings.module.js";

export interface AzureConnection {
  state: ConnectionState;
  account: AzureAccount | null;
  detail: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

// `az account show --output json`: { user: { name, type }, tenantId, name, id, ... }.
export function parseAzAccount(stdout: string): AzureAccount | null {
  try {
    const json = JSON.parse(stdout) as unknown;
    if (!isRecord(json) || !isRecord(json.user) || typeof json.user.name !== "string") return null;
    return { user: json.user.name, userType: str(json.user.type), tenantId: str(json.tenantId), subscription: str(json.name), subscriptionId: str(json.id) };
  } catch {
    return null;
  }
}

// What `az login --use-device-code` printed so far: "To sign in, use a web browser to open the page <url> and enter
// the code <code> to authenticate."
export function readAzLogin(output: string): LoginFields {
  const m = [...output.matchAll(/open the page\s+(https:\/\/\S+)\s+and enter the code\s+([A-Z0-9]{6,16})\b/g)].at(-1);
  return { url: m?.[1] ?? null, code: m?.[2] ?? null };
}

// A sign-in the CLI does not hold: what `az account show` says when nobody signed in.
const signedOut = (stderr: string): boolean => /az login|not logged in|no subscription/i.test(stderr);

const CACHE_MS = 10_000;

@Injectable()
export class AzureAuthService {
  private readonly flow: LoginFlow;
  private cached: { at: number; value: Promise<AzureConnection> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {
    this.flow = new LoginFlow(process);
    // The sign-in flow is told to every page on the app stream; its end, with what az says now.
    this.flow.subscribe((flow) => {
      this.bus.publishApp("connector.flow", { connector: "azure", flow });
      if (flow.state === "connected" || flow.state === "failed") void this.connection().then((c) => this.announce(c));
    });
  }

  private announce(c: AzureConnection): void {
    this.bus.publishApp("connector.status", { connector: "azure", state: c.state, account: c.account?.user ?? null });
  }

  async status(): Promise<AzureStatus> {
    return { ...(await this.connection()), flow: this.flow.current(), availableToClaude: this.settings.get().azureForClaude };
  }

  connection(fresh = false): Promise<AzureConnection> {
    if (!fresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = this.ask();
    this.cached = { at: Date.now(), value };
    return value;
  }

  login(tenant: string | undefined): LoginSnapshot {
    this.cached = null;
    return this.flow.start(this.driver(tenant));
  }

  cancel(): LoginSnapshot {
    return this.flow.cancel();
  }

  async logout(): Promise<AzureStatus> {
    const r = await this.az(["logout"]);
    this.cached = null;
    this.flow.reset();
    const status = await this.status();
    this.announce(status);
    if (!succeeded(r) && status.state === "connected") return { ...status, detail: `az logout ${endedHow(r)}: ${tail(r.stderr, 2)}` };
    return status;
  }

  private az(args: string[], timeoutMs = 60_000) {
    return this.process.run(this.config.binaries.az, args, { cwd: this.config.controlHome, env: azureEnv(this.config), timeoutMs });
  }

  private async ask(): Promise<AzureConnection> {
    const r = await this.az(["account", "show", "--output", "json"]);
    if (r.spawnError !== null) return { state: "unavailable", account: null, detail: "The Azure CLI is not installed in this image." };
    if (r.timedOut) return { state: "unavailable", account: null, detail: "az account show timed out." };
    const account = r.code === 0 ? parseAzAccount(r.stdout) : null;
    if (account !== null) return { state: "connected", account, detail: null };
    if (signedOut(r.stderr)) return { state: "not_connected", account: null, detail: null };
    return { state: "unavailable", account: null, detail: `az account show ${endedHow(r)}: ${tail(r.stderr, 2)}` };
  }

  private driver(tenant: string | undefined): LoginDriver {
    return {
      file: this.config.binaries.az,
      args: ["login", "--use-device-code", "--allow-no-subscriptions", "--output", "none", ...(tenant ? ["--tenant", tenant] : [])],
      cwd: this.config.controlHome,
      env: azureEnv(this.config),
      timeoutMs: this.config.limits.loginTimeoutMs,
      read: readAzLogin,
      ready: (f) => typeof f.url === "string" && typeof f.code === "string",
      verify: async () => {
        const c = await this.connection(true);
        return c.state === "connected" ? { ok: true, message: `Signed in to Azure as ${c.account?.user}.` } : { ok: false, message: c.detail ?? "az finished, but `az account show` does not report a sign-in." };
      },
      failure: (output, exit) => lastWords(output, exit),
    };
  }
}
