// THE AUTH MODULE (the Identity context): Orbit's own sign-in -- accounts, their users, one-time setup codes, the
// sign-in throttle, browser sessions, the localhost trial's seed -- who each request is from, and the one global gate
// every route passes. Global: every module asks it who is asking. No AI CLI has any part in it.
import { Global, Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { StreamGateway } from "../../core/events/stream-gateway.js";
import { AccountsService } from "./accounts.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthHooks } from "./auth-hooks.js";
import { IdentityService } from "./identity.service.js";
import { PrincipalResolver } from "./principals.js";
import { ShareRecipients } from "./share-recipients.js";
import { LoginThrottle } from "./throttle.js";
import { TrialSeed } from "./trial.service.js";

// How often streams of sessions that ended by themselves (their lifetime, idle, a terminal's revoke) are looked for and
// closed.
const SWEEP_MS = 60_000;

// What ends with a session: its open streams.
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
      if (e.scope === "session") this.gateway.closeSession(e.sessionId);
      else for (const id of e.sessionIds) this.gateway.closeSession(id);
    });
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      for (const s of this.gateway.sessions()) if (!(await this.accounts.sessionLive(s))) this.gateway.closeSession(s);
    } catch {
      // The database answers next time; nothing is closed on a guess.
    }
  }
}

@Global()
@Module({
  providers: [AuthHooks, AccountsService, IdentityService, LoginThrottle, PrincipalResolver, ShareRecipients, TrialSeed, StreamsEnd, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController],
  exports: [AuthHooks, AccountsService, IdentityService, PrincipalResolver, ShareRecipients],
})
export class AuthModule {}
