// WHEN WHAT AN ATTEMPT READS IS NO LONGER ITS TO READ (Execution; ADR 0061 §9). A live attempt was given, before it
// started, what its grant allowed: its manifest of /input and its data domain's room at /team. When that grant moves --
// a share revoked, a lead's own grant narrowed, its employee moved to another department (the room it holds is another
// department's now) -- the attempt is asked to stop (ACCESS_REVOKED, recorded with why) and Work blocks its assignment
// saying so; nothing runs it again by itself. Checked when something that decides access changes (the governance's
// access hooks, an employee's department), and by a heartbeat for what no hook says. Fail-open: a check that cannot be
// made is tried again by the next.
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Db } from "../../../infra/db/db.js";
import { RunBindingStore } from "../../../infra/governance/stores.js";
import { contextOf } from "../../../modules/auth/principal.js";
import { AccessHooks } from "../../../modules/governance/access-hooks.js";
import { AuditService } from "../../../modules/governance/audit.service.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { AttemptManifest } from "../infrastructure/attempt-manifest.js";
import { RunRepository, type RunRecord } from "../infrastructure/runs.repository.js";
import { AttemptInputs } from "./attempt-inputs.js";
import { ACCESS_REVOKED } from "./execution.worker.js";

const HEARTBEAT_MS = 60_000;

@Injectable()
export class AccessWatch implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("AccessWatch");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AccessHooks) private readonly hooks: AccessHooks,
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(RunBindingStore) private readonly bindings: RunBindingStore,
    @Inject(AttemptManifest) private readonly manifest: AttemptManifest,
    @Inject(AttemptInputs) private readonly inputs: AttemptInputs,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
  ) {}

  onModuleInit(): void {
    this.hooks.on(async (accountId, change) => {
      await this.check(accountId, change.employeeId ?? null, change.cause ?? "access changed");
    });
    this.dispatcher.register({ id: "execution.access", types: ["EmployeeDepartmentChanged"], handle: async (e) => void (await this.check(e.accountId, e.aggregateId, "department changed")) });
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  // Every live attempt of the account (of one employee, when named) held to its grant now: those that hold what is no
  // longer theirs are asked to stop. How many were.
  async check(orbitId: string, employeeId: string | null, cause: string): Promise<number> {
    let stopped = 0;
    for (const run of await this.runs.liveOf(orbitId, employeeId)) {
      const why = await this.revoked(run);
      if (why === null || !(await this.runs.requestStopOf(orbitId, run.id, ACCESS_REVOKED))) continue;
      stopped += 1;
      const ctx = contextOf({ kind: "system", id: "access-watch", accountId: orbitId }, `run:${run.id}`);
      await this.audit.record(ctx, { type: "office.access.revoked", outcome: "stopped", runId: run.id, data: { runId: run.id, assignmentId: run.assignmentId, cause: `${why} (${cause})`.slice(0, 300) } });
    }
    if (stopped > 0) this.logger.log(`${stopped} attempt(s) asked to stop: what they read is no longer theirs (${cause}).`);
    return stopped;
  }

  // Why this attempt no longer holds what it was given (null: it still may).
  private async revoked(run: RunRecord): Promise<string | null> {
    const binding = await this.bindings.get(run.orbitId, run.id);
    if (binding !== null && binding.kind === "assignment") {
      const e = await this.db.one("SELECT department_id FROM workforce.employees WHERE account_id = $1 AND id = $2", [run.orbitId, run.employeeId]);
      const now = e === null || e.department_id === null ? null : String(e.department_id);
      if ((binding.departmentId ?? null) !== now) return "its employee moved to another department: the room it holds is not its department's now";
    }
    const name = await this.inputs.withdrawn(run.orbitId, run.assignmentId, await this.manifest.of(run.orbitId, run.id));
    return name === null ? null : `"${name}" is no longer its to read`;
  }

  private async heartbeat(): Promise<void> {
    try {
      for (const orbitId of await this.runs.accountsLive()) await this.check(orbitId, null, "heartbeat");
    } catch (err) {
      this.logger.warn(`The access heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
