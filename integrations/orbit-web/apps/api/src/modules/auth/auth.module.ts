// THE AUTH MODULE: accounts and their browser sessions, what the runtime's Claude CLI says about its sign-in, who each
// request is from, and the one global gate every route passes. Global: every module asks it who is asking.
import { Global, Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { StreamGateway } from "../../core/events/stream-gateway.js";
import { AccountsService } from "./accounts.service.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthHooks } from "./auth-hooks.js";
import { ClaudeCli } from "./claude-cli.service.js";
import { PrincipalResolver } from "./principals.js";

// How often streams of sessions that ended by themselves (their lifetime, idle) are looked for and closed.
const SWEEP_MS = 60_000;

// What ends with a session or an account: its open streams.
@Injectable()
class StreamsEnd implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
    @Inject(StreamGateway) private readonly gateway: StreamGateway,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  onApplicationBootstrap(): void {
    this.hooks.onEnded((e) => {
      if (e.scope === "account") this.gateway.closeAccount(e.accountId);
      else this.gateway.closeSession(e.sessionId);
    });
    // A stream outlives no account the runtime stopped serving.
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      const active = await this.accounts.active();
      for (const accountId of this.gateway.accounts()) if (accountId !== active) this.gateway.closeAccount(accountId);
      for (const s of this.gateway.sessions()) if (!(await this.accounts.sessionLive(s))) this.gateway.closeSession(s);
    } catch {
      // The database answers next time; nothing is closed on a guess.
    }
  }
}

@Global()
@Module({
  providers: [AuthHooks, AccountsService, ClaudeCli, PrincipalResolver, StreamsEnd, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthHooks, AccountsService, ClaudeCli, PrincipalResolver],
})
export class AuthModule {}
