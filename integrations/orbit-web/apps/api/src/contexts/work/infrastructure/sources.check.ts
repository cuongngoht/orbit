// What a mission may be given of the account's research (Knowledge & Research context, read through this port): the
// pinned revisions must be the account's own, of the named workspace, and indexed. A revision is immutable, so a
// mission pinned to it reads exactly what was there when it was given -- whatever the source becomes later.
import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../../../infra/db/db.js";
import type { PinnedSource } from "../../execution/application/run-outcomes.port.js";
import { missing, unprocessable } from "../../shared/domain.js";

@Injectable()
export class SourcesCheck {
  constructor(@Inject(Db) private readonly db: Db) {}

  async check(orbitId: string, workspaceId: string, revisionIds: readonly string[]): Promise<void> {
    const ws = await this.db.one("SELECT id FROM research.research_workspaces WHERE account_id = $1 AND id = $2", [orbitId, workspaceId]);
    if (ws === null) throw missing("Research workspace");
    if (revisionIds.length === 0) return;
    const rows = await this.db.query("SELECT id, status FROM research.research_source_revisions WHERE account_id = $1 AND workspace_id = $2 AND id = ANY($3)", [orbitId, workspaceId, [...revisionIds]]);
    const found = new Map(rows.map((r) => [String(r.id), String(r.status)]));
    const absent = revisionIds.filter((id) => !found.has(id));
    const unready = revisionIds.filter((id) => found.has(id) && found.get(id) !== "indexed");
    if (absent.length > 0) throw unprocessable("source_not_available", `${absent.length} source revision(s) are not of this research workspace.`, { absent });
    if (unready.length > 0) throw unprocessable("source_not_indexed", `${unready.length} source revision(s) are not indexed yet.`, { unready });
  }

  // The pinned revisions, labelled S1, S2 ... in the order the mission named them (what the employee cites them by).
  async pinned(orbitId: string, workspaceId: string | null, revisionIds: readonly string[]): Promise<PinnedSource[]> {
    if (workspaceId === null || revisionIds.length === 0) return [];
    const rows = await this.db.query(
      `SELECT r.id, r.source_id, r.workspace_id, r.media_type, r.content_hash, r.file_name, s.title
       FROM research.research_source_revisions r JOIN research.research_sources s ON s.account_id = r.account_id AND s.id = r.source_id
       WHERE r.account_id = $1 AND r.workspace_id = $2 AND r.id = ANY($3)`,
      [orbitId, workspaceId, [...revisionIds]],
    );
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return revisionIds.flatMap((id, i) => {
      const r = byId.get(id);
      if (r === undefined) return [];
      return [{ label: `S${i + 1}`, revisionId: id, sourceId: String(r.source_id), workspaceId: String(r.workspace_id), title: String(r.title), mediaType: String(r.media_type), contentHash: String(r.content_hash), fileName: r.file_name === null ? null : String(r.file_name) }];
    });
  }
}
