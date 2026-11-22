// A MISSION'S REPOSITORIES, held to its employee's grants: asked when the work is given (each one as the connector
// lists it now, and only one the employee may use on that connector -- every repository or the ones chosen), kept in
// workforce.connection_grants as the MISSION's grants (one row per repository, "<connector>.repository"), and read back.
import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ACCESS_CONNECTOR_LABELS, type MissionRepositoryRequest } from "@orbit-web/contracts";
import { ApiError } from "../../common/errors.js";
import type { MissionRepositories, MissionRepository } from "../../contexts/work/application/mission-repositories.port.js";
import { Db, jsonParam } from "../../infra/db/db.js";
import { SourcesService } from "../sources/sources.module.js";
import { inScope } from "./connector-text.js";
import { ConnectionGrantStore } from "./grants.store.js";

const OPERATION = /^(github|azure)\.repository$/;

@Injectable()
export class MissionRepositoryGrants implements MissionRepositories {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ConnectionGrantStore) private readonly grants: ConnectionGrantStore,
    @Inject(SourcesService) private readonly sources: SourcesService,
  ) {}

  async resolve(orbitId: string, employeeId: string, asked: readonly MissionRepositoryRequest[]): Promise<MissionRepository[]> {
    const live = await this.grants.live(orbitId, employeeId);
    const out: MissionRepository[] = [];
    for (const r of asked) {
      const label = ACCESS_CONNECTOR_LABELS[r.source];
      const grant = live.get(r.source);
      if (grant === undefined) throw new ApiError(HttpStatus.FORBIDDEN, "repository_not_granted", `This employee may not use ${label}: let it on its Access page (Office → the employee → Access) first.`);
      const repo = await this.sources.authorized(r.source, r.id);
      if (!inScope(grant.repositories, { owner: repo.owner, project: repo.project, name: repo.name })) throw new ApiError(HttpStatus.FORBIDDEN, "repository_not_granted", `${repo.fullName} is not among the repositories this employee may use on ${label}: change that on its Access page first.`);
      out.push({ source: r.source, id: repo.id, fullName: repo.fullName, owner: repo.owner, project: repo.project, name: repo.name, branch: r.branch });
    }
    return out;
  }

  async keep(orbitId: string, missionId: string, repositories: readonly MissionRepository[], by: string): Promise<void> {
    for (const r of repositories) {
      await this.db.query(
        `INSERT INTO workforce.connection_grants (id, account_id, grantee_kind, grantee_id, operation, scope, created_by, created_at)
         VALUES ($1, $2, 'mission', $3, $4, $5::jsonb, $6, now())`,
        [randomUUID(), orbitId, missionId, `${r.source}.repository`, jsonParam(r), by],
      );
    }
  }

  async of(orbitId: string, missionId: string): Promise<MissionRepository[]> {
    const rows = await this.db.query(
      `SELECT operation, scope FROM workforce.connection_grants
        WHERE account_id = $1 AND grantee_kind = 'mission' AND grantee_id = $2 AND revoked_at IS NULL ORDER BY created_at, id`,
      [orbitId, missionId],
    );
    return rows.filter((r) => OPERATION.test(String(r.operation))).map((r) => (typeof r.scope === "string" ? JSON.parse(r.scope) : r.scope) as MissionRepository);
  }
}
