// WHAT AN ATTEMPT MAY READ, read from Work's records and decided by `grantOf` (domain/data-authorization.ts): its sources
// (with the labels the mission gave them, so a claim cites the same S1 at every level), the hand-ins it may read (their
// summary and files), and whether it brings the mission's repositories. Worked out again at every look -- staging, each
// read of one of its inputs, the access watch -- so a share revoked or a part moved is seen at once. A lead's own sources
// are its own grant, worked out the same way: a part of a part reads at most what its lead reads.
import { Inject, Injectable } from "@nestjs/common";
import { WORKFORCE_LIMITS } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import type { AttemptData, GrantedHandoffInput } from "../../execution/application/run-outcomes.port.js";
import { grantOf, type DataGrant, type ShareFact } from "../domain/data-authorization.js";
import { SourcesCheck } from "../infrastructure/sources.check.js";

interface AssignmentRow {
  id: string;
  parentId: string | null;
  dependsOn: string[];
  shareRepositories: boolean;
  workspaceId: string | null;
  sourceRevisionIds: string[];
}

@Injectable()
export class AttemptDataService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(SourcesCheck) private readonly sources: SourcesCheck,
  ) {}

  async of(orbitId: string, assignmentId: string): Promise<AttemptData | null> {
    const a = await this.row(orbitId, assignmentId);
    if (a === null) return null;
    const grant = await this.grant(orbitId, a, 0);
    const pinned = await this.sources.pinned(orbitId, a.workspaceId, a.sourceRevisionIds);
    const given = new Map(grant.sources.map((s) => [s.revisionId, s]));
    const sources = pinned.flatMap((p) => {
      const g = given.get(p.revisionId);
      return g === undefined ? [] : [{ ...p, origin: g.origin, ref: g.ref }];
    });
    return { sources, handoffs: await this.handoffsOf(orbitId, grant), repositories: grant.repositories, withheld: grant.withheld };
  }

  // Every artifact hash belonging to any hand-in (any status) of this assignment's direct parts: used by the access
  // watch so a live review attempt is never stopped as ACCESS_REVOKED when the lead itself requests a revision or a
  // subordinate hands in a newer revision.
  async supervisedArtifactSha256s(orbitId: string, assignmentId: string): Promise<Set<string>> {
    const rows = await this.db.query(
      `SELECT DISTINCT ar.sha256
       FROM workforce.assignments p
       JOIN workforce.handoffs h ON h.account_id = p.account_id AND h.assignment_id = p.id
       JOIN workforce.artifacts ar ON ar.account_id = h.account_id AND ar.handoff_id = h.id
       WHERE p.account_id = $1 AND p.parent_id = $2`,
      [orbitId, assignmentId],
    );
    return new Set(rows.map((r) => String(r.sha256)));
  }

  private async row(orbitId: string, assignmentId: string): Promise<AssignmentRow | null> {
    const r = await this.db.one(
      `SELECT a.id, a.parent_id, a.brief, m.research_workspace_id, m.source_revision_ids FROM workforce.assignments a
       JOIN workforce.missions m ON m.account_id = a.account_id AND m.id = a.mission_id
       WHERE a.account_id = $1 AND a.id = $2`,
      [orbitId, assignmentId],
    );
    if (r === null) return null;
    return {
      id: String(r.id),
      parentId: r.parent_id === null ? null : String(r.parent_id),
      dependsOn: ((r.brief as { dependsOn?: string[] }).dependsOn ?? []).map(String),
      shareRepositories: (r.brief as { shareRepositories?: boolean }).shareRepositories === true,
      workspaceId: r.research_workspace_id === null ? null : String(r.research_workspace_id),
      sourceRevisionIds: (r.source_revision_ids as string[]).map(String),
    };
  }

  private async grant(orbitId: string, a: AssignmentRow, depth: number): Promise<DataGrant> {
    const lead = a.parentId === null || depth > WORKFORCE_LIMITS.delegationDepth ? null : await this.row(orbitId, a.parentId);
    const leadGrant = lead === null ? null : await this.grant(orbitId, lead, depth + 1);
    return grantOf({
      leadId: a.parentId,
      missionSources: a.sourceRevisionIds,
      repositories: a.parentId === null,
      leadSources: leadGrant === null ? [] : leadGrant.sources.map((s) => s.revisionId),
      leadRepositories: leadGrant?.repositories ?? false,
      shareRepositories: a.shareRepositories,
      shares: await this.shares(orbitId, a.id),
      waitsFor: a.parentId === null ? [] : await this.waitsFor(orbitId, a.parentId, a.dependsOn),
      parts: await this.parts(orbitId, a.id),
    });
  }

  private async shares(orbitId: string, assignmentId: string): Promise<ShareFact[]> {
    const rows = await this.db.query("SELECT id, kind, source_revision_id, origin_assignment_id, mode FROM workforce.data_shares WHERE account_id = $1 AND recipient_assignment_id = $2 AND revoked_at IS NULL ORDER BY created_at, id", [orbitId, assignmentId]);
    return rows.map((r) => (r.kind === "source" ? { id: String(r.id), kind: "source" as const, revisionId: String(r.source_revision_id) } : { id: String(r.id), kind: "handoff" as const, originAssignmentId: String(r.origin_assignment_id), mode: r.mode === "full" ? ("full" as const) : ("summary" as const) }));
  }

  // The parts of the same lead this one waits for, each with its accepted hand-in (null: not accepted yet).
  private async waitsFor(orbitId: string, leadId: string, keys: readonly string[]): Promise<{ assignmentId: string; unitKey: string; accepted: string | null }[]> {
    if (keys.length === 0) return [];
    const rows = await this.db.query(
      `SELECT a.id, a.unit_key, (SELECT h.id FROM workforce.handoffs h WHERE h.account_id = a.account_id AND h.assignment_id = a.id AND h.status = 'accepted' ORDER BY h.revision DESC LIMIT 1) AS accepted
       FROM workforce.assignments a WHERE a.account_id = $1 AND a.parent_id = $2 AND a.unit_key = ANY($3) ORDER BY a.created_at, a.id`,
      [orbitId, leadId, [...keys]],
    );
    return rows.map((r) => ({ assignmentId: String(r.id), unitKey: String(r.unit_key), accepted: r.accepted === null ? null : String(r.accepted) }));
  }

  // Its own direct parts, each with its latest hand-in that is submitted or accepted.
  private async parts(orbitId: string, assignmentId: string): Promise<{ assignmentId: string; unitKey: string; latest: string | null }[]> {
    const rows = await this.db.query(
      `SELECT a.id, a.unit_key, (SELECT h.id FROM workforce.handoffs h WHERE h.account_id = a.account_id AND h.assignment_id = a.id AND h.status IN ('submitted', 'accepted') ORDER BY h.revision DESC LIMIT 1) AS latest
       FROM workforce.assignments a WHERE a.account_id = $1 AND a.parent_id = $2 ORDER BY a.created_at, a.id`,
      [orbitId, assignmentId],
    );
    return rows.map((r) => ({ assignmentId: String(r.id), unitKey: String(r.unit_key), latest: r.latest === null ? null : String(r.latest) }));
  }

  private async handoffsOf(orbitId: string, grant: DataGrant): Promise<GrantedHandoffInput[]> {
    const out: GrantedHandoffInput[] = [];
    for (const g of grant.handoffs) {
      const h = await this.db.one("SELECT revision, summary, digest FROM workforce.handoffs WHERE account_id = $1 AND id = $2", [orbitId, g.handoffId]);
      if (h === null) continue;
      const files = g.mode === "summary" ? [] : await this.db.query("SELECT name, sha256 FROM workforce.artifacts WHERE account_id = $1 AND handoff_id = $2 ORDER BY name", [orbitId, g.handoffId]);
      out.push({ ...g, revision: Number(h.revision), digest: String(h.digest), summary: String(h.summary), artifacts: files.map((f) => ({ name: String(f.name), sha256: String(f.sha256) })) });
    }
    return out;
  }
}
