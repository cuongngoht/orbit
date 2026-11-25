// TEMPORARY ASSISTANTS LEAVE WITH THEIR MISSION (Workforce; ADR 0061 §8). An assistant a lead engaged is RELEASED --
// its open work cancelled (which wakes its lead), archived, its desk deleted so the storage it committed is freed
// (HiringService.releaseAssistant) -- when:
//
//   - its mission ENDS: the ROOT assignment accepted, cancelled or failed (Work's own events; Workforce reads which
//     mission an assignment is of and imports nothing of Work);
//   - its Personal Sandbox could not be made (SandboxFailed): it would never run, and its lead must not wait for it;
//   - its engagement EXPIRED (at most WORKFORCE_LIMITS.assistantDays, or the mission's deadline): a sweep in the style of
//     the sandbox provisioner -- a loop over the records, each release in a transaction of its own.
//
// It is Orbit's own act, as a system actor: no person's employment command, and no policy to refuse it -- the engagement
// was decided as the lead when it was made, and this only ends what that decision bounded. A replayed event or a second
// sweep releases nothing twice.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { IntegrationEvent } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { systemActor } from "../../shared/application/commands.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { EmployeeRepository } from "../infrastructure/repositories.js";
import { HiringService } from "./hiring.service.js";

const SWEEP_MS = 10_000;
const BATCH = 20;

// Why an engagement ended, by what ended its mission.
const ENDED: Partial<Record<IntegrationEvent["type"], string>> = {
  AssignmentAccepted: "Its mission was accepted: the engagement ended.",
  AssignmentCancelled: "Its mission was cancelled: the engagement ended.",
  AssignmentFailed: "Its mission failed: the engagement ended.",
};
const SANDBOX_FAILED = "Its Personal Sandbox could not be made: the engagement ended.";
const EXPIRED = "Its engagement expired.";

@Injectable()
export class AssistantReleases implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("AssistantReleases");
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private closing = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(HiringService) private readonly hiring: HiringService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({ id: "workforce.assistants", types: ["AssignmentAccepted", "AssignmentCancelled", "AssignmentFailed", "SandboxFailed"], handle: (e) => this.on(e) });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.kick(), SWEEP_MS);
    this.timer.unref();
    this.kick();
  }

  onModuleDestroy(): void {
    this.closing = true;
    if (this.timer !== null) clearInterval(this.timer);
  }

  kick(): void {
    if (this.closing || this.busy) return;
    this.busy = true;
    void this.sweep()
      .catch((err: unknown) => this.logger.warn(`Releasing expired assistants failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.busy = false;
      });
  }

  // Every assistant whose engagement ran out, released -- each in a transaction of its own. Returns how many.
  async sweep(): Promise<number> {
    let n = 0;
    for (const a of await this.employees.expiredAssistants(BATCH)) {
      if (this.closing) break;
      const actor = systemActor(a.orbitId, "assistants", `assistant:${a.id}`);
      if (await this.db.tx(() => this.hiring.releaseAssistant(actor, a.id, EXPIRED))) n += 1;
    }
    return n;
  }

  // In the dispatcher's transaction (the event recorded handled with it).
  private async on(e: IntegrationEvent): Promise<void> {
    const actor = systemActor(e.accountId, "assistants", e.correlationId, e.id);
    if (e.type === "SandboxFailed") {
      if (typeof e.payload.employeeId === "string") await this.hiring.releaseAssistant(actor, e.payload.employeeId, SANDBOX_FAILED);
      return;
    }
    const why = ENDED[e.type];
    const root = await this.db.one("SELECT mission_id FROM workforce.assignments WHERE account_id = $1 AND id = $2 AND parent_id IS NULL", [e.accountId, e.aggregateId]);
    if (why === undefined || root === null) return;
    for (const id of await this.employees.assistantsOfMission(e.accountId, String(root.mission_id))) await this.hiring.releaseAssistant(actor, id, why);
  }
}
