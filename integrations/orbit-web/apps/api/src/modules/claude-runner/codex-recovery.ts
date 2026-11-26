// RECOVERY ASSESSMENT & IDEMPOTENT REPAIR FOR PRE-FIX CODEX TRANSCRIPTS.
//
// Pre-fix Codex chat runs wrote raw provider item IDs (`item_0`, `cmd_1`) into both `app.events` and `app.messages`.
// Because `codex exec` / `codex exec resume` resets its item counter on each invocation, later turns reused the same
// `messageId` (and `toolUseId`): `app.events` kept each turn's completed reply under its own `run_id`, while
// `app.messages` (PK `id`) and event replay overwrote the earlier reply.
//
// This module is intentionally separate from the forward fix:
//   - Dry-run by default (`apply: false`): inspects `app.sessions` where `runtime = 'codex'` (optionally narrowed to
//     one account or session) and reports what is clean, recoverable, or needs manual review, plus every gap found.
//   - Preserves account, session, and run boundaries; never touches non-Codex sessions, never touches another session's
//     rows, and never guesses missing text when a completed run has no `message.completed` event in `app.events`.
//   - Idempotent (`apply: true`): scopes unscoped Codex item IDs in `app.events` using `${runId}:${rawId}` and rebuilds
//     the session's `app.messages` rows from `app.events` in exact `seq` order. Running it again makes zero writes.
import type { Db, Param } from "../../infra/db/db.js";
import { codexScopedId, isCodexScopedId } from "./codex-chat.js";

export type CodexRecoveryGapKind =
  | "missing_completed_reply"
  | "unattributed_assistant_event"
  | "malformed_event"
  | "same_run_collision"
  | "orphan_message_row";

export interface CodexRecoveryGap {
  kind: CodexRecoveryGapKind;
  runId: string | null;
  seq: number | null;
  messageId: string | null;
  detail: string;
}

export interface CodexSessionRecovery {
  accountId: string;
  sessionId: string;
  title: string;
  status: "clean" | "recoverable" | "recovered" | "manual_review";
  completedRuns: number;
  journalMessages: number;
  storedMessagesBefore: number;
  storedMessagesAfter: number;
  eventsScoped: number;
  hasShareSnapshot: boolean;
  gaps: CodexRecoveryGap[];
}

export interface CodexRecoveryReport {
  applied: boolean;
  inspected: number;
  clean: number;
  recoverable: number;
  recovered: number;
  manualReview: number;
  totalGaps: number;
  sessions: CodexSessionRecovery[];
}

export interface CodexRecoveryOptions {
  apply?: boolean;
  accountId?: string | null;
  sessionId?: string | null;
}

const BLOCKING_GAPS = new Set<CodexRecoveryGapKind>(["unattributed_assistant_event", "malformed_event", "same_run_collision", "orphan_message_row"]);

const str = (v: unknown): string => (typeof v === "string" ? v : v instanceof Date ? v.toISOString() : String(v ?? ""));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface CanonicalMessage {
  id: string;
  runId: string | null;
  role: string;
  text: string;
  createdAt: string;
}

interface EventScopeUpdate {
  seq: number;
  runId: string;
  field: "messageId" | "toolUseId";
  scopedId: string;
}

interface StoredMessage {
  id: string;
  runId: string | null;
  role: string;
  text: string;
}

function messagesMatch(stored: readonly StoredMessage[], canonical: readonly CanonicalMessage[]): boolean {
  if (stored.length !== canonical.length) return false;
  return stored.every((m, i) => {
    const c = canonical[i];
    return c !== undefined && m.id === c.id && m.runId === c.runId && m.role === c.role && m.text === c.text;
  });
}

export async function assessAndRecoverCodexTranscripts(db: Db, options: CodexRecoveryOptions = {}): Promise<CodexRecoveryReport> {
  const apply = options.apply === true;
  const where = ["runtime = 'codex'"];
  const params: Param[] = [];
  if (options.accountId) {
    params.push(options.accountId);
    where.push(`account_id = $${params.length}`);
  }
  if (options.sessionId) {
    params.push(options.sessionId);
    where.push(`id = $${params.length}`);
  }
  const sessionRows = await db.query(`SELECT id, account_id, title FROM app.sessions WHERE ${where.join(" AND ")} ORDER BY created_at ASC, id ASC`, params);
  const sessions: CodexSessionRecovery[] = [];

  for (const row of sessionRows) {
    const sessionId = str(row.id);
    const accountId = str(row.account_id);
    const title = str(row.title);
    const one = await processSession(db, { accountId, sessionId, title, apply });
    sessions.push(one);
  }

  return {
    applied: apply,
    inspected: sessions.length,
    clean: sessions.filter((s) => s.status === "clean").length,
    recoverable: sessions.filter((s) => s.status === "recoverable").length,
    recovered: sessions.filter((s) => s.status === "recovered").length,
    manualReview: sessions.filter((s) => s.status === "manual_review").length,
    totalGaps: sessions.reduce((acc, s) => acc + s.gaps.length, 0),
    sessions,
  };
}

async function processSession(
  db: Db,
  ctx: { accountId: string; sessionId: string; title: string; apply: boolean },
): Promise<CodexSessionRecovery> {
  const { accountId, sessionId, title, apply } = ctx;
  const [runRows, eventRows, messageRows, shareRow] = await Promise.all([
    db.query("SELECT id, status FROM app.runs WHERE account_id = $1 AND session_id = $2 ORDER BY started_at ASC, id ASC", [accountId, sessionId]),
    db.query("SELECT seq, run_id, type, data, at FROM app.events WHERE account_id = $1 AND session_id = $2 ORDER BY seq ASC", [accountId, sessionId]),
    db.query("SELECT id, run_id, role, text FROM app.messages WHERE account_id = $1 AND session_id = $2 ORDER BY seq ASC", [accountId, sessionId]),
    db.one("SELECT 1 AS yes FROM app.shares WHERE account_id = $1 AND session_id = $2", [accountId, sessionId]),
  ]);

  const gaps: CodexRecoveryGap[] = [];
  const canonical: CanonicalMessage[] = [];
  const seenCanonical = new Map<string, string>();
  const knownIds = new Set<string>();
  const runsWithReply = new Set<string>();
  const eventsToScope: EventScopeUpdate[] = [];

  for (const ev of eventRows) {
    const seq = Number(ev.seq);
    const runId = strOrNull(ev.run_id);
    const type = str(ev.type);
    const data = isRecord(ev.data) ? ev.data : null;
    if (data === null) continue;

    if ((type === "tool.started" || type === "tool.completed" || type === "tool.failed") && runId !== null) {
      const rawToolId = typeof data.toolUseId === "string" ? data.toolUseId : null;
      if (rawToolId !== null && rawToolId.length > 0 && !isCodexScopedId(rawToolId, runId)) {
        eventsToScope.push({ seq, runId, field: "toolUseId", scopedId: codexScopedId(runId, rawToolId) });
      }
      continue;
    }

    if (type === "message.started" && data.role === "assistant" && runId !== null) {
      const rawId = typeof data.messageId === "string" ? data.messageId : null;
      if (rawId !== null && rawId.length > 0 && !isCodexScopedId(rawId, runId)) {
        eventsToScope.push({ seq, runId, field: "messageId", scopedId: codexScopedId(runId, rawId) });
      }
      continue;
    }

    if (type !== "message.completed") continue;
    const parentToolUseId = data.parentToolUseId ?? null;
    const role = typeof data.role === "string" ? data.role : null;
    const rawId = typeof data.messageId === "string" ? data.messageId : null;
    const text = typeof data.text === "string" ? data.text : null;

    if (role === null || rawId === null || rawId.length === 0 || text === null) {
      gaps.push({ kind: "malformed_event", runId, seq, messageId: rawId, detail: `Event seq ${seq} is missing role, messageId, or text.` });
      continue;
    }

    if (role === "assistant") {
      if (runId === null) {
        gaps.push({ kind: "unattributed_assistant_event", runId: null, seq, messageId: rawId, detail: `Assistant message.completed at seq ${seq} has no run_id.` });
        continue;
      }
      const scopedId = isCodexScopedId(rawId, runId) ? rawId : codexScopedId(runId, rawId);
      if (scopedId !== rawId) {
        eventsToScope.push({ seq, runId, field: "messageId", scopedId });
      }
      if (parentToolUseId !== null) continue;
      runsWithReply.add(runId);
      knownIds.add(rawId);
      knownIds.add(scopedId);
      const prev = seenCanonical.get(scopedId);
      if (prev !== undefined) {
        if (prev !== text) {
          gaps.push({ kind: "same_run_collision", runId, seq, messageId: scopedId, detail: `Run ${runId} emitted conflicting texts for ${scopedId}.` });
        }
        continue;
      }
      seenCanonical.set(scopedId, text);
      canonical.push({ id: scopedId, runId, role, text, createdAt: str(ev.at) });
      continue;
    }

    if (parentToolUseId !== null) continue;
    knownIds.add(rawId);
    const prev = seenCanonical.get(rawId);
    if (prev !== undefined) {
      if (prev !== text) {
        gaps.push({ kind: "same_run_collision", runId, seq, messageId: rawId, detail: `Conflicting user message texts for ${rawId}.` });
      }
      continue;
    }
    seenCanonical.set(rawId, text);
    canonical.push({ id: rawId, runId, role, text, createdAt: str(ev.at) });
  }

  const completedRuns = runRows.filter((r) => str(r.status) === "completed");
  for (const r of completedRuns) {
    const runId = str(r.id);
    if (!runsWithReply.has(runId)) {
      gaps.push({
        kind: "missing_completed_reply",
        runId,
        seq: null,
        messageId: null,
        detail: `Completed run ${runId} has no top-level assistant message.completed event in app.events; missing text is not guessed.`,
      });
    }
  }

  const stored: StoredMessage[] = messageRows.map((r) => ({ id: str(r.id), runId: strOrNull(r.run_id), role: str(r.role), text: str(r.text) }));
  for (const m of stored) {
    if (!knownIds.has(m.id)) {
      gaps.push({
        kind: "orphan_message_row",
        runId: m.runId,
        seq: null,
        messageId: m.id,
        detail: `Stored message ${m.id} is not backed by app.events and will not be overwritten or deleted automatically.`,
      });
    }
  }

  const blocking = gaps.some((g) => BLOCKING_GAPS.has(g.kind));
  const needsMessageRebuild = !messagesMatch(stored, canonical);
  const needsRecovery = eventsToScope.length > 0 || needsMessageRebuild;

  if (blocking) {
    return {
      accountId,
      sessionId,
      title,
      status: "manual_review",
      completedRuns: completedRuns.length,
      journalMessages: canonical.length,
      storedMessagesBefore: stored.length,
      storedMessagesAfter: stored.length,
      eventsScoped: 0,
      hasShareSnapshot: shareRow !== null,
      gaps,
    };
  }

  if (!needsRecovery) {
    return {
      accountId,
      sessionId,
      title,
      status: "clean",
      completedRuns: completedRuns.length,
      journalMessages: canonical.length,
      storedMessagesBefore: stored.length,
      storedMessagesAfter: stored.length,
      eventsScoped: 0,
      hasShareSnapshot: shareRow !== null,
      gaps,
    };
  }

  if (!apply) {
    return {
      accountId,
      sessionId,
      title,
      status: "recoverable",
      completedRuns: completedRuns.length,
      journalMessages: canonical.length,
      storedMessagesBefore: stored.length,
      storedMessagesAfter: canonical.length,
      eventsScoped: eventsToScope.length,
      hasShareSnapshot: shareRow !== null,
      gaps,
    };
  }

  await db.tx(async () => {
    for (const u of eventsToScope) {
      await db.query("UPDATE app.events SET data = jsonb_set(data, $5::text[], to_jsonb($6::text)) WHERE account_id = $1 AND session_id = $2 AND seq = $3 AND run_id = $4", [
        accountId,
        sessionId,
        u.seq,
        u.runId,
        [u.field],
        u.scopedId,
      ]);
    }
    if (needsMessageRebuild) {
      const idsToReplace = [...knownIds];
      if (idsToReplace.length > 0) {
        await db.query("DELETE FROM app.messages WHERE account_id = $1 AND session_id = $2 AND id = ANY($3::text[])", [accountId, sessionId, idsToReplace]);
      }
      for (const m of canonical) {
        await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
          m.id,
          accountId,
          sessionId,
          m.runId,
          m.role,
          m.text,
          m.createdAt,
        ]);
      }
    }
  });

  return {
    accountId,
    sessionId,
    title,
    status: "recovered",
    completedRuns: completedRuns.length,
    journalMessages: canonical.length,
    storedMessagesBefore: stored.length,
    storedMessagesAfter: canonical.length,
    eventsScoped: eventsToScope.length,
    hasShareSnapshot: shareRow !== null,
    gaps,
  };
}
