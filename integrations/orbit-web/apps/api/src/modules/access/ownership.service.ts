// WHOSE A CHAT IS. A chat belongs to the ACCOUNT that started it -- the account of the user whose browser session made
// the request -- and that account alone owns it. Its owner may share it with other users of this deployment, kept by
// their share address (a verified email, or `<username>@users.orbit.local`): they open it and carry on with it as
// themselves (`shared`), and nothing else of the owner's -- governance above all -- opens to them. Anybody else is told
// the chat does not exist (404).
//
// Who is asking is the request's own browser session (common/request-scope.ts), never anything the request says.
//
// This is a boundary of the API and the pages, not of the operating system: in the single deployment every chat's
// workspace sits in one container, run by one user (README, "The limit, said plainly").
import { Inject, Injectable } from "@nestjs/common";
import type { AccessLevel, AccessList } from "@orbit-web/contracts";
import { forbidden, notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { accountAudience, type Audience } from "../../core/events/event-bus.js";
import { SessionAccessStore, SessionStore, type SessionRecord, type Viewer } from "../../infra/storage/stores.js";

export type Need = "open" | "owner";

// No account's holder has this id: an audience of the people a chat is shared with, and of nobody's account.
const NO_ACCOUNT = "";

@Injectable()
export class OwnershipService {
  constructor(
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(SessionAccessStore) private readonly access: SessionAccessStore,
  ) {}

  async levelOf(s: SessionRecord | null, viewer: Viewer | null): Promise<AccessLevel | null> {
    if (s === null || viewer === null) return null;
    if (s.accountId === viewer.accountId) return "owner";
    return (await this.access.has(s.id, viewer.email)) ? "shared" : null;
  }

  // A chat this viewer may open -- 404 for any other, as if it did not exist -- and, when the owner is needed, one it
  // owns (403: it may see it, but not do that).
  async require(id: string, viewer: Viewer, need: Need): Promise<SessionRecord> {
    const s = isSessionId(id) ? await this.sessions.get(id) : null;
    const level = await this.levelOf(s, viewer);
    if (s === null || level === null) throw notFound("Session");
    if (need === "owner" && level !== "owner") throw forbidden("owner_only", "Only the account that owns this chat can do that.");
    return s;
  }

  async visible(viewer: Viewer): Promise<SessionRecord[]> {
    return this.sessions.visibleTo(viewer);
  }

  async visibleIds(viewer: Viewer): Promise<Set<string>> {
    return new Set((await this.visible(viewer)).map((s) => s.id));
  }

  async accessList(s: SessionRecord, viewer: Viewer): Promise<AccessList> {
    return { access: (await this.levelOf(s, viewer)) ?? "shared", owner: s.ownerEmail, people: await this.access.list(s.id) };
  }

  // The owner names everyone it is shared with, by share address (its own is never on the list: it owns it).
  async share(s: SessionRecord, people: readonly string[], viewer: Viewer & { email: string }): Promise<AccessList> {
    await this.access.set(
      s,
      people.filter((p) => p !== s.ownerEmail),
      viewer.email,
    );
    return this.accessList(s, viewer);
  }

  // Who may hear of a chat on the app stream: its owner account, and the people it is shared with. Read BEFORE the chat
  // is deleted (its sharing goes with it).
  async audience(s: Pick<SessionRecord, "id" | "accountId">): Promise<Audience> {
    return accountAudience(s.accountId, await this.access.emails(s.id));
  }

  // The owner's audience alone, and the people it is shared with alone (a chat's summary says `owner` to the one and
  // `shared` to the others).
  ownerAudience(s: Pick<SessionRecord, "accountId">): Audience {
    return accountAudience(s.accountId);
  }

  async sharedAudience(s: Pick<SessionRecord, "id">): Promise<Audience | null> {
    const emails = await this.access.emails(s.id);
    return emails.length === 0 ? null : accountAudience(NO_ACCOUNT, emails);
  }
}
