// WHOSE A CHAT IS. Orbit Web is signed in to one Claude account at a time (the CLI's sign-in, on the server); a chat
// belongs to the account that started it -- its email in its organization -- and that account alone sees it, unless its
// owner shared it with other accounts by email. Signing in as another account shows that account's chats only. A chat
// from before owners existed is claimed, once, by the first account that signs in after the upgrade.
//
// This is a boundary of the API and the pages, not of the operating system: in the single deployment every chat's
// workspace sits in one container, run by one user (README, "The limit, said plainly").
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { AccessLevel, AccessList } from "@orbit-web/contracts";
import { forbidden, notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { StreamGateway } from "../../core/events/stream-gateway.js";
import { SessionAccessStore, SessionStore, SettingsStore, type SessionRecord } from "../../infra/storage/stores.js";
import { ClaudeAuthService, type Identity } from "../claude-auth/claude-auth.service.js";

export type Need = "open" | "owner";

export const NO_EMAIL = "This Claude account's CLI names no email, so nothing here can be its own: sign in with a Claude account that has one.";

@Injectable()
export class OwnershipService implements OnModuleInit {
  // The accounts whose claim of the chats from before owners was made in this process (it is made once each).
  private readonly claimed = new Set<string>();

  constructor(
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(SessionAccessStore) private readonly access: SessionAccessStore,
    @Inject(SettingsStore) private readonly settings: SettingsStore,
    @Inject(StreamGateway) private readonly gateway: StreamGateway,
  ) {}

  // A chat's summary reaches the pages of the account that may see it, and no other.
  onModuleInit(): void {
    this.gateway.filterApp((e) => e.type !== "session.summary" || this.levelNow(this.sessions.get(e.data.session.id)) !== null);
  }

  // The account signed in now, once what predates owners is claimed.
  async viewer(): Promise<Identity | null> {
    const identity = await this.claude.identity();
    if (identity !== null && !this.claimed.has(identity.key)) this.claim(identity);
    return identity;
  }

  levelOf(s: SessionRecord | null, identity: Identity | null): AccessLevel | null {
    if (s === null || identity === null) return null;
    if (s.ownerEmail === identity.email && s.ownerOrg === identity.org) return "owner";
    return this.access.has(s.id, identity.email) ? "shared" : null;
  }

  // As the account signed in now sees it, without asking the CLI again.
  levelNow(s: SessionRecord | null): AccessLevel | null {
    return this.levelOf(s, this.claude.currentIdentity());
  }

  // A chat this account may open -- 404 for any other, as if it did not exist -- and, when the owner is needed, one it
  // owns (403: it may see it, but not do that).
  require(id: string, identity: Identity | null, need: Need): SessionRecord {
    const s = isSessionId(id) ? this.sessions.get(id) : null;
    const level = this.levelOf(s, identity);
    if (s === null || level === null) throw notFound("Session");
    if (need === "owner" && level !== "owner") throw forbidden("owner_only", "Only the account that owns this chat can do that.");
    return s;
  }

  visible(identity: Identity | null): SessionRecord[] {
    return identity === null ? [] : this.sessions.visibleTo(identity);
  }

  visibleIds(identity: Identity | null): Set<string> {
    return new Set(this.visible(identity).map((s) => s.id));
  }

  accessList(s: SessionRecord, identity: Identity | null): AccessList {
    return { access: this.levelOf(s, identity) ?? "shared", owner: s.ownerEmail, people: this.access.list(s.id) };
  }

  // The owner names everyone it is shared with (its own email is never on the list: it owns it).
  share(s: SessionRecord, people: readonly string[], identity: Identity): AccessList {
    this.access.set(
      s.id,
      people.filter((p) => p !== s.ownerEmail),
      identity.email,
    );
    return this.accessList(s, identity);
  }

  private claim(identity: Identity): void {
    this.claimed.add(identity.key);
    const chats = this.sessions.claimUnowned(identity);
    if (chats > 0) this.settings.set("ownership.claimed", { by: identity.email, at: new Date().toISOString(), chats });
  }
}

// A request that only an account with an email can make.
export function requireIdentity(identity: Identity | null): Identity {
  if (identity === null) throw forbidden("account_without_email", NO_EMAIL);
  return identity;
}
