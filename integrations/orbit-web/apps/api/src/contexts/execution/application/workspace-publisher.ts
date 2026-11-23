// THE WORKSPACES OF ENDED ASSIGNMENTS (Execution): an ACCEPTED assignment's workspace is published to its employee's
// desk ONCE (`workforce.desk_publications` is that once) and then removed; a cancelled or failed one is removed. What was
// accepted -- the files and the toolbox the employee wrote for itself -- is what its next work starts from.
//
// Publishing happens under the employee's sandbox row lock, never while an attempt of the assignment is still live, and
// is asked from two sides, whichever comes first: the consumer of AssignmentAccepted, and the worker, which brings the
// desk up to date before it prepares the employee's next attempt. A removal is verified before the scratch it committed
// goes back to the account's storage budget; one that cannot be verified is tried again.
import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import type { IntegrationEvent } from "@orbit-web/contracts";
import { Db, jsonParam } from "../../../infra/db/db.js";
import { systemActor } from "../../shared/application/commands.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { AdmissionService } from "./admission.service.js";
import { SANDBOX_PROVIDER, type SandboxProvider } from "./sandbox.port.js";

@Injectable()
export class WorkspacePublisher implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(AdmissionService) private readonly admission: AdmissionService,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
  ) {}

  onModuleInit(): void {
    if (this.provider === null) return;
    this.dispatcher.register({ id: "execution.desk", types: ["AssignmentAccepted"], handle: async (e) => this.publish(e.accountId, e.aggregateId) });
    this.dispatcher.register({ id: "execution.workspace-cleanup", types: ["DeskPublished", "AssignmentCancelled", "AssignmentFailed"], handle: async (e) => this.cleanup(e) });
  }

  // Every accepted workspace of the employee that has not reached its desk yet, oldest first.
  async publishPending(orbitId: string, employeeId: string): Promise<void> {
    const rows = await this.db.query(
      `SELECT a.id FROM workforce.assignments a
       WHERE a.account_id = $1 AND a.employee_id = $2 AND a.state = 'COMPLETED'
         AND NOT EXISTS (SELECT 1 FROM workforce.desk_publications p WHERE p.account_id = a.account_id AND p.assignment_id = a.id)
       ORDER BY a.finished_at, a.id`,
      [orbitId, employeeId],
    );
    for (const r of rows) await this.publish(orbitId, String(r.id));
  }

  async publish(orbitId: string, assignmentId: string): Promise<void> {
    const provider = this.provider;
    if (provider === null) return;
    await this.db.tx(async () => {
      const a = await this.db.one("SELECT employee_id, mission_id, state FROM workforce.assignments WHERE account_id = $1 AND id = $2", [orbitId, assignmentId]);
      if (a === null || a.state !== "COMPLETED") return;
      const employeeId = String(a.employee_id);
      const s = await this.db.one("SELECT id, desk_version, version FROM workforce.sandboxes WHERE account_id = $1 AND employee_id = $2 FOR UPDATE", [orbitId, employeeId]);
      if (s === null) return;
      if ((await this.db.one("SELECT 1 AS done FROM workforce.desk_publications WHERE account_id = $1 AND assignment_id = $2", [orbitId, assignmentId])) !== null) return;
      const live = await this.db.one("SELECT 1 AS live FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2 AND state IN ('starting', 'running', 'unknown') LIMIT 1", [orbitId, assignmentId]);
      if (live !== null) throw new Error("an attempt of the assignment is still ending; its workspace is published once it has");
      const sandboxId = String(s.id);
      const r = await provider.publishWorkspace({ orbitId, employeeId, sandboxId }, assignmentId, Number(s.desk_version));
      const at = new Date().toISOString();
      await this.db.query("INSERT INTO workforce.desk_publications (account_id, assignment_id, employee_id, published, desk_version, changed, reason, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)", [orbitId, assignmentId, employeeId, r.published, r.deskVersion, jsonParam(r.changed.slice(0, 500)), r.reason, at]);
      let version = Number(s.version);
      if (r.published) {
        await this.db.query("UPDATE workforce.sandboxes SET desk_version = $3, updated_at = $4, version = version + 1 WHERE account_id = $1 AND id = $2", [orbitId, sandboxId, r.deskVersion, at]);
        version += 1;
      }
      const actor = systemActor(orbitId, "desk-publisher", `desk:${assignmentId}`);
      await this.outbox.append(actor.command, [{ type: "DeskPublished", aggregateType: "sandbox", aggregateId: sandboxId, aggregateVersion: version, missionId: String(a.mission_id), payload: { employeeId, assignmentId, published: r.published, deskVersion: r.deskVersion, changed: r.changedTotal, reason: r.reason } }]);
      await this.outbox.touched(orbitId, ["roster", "missions"], String(a.mission_id));
    });
  }

  // The workspace of an assignment that ended goes, verified; then its scratch commitment goes back.
  private async cleanup(e: IntegrationEvent): Promise<void> {
    const provider = this.provider;
    if (provider === null) return;
    const assignmentId = e.type === "DeskPublished" ? String(e.payload.assignmentId ?? "") : e.aggregateId;
    const a = await this.db.one("SELECT employee_id FROM workforce.assignments WHERE account_id = $1 AND id = $2", [e.accountId, assignmentId]);
    if (a === null) return;
    const s = await this.db.one("SELECT id FROM workforce.sandboxes WHERE account_id = $1 AND employee_id = $2", [e.accountId, String(a.employee_id)]);
    if (s === null) return;
    const live = await this.db.one("SELECT 1 AS live FROM workforce.runs WHERE account_id = $1 AND assignment_id = $2 AND state IN ('starting', 'running', 'unknown') LIMIT 1", [e.accountId, assignmentId]);
    if (live !== null) throw new Error("an attempt of the assignment is still ending; its workspace is removed once it has");
    const r = await provider.removeWorkspace({ orbitId: e.accountId, employeeId: String(a.employee_id), sandboxId: String(s.id) }, assignmentId);
    if (!r.gone) throw new Error(`the workspace was not verified removed: ${r.detail}`);
    await this.admission.releaseScratch(e.accountId, assignmentId);
  }
}
