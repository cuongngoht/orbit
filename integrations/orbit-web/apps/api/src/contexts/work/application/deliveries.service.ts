// DELIVERIES (Work context): when a scheduled mission's result is ACCEPTED, it is delivered to each of its schedule's
// recipients -- and acceptance and delivery stay two states. A delivery is SENT only with the receiver's receipt:
//
//   inbox     a user of this account with that verified email: the report is put in their Needs me, and that item is the
//             receipt;
//   anything else  no channel can deliver it in this version (no outside channel is configured): PENDING_CHANNEL, and a
//             Needs-me item says so -- never "sent" on a guess. A person who delivered it some other way says so
//             (`resolve`), and that word, with its reason, is the receipt; or asks for it to be sent again.
//
// One delivery per (handoff, recipient) -- its idempotency key -- so an acceptance delivered twice delivers once.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { checkResolveDelivery, isWorkforceId, type DeliveryView, type IntegrationEvent, type ScheduleRecipient } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import { OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { conflictWith, missing } from "../../shared/domain.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { DecisionRepository } from "../infrastructure/decisions.js";

const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const deliveryOf = (r: Row): DeliveryView => ({
  id: s(r.id),
  missionId: s(r.mission_id),
  handoffId: s(r.handoff_id),
  digest: s(r.digest),
  recipient: r.recipient as ScheduleRecipient,
  state: s(r.state) as DeliveryView["state"],
  attempts: Number(r.attempts),
  receipt: sn(r.receipt),
  detail: sn(r.detail),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

@Injectable()
export class DeliveriesService implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(DecisionRepository) private readonly decisions: DecisionRepository,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({ id: "work.delivery", types: ["AssignmentAccepted"], handle: async (e) => this.onAccepted(e) });
  }

  async ofMission(orbitId: string, missionId: string): Promise<DeliveryView[]> {
    return (await this.db.query("SELECT * FROM workforce.deliveries WHERE account_id = $1 AND mission_id = $2 ORDER BY created_at, id", [orbitId, missionId])).map(deliveryOf);
  }

  // An accepted ROOT assignment of a mission a schedule made: one delivery per recipient of the revision it was made from.
  private async onAccepted(e: IntegrationEvent): Promise<void> {
    if (e.aggregateType !== "assignment") return;
    const a = await this.db.one(
      `SELECT a.id, a.mission_id, a.handoff_revision, m.title, o.schedule_id, o.schedule_revision
       FROM workforce.assignments a JOIN workforce.missions m ON m.account_id = a.account_id AND m.id = a.mission_id
       JOIN workforce.occurrences o ON o.account_id = m.account_id AND o.id = m.occurrence_id
       WHERE a.account_id = $1 AND a.id = $2 AND a.parent_id IS NULL AND a.state = 'COMPLETED'`,
      [e.accountId, e.aggregateId],
    );
    if (a === null) return;
    const h = await this.db.one("SELECT id, digest FROM workforce.handoffs WHERE account_id = $1 AND assignment_id = $2 AND status = 'accepted'", [e.accountId, e.aggregateId]);
    if (h === null) return;
    const doc = await this.db.one("SELECT document FROM workforce.schedule_revisions WHERE account_id = $1 AND schedule_id = $2 AND revision = $3", [e.accountId, s(a.schedule_id), Number(a.schedule_revision)]);
    const recipients = ((doc?.document as { recipients?: ScheduleRecipient[] } | undefined)?.recipients ?? []) as ScheduleRecipient[];
    const actor = systemActor(e.accountId, "delivery", e.correlationId, e.id);
    for (const recipient of recipients) await this.deliver(actor, s(a.mission_id), s(a.title), s(h.id), s(h.digest), recipient);
    await this.outbox.touched(e.accountId, ["missions", "inbox", "schedules"], s(a.mission_id));
  }

  private async deliver(actor: Actor, missionId: string, title: string, handoffId: string, digest: string, recipient: ScheduleRecipient): Promise<void> {
    const orbitId = actor.command.orbitId;
    const id = randomUUID();
    const at = new Date().toISOString();
    const row = await this.db.one(
      `INSERT INTO workforce.deliveries (id, account_id, mission_id, handoff_id, digest, recipient, state, attempts, idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', 0, $7, $8, $8) ON CONFLICT (account_id, idempotency_key) DO NOTHING RETURNING id`,
      [id, orbitId, missionId, handoffId, digest, jsonParam(recipient), `${handoffId}:${recipient.channel}:${recipient.address}`, at],
    );
    if (row === null) return;
    await this.outbox.append(actor.command, [{ type: "DeliveryRequested", aggregateType: "delivery", aggregateId: id, aggregateVersion: 1, missionId, payload: { channel: recipient.channel } }]);
    const user = recipient.channel === "inbox" ? await this.db.one("SELECT id FROM app.users WHERE account_id = $1 AND lower(email) = $2 AND email_verified_at IS NOT NULL", [orbitId, recipient.address]) : null;
    if (user !== null) {
      await this.decisions.open({ orbitId, kind: "report", missionId, assignmentId: null, title: `Report: ${title}`.slice(0, 200), reason: `Delivered to ${recipient.address}. Open the mission to read it.`, waiting: recipient.address, deadline: null, pin: { assignmentVersion: null, handoffDigest: digest, deliveryId: id }, dedupKey: `report:${id}` });
      await this.db.query("UPDATE workforce.deliveries SET state = 'SENT', attempts = 1, receipt = $3, detail = NULL, updated_at = $4, version = version + 1 WHERE account_id = $1 AND id = $2", [orbitId, id, `inbox:${s(user.id)}:${at}`, at]);
      return;
    }
    const detail = recipient.channel === "inbox" ? `No user of this account has the verified email ${recipient.address}.` : "No outside delivery channel is configured in this version of Orbit Web: deliver it yourself, then mark it delivered with how.";
    await this.db.query("UPDATE workforce.deliveries SET state = 'PENDING_CHANNEL', detail = $3, updated_at = $4, version = version + 1 WHERE account_id = $1 AND id = $2", [orbitId, id, detail, at]);
    await this.decisions.open({ orbitId, kind: "delivery_channel", missionId, assignmentId: null, title: `Deliver: ${title}`.slice(0, 200), reason: `${recipient.address}: ${detail}`, waiting: null, deadline: null, pin: { assignmentVersion: null, handoffDigest: digest, deliveryId: id }, dedupKey: `delivery:${id}` });
  }

  // A person's word about a delivery no channel could prove: it reached the receiver (that word, with its reason, is the
  // receipt), or it is to be tried again.
  async resolve(actor: Actor, id: string, body: unknown): Promise<DeliveryView> {
    const req = accepted(checkResolveDelivery(body));
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "delivery.resolve", id, async () => {
      const d = isWorkforceId(id) ? await this.db.one("SELECT * FROM workforce.deliveries WHERE account_id = $1 AND id = $2 FOR UPDATE", [orbitId, id]) : null;
      if (d === null) throw missing("Delivery");
      if (s(d.state) === "SENT" || s(d.state) === "SENDING") throw conflictWith("invalid_transition", `This delivery is ${s(d.state).toLowerCase()}: nothing to resolve.`);
      await this.governance.authorize(actor, "notification.send", s(d.mission_id), { delivery: id, outcome: req.outcome });
      const at = new Date().toISOString();
      const next = req.outcome === "delivered" ? { state: "SENT", receipt: `attested by ${actor.command.actor} at ${at}: ${req.reason}`.slice(0, 1000), detail: null } : { state: "PENDING_CHANNEL", receipt: null, detail: `To be sent again (${req.reason.slice(0, 300)}); no channel can send it yet.` };
      const row = await this.db.one("UPDATE workforce.deliveries SET state = $3, receipt = $4, detail = $5, attempts = attempts + 1, updated_at = $6, version = version + 1 WHERE account_id = $1 AND id = $2 RETURNING *", [orbitId, id, next.state, next.receipt, next.detail, at]);
      if (req.outcome === "delivered") await this.decisions.close(orbitId, `delivery:${id}`, "resolved", "delivered by a person", actor.command.actor);
      await this.outbox.append(actor.command, [{ type: "DeliveryReconciled", aggregateType: "delivery", aggregateId: id, aggregateVersion: Number(row?.version ?? 1), missionId: s(d.mission_id), payload: { outcome: req.outcome } }]);
      await this.outbox.touched(orbitId, ["missions", "inbox", "schedules"], s(d.mission_id));
      await this.governance.recorded(actor, "delivery.resolve", "delivery", id, Number(row?.version ?? 1), `${req.outcome}: ${req.reason.slice(0, 200)}`);
      return deliveryOf(row as Row);
    });
  }
}
