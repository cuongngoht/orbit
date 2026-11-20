// SHARING A CHAT: a read-only link to a SNAPSHOT of its conversation.
//
//   GET    /api/sessions/:id/share   whether the chat is shared, and how (the access token, as any route)
//   POST   /api/sessions/:id/share   share it as it is now, or update the shared copy -- the same link
//   DELETE /api/sessions/:id/share   stop sharing: the link shows nothing from then on
//   GET    /api/shared/:token        what the link shows -- the one route a link's token opens, before the access token
//                                    and the Claude sign-in (guards.ts `isSharedRead`), and only to read
//
// A snapshot keeps the conversation and nothing else of Orbit Web: the messages, the tool calls by their title (what
// each did -- input, output -- only when its owner chose to share it: it may hold the repository's code), the plans.
// No workspace step, run, notice, Orbit record or id of the chat. Every text is masked by token shape again. The link's
// token is 32 random bytes in the URL's fragment, so no server or Referer sees it; a token that names no share is not
// found, whatever its shape.
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, Param, Post, Res } from "@nestjs/common";
import {
  checkShareRequest,
  SHARE_TOKEN,
  type AnySessionEvent,
  type SessionEventType,
  type SharedChat,
  type ShareInfo,
  type ShareState,
} from "@orbit-web/contracts";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { BeforeClaudeSignIn } from "../../common/before-claude-sign-in.js";
import { accepted, conflict, notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { EventStore, SessionStore, ShareStore, type SessionRecord, type ShareRecord } from "../../infra/storage/stores.js";

const SHARED: ReadonlySet<SessionEventType> = new Set<SessionEventType>(["message.completed", "tool.started", "tool.completed", "tool.failed", "plan.proposed"]);

// The most a snapshot may weigh: a long chat shared with its tools' output is refused, never cut where nobody sees.
export const SNAPSHOT_LIMIT_BYTES = 8 * 1024 * 1024;
const EVENTS_READ = 50_000;

const masked = (text: string): string => redactSecrets(text);

// One event as the link shows it: masked again, the tools' doings only when shared, and nothing that names the chat.
function shown(e: AnySessionEvent, includeTools: boolean): AnySessionEvent | null {
  const base = { id: `e${e.seq ?? 0}`, stream: "session" as const, sessionId: "shared", seq: e.seq, runId: null, at: e.at };
  if (e.type === "message.completed") {
    // The words: the images a message carried stay in the chat (a link opens none), and so do their ids.
    const data = { ...e.data, text: masked(e.data.text) };
    delete data.images;
    return { ...base, type: e.type, data };
  }
  if (e.type === "tool.started") {
    const agent = e.data.agent === null ? null : { subagentType: e.data.agent.subagentType, description: e.data.agent.description === null ? null : masked(e.data.agent.description) };
    return { ...base, type: e.type, data: { ...e.data, title: masked(e.data.title), input: includeTools ? masked(e.data.input) : "", inputTruncated: includeTools && e.data.inputTruncated, agent } };
  }
  if (e.type === "tool.completed" || e.type === "tool.failed") return { ...base, type: e.type, data: { ...e.data, output: includeTools ? masked(e.data.output) : "", truncated: includeTools && e.data.truncated } };
  if (e.type === "plan.proposed") return { ...base, type: e.type, data: { ...e.data, plan: masked(e.data.plan) } };
  return null;
}

const infoOf = (r: ShareRecord): ShareInfo => ({ token: r.token, includeTools: r.includeTools, createdAt: r.createdAt, updatedAt: r.updatedAt, entries: r.snapshot.events.length });

@Injectable()
export class ShareService {
  constructor(
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(EventStore) private readonly events: EventStore,
    @Inject(ShareStore) private readonly shares: ShareStore,
  ) {}

  state(sessionId: string): ShareState {
    const share = this.shares.get(this.session(sessionId).id);
    return { share: share === null ? null : infoOf(share) };
  }

  share(sessionId: string, body: unknown): ShareInfo {
    const req = accepted(checkShareRequest(body));
    const session = this.session(sessionId);
    const snapshot = this.snapshotOf(session, req.includeTools);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > SNAPSHOT_LIMIT_BYTES) {
      throw conflict("share_too_large", req.includeTools ? "This chat is too long to share with what its tools did: share it without them." : "This chat is too long to share.");
    }
    const token = this.shares.get(session.id)?.token ?? randomBytes(32).toString("base64url");
    return infoOf(this.shares.put(session.id, token, req.includeTools, snapshot));
  }

  stop(sessionId: string): void {
    this.shares.delete(this.session(sessionId).id);
  }

  read(token: string): SharedChat {
    const share = SHARE_TOKEN.test(token) ? this.shares.byToken(token) : null;
    if (share === null) throw notFound("Shared chat");
    return share.snapshot;
  }

  private snapshotOf(session: SessionRecord, includeTools: boolean): SharedChat {
    const events = this.events
      .since(session.id, 0, EVENTS_READ)
      .filter((e) => SHARED.has(e.type))
      .flatMap((e) => {
        const one = shown(e, includeTools);
        return one === null ? [] : [one];
      });
    // The title is masked again here: a chat named before titles were masked could hold a piece of a credential.
    return { title: masked(session.title), repository: session.repository === null ? null : masked(session.repository), source: session.source, sharedAt: new Date().toISOString(), includeTools, events };
  }

  private session(id: string): SessionRecord {
    const s = isSessionId(id) ? this.sessions.get(id) : null;
    if (s === null) throw notFound("Session");
    return s;
  }
}

@Controller()
export class ShareController {
  constructor(@Inject(ShareService) private readonly shares: ShareService) {}

  @Get("sessions/:id/share")
  state(@Param("id") id: string): ShareState {
    return this.shares.state(id);
  }

  @Post("sessions/:id/share")
  @HttpCode(200)
  share(@Param("id") id: string, @Body() body: unknown): ShareInfo {
    return this.shares.share(id, body);
  }

  @Delete("sessions/:id/share")
  @HttpCode(204)
  stop(@Param("id") id: string): void {
    this.shares.stop(id);
  }

  // Open before the access token and the Claude sign-in: a link's token is all it takes, and all it opens.
  @Get("shared/:token")
  @BeforeClaudeSignIn()
  read(@Param("token") token: string, @Res({ passthrough: true }) res: Response): SharedChat {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return this.shares.read(token);
  }
}

@Module({
  providers: [ShareService],
  controllers: [ShareController],
})
export class ShareModule {}
