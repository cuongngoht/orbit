// THE PERSONAL SANDBOX PROVISIONER (Workforce owns the record; the sandbox provider does the work): a sandbox hired as
// PROVISIONING becomes READY only once the provider made its desk, toolbox and cache, wrote to each and recorded how its
// quota is enforced, with the evidence -- or FAILED with the reason after its last try. It is a loop over the records
// (woken by every outbox append, swept every few seconds), not a consumer that holds a transaction while volumes are
// made: a try is CLAIMED with an optimistic version (two processes never provision one sandbox at once), the provider is
// asked with no transaction open (idempotent by the sandbox's ids, so a try repeated after a crash finds what the first
// made), and the result is written under the version the claim left. No container is started.
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { Db } from "../../../infra/db/db.js";
import { SANDBOX_PROVIDER, type ProvisionResult, type SandboxProvider } from "../../execution/application/sandbox.port.js";
import { systemActor } from "../../shared/application/commands.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { SandboxRepository } from "../infrastructure/repositories.js";

const SWEEP_MS = 5000;
const MAX_TRIES = 6;
// The pause before try n+1, in seconds (2, 4, 8 ... at most 5 minutes).
const backoff = (tries: number): number => Math.min(300, 2 ** Math.max(1, tries));

@Injectable()
export class SandboxProvisioner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("SandboxProvisioner");
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private again = false;
  private closing = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
  ) {}

  onApplicationBootstrap(): void {
    if (this.provider === null) return;
    this.outbox.onAppended(() => this.kick());
    this.timer = setInterval(() => this.kick(), SWEEP_MS);
    this.timer.unref();
    this.kick();
  }

  onModuleDestroy(): void {
    this.closing = true;
    if (this.timer !== null) clearInterval(this.timer);
  }

  kick(): void {
    if (this.closing || this.provider === null) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    void this.sweep()
      .catch((err: unknown) => this.logger.warn(`Provisioning failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.busy = false;
        if (this.again && !this.closing) {
          this.again = false;
          this.kick();
        }
      });
  }

  // Every sandbox due a try, oldest first.
  async sweep(): Promise<number> {
    const due = await this.db.query(
      `SELECT s.account_id, s.id, s.employee_id, s.version, s.provision_attempts, r.profile
       FROM workforce.sandboxes s
       JOIN workforce.employees e ON e.account_id = s.account_id AND e.id = s.employee_id
       JOIN workforce.employee_resources r ON r.account_id = e.account_id AND r.employee_id = e.id AND r.revision = e.resource_revision
       WHERE s.state = 'PROVISIONING' AND (s.provision_attempts = 0 OR s.updated_at + make_interval(secs => LEAST(300, power(2, GREATEST(1, s.provision_attempts)))) <= now())
       ORDER BY s.updated_at LIMIT 20`,
    );
    let n = 0;
    for (const row of due) {
      if (this.closing) break;
      const quotas = row.profile as { deskStorageMiB: number; cacheStorageMiB: number };
      if (await this.provision(String(row.account_id), String(row.id), String(row.employee_id), Number(row.version), Number(row.provision_attempts), { deskMiB: quotas.deskStorageMiB, cacheMiB: quotas.cacheStorageMiB })) n += 1;
    }
    return n;
  }

  private async provision(orbitId: string, sandboxId: string, employeeId: string, version: number, tries: number, quotas: { deskMiB: number; cacheMiB: number }): Promise<boolean> {
    const claimed = await this.db.run("UPDATE workforce.sandboxes SET provision_attempts = provision_attempts + 1, updated_at = now(), version = version + 1 WHERE account_id = $1 AND id = $2 AND state = 'PROVISIONING' AND version = $3", [orbitId, sandboxId, version]);
    if (claimed === 0) return false;
    let result: ProvisionResult;
    try {
      result = await (this.provider as SandboxProvider).provisionEmployee({ orbitId, employeeId, sandboxId }, quotas);
    } catch (err) {
      result = { state: "FAILED", areas: [], reason: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
    }
    const last = tries + 1 >= MAX_TRIES;
    if (result.state === "FAILED" && !last) {
      this.logger.warn(`Provisioning the sandbox of ${employeeId} failed (try ${tries + 1} of ${MAX_TRIES}); it is tried again in ${backoff(tries + 1)} s: ${result.reason ?? ""}`);
      return false;
    }
    await this.db.tx(async () => {
      const s = await this.sandboxes.ofEmployee(orbitId, employeeId, true);
      if (s === null || s.id !== sandboxId || s.state !== "PROVISIONING") return;
      const at = new Date().toISOString();
      const next = { ...s, state: result.state, areas: result.areas, reason: result.state === "READY" ? null : `${result.reason ?? "The sandbox could not be made."} (after ${MAX_TRIES} tries)` };
      const v = await this.sandboxes.save(next, at);
      const actor = systemActor(orbitId, "sandbox-provisioner", `sandbox:${sandboxId}`);
      await this.outbox.append(actor.command, [{ type: result.state === "READY" ? "SandboxReady" : "SandboxFailed", aggregateType: "sandbox", aggregateId: sandboxId, aggregateVersion: v, payload: { employeeId, areas: result.areas.map((a) => `${a.area} ${a.quotaMiB} MiB ${a.level}`).join(", "), reason: next.reason } }]);
      await this.outbox.touched(orbitId, ["roster"]);
    });
    return result.state === "READY";
  }
}
