// GOVERNANCE → EMPLOYEE DESKS, LOOKED INTO AND CLEANED UP (desks.ts, ADR 0069): the account's owner opens any of its
// employees' desks -- one folder, or a file's text, read only -- and cleans one up when it fills.
//
// Every look is the account policy's to decide (`employee.desk.read`, people only, always recorded) and is recorded
// with what was looked at, never what it holds (`office.desk.read`). The bytes are read by the sandbox provider's
// storage worker -- the employee's own user, no network, never through a link -- and a file is sent as text only when it
// is text; what it holds is shown, never run.
//
// A clean (`employee.desk.clean`) happens only when nothing of the employee's work could still change the desk -- it is
// in the office, its sandbox READY, it holds no assignment, no attempt of it is ending, and accepted work has reached
// the desk (it is published first) -- and only at the desk's version the person chose what to remove at (If-Match). The
// provider checks again, under the employee's own lock, that no workspace or attempt container is left: a work tree
// seeded before the clean would put back, when published, what the clean removed. The desk's version does not move (it
// counts accepted results); the clean is recorded, and the desk's use measured again.
import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import { checkDeskClean, checkDeskDir, checkDeskPath, DESK_LIMITS, isWorkforceId, type DeskCleanResult, type DeskFile, type DeskTree } from "@orbit-web/contracts";
import { accepted } from "../../../common/errors.js";
import { Db } from "../../../infra/db/db.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { SANDBOX_PROVIDER, type SandboxIds, type SandboxProvider } from "../../execution/application/sandbox.port.js";
import { WorkspacePublisher } from "../../execution/application/workspace-publisher.js";
import { OfficeGovernance, type Actor } from "../../shared/application/commands.js";
import { conflictWith, DomainError, invalid, missing, stale } from "../../shared/domain.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { EmployeeRepository, SandboxRepository, type SandboxRecord } from "../infrastructure/repositories.js";
import { deskReadable } from "./employee.queries.js";

// A file's text, or null when it is not text (a NUL byte, or not UTF-8). A file cut short may end inside a character:
// that character is left out, not counted against the file.
export function textOf(data: Buffer, truncated: boolean): string | null {
  if (data.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data, { stream: truncated });
  } catch {
    return null;
  }
}

// What the provider said, as the office says it: a path that is not one, one that is not there, a clean it refuses now.
function refusalOf(err: unknown): unknown {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "bad_request") return invalid("invalid_path", message);
  if (code === "not_found") return new DomainError("not_found", "not_found", message);
  if (code === "conflict") return conflictWith("desk_in_use", message);
  if (code === "unavailable") return new DomainError("unavailable", "desk_unavailable", message);
  return err;
}

const idsOf = (s: SandboxRecord): SandboxIds => ({ orbitId: s.orbitId, employeeId: s.employeeId, sandboxId: s.id });

@Injectable()
export class DeskService implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(WorkspacePublisher) private readonly publisher: WorkspacePublisher,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
  ) {}

  // A desk's use changes when accepted work is published to it and when it is provisioned: measured again then.
  onModuleInit(): void {
    if (this.provider === null) return;
    this.dispatcher.register({
      id: "workforce.desk-measure",
      types: ["DeskPublished", "SandboxReady"],
      handle: async (e) => {
        if (typeof e.payload.employeeId === "string") await this.resources.measureEmployee({ orbitId: e.accountId, employeeId: e.payload.employeeId, sandboxId: e.aggregateId });
      },
    });
  }

  // GET /api/employees/:id/desk?dir= -- one folder of the desk.
  async tree(actor: Actor, employeeId: string, dirIn: unknown): Promise<DeskTree> {
    const orbitId = actor.command.orbitId;
    const { name, employment, sandbox } = await this.found(orbitId, employeeId);
    const dir = checkDeskDir(dirIn ?? "");
    if (dir === null) throw invalid("invalid_path", "dir must be a folder of the desk, from its root (no leading /, no . or ..)");
    await this.governance.authorize(actor, "employee.desk.read", employeeId, { employee: employeeId });
    const provider = this.readable(sandbox);
    const listing = await provider.listDesk(idsOf(sandbox), dir, DESK_LIMITS.entries).catch((err: unknown) => Promise.reject(refusalOf(err)));
    await this.governance.looked(actor, { employeeId, path: dir, kind: "dir", bytes: listing.bytes, deskVersion: listing.deskVersion });
    if (dir === "") await this.resources.measureEmployee(idsOf(sandbox));
    return {
      employee: { id: employeeId, name, employment },
      dir,
      deskVersion: listing.deskVersion,
      entries: listing.entries,
      truncated: listing.truncated,
      bytes: listing.bytes,
      files: listing.files,
      storage: await this.storage(orbitId, employeeId),
      clean: await this.cleanable(orbitId, employeeId, employment, sandbox),
      asOf: new Date().toISOString(),
    };
  }

  // GET /api/employees/:id/desk/file?path= -- a file's first DESK_LIMITS.readBytes, as text when it is text.
  async file(actor: Actor, employeeId: string, pathIn: unknown): Promise<DeskFile> {
    const { sandbox } = await this.found(actor.command.orbitId, employeeId);
    const path = checkDeskPath(pathIn);
    if (path === null) throw invalid("invalid_path", "path must be a file of the desk, from its root (no leading /, no . or ..)");
    await this.governance.authorize(actor, "employee.desk.read", employeeId, { employee: employeeId });
    const provider = this.readable(sandbox);
    const r = await provider.readDesk(idsOf(sandbox), path, DESK_LIMITS.readBytes).catch((err: unknown) => Promise.reject(refusalOf(err)));
    await this.governance.looked(actor, { employeeId, path, kind: "file", bytes: r.bytes, deskVersion: r.deskVersion });
    return { path, bytes: r.bytes, text: textOf(r.data, r.truncated), truncated: r.truncated, deskVersion: r.deskVersion, modifiedAt: r.modifiedAt };
  }

  // POST /api/employees/:id/desk/clean (If-Match: the desk's version).
  async clean(actor: Actor, employeeId: string, body: unknown, expected: number): Promise<DeskCleanResult> {
    const order = accepted(checkDeskClean(body));
    const orbitId = actor.command.orbitId;
    const { sandbox } = await this.found(orbitId, employeeId);
    // Accepted work that has not reached the desk goes there first (in its own transaction); one that cannot yet keeps
    // the clean waiting (below).
    await this.publisher.publishPending(orbitId, employeeId).catch(() => undefined);
    const result = await this.governance.command(actor, "employee.desk.clean", employeeId, async () => {
      await this.governance.authorize(actor, "employee.desk.clean", employeeId, { employee: employeeId });
      // The same order as an employment change: the employee (which a claim of new work takes first), then its sandbox
      // (which a publish takes) -- both wait for this clean.
      const e = await this.employees.get(orbitId, employeeId, true);
      const s = await this.sandboxes.ofEmployee(orbitId, employeeId, true);
      if (e === null || s === null) throw missing("Employee's desk");
      if (e.data.employment === "archived" || e.data.employment === "deleted") throw conflictWith("desk_read_only", "This employee left the office: its desk is kept read only until you delete it.");
      if (s.state !== "READY") throw conflictWith("desk_unavailable", `The employee's sandbox is ${s.state}: its desk is cleaned once it is READY.`);
      if (s.deskVersion !== expected) throw stale(`The desk is at version ${s.deskVersion}, not ${expected}: accepted work reached it since you read it. Look at it again.`);
      const busy = await this.busy(orbitId, employeeId);
      if (busy !== null) throw conflictWith("employee_holds_work", busy);
      const provider = this.provider;
      if (provider === null) throw new DomainError("unavailable", "desk_unavailable", "No sandbox provider is configured.");
      const r = await provider.cleanDesk(idsOf(s), order, expected).catch((err: unknown) => Promise.reject(refusalOf(err)));
      const detail = `removed ${r.removed} (${r.paths.join(", ")})${order.empty ? "; everything but the toolbox" : ""}${r.cacheEmptied ? "; cache emptied" : ""}${r.missing.length > 0 ? `; not there: ${r.missing.join(", ")}` : ""}`;
      await this.governance.recorded(actor, "employee.desk.clean", "sandbox", s.id, r.deskVersion, detail);
      await this.outbox.touched(orbitId, ["roster"]);
      return r;
    });
    await this.resources.measureEmployee(idsOf(sandbox));
    return { removed: result.removed, paths: result.paths, missing: result.missing, cacheEmptied: result.cacheEmptied, deskVersion: result.deskVersion };
  }

  // The account's employee and its sandbox; another account's, or one with no sandbox, is not found.
  private async found(orbitId: string, employeeId: string): Promise<{ name: string; employment: string; sandbox: SandboxRecord }> {
    if (!isWorkforceId(employeeId)) throw missing("Employee");
    const e = await this.employees.get(orbitId, employeeId);
    const sandbox = e === null ? null : await this.sandboxes.ofEmployee(orbitId, employeeId);
    if (e === null || sandbox === null) throw missing("Employee");
    return { name: e.data.name, employment: e.data.employment, sandbox };
  }

  private readable(s: SandboxRecord): SandboxProvider {
    if (this.provider === null) throw new DomainError("unavailable", "desk_unavailable", "No sandbox provider is configured.");
    if (!deskReadable(s.state)) throw conflictWith("desk_unavailable", `The employee's sandbox is ${s.state}: there is no desk to look into.`);
    return this.provider;
  }

  // Why the employee's work could still change its desk now, or null.
  private async busy(orbitId: string, employeeId: string): Promise<string | null> {
    const r = await this.db.one(
      `SELECT EXISTS (SELECT 1 FROM workforce.reservations WHERE account_id = $1 AND employee_id = $2) AS holds,
              EXISTS (SELECT 1 FROM workforce.runs WHERE account_id = $1 AND employee_id = $2 AND state IN ('starting', 'running', 'unknown')) AS running,
              EXISTS (SELECT 1 FROM workforce.assignments a WHERE a.account_id = $1 AND a.employee_id = $2 AND a.state = 'COMPLETED'
                        AND NOT EXISTS (SELECT 1 FROM workforce.desk_publications p WHERE p.account_id = a.account_id AND p.assignment_id = a.id)) AS unpublished`,
      [orbitId, employeeId],
    );
    if (r?.holds === true) return "This employee holds work: its work tree, made from the desk, would put back what is removed. Clean it once that work is done.";
    if (r?.running === true) return "An attempt of this employee's work is still ending. Clean the desk once it has.";
    if (r?.unpublished === true) return "Accepted work of this employee has not reached its desk yet. Clean it once it has.";
    return null;
  }

  private async cleanable(orbitId: string, employeeId: string, employment: string, s: SandboxRecord): Promise<{ allowed: boolean; why: string | null }> {
    if (employment === "archived" || employment === "deleted") return { allowed: false, why: "It left the office: its desk is kept read only until you delete it." };
    if (s.state !== "READY") return { allowed: false, why: `Its sandbox is ${s.state}.` };
    const busy = await this.busy(orbitId, employeeId);
    return { allowed: busy === null, why: busy };
  }

  private async storage(orbitId: string, employeeId: string): Promise<DeskTree["storage"]> {
    const rows = await this.db.query("SELECT category, committed_mib, used_mib, measured_at FROM workforce.storage_usage WHERE account_id = $1 AND owner_ref = $2 AND category IN ('desk', 'cache')", [orbitId, employeeId]);
    const of = (c: string) => rows.find((r) => r.category === c);
    const used = (c: string): number | null => (of(c)?.used_mib === null || of(c)?.used_mib === undefined ? null : Number(of(c)?.used_mib));
    const desk = of("desk");
    return { deskQuotaMiB: Number(desk?.committed_mib ?? 0), cacheQuotaMiB: Number(of("cache")?.committed_mib ?? 0), deskUsedMiB: used("desk"), cacheUsedMiB: used("cache"), measuredAt: desk?.measured_at === null || desk?.measured_at === undefined ? null : String(desk.measured_at) };
  }
}
