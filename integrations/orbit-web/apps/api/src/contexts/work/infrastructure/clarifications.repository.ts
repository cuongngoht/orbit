// THE QUESTIONS assignments asked (workforce.clarifications) and every hop of each (workforce.clarification_routes,
// appended). An answer is taken by a compare-and-set on the open question: two answers at once -- a lead's and the
// owner's, two tabs -- give exactly one.
import { Inject, Injectable } from "@nestjs/common";
import type { ClarificationKind, ClarificationView } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";

export interface ClarificationRecord {
  id: string;
  orbitId: string;
  missionId: string;
  askerAssignmentId: string;
  askerFence: number;
  question: string;
  addressee: "lead" | "owner";
  addresseeAssignmentId: string | null;
  kind: ClarificationKind;
  state: "open" | "answered" | "withdrawn";
  answer: string | null;
  answeredBy: string | null;
  wakes: number;
  dueAt: string | null;
  askedAt: string;
}

const iso = (v: unknown): string => new Date(String(v)).toISOString();
const recordOf = (r: Record<string, unknown>): ClarificationRecord => ({
  id: String(r.id),
  orbitId: String(r.account_id),
  missionId: String(r.mission_id),
  askerAssignmentId: String(r.asker_assignment_id),
  askerFence: Number(r.asker_fence),
  question: String(r.question),
  addressee: r.addressee === "lead" ? "lead" : "owner",
  addresseeAssignmentId: r.addressee_assignment_id === null ? null : String(r.addressee_assignment_id),
  kind: String(r.kind) as ClarificationKind,
  state: String(r.state) as ClarificationRecord["state"],
  answer: r.answer === null ? null : String(r.answer),
  answeredBy: r.answered_by === null ? null : String(r.answered_by),
  wakes: Number(r.wakes),
  dueAt: r.due_at === null ? null : iso(r.due_at),
  askedAt: iso(r.asked_at),
});

@Injectable()
export class ClarificationRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async insert(c: Omit<ClarificationRecord, "state" | "answer" | "answeredBy" | "wakes">, why: string): Promise<void> {
    await this.db.query(
      "INSERT INTO workforce.clarifications (id, account_id, mission_id, asker_assignment_id, asker_fence, question, addressee, addressee_assignment_id, kind, state, due_at, asked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11)",
      [c.id, c.orbitId, c.missionId, c.askerAssignmentId, c.askerFence, c.question, c.addressee, c.addresseeAssignmentId, c.kind, c.dueAt, c.askedAt],
    );
    await this.route(c.orbitId, c.id, c.addressee, c.addresseeAssignmentId, why, c.askedAt);
  }

  async get(orbitId: string, id: string, lock = false): Promise<ClarificationRecord | null> {
    const r = await this.db.one(`SELECT * FROM workforce.clarifications WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return r === null ? null : recordOf(r);
  }

  // The question an assignment asked that is still open (at most one).
  async openOf(orbitId: string, askerAssignmentId: string, lock = false): Promise<ClarificationRecord | null> {
    const r = await this.db.one(`SELECT * FROM workforce.clarifications WHERE account_id = $1 AND asker_assignment_id = $2 AND state = 'open'${lock ? " FOR UPDATE" : ""}`, [orbitId, askerAssignmentId]);
    return r === null ? null : recordOf(r);
  }

  // The open questions waiting for a lead, oldest first.
  async openTo(orbitId: string, leadAssignmentId: string): Promise<(ClarificationRecord & { askerName: string; askerUnit: string | null })[]> {
    const rows = await this.db.query(
      `SELECT c.*, e.name AS asker_name, a.unit_key AS asker_unit FROM workforce.clarifications c
       JOIN workforce.assignments a ON a.account_id = c.account_id AND a.id = c.asker_assignment_id
       JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       WHERE c.account_id = $1 AND c.addressee_assignment_id = $2 AND c.state = 'open' ORDER BY c.asked_at, c.id`,
      [orbitId, leadAssignmentId],
    );
    return rows.map((r) => ({ ...recordOf(r), askerName: String(r.asker_name), askerUnit: r.asker_unit === null ? null : String(r.asker_unit) }));
  }

  // Compare-and-set: answers the question only while it is open. Whether this call answered it.
  async answer(orbitId: string, id: string, answer: string, by: string, at: string): Promise<boolean> {
    const r = await this.db.one("UPDATE workforce.clarifications SET state = 'answered', answer = $3, answered_by = $4, answered_at = $5, version = version + 1 WHERE account_id = $1 AND id = $2 AND state = 'open' RETURNING id", [orbitId, id, answer, by, at]);
    return r !== null;
  }

  // One level up: to a lead's own lead, or to the owner; its wakes start again. Whether it moved (it was open).
  async moveTo(orbitId: string, id: string, to: { addressee: "lead" | "owner"; assignmentId: string | null; kind: ClarificationKind }, why: string, at: string): Promise<boolean> {
    const r = await this.db.one("UPDATE workforce.clarifications SET addressee = $3, addressee_assignment_id = $4, kind = $5, wakes = 0, version = version + 1 WHERE account_id = $1 AND id = $2 AND state = 'open' RETURNING id", [orbitId, id, to.addressee, to.assignmentId, to.kind]);
    if (r === null) return false;
    await this.route(orbitId, id, to.addressee, to.assignmentId, why, at);
    return true;
  }

  // Its addressee was woken for it once more without answering: how many times now.
  async woken(orbitId: string, id: string): Promise<number> {
    const r = await this.db.one("UPDATE workforce.clarifications SET wakes = wakes + 1, version = version + 1 WHERE account_id = $1 AND id = $2 AND state = 'open' RETURNING wakes", [orbitId, id]);
    return r === null ? 0 : Number(r.wakes);
  }

  // The asker's open question, withdrawn with its end (cancelled, failed, handed over): its id, if it had one.
  async withdraw(orbitId: string, askerAssignmentId: string): Promise<ClarificationRecord | null> {
    const r = await this.db.one("UPDATE workforce.clarifications SET state = 'withdrawn', version = version + 1 WHERE account_id = $1 AND asker_assignment_id = $2 AND state = 'open' RETURNING *", [orbitId, askerAssignmentId]);
    return r === null ? null : recordOf(r);
  }

  // Open questions past their due time (the sweep moves them one level up).
  async overdue(now: string): Promise<ClarificationRecord[]> {
    return (await this.db.query("SELECT * FROM workforce.clarifications WHERE state = 'open' AND due_at IS NOT NULL AND due_at < $1 ORDER BY due_at LIMIT 100", [now])).map(recordOf);
  }

  // Leads in WAITING_FOR_SUBORDINATES with a question open to them (a wake that was lost is made again by the sweep).
  async waitingLeads(): Promise<{ orbitId: string; leadId: string }[]> {
    const rows = await this.db.query(
      `SELECT DISTINCT c.account_id, c.addressee_assignment_id FROM workforce.clarifications c
       JOIN workforce.assignments l ON l.account_id = c.account_id AND l.id = c.addressee_assignment_id
       WHERE c.state = 'open' AND c.addressee = 'lead' AND l.state = 'WAITING_FOR_SUBORDINATES' LIMIT 100`,
    );
    return rows.map((r) => ({ orbitId: String(r.account_id), leadId: String(r.addressee_assignment_id) }));
  }

  async ofMission(orbitId: string, missionId: string): Promise<ClarificationView[]> {
    const rows = await this.db.query(
      `SELECT c.*, ae.name AS asker_name, le.name AS addressee_name FROM workforce.clarifications c
       JOIN workforce.assignments a ON a.account_id = c.account_id AND a.id = c.asker_assignment_id
       JOIN workforce.employees ae ON ae.account_id = a.account_id AND ae.id = a.employee_id
       LEFT JOIN workforce.assignments l ON l.account_id = c.account_id AND l.id = c.addressee_assignment_id
       LEFT JOIN workforce.employees le ON le.account_id = l.account_id AND le.id = l.employee_id
       WHERE c.account_id = $1 AND c.mission_id = $2 ORDER BY c.asked_at, c.id`,
      [orbitId, missionId],
    );
    const routes = await this.db.query(
      `SELECT r.clarification_id, r.addressee, r.why, r.at, e.name FROM workforce.clarification_routes r
       LEFT JOIN workforce.assignments a ON a.account_id = r.account_id AND a.id = r.addressee_assignment_id
       LEFT JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       WHERE r.account_id = $1 AND r.clarification_id = ANY($2) ORDER BY r.clarification_id, r.seq`,
      [orbitId, rows.map((r) => String(r.id))],
    );
    return rows.map((r) => ({
      id: String(r.id),
      askerAssignmentId: String(r.asker_assignment_id),
      askerName: String(r.asker_name),
      question: String(r.question),
      addressee: r.addressee === "lead" ? "lead" : "owner",
      addresseeAssignmentId: r.addressee_assignment_id === null ? null : String(r.addressee_assignment_id),
      addresseeName: r.addressee_name === null ? null : String(r.addressee_name),
      kind: String(r.kind) as ClarificationKind,
      state: String(r.state) as ClarificationView["state"],
      answer: r.answer === null ? null : String(r.answer),
      answeredBy: r.answered_by === null ? null : String(r.answered_by),
      answeredAt: r.answered_at === null ? null : iso(r.answered_at),
      askedAt: iso(r.asked_at),
      route: routes.filter((x) => String(x.clarification_id) === String(r.id)).map((x) => ({ addressee: x.addressee === "lead" ? ("lead" as const) : ("owner" as const), addresseeName: x.name === null ? null : String(x.name), why: String(x.why), at: iso(x.at) })),
    }));
  }

  private async route(orbitId: string, id: string, addressee: "lead" | "owner", assignmentId: string | null, why: string, at: string): Promise<void> {
    await this.db.query(
      "INSERT INTO workforce.clarification_routes (account_id, clarification_id, seq, addressee, addressee_assignment_id, why, at) SELECT $1, $2, COALESCE(max(seq), 0) + 1, $3, $4, $5, $6 FROM workforce.clarification_routes WHERE account_id = $1 AND clarification_id = $2",
      [orbitId, id, addressee, assignmentId, why.slice(0, 500), at],
    );
  }
}
