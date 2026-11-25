// WHO A SHARE NAMES. A chat or a research workspace is shared with USERS of this deployment: named by their username,
// or by an email that is some user's VERIFIED email (an unverified email names nobody: it could be anybody's). Each is
// kept as the user's share address (accounts.service.ts, shareAddressOfUser) -- the address a page shows back, which is
// accepted again as the same user. Anybody else refuses the whole request, naming who: nothing is half-shared.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { checkAccessPeople, SHARE_ADDRESS_DOMAIN, SHARE_RECIPIENT_UNKNOWN, type ShareRecipient } from "@orbit-web/contracts";
import { accepted, ApiError } from "../../common/errors.js";
import { UserStore, type UserRecord } from "../../infra/accounts/stores.js";
import { shareAddressOfUser } from "./accounts.service.js";

const LOCAL = `@${SHARE_ADDRESS_DOMAIN}`;

@Injectable()
export class ShareRecipients {
  constructor(@Inject(UserStore) private readonly users: UserStore) {}

  // The share addresses of the people a PUT …/access body names.
  async resolve(body: unknown): Promise<string[]> {
    const people = accepted(checkAccessPeople(body)).people;
    const found: string[] = [];
    const unknown: string[] = [];
    for (const p of people) {
      const user = await this.userOf(p);
      if (user === null || user.disabledAt !== null) unknown.push(p.kind === "username" ? p.username : p.email);
      else found.push(shareAddressOfUser(user));
    }
    if (unknown.length > 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, SHARE_RECIPIENT_UNKNOWN, `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not a user of this Orbit Web: share with a username, or with an email its user has verified.`, { unknown });
    }
    return [...new Set(found)];
  }

  private async userOf(p: ShareRecipient): Promise<UserRecord | null> {
    if (p.kind === "username") return this.users.byUsername(p.username);
    // A share address of this deployment (what a page shows back) names its username's user.
    if (p.email.endsWith(LOCAL)) {
      const user = await this.users.byUsername(p.email.slice(0, -LOCAL.length));
      return user !== null && shareAddressOfUser(user) === p.email ? user : null;
    }
    return this.users.byVerifiedEmail(p.email);
  }
}
