// THE CLAUDE SIGN-IN, which is also THE SIGN-IN OF ORBIT WEB -- a BROWSER's, through the official CLI only:
// `claude auth login --claudeai` signs in (a person opens the URL it prints and pastes back the code the page shows, which
// is handed to that process's stdin and nowhere else), `claude auth status` verifies it, `claude auth logout` signs out.
// Orbit Web never reads the CLI's credential file and never holds an OAuth token.
//
// A sign-in belongs to the browser that STARTED it: starting one sets an unguessable nonce in an HttpOnly cookie, and
// only the browser holding it sees that flow, sends its code, cancels it or -- once the CLI's own status verified the
// sign-in -- exchanges it, once, for a browser session (accounts.service.ts). Another browser polling the status sees
// nothing of it and can take nothing from it. A browser that has no session is signed in by running the flow again,
// even when the runtime's CLI is signed in already: the CLI being signed in is not this browser being signed in.
//
// The CLI holds one sign-in at a time: one flow runs at a time, and a flow that would sign the CLI in again is refused
// while Claude works for the account (a run would change identity under it).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { IDENTITY_MISMATCH, LOGIN_ACTIVE, SIGN_IN_BUSY, type ClaudeStatus, type LoginSnapshot } from "@orbit-web/contracts";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { ApiError, conflict } from "../../common/errors.js";
import { LoginFlow, lastWords, type LoginDriver, type LoginFields } from "../../common/login-flow.js";
import { SignInChannel } from "../../infra/egress/sign-in-channel.js";
import { sha256 } from "../../infra/accounts/stores.js";
import { claudeEnv, egressProxyEnv } from "../../infra/process/env.js";
import { endedHow, type ProcessPort } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SessionStore } from "../../infra/storage/stores.js";
import { AccountsService, type Issued, type VerifiedIdentity } from "../auth/accounts.service.js";
import { ClaudeCli } from "../auth/claude-cli.service.js";
import type { Owner } from "../auth/principal.js";

export { identityOf, parseClaudeStatus, signInOf, type CliStatus } from "../auth/claude-cli.service.js";

// What `claude auth login` printed so far: the URL after "visit:", and whether it asks for the code.
export function readClaudeLogin(output: string): LoginFields {
  const visit = [...output.matchAll(/visit:\s*(https:\/\/\S+)/g)].at(-1)?.[1] ?? null;
  const any = visit ?? [...output.matchAll(/(https:\/\/\S*(?:oauth|authorize)\S*)/g)].at(-1)?.[1] ?? null;
  return { url: any, needsCode: /paste code here/i.test(output) };
}

// One browser's sign-in.
interface Attempt {
  nonceHash: string;
  flow: LoginFlow;
  startedAt: number;
  // The identity the CLI's own status verified when the flow ended; set once.
  identity: VerifiedIdentity | null;
  verifiedAt: number | null;
  consumed: boolean;
}

// A verified sign-in is exchanged for a session within this long, or not at all.
const CLAIM_WINDOW_MS = 10 * 60_000;
// Attempts kept at most (a finished one is dropped first).
const ATTEMPTS_KEPT = 32;

const idle = (): LoginSnapshot => ({ state: "idle", url: null, code: null, needsCode: false, message: null, startedAt: null, updatedAt: new Date().toISOString() });

@Injectable()
export class ClaudeAuthService {
  private readonly attempts = new Map<string, Attempt>();
  private readonly workChecks: ((accountId: string | null) => Promise<string | null>)[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(SignInChannel) private readonly channel: SignInChannel,
    @Inject(ClaudeCli) private readonly cli: ClaudeCli,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  // What THIS browser is: signed in (a session), or what keeps it out -- with its own flow and nothing of another's.
  async status(owner: Owner | null, nonce: string | null): Promise<ClaudeStatus> {
    const runtime = await this.cli.signIn();
    const flow = this.attemptOf(nonce)?.flow.current() ?? idle();
    if (owner === null) return { state: runtime.state === "unavailable" ? "unavailable" : "not_connected", runtime: runtime.state, method: runtime.state === "connected" ? null : runtime.method, account: null, session: null, detail: runtime.detail, flow };
    const account = await this.accounts.account(owner.accountId);
    const identity = await this.accounts.identityOf(owner.accountId);
    return {
      state: "connected",
      runtime: runtime.state,
      method: runtime.method,
      account: { email: identity?.email ?? owner.email, organization: identity?.orgName ?? null, plan: identity?.plan ?? null },
      session: { accountId: owner.accountId, displayName: account?.displayName ?? "", email: owner.email, csrfToken: owner.csrfToken, expiresAt: owner.expiresAt },
      detail: runtime.detail,
      flow,
    };
  }

  // Starts this browser's sign-in, or returns the one it has under way. The nonce returned is the browser's to keep.
  async login(nonce: string | null): Promise<{ nonce: string; flow: LoginSnapshot }> {
    const mine = this.attemptOf(nonce);
    if (mine !== null && mine.flow.active()) return { nonce: nonce as string, flow: mine.flow.current() };
    if ([...this.attempts.values()].some((a) => a.flow.active())) throw new ApiError(HttpStatus.CONFLICT, SIGN_IN_BUSY, "Another browser has a Claude sign-in under way: the Claude CLI signs in one at a time. Try again in a moment.");
    await this.refuseWhileWorking();
    this.cli.forget();
    const fresh = randomBytes(32).toString("base64url");
    const attempt: Attempt = { nonceHash: sha256(fresh), flow: new LoginFlow(this.process), startedAt: Date.now(), identity: null, verifiedAt: null, consumed: false };
    this.prune();
    this.attempts.set(attempt.nonceHash, attempt);
    attempt.flow.subscribe((s) => {
      if (!LOGIN_ACTIVE.includes(s.state)) this.channel.close();
    });
    attempt.flow.start(this.driver(attempt));
    return { nonce: fresh, flow: attempt.flow.current() };
  }

  submitCode(nonce: string | null, code: string): LoginSnapshot {
    const attempt = this.attemptOf(nonce);
    return attempt === null ? idle() : attempt.flow.submit(code);
  }

  cancel(nonce: string | null): LoginSnapshot {
    const attempt = this.attemptOf(nonce);
    return attempt === null ? idle() : attempt.flow.cancel();
  }

  subscribe(nonce: string | null, listener: (s: LoginSnapshot) => void): () => void {
    const attempt = this.attemptOf(nonce);
    if (attempt === null) {
      listener(idle());
      return () => undefined;
    }
    listener(attempt.flow.current());
    return attempt.flow.subscribe(listener);
  }

  // THE EXCHANGE: this browser's verified sign-in, once, for a session -- if the runtime's CLI still holds the identity
  // the flow verified. `previousToken`: a session this browser presented, which ends (the session rotates).
  async claim(nonce: string | null, previousToken: string | null, userAgent: string | null): Promise<Issued> {
    const attempt = this.attemptOf(nonce);
    if (attempt === null || attempt.flow.current().state !== "connected" || attempt.identity === null || attempt.verifiedAt === null) {
      throw new ApiError(HttpStatus.CONFLICT, "sign_in_not_finished", "This browser has no finished Claude sign-in to exchange: sign in first.");
    }
    if (attempt.consumed) throw new ApiError(HttpStatus.CONFLICT, "sign_in_used", "This sign-in was already exchanged for a session.");
    if (Date.now() - attempt.verifiedAt > CLAIM_WINDOW_MS) throw new ApiError(HttpStatus.CONFLICT, "sign_in_expired", "This sign-in finished too long ago: sign in again.");
    attempt.consumed = true;
    const now = await this.cli.identity(true);
    if (now === null || now.key !== attempt.identity.key) throw new ApiError(HttpStatus.CONFLICT, IDENTITY_MISMATCH, "The Claude CLI no longer holds the account this sign-in verified: sign in again.");
    const issued = await this.accounts.issue(now, { previousToken, userAgent });
    this.attempts.delete(attempt.nonceHash);
    return issued;
  }

  // Signing the ACCOUNT out signs the runtime's CLI out. Never while Claude works for it (or a workspace is being
  // prepared, which ends by sending the chat's first message): what the account started would go on after it.
  async logout(owner: Owner): Promise<{ detail: string | null }> {
    await this.refuseWhileWorking();
    await this.accounts.endAccount(owner.accountId, "signed_out");
    const r = await this.process.run(this.config.binaries.claude, ["auth", "logout"], this.options());
    this.cli.forget();
    const after = await this.cli.signIn(true);
    if (r.code !== 0 && after.state === "connected") return { detail: `claude auth logout ${endedHow(r)}: ${tail(r.stderr || r.stdout, 3)}` };
    return { detail: null };
  }

  // What else works for an account and must end before the CLI's sign-in changes (a research run): each says so, or null.
  workCheck(check: (accountId: string | null) => Promise<string | null>): void {
    this.workChecks.push(check);
  }

  private async refuseWhileWorking(): Promise<void> {
    const running = (await this.sessions.withStatus("running")).length;
    const preparing = (await this.sessions.withStatus("preparing")).length;
    if (running > 0) throw conflict("run_active", `Claude is still working in ${running === 1 ? "a chat" : `${running} chats`}. Wait for ${running === 1 ? "it" : "them"} to finish, or stop ${running === 1 ? "it" : "them"}, first.`);
    if (preparing > 0) throw conflict("workspace_preparing", "A chat's workspace is still being prepared. Wait until it is ready (or fails) first.");
    for (const check of this.workChecks) {
      const busy = await check(null);
      if (busy !== null) throw conflict("run_active", busy);
    }
  }

  private attemptOf(nonce: string | null): Attempt | null {
    if (nonce === null || nonce.length === 0) return null;
    return this.attempts.get(sha256(nonce)) ?? null;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, a] of this.attempts) {
      const done = !a.flow.active();
      if (done && (a.consumed || now - a.startedAt > this.config.limits.loginTimeoutMs + CLAIM_WINDOW_MS)) this.attempts.delete(key);
    }
    const finished = [...this.attempts.entries()].filter(([, a]) => !a.flow.active());
    while (this.attempts.size >= ATTEMPTS_KEPT && finished.length > 0) this.attempts.delete((finished.shift() as [string, Attempt])[0]);
  }

  private options() {
    return { cwd: this.config.data.home, env: claudeEnv(this.config), timeoutMs: this.config.limits.commandTimeoutMs };
  }

  // In the governed deployment the sign-in runs in the agent's container, whose only way out is the egress proxy: it
  // is given a channel of its own there (infra/egress/sign-in-channel.ts), for as long as a sign-in may take. In the
  // single deployment it goes out as it always did.
  private wayOut(): Record<string, string> {
    const g = this.config.governance;
    if (g.deployment !== "governed" || g.proxyPort === null) return {};
    return egressProxyEnv(g.agentControlHost, g.proxyPort, "signin", this.channel.open(this.config.limits.loginTimeoutMs + 60_000));
  }

  private driver(attempt: Attempt): LoginDriver {
    return {
      file: this.config.binaries.claude,
      args: ["auth", "login", "--claudeai"],
      cwd: this.config.data.home,
      env: { ...claudeEnv(this.config), ...this.wayOut() },
      timeoutMs: this.config.limits.loginTimeoutMs,
      read: readClaudeLogin,
      ready: (f) => typeof f.url === "string" && f.url.length > 0,
      verify: async () => {
        const signIn = await this.cli.signIn(true);
        const identity = await this.cli.identity();
        if (signIn.state === "connected" && identity !== null) {
          attempt.identity = identity;
          attempt.verifiedAt = Date.now();
          return { ok: true, message: `Signed in to Claude as ${identity.email}.` };
        }
        if (signIn.state === "connected") return { ok: false, message: "The Claude CLI is signed in, but names no email for the account: nothing here can be its own. Sign in with a Claude account that has one." };
        return { ok: false, message: signIn.detail ?? "The Claude CLI finished, but `claude auth status` does not report a Claude account." };
      },
      failure: (output, exit) => lastWords(output, exit),
    };
  }
}
