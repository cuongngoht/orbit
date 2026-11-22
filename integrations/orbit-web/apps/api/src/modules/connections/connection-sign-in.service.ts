// SIGNING A SUBSCRIPTION CONNECTION IN FROM ITS CARD (ADR 0068). The provider's own, unmodified sign-in (runtimes.ts:
// `claude auth login --claudeai`, `codex login --device-auth`) is run by Orbit Web with that one connection's home --
// exactly what the terminal's cli/connect.js runs -- and the page follows it: the URL the CLI printed (and Codex's
// one-time code) is shown to the browser that started it, and the code a person pastes for Claude Code is written to
// that process's stdin. Nothing of it is kept: no URL, code or token is written to the database, a log, the audit record
// or an event; the CLI keeps its own login in the connection's home, as from the terminal.
//
//   ONE BROWSER. A sign-in belongs to the browser session that started it: only that session sees its URL and code,
//   sends the code, or cancels it. Another browser of the account sees that one is under way, and by whom.
//   ONE AT A TIME, per connection. A connected one may be signed in again (Reconnect): with the same identity it stays
//   connected; with another, probe.ts makes it `identity_changed` -- who a connection is changes only by disconnecting.
//   VERIFIED, NOT SAID. It ends connected only when the CLI's own status names the identity (probe.ts), held to ONE
//   IDENTITY, ONE ACCOUNT -- the CLI exiting 0 proves nothing by itself.
//
// The operator may switch it off (ORBIT_WEB_SIGN_IN_ON_PAGE=0): then the terminal is the only way, as before.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { CONNECTION_ERRORS, LOGIN_ACTIVE, RUNTIME_LABELS, checkSignInCode, type ConnectionSignIn, type LoginSnapshot } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, notFound } from "../../common/errors.js";
import { LoginFlow, lastWords, type LoginDriver } from "../../common/login-flow.js";
import { ConnectionStore, type ConnectionRecord } from "../../infra/connections/stores.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import type { GovernanceContext, Owner } from "../auth/principal.js";
import { ConnectionsService } from "./connections.service.js";
import { ConnectionProbe } from "./probe.js";
import { RUNTIME_SPECS } from "./runtimes.js";
import { SIGN_IN_READERS, signsInHere, type SignInReader } from "./sign-in.js";

interface Attempt {
  connectionId: string;
  accountId: string;
  // The browser session that started it.
  sessionId: string;
  startedBy: string;
  flow: LoginFlow;
  endedAt: number | null;
}

// An ended sign-in's outcome stays readable this long (the page that started it shows how it ended), then goes.
const KEEP_ENDED_MS = 10 * 60_000;

const idle = (): LoginSnapshot => ({ state: "idle", url: null, code: null, needsCode: false, message: null, startedAt: null, updatedAt: new Date().toISOString() });

@Injectable()
export class ConnectionSignInService {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(ConnectionStore) private readonly connections: ConnectionStore,
    @Inject(ConnectionProbe) private readonly probe: ConnectionProbe,
    @Inject(ConnectionsService) private readonly service: ConnectionsService,
  ) {}

  // GET: this connection's sign-in, as this browser may see it.
  async status(owner: Owner, id: string): Promise<ConnectionSignIn> {
    const c = await this.own(owner, id);
    this.prune();
    const attempt = this.attempts.get(c.id);
    return attempt === undefined || attempt.accountId !== owner.accountId ? { connectionId: c.id, mine: false, startedBy: null, flow: idle() } : this.viewOf(attempt, owner);
  }

  // POST: starts the CLI's own sign-in for this connection -- or returns the one this browser has under way.
  async start(owner: Owner, ctx: GovernanceContext, id: string): Promise<ConnectionSignIn> {
    const c = await this.own(owner, id);
    const reader = this.readerOf(c);
    const installation = await this.probe.installation(c.runtime, 60_000);
    if (installation.state !== "installed") throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.notInstalled, installation.detail ?? `${RUNTIME_LABELS[c.runtime]} is not installed on this server.`);
    this.prune();
    const current = this.attempts.get(c.id);
    if (current !== undefined && current.flow.active()) {
      if (current.sessionId === owner.sessionId) return this.viewOf(current, owner);
      throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.signInBusy, `${current.startedBy} is signing "${c.label}" in right now, from another browser. Wait for it to end, or cancel it there.`);
    }
    const attempt: Attempt = { connectionId: c.id, accountId: c.accountId, sessionId: owner.sessionId, startedBy: owner.fullName || owner.username, flow: new LoginFlow(this.process), endedAt: null };
    attempt.flow.subscribe((s) => {
      if (!LOGIN_ACTIVE.includes(s.state) && attempt.endedAt === null) attempt.endedAt = Date.now();
    });
    this.attempts.set(c.id, attempt);
    await this.service.signInStarted(ctx, c);
    attempt.flow.start(this.driver(c, reader, ctx));
    return this.viewOf(attempt, owner);
  }

  // POST …/code: the code a person copied from Claude's page, to the CLI's stdin -- and nowhere else.
  async submit(owner: Owner, id: string, body: unknown): Promise<ConnectionSignIn> {
    const { code } = accepted(checkSignInCode(body));
    const attempt = await this.mine(owner, id);
    attempt.flow.submit(code);
    return this.viewOf(attempt, owner);
  }

  // POST …/cancel: stops the CLI's sign-in (any browser of the account may: it only ends a sign-in under way).
  async cancel(owner: Owner, id: string): Promise<ConnectionSignIn> {
    const c = await this.own(owner, id);
    const attempt = this.attempts.get(c.id);
    if (attempt === undefined || attempt.accountId !== owner.accountId) return { connectionId: c.id, mine: false, startedBy: null, flow: idle() };
    attempt.flow.cancel();
    return this.viewOf(attempt, owner);
  }

  // The view of an attempt for this browser: its URL and codes only for the browser that started it.
  private viewOf(a: Attempt, owner: Owner): ConnectionSignIn {
    const mine = a.sessionId === owner.sessionId;
    const flow = a.flow.current();
    return { connectionId: a.connectionId, mine, startedBy: a.startedBy, flow: mine ? flow : { ...flow, url: null, code: null, needsCode: false } };
  }

  private async mine(owner: Owner, id: string): Promise<Attempt> {
    const c = await this.own(owner, id);
    const attempt = this.attempts.get(c.id);
    if (attempt === undefined || attempt.sessionId !== owner.sessionId || !attempt.flow.active()) throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.noSignIn, "This browser has no sign-in under way for this connection: start one from its card.");
    return attempt;
  }

  private readerOf(c: ConnectionRecord): SignInReader {
    const reader = SIGN_IN_READERS[c.runtime];
    if (!this.config.signInOnPage) throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.signInNotOffered, "Signing in from this page is switched off on this server (ORBIT_WEB_SIGN_IN_ON_PAGE=0): run the command on the card in a terminal of the server.");
    if (!signsInHere(c) || reader === undefined) throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.signInNotOffered, `"${c.label}" is not signed in by a subscription sign-in Orbit Web can run: ${c.method === "api_key" ? "it takes an API key (Reconnect replaces it)" : c.method === "cloud" ? "it uses a cloud provider's settings" : `${RUNTIME_LABELS[c.runtime]} has no sign-in Orbit Web offers`}.`);
    return reader;
  }

  // The account's own connection (another account's -- or a removed one -- is not found).
  private async own(owner: Owner, id: string): Promise<ConnectionRecord> {
    const c = /^[0-9a-f-]{36}$/.test(id) ? await this.connections.get(owner.accountId, id) : null;
    if (c === null) throw notFound("The connection");
    return c;
  }

  // Ended attempts are dropped once their outcome is old.
  private prune(): void {
    const now = Date.now();
    for (const [id, a] of this.attempts) if (a.endedAt !== null && now - a.endedAt > KEEP_ENDED_MS) this.attempts.delete(id);
  }

  private driver(c: ConnectionRecord, reader: SignInReader, ctx: GovernanceContext): LoginDriver {
    const spec = RUNTIME_SPECS[c.runtime];
    return {
      file: this.probe.binaryOf(c.runtime),
      args: spec.login as string[],
      cwd: this.config.data.home,
      env: this.probe.envOf(c),
      timeoutMs: this.config.limits.loginTimeoutMs,
      read: reader.read,
      ready: reader.ready,
      // Connected only when the CLI's own status names the identity, held to one identity, one account.
      verify: async () => {
        const now = await this.connections.get(c.accountId, c.id);
        if (now === null) return { ok: false, message: "The connection was removed while it was being signed in." };
        const after = await this.service.signedIn(ctx, now);
        if (after.authState === "connected") return { ok: true, message: `Connected: ${spec.label} says it is signed in as ${after.identity ?? "an identity"}.` };
        return { ok: false, message: after.reason ?? `${spec.label} finished, but its own status does not say it is signed in.` };
      },
      failure: (output, exit) => lastWords(output, exit),
    };
  }
}
