// Research workspaces and who each is shared with. Nothing else writes these tables. A workspace belongs to an ACCOUNT
// (account_id); everything it holds carries that account too, held to it by the database (infra/db/migrations.ts).
import type { AccessEntry } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { now, num, str, type Row } from "./rows.js";

export interface WorkspaceRecord {
  id: string;
  // The account that owns it -- what decides who may open it -- and its identity's email when it was made (shown only).
  accountId: string;
  ownerEmail: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCounts {
  sources: number;
  sessions: number;
  notes: number;
  findings: number;
}

// Who asks: an account, and the email its identity is shared by.
export interface ResearchViewer {
  accountId: string;
  email: string;
}

const workspaceOf = (r: Row): WorkspaceRecord => ({
  id: str(r.id),
  accountId: str(r.account_id),
  ownerEmail: str(r.owner_email),
  name: str(r.name),
  description: str(r.description),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export class WorkspaceStore {
  constructor(private readonly db: Db) {}

  async create(w: Pick<WorkspaceRecord, "id" | "accountId" | "ownerEmail" | "name" | "description">): Promise<WorkspaceRecord> {
    const at = now();
    const row = await this.db.one("INSERT INTO research_workspaces (id, account_id, owner_email, name, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *", [w.id, w.accountId, w.ownerEmail, w.name, w.description, at]);
    return workspaceOf(row as Row);
  }

  async get(id: string): Promise<WorkspaceRecord | null> {
    const row = await this.db.one("SELECT * FROM research_workspaces WHERE id = $1", [id]);
    return row === null ? null : workspaceOf(row);
  }

  // The workspaces an account owns, and those shared with its identity's email -- most recently changed first.
  async visibleTo(v: ResearchViewer): Promise<WorkspaceRecord[]> {
    return (
      await this.db.query("SELECT * FROM research_workspaces WHERE account_id = $1 OR id IN (SELECT workspace_id FROM research_workspace_access WHERE email = $2) ORDER BY updated_at DESC, created_at DESC", [v.accountId, v.email])
    ).map(workspaceOf);
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<WorkspaceRecord> {
    const row = await this.db.one("UPDATE research_workspaces SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = $4 WHERE id = $1 RETURNING *", [id, patch.name ?? null, patch.description ?? null, now()]);
    if (row === null) throw new Error(`no research workspace ${id}`);
    return workspaceOf(row);
  }

  // Something inside changed (a source, a session, a note): it moves up the list.
  async touch(id: string): Promise<void> {
    await this.db.query("UPDATE research_workspaces SET updated_at = $2 WHERE id = $1", [id, now()]);
  }

  async counts(id: string): Promise<WorkspaceCounts> {
    const row = (await this.db.one(
      `SELECT (SELECT count(*) FROM research_sources WHERE workspace_id = $1) AS sources,
              (SELECT count(*) FROM research_sessions WHERE workspace_id = $1) AS sessions,
              (SELECT count(*) FROM research_notes WHERE workspace_id = $1) AS notes,
              (SELECT count(*) FROM research_findings WHERE workspace_id = $1) AS findings`,
      [id],
    )) as Row;
    return { sources: num(row.sources), sessions: num(row.sessions), notes: num(row.notes), findings: num(row.findings) };
  }

  // The next finding number of the workspace (F-001, F-002 …), taken by an UPDATE of the workspace's row in the same
  // transaction that stores the finding: a number is never handed out twice.
  async nextFinding(id: string): Promise<number> {
    const row = await this.db.one("UPDATE research_workspaces SET next_finding = next_finding + 1 WHERE id = $1 RETURNING next_finding", [id]);
    if (row === null) throw new Error(`no research workspace ${id}`);
    return num(row.next_finding) - 1;
  }

  // Everything the workspace holds goes with it: its sources, revisions and chunks, its sessions and their journals, its
  // citations, notes and findings, who it was shared with -- by the database's cascades.
  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM research_workspaces WHERE id = $1", [id]);
  }

  async hasAccess(id: string, email: string): Promise<boolean> {
    return (await this.db.one("SELECT 1 AS yes FROM research_workspace_access WHERE workspace_id = $1 AND email = $2", [id, email])) !== null;
  }

  async people(id: string): Promise<AccessEntry[]> {
    return (await this.db.query("SELECT * FROM research_workspace_access WHERE workspace_id = $1 ORDER BY granted_at, email", [id])).map((r) => ({ email: str(r.email), grantedBy: str(r.granted_by), grantedAt: str(r.granted_at) }));
  }

  // The emails it is shared with: who, beside its owner, is told what changes in it.
  async emails(id: string): Promise<string[]> {
    return (await this.db.query("SELECT email FROM research_workspace_access WHERE workspace_id = $1 ORDER BY email", [id])).map((r) => str(r.email));
  }

  // The whole list, as the owner gave it: who was already on it keeps when they were added.
  async share(w: Pick<WorkspaceRecord, "id" | "accountId">, emails: readonly string[], grantedBy: string): Promise<void> {
    const at = now();
    await this.db.tx(async () => {
      await this.db.query("DELETE FROM research_workspace_access WHERE workspace_id = $1 AND NOT (email = ANY($2::text[]))", [w.id, emails]);
      for (const email of emails) {
        await this.db.query("INSERT INTO research_workspace_access (account_id, workspace_id, email, granted_by, granted_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, email) DO NOTHING", [w.accountId, w.id, email, grantedBy, at]);
      }
    });
  }
}
