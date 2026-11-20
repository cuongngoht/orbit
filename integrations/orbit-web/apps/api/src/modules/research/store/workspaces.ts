// Research workspaces and who each is shared with. Nothing else writes these tables.
import type { AccessEntry } from "@orbit-web/contracts";
import type { Database } from "../../../infra/storage/database.js";
import type { Owner } from "../../../infra/storage/stores.js";
import { now, num, str, type Row } from "./rows.js";

export interface WorkspaceRecord {
  id: string;
  name: string;
  description: string;
  ownerEmail: string;
  ownerOrg: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCounts {
  sources: number;
  sessions: number;
  notes: number;
  findings: number;
}

const workspaceOf = (r: Row): WorkspaceRecord => ({
  id: str(r.id),
  name: str(r.name),
  description: str(r.description),
  ownerEmail: str(r.owner_email),
  ownerOrg: str(r.owner_org),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export class WorkspaceStore {
  constructor(private readonly database: Database) {}

  create(w: Pick<WorkspaceRecord, "id" | "name" | "description" | "ownerEmail" | "ownerOrg">): WorkspaceRecord {
    const at = now();
    this.database.db.prepare("INSERT INTO research_workspaces (id, name, description, owner_email, owner_org, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(w.id, w.name, w.description, w.ownerEmail, w.ownerOrg, at, at);
    return this.get(w.id) as WorkspaceRecord;
  }

  get(id: string): WorkspaceRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_workspaces WHERE id = ?").get(id) as Row | undefined;
    return row ? workspaceOf(row) : null;
  }

  // The workspaces an account owns, and those shared with its email -- most recently changed first.
  visibleTo(o: Owner): WorkspaceRecord[] {
    return (
      this.database.db
        .prepare("SELECT * FROM research_workspaces WHERE (owner_email = ? AND owner_org = ?) OR id IN (SELECT workspace_id FROM research_workspace_access WHERE email = ?) ORDER BY updated_at DESC, created_at DESC")
        .all(o.email, o.org, o.email) as Row[]
    ).map(workspaceOf);
  }

  update(id: string, patch: { name?: string; description?: string }): WorkspaceRecord {
    const w = this.get(id) as WorkspaceRecord;
    this.database.db.prepare("UPDATE research_workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?").run(patch.name ?? w.name, patch.description ?? w.description, now(), id);
    return this.get(id) as WorkspaceRecord;
  }

  // Something inside changed (a source, a session, a note): it moves up the list.
  touch(id: string): void {
    this.database.db.prepare("UPDATE research_workspaces SET updated_at = ? WHERE id = ?").run(now(), id);
  }

  counts(id: string): WorkspaceCounts {
    const one = (sql: string) => num((this.database.db.prepare(sql).get(id) as Row).n);
    return {
      sources: one("SELECT count(*) AS n FROM research_sources WHERE workspace_id = ?"),
      sessions: one("SELECT count(*) AS n FROM research_sessions WHERE workspace_id = ?"),
      notes: one("SELECT count(*) AS n FROM research_notes WHERE workspace_id = ?"),
      findings: one("SELECT count(*) AS n FROM research_findings WHERE workspace_id = ?"),
    };
  }

  // The next finding number of the workspace (F-001, F-002 …), taken in the same transaction that stores the finding.
  nextFinding(id: string): number {
    const row = this.database.db.prepare("UPDATE research_workspaces SET next_finding = next_finding + 1 WHERE id = ? RETURNING next_finding").get(id) as Row;
    return num(row.next_finding) - 1;
  }

  // Everything the workspace holds goes with it: the chunks first (their index entries are removed with each row),
  // then the rows that cascade from the workspace.
  delete(id: string): void {
    this.database.transaction(() => {
      this.database.db.prepare("DELETE FROM research_chunks WHERE workspace_id = ?").run(id);
      this.database.db.prepare("DELETE FROM research_workspaces WHERE id = ?").run(id);
    });
  }

  hasAccess(id: string, email: string): boolean {
    return this.database.db.prepare("SELECT 1 FROM research_workspace_access WHERE workspace_id = ? AND email = ?").get(id, email) !== undefined;
  }

  people(id: string): AccessEntry[] {
    return (this.database.db.prepare("SELECT * FROM research_workspace_access WHERE workspace_id = ? ORDER BY granted_at, email").all(id) as Row[]).map((r) => ({ email: str(r.email), grantedBy: str(r.granted_by), grantedAt: str(r.granted_at) }));
  }

  share(id: string, emails: readonly string[], grantedBy: string): void {
    const at = now();
    this.database.transaction(() => {
      const kept = new Set(emails);
      for (const p of this.people(id)) if (!kept.has(p.email)) this.database.db.prepare("DELETE FROM research_workspace_access WHERE workspace_id = ? AND email = ?").run(id, p.email);
      for (const email of emails) this.database.db.prepare("INSERT INTO research_workspace_access (workspace_id, email, granted_by, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, email) DO NOTHING").run(id, email, grantedBy, at);
    });
  }
}
