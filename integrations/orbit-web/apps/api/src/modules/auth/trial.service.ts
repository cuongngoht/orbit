// THE TRIAL ACCOUNT (ORBIT_WEB_TRIAL=1, set only by docker/compose.trial.yaml or a local run): at every start, the
// account `admin` / `123456` is made if it is not there yet -- ONCE, with what governance owes it, and never again: a
// password its user changed is never set back. The password rules are waived for this seed alone (`trial_waiver`), and
// changing the password ends the waiver. Every start in trial mode is written in the deployment's audit record.
//
// Whether a trial may start at all is decided before anything runs (config.ts, trialRefusal): loopback host names only,
// no access token, the single deployment, nothing served to the world.
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { UserStore } from "../../infra/accounts/stores.js";
import { Db } from "../../infra/db/db.js";
import { AccountsService } from "./accounts.service.js";
import { AuthHooks } from "./auth-hooks.js";
import { TRIAL_PASSWORD, TRIAL_USERNAME } from "./identity.service.js";
import { hashPassword } from "./passwords.js";
import { systemContext } from "./principal.js";

@Injectable()
export class TrialSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger("Trial");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(UserStore) private readonly users: UserStore,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.identity.trial) return;
    const seeded = await this.seed();
    await this.hooks.identity(systemContext("trial"), { kind: "trial_started", seeded });
    this.logger.warn(`TRIAL MODE: sign in as ${TRIAL_USERNAME} / ${TRIAL_PASSWORD} (localhost only). Change the password, and never expose this installation.`);
  }

  // Whether this start made the account (false: it was there, whatever its password is now).
  async seed(): Promise<boolean> {
    if ((await this.users.byUsername(TRIAL_USERNAME)) !== null) return false;
    const passwordHash = await hashPassword(TRIAL_PASSWORD, this.config.identity.kdf);
    return this.db.tx(async () => {
      // Two starts at once seed it once.
      await this.db.query("SELECT pg_advisory_xact_lock(hashtextextended('orbit-web:trial-seed', 0))");
      if ((await this.users.byUsername(TRIAL_USERNAME)) !== null) return false;
      await this.accounts.create({ displayName: "Orbit Admin", companyName: "", contactEmail: null, timezone: "UTC" }, { username: TRIAL_USERNAME, fullName: "Orbit Admin", passwordHash, mustChangePassword: false, trialWaiver: true }, "trial");
      return true;
    });
  }
}
