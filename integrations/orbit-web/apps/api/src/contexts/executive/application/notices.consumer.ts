// WHAT A CONVERSATION IS TOLD ABOUT ITS MISSIONS (Executive, application; ADR 0062): a consumer of the office's events
// (at least once, applied once) that turns those of a mission given from a conversation -- its root's hand-in,
// acceptance, block, failure or cancellation, a question that waits for the owner, work that cannot start -- into ONE
// system message of that conversation (domain/notices.ts). Deterministic, never in the CEO's voice, and written once per
// event (its key), whatever delivers it again.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { IntegrationEvent } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { NOTICE_TYPES, noticeOf } from "../domain/notices.js";
import { ExecutiveRepository, messageView } from "../infrastructure/executive.repository.js";
import { ExecutiveStream } from "../infrastructure/executive-stream.js";

@Injectable()
export class ExecutiveNotices implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(ExecutiveRepository) private readonly repo: ExecutiveRepository,
    @Inject(ExecutiveStream) private readonly stream: ExecutiveStream,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({ id: "executive.notices", types: NOTICE_TYPES, handle: (e) => this.handle(e) });
  }

  private async handle(e: IntegrationEvent): Promise<void> {
    const row = await this.db.one("SELECT mission_id FROM workforce.events WHERE account_id = $1 AND id = $2", [e.accountId, e.id]);
    if (row === null || row.mission_id === null) return;
    const missionId = String(row.mission_id);
    const link = await this.repo.linkOfMission(e.accountId, missionId);
    if (link === null) return;
    const text = noticeOf({ type: e.type, payload: e.payload, title: link.title, root: e.aggregateType === "assignment" && e.aggregateId === link.rootAssignmentId });
    if (text === null) return;
    const message = await this.repo.addMessage({ id: randomUUID(), orbitId: e.accountId, conversationId: link.conversationId, role: "system", authorName: "Orbit", text, missionId, noticeKey: `event:${e.id}`, at: new Date().toISOString() });
    if (message !== null) await this.stream.publish(e.accountId, link.conversationId, "executive.message.created", { message: messageView(message, null) }, null);
  }
}
