// RECURRING WORK (Work context): a schedule makes one OCCURRENCE per period -- once, whoever asks (the occurrence's
// `UNIQUE (account, schedule, period)` is that once, so two schedulers, or one restarted, never make a period twice) --
// and each occurrence made becomes a mission through the same command a person's "Assign" uses (queued when its
// employee is busy). A period nobody ran is made or skipped as the schedule's missed-period policy says, and a skip is
// recorded with its reason. A change of a schedule is a new revision; an occurrence names the revision it was made from.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  checkCreateSchedule,
  checkScheduleRule,
  checkUpdateSchedule,
  isWorkforceId,
  type AssignmentState,
  type CreateMissionRequest,
  type DeliveryState,
  type MissedPolicy,
  type OccurrenceView,
  type ScheduleRecipient,
  type ScheduleRule,
  type ScheduleRun,
  type ScheduleView,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import { OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { DomainError, missing, stale } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { decideMissed, runsAfter, runsBetween } from "../domain/schedule.js";
import { MissionsService } from "./missions.service.js";

const SWEEP_MS = 30_000;
// A run due longer ago than this was MISSED (the scheduler was away when it was due).
const GRACE_MS = 15 * 60_000;

interface Template {
  goal: string;
  deliverables: CreateMissionRequest["deliverables"];
  acceptanceCriteria: string[];
  workspaceId: string | null;
  sourceRevisionIds: string[];
}

const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// The worst state of an occurrence's deliveries, for its one word.
const DELIVERY_ORDER: DeliveryState[] = ["FAILED", "NEEDS_RECONCILIATION", "PENDING_CHANNEL", "PENDING", "SENDING", "SENT"];

@Injectable()
export class SchedulesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Scheduler");
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(MissionsService) private readonly missions: MissionsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  // ---- reading ------------------------------------------------------------------------------------------------------

  async list(orbitId: string): Promise<ScheduleView[]> {
    const rows = await this.db.query("SELECT s.*, e.name AS employee_name FROM workforce.schedules s JOIN workforce.employees e ON e.account_id = s.account_id AND e.id = s.employee_id WHERE s.account_id = $1 ORDER BY s.name, s.id", [orbitId]);
    const out: ScheduleView[] = [];
    for (const r of rows) out.push(await this.viewOf(r));
    return out;
  }

  async get(orbitId: string, id: string): Promise<ScheduleView> {
    if (!isWorkforceId(id)) throw missing("Schedule");
    const r = await this.db.one("SELECT s.*, e.name AS employee_name FROM workforce.schedules s JOIN workforce.employees e ON e.account_id = s.account_id AND e.id = s.employee_id WHERE s.account_id = $1 AND s.id = $2", [orbitId, id]);
    if (r === null) throw missing("Schedule");
    return this.viewOf(r);
  }

  private async viewOf(r: Row): Promise<ScheduleView> {
    const rule = r.rule as ScheduleRule;
    const [last] = await this.occurrencesOf(s(r.account_id), s(r.id), 1);
    return {
      id: s(r.id),
      name: s(r.name),
      rule,
      employeeId: s(r.employee_id),
      employeeName: s(r.employee_name),
      recipients: r.recipients as ScheduleRecipient[],
      missedPolicy: s(r.missed_policy) as MissedPolicy,
      catchUpLimit: Number(r.catch_up_limit),
      state: s(r.state) as ScheduleView["state"],
      revision: Number(r.revision),
      version: Number(r.version),
      next: s(r.state) === "active" ? runsAfter(rule, Date.now(), 3) : [],
      lastOccurrence: last ?? null,
    };
  }

  // The next runs a rule would make (the form shows them before saving).
  preview(body: unknown): ScheduleRun[] {
    const rule = accepted(checkScheduleRule((body as { rule?: unknown } | null)?.rule));
    return runsAfter(rule, Date.now(), 5);
  }

  async occurrences(orbitId: string, scheduleId: string): Promise<OccurrenceView[]> {
    if (!isWorkforceId(scheduleId)) throw missing("Schedule");
    if ((await this.db.one("SELECT 1 AS x FROM workforce.schedules WHERE account_id = $1 AND id = $2", [orbitId, scheduleId])) === null) throw missing("Schedule");
    return this.occurrencesOf(orbitId, scheduleId, 100);
  }

  private async occurrencesOf(orbitId: string, scheduleId: string, limit: number): Promise<OccurrenceView[]> {
    const rows = await this.db.query(
      `SELECT o.*, (SELECT a.state FROM workforce.assignments a WHERE a.account_id = o.account_id AND a.mission_id = o.mission_id AND a.parent_id IS NULL LIMIT 1) AS assignment_state,
              (SELECT array_agg(d.state) FROM workforce.deliveries d WHERE d.account_id = o.account_id AND d.mission_id = o.mission_id) AS delivery_states
       FROM workforce.occurrences o WHERE o.account_id = $1 AND o.schedule_id = $2 ORDER BY o.due_at DESC, o.id LIMIT $3`,
      [orbitId, scheduleId, limit],
    );
    return rows.map((o) => {
      const states = (o.delivery_states as DeliveryState[] | null) ?? [];
      return {
        id: s(o.id),
        scheduleId: s(o.schedule_id),
        periodKey: s(o.period_key),
        dueAt: s(o.due_at),
        scheduleRevision: Number(o.schedule_revision),
        state: s(o.state) as OccurrenceView["state"],
        missionId: sn(o.mission_id),
        assignmentState: (sn(o.assignment_state) as AssignmentState | null) ?? null,
        delivery: states.length === 0 ? "none" : (DELIVERY_ORDER.find((x) => states.includes(x)) ?? "none"),
        createdAt: s(o.created_at),
      };
    });
  }

  // ---- changing ------------------------------------------------------------------------------------------------------

  async create(actor: Actor, body: unknown): Promise<ScheduleView> {
    const req = accepted(checkCreateSchedule(body));
    const orbitId = actor.command.orbitId;
    const id = randomUUID();
    await this.governance.command(actor, "schedule.create", id, async () => {
      await this.governance.authorize(actor, "work.assign", req.employeeId, { employee: req.employeeId, schedule: true });
      if ((await this.db.one("SELECT 1 AS x FROM workforce.employees WHERE account_id = $1 AND id = $2 AND employment NOT IN ('archived', 'deleted')", [orbitId, req.employeeId])) === null) throw missing("Employee");
      const at = new Date().toISOString();
      const template: Template = { goal: req.mission.goal, deliverables: req.mission.deliverables, acceptanceCriteria: req.mission.acceptanceCriteria, workspaceId: req.mission.workspaceId ?? null, sourceRevisionIds: req.mission.sourceRevisionIds ?? [] };
      const next = runsAfter(req.rule, Date.now(), 1)[0]?.dueAt ?? null;
      await this.db.query(
        `INSERT INTO workforce.schedules (id, account_id, name, rule, employee_id, template, recipients, missed_policy, catch_up_limit, state, revision, next_due_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, 'active', 1, $10, $11, $12, $12)`,
        [id, orbitId, req.name, jsonParam(req.rule), req.employeeId, jsonParam(template), jsonParam(req.recipients), req.missedPolicy, req.catchUpLimit, next, actor.command.actor, at],
      );
      await this.revision(orbitId, id, 1, actor.command.actor, at);
      await this.outbox.touched(orbitId, ["schedules"]);
      await this.governance.recorded(actor, "schedule.create", "schedule", id, 1, `${req.rule.kind} at ${req.rule.localTime} ${req.rule.timezone}`);
    });
    return this.get(orbitId, id);
  }

  async update(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<ScheduleView> {
    const req = accepted(checkUpdateSchedule(body));
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, "schedule.update", id, async () => {
      const r = isWorkforceId(id) ? await this.db.one("SELECT * FROM workforce.schedules WHERE account_id = $1 AND id = $2 FOR UPDATE", [orbitId, id]) : null;
      if (r === null) throw missing("Schedule");
      if (Number(r.version) !== expectedVersion) throw stale("This schedule changed since you read it: load the latest.", { version: Number(r.version) });
      const employeeId = req.employeeId ?? s(r.employee_id);
      await this.governance.authorize(actor, "work.assign", employeeId, { employee: employeeId, schedule: true });
      if (req.employeeId !== undefined && (await this.db.one("SELECT 1 AS x FROM workforce.employees WHERE account_id = $1 AND id = $2 AND employment NOT IN ('archived', 'deleted')", [orbitId, employeeId])) === null) throw missing("Employee");
      const rule = req.rule ?? (r.rule as ScheduleRule);
      const state = req.state ?? s(r.state);
      // A rule changed or a schedule resumed: due from now on (what was missed while paused is not made).
      const next = state === "active" ? (req.rule !== undefined || s(r.state) !== "active" ? (runsAfter(rule, Date.now(), 1)[0]?.dueAt ?? null) : sn(r.next_due_at)) : sn(r.next_due_at);
      const revision = Number(r.revision) + 1;
      const at = new Date().toISOString();
      await this.db.query(
        `UPDATE workforce.schedules SET name = $3, rule = $4::jsonb, employee_id = $5, recipients = $6::jsonb, missed_policy = $7, catch_up_limit = $8, state = $9, revision = $10, next_due_at = $11, updated_at = $12, version = version + 1
         WHERE account_id = $1 AND id = $2`,
        [orbitId, id, req.name ?? s(r.name), jsonParam(rule), employeeId, jsonParam(req.recipients ?? r.recipients), req.missedPolicy ?? s(r.missed_policy), req.catchUpLimit ?? Number(r.catch_up_limit), state, revision, next, at],
      );
      await this.revision(orbitId, id, revision, actor.command.actor, at);
      await this.outbox.touched(orbitId, ["schedules"]);
      await this.governance.recorded(actor, "schedule.update", "schedule", id, Number(r.version) + 1, `revision ${revision}, ${state}`);
    });
    return this.get(orbitId, id);
  }

  // The schedule as it is now, kept whole as its revision (an occurrence names the revision it was made from).
  private async revision(orbitId: string, id: string, revision: number, by: string, at: string): Promise<void> {
    const r = await this.db.one("SELECT name, rule, employee_id, template, recipients, missed_policy, catch_up_limit, state FROM workforce.schedules WHERE account_id = $1 AND id = $2", [orbitId, id]);
    await this.db.query("INSERT INTO workforce.schedule_revisions (account_id, schedule_id, revision, document, created_by, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)", [orbitId, id, revision, jsonParam(r), by, at]);
  }

  // ---- the scheduler ---------------------------------------------------------------------------------------------------

  private async sweep(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.tick();
    } catch (err) {
      this.logger.warn(`The scheduler's pass failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  // One pass: every active schedule that is due, each in a transaction of its own (a schedule another scheduler holds
  // is passed over). Returns how many occurrences it made. `now` is given by tests.
  async tick(now = Date.now()): Promise<number> {
    const due = await this.db.query("SELECT account_id, id FROM workforce.schedules WHERE state = 'active' AND next_due_at <= $1 ORDER BY next_due_at LIMIT 50", [new Date(now).toISOString()]);
    let made = 0;
    for (const d of due) made += await this.runSchedule(s(d.account_id), s(d.id), now);
    return made;
  }

  private async runSchedule(orbitId: string, id: string, now: number): Promise<number> {
    return this.db.tx(async () => {
      const r = await this.db.one("SELECT * FROM workforce.schedules WHERE account_id = $1 AND id = $2 AND state = 'active' AND next_due_at <= $3 FOR UPDATE SKIP LOCKED", [orbitId, id, new Date(now).toISOString()]);
      if (r === null) return 0;
      const rule = r.rule as ScheduleRule;
      const owed = runsBetween(rule, Date.parse(s(r.next_due_at)) - 1, now);
      const decisions = decideMissed(owed, s(r.missed_policy) as MissedPolicy, Number(r.catch_up_limit), now, GRACE_MS);
      let made = 0;
      for (const d of decisions) made += (await this.occurrence(r, d.run, d.make, d.reason)) ? 1 : 0;
      const next = runsAfter(rule, now, 1)[0]?.dueAt ?? null;
      await this.db.query("UPDATE workforce.schedules SET next_due_at = $3, updated_at = $4 WHERE account_id = $1 AND id = $2", [orbitId, id, next, new Date(now).toISOString()]);
      await this.outbox.touched(orbitId, ["schedules", "missions", "roster"]);
      return made;
    });
  }

  // One period's occurrence: made once (the unique key), then its mission -- or recorded as skipped, with the reason.
  private async occurrence(r: Row, run: ScheduleRun, make: boolean, why: string | null): Promise<boolean> {
    const orbitId = s(r.account_id);
    const scheduleId = s(r.id);
    const occurrenceId = randomUUID();
    const inserted = await this.db.one(
      `INSERT INTO workforce.occurrences (id, account_id, schedule_id, period_key, due_at, schedule_revision, state, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) ON CONFLICT (account_id, schedule_id, period_key) DO NOTHING RETURNING id`,
      [occurrenceId, orbitId, scheduleId, run.periodKey, run.dueAt, Number(r.revision), make ? "created" : "skipped", why],
    );
    if (inserted === null || !make) return false;
    const actor = systemActor(orbitId, "scheduler", `occurrence:${occurrenceId}`);
    const t = r.template as Template;
    const body: CreateMissionRequest = {
      title: `${s(r.name)} — ${run.periodKey}`.slice(0, 120),
      goal: `${t.goal}\n\nPeriod: ${run.periodKey} (${run.periodStart} to ${run.periodEnd}). Use only data that belongs to this period, and say which records you left out because they belong to another period.`.slice(0, 8000),
      targetEmployeeId: s(r.employee_id),
      whenBusy: "enqueue",
      workspaceId: t.workspaceId,
      sourceRevisionIds: t.sourceRevisionIds,
      deliverables: t.deliverables,
      acceptanceCriteria: t.acceptanceCriteria,
    };
    try {
      const answer = await this.missions.create(actor, body, `occurrence:${occurrenceId}`, { scheduleId, occurrenceId });
      const missionId = String((answer.body as { missionId?: string }).missionId ?? "");
      await this.db.query("UPDATE workforce.occurrences SET mission_id = $3 WHERE account_id = $1 AND id = $2", [orbitId, occurrenceId, missionId]);
      await this.outbox.append(actor.command, [{ type: "OccurrenceCreated", aggregateType: "schedule", aggregateId: scheduleId, aggregateVersion: Number(r.version), missionId, payload: { occurrenceId, periodKey: run.periodKey, dueAt: run.dueAt } }]);
      return true;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      await this.db.query("UPDATE workforce.occurrences SET state = 'skipped', reason = $3 WHERE account_id = $1 AND id = $2", [orbitId, occurrenceId, `Its mission could not be made: ${err.message}`.slice(0, 500)]);
      return false;
    }
  }
}
