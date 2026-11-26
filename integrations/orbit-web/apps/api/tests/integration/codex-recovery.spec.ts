// RECOVERY VALIDATION FOR PRE-FIX CODEX TRANSCRIPTS (Issue #1, AC #3):
// Separate from the forward fix: simulates pre-fix 0.8.0 PostgreSQL data where Codex emitted unscoped `item_0` across
// multiple turns and across sessions/accounts, plus a session with a journal gap (completed run with no reply event).
// Validates dry-run assessment, boundary preservation, explicit gap reporting without guessing, and idempotency.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { SEARCH_PATH } from "../../src/core/core.module.js";
import { Db } from "../../src/infra/db/db.js";
import { assessAndRecoverCodexTranscripts, type CodexRecoveryReport } from "../../src/modules/claude-runner/codex-recovery.js";
import type { TestDatabase } from "../../src/testing/database.js";
import { startHarness } from "../../src/testing/harness.js";

const CLI = fileURLToPath(new URL("../../src/cli/db.js", import.meta.url));

describe("Codex transcript recovery (separate from forward fix)", () => {
  let database: TestDatabase;
  let dataDir: string;
  let db: Db;
  let accountA: string;
  let accountB: string;
  let sessionA: string;
  let sessionB: string;
  let sessionGap: string;
  let runA1: string;
  let runA2: string;
  let runB1: string;
  let runGap1: string;
  let runGap2: string;

  const runCli = (...args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, "recover-codex-transcripts", ...args], {
      env: { PATH: process.env.PATH, ORBIT_WEB_DATABASE_URL: database.url },
      encoding: "utf8",
    });

  before(async () => {
    const h = await startHarness();
    dataDir = h.dataDir;
    database = h.database;
    accountA = h.accountId as string;
    await h.close(true);

    db = new Db({ url: database.url, poolMax: 2, connectTimeoutMs: 10_000, statementTimeoutMs: 60_000, searchPath: SEARCH_PATH, applicationName: "orbit-web-recovery-test" });
    accountB = randomUUID();
    const now = new Date().toISOString();
    await db.query("INSERT INTO app.accounts (id, kind, display_name, company_name, created_at, updated_at) VALUES ($1, 'customer', 'Other', 'Other Co', $2, $2)", [accountB, now]);

    sessionA = randomUUID();
    sessionB = randomUUID();
    sessionGap = randomUUID();
    runA1 = randomUUID();
    runA2 = randomUUID();
    runB1 = randomUUID();
    runGap1 = randomUUID();
    runGap2 = randomUUID();

    // Seed three Codex sessions.
    for (const [id, acc, title, lastSeq] of [
      [sessionA, accountA, "Two-turn Codex session", 8],
      [sessionB, accountB, "Second account Codex session", 3],
      [sessionGap, accountA, "Session with missing reply gap", 5],
    ] as const) {
      await db.query(
        "INSERT INTO app.sessions (id, account_id, owner_email, title, model, effort, mode, workspace_path, runtime, claude_session_id, turns, status, last_seq, created_at, updated_at) VALUES ($1, $2, 'owner@test.local', $3, 'gpt-6.1-sol', 'medium', 'autonomous', '/tmp/w', 'codex', $4, 2, 'completed', $5, $6, $6)",
        [id, acc, title, randomUUID(), lastSeq, now],
      );
    }

    // Seed runs.
    for (const [id, acc, sess, resumed] of [
      [runA1, accountA, sessionA, false],
      [runA2, accountA, sessionA, true],
      [runB1, accountB, sessionB, false],
      [runGap1, accountA, sessionGap, false],
      [runGap2, accountA, sessionGap, true],
    ] as const) {
      await db.query(
        "INSERT INTO app.runs (id, account_id, session_id, status, model, effort, mode, resumed, started_at, ended_at, exit_code) VALUES ($1, $2, $3, 'completed', 'gpt-6.1-sol', 'medium', 'autonomous', $4, $5, $5, 0)",
        [id, acc, sess, resumed, now],
      );
    }

    const uA1 = randomUUID();
    const uA2 = randomUUID();
    const uB1 = randomUUID();
    const uG1 = randomUUID();
    const uG2 = randomUUID();

    // Session A journal: both runs completed with unscoped `item_0` (tool) and `item_1` (message).
    const eventsA: Array<[number, string, string, Record<string, unknown>]> = [
      [1, runA1, "message.completed", { messageId: uA1, role: "user", text: "Round 1", parentToolUseId: null, partial: false, truncated: false }],
      [2, runA1, "tool.started", { toolUseId: "item_0", name: "Shell", title: "$ echo 1", input: "echo 1", inputTruncated: false, parentToolUseId: null, agent: null }],
      [3, runA1, "tool.completed", { toolUseId: "item_0", output: "1", truncated: false, isError: false, interrupted: false, parentToolUseId: null }],
      [4, runA1, "message.started", { messageId: "item_1", role: "assistant", parentToolUseId: null }],
      [5, runA1, "message.completed", { messageId: "item_1", role: "assistant", text: "ORBIT-ROUND-ONE-348", parentToolUseId: null, partial: false, truncated: false }],
      [6, runA2, "message.completed", { messageId: uA2, role: "user", text: "Round 2", parentToolUseId: null, partial: false, truncated: false }],
      [7, runA2, "message.started", { messageId: "item_1", role: "assistant", parentToolUseId: null }],
      [8, runA2, "message.completed", { messageId: "item_1", role: "assistant", text: "ORBIT-ROUND-TWO-906", parentToolUseId: null, partial: false, truncated: false }],
    ];
    for (const [seq, runId, type, data] of eventsA) {
      await db.query("INSERT INTO app.events (account_id, session_id, seq, run_id, type, data, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [accountA, sessionA, seq, runId, type, JSON.stringify(data), now]);
    }
    // Pre-fix corrupted app.messages for Session A: item_1 was overwritten by Round 2 (and then even clobbered by Session B!).
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ($1, $2, $3, $4, 'user', 'Round 1', $5)", [uA1, accountA, sessionA, runA1, now]);
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ('item_1', $1, $2, $3, 'assistant', 'ACCOUNT-B-CLOBBER', $4)", [accountA, sessionA, runA1, now]);
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ($1, $2, $3, $4, 'user', 'Round 2', $5)", [uA2, accountA, sessionA, runA2, now]);

    // Session B journal (different account): also emitted unscoped `item_1`; its app.messages lost the row to conflict with Session A.
    const eventsB: Array<[number, string, string, Record<string, unknown>]> = [
      [1, runB1, "message.completed", { messageId: uB1, role: "user", text: "Hello from B", parentToolUseId: null, partial: false, truncated: false }],
      [2, runB1, "message.started", { messageId: "item_1", role: "assistant", parentToolUseId: null }],
      [3, runB1, "message.completed", { messageId: "item_1", role: "assistant", text: "ACCOUNT-B-REPLY", parentToolUseId: null, partial: false, truncated: false }],
    ];
    for (const [seq, runId, type, data] of eventsB) {
      await db.query("INSERT INTO app.events (account_id, session_id, seq, run_id, type, data, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [accountB, sessionB, seq, runId, type, JSON.stringify(data), now]);
    }
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ($1, $2, $3, $4, 'user', 'Hello from B', $5)", [uB1, accountB, sessionB, runB1, now]);

    // Session Gap: runGap1 has a completed reply, runGap2 is marked completed in app.runs but has NO assistant message.completed in app.events.
    const eventsGap: Array<[number, string, string, Record<string, unknown>]> = [
      [1, runGap1, "message.completed", { messageId: uG1, role: "user", text: "Q1", parentToolUseId: null, partial: false, truncated: false }],
      [2, runGap1, "message.started", { messageId: "item_9", role: "assistant", parentToolUseId: null }],
      [3, runGap1, "message.completed", { messageId: "item_9", role: "assistant", text: "A1", parentToolUseId: null, partial: false, truncated: false }],
      [4, runGap2, "message.completed", { messageId: uG2, role: "user", text: "Q2", parentToolUseId: null, partial: false, truncated: false }],
    ];
    for (const [seq, runId, type, data] of eventsGap) {
      await db.query("INSERT INTO app.events (account_id, session_id, seq, run_id, type, data, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [accountA, sessionGap, seq, runId, type, JSON.stringify(data), now]);
    }
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ($1, $2, $3, $4, 'user', 'Q1', $5)", [uG1, accountA, sessionGap, runGap1, now]);
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ('item_9', $1, $2, $3, 'assistant', 'A1', $4)", [accountA, sessionGap, runGap1, now]);
    await db.query("INSERT INTO app.messages (id, account_id, session_id, run_id, role, text, created_at) VALUES ($1, $2, $3, $4, 'user', 'Q2', $5)", [uG2, accountA, sessionGap, runGap2, now]);
  });

  after(async () => {
    await db.close();
    rmSync(dataDir, { recursive: true, force: true });
    await database.drop();
  });

  test("dry-run assessment reports recoverable sessions and gaps without mutating data", async () => {
    const r = runCli("--json");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const report = JSON.parse(r.stdout) as CodexRecoveryReport;
    assert.equal(report.applied, false);
    assert.equal(report.inspected, 3);
    assert.equal(report.recoverable, 3);
    assert.equal(report.recovered, 0);
    assert.equal(report.totalGaps, 1);

    const gapSession = report.sessions.find((s) => s.sessionId === sessionGap);
    assert.equal(gapSession?.gaps.length, 1);
    assert.equal(gapSession?.gaps[0]?.kind, "missing_completed_reply");
    assert.equal(gapSession?.gaps[0]?.runId, runGap2);

    // Confirm nothing was mutated on dry-run.
    const msgsA = await db.query("SELECT id, text FROM app.messages WHERE session_id = $1 ORDER BY seq", [sessionA]);
    assert.equal(msgsA.length, 3);
    assert.equal(msgsA[1]?.id, "item_1");
  });

  test("apply restores transcripts and event IDs in order, preserves boundaries, reports gaps without guessing, and is idempotent", async () => {
    const r1 = runCli("--apply", "--json");
    assert.equal(r1.status, 0, r1.stderr + r1.stdout);
    const applied = JSON.parse(r1.stdout) as CodexRecoveryReport;
    assert.equal(applied.applied, true);
    assert.equal(applied.recovered, 3);
    assert.equal(applied.totalGaps, 1);

    // Session A: both replies restored in exact order under distinct run-scoped IDs.
    const msgsA = await db.query("SELECT id, account_id, run_id, role, text FROM app.messages WHERE session_id = $1 ORDER BY seq", [sessionA]);
    assert.deepEqual(
      msgsA.map((m) => [m.role, m.text, m.run_id, m.account_id]),
      [
        ["user", "Round 1", runA1, accountA],
        ["assistant", "ORBIT-ROUND-ONE-348", runA1, accountA],
        ["user", "Round 2", runA2, accountA],
        ["assistant", "ORBIT-ROUND-TWO-906", runA2, accountA],
      ],
    );
    assert.equal(msgsA[1]?.id, `${runA1}:item_1`);
    assert.equal(msgsA[3]?.id, `${runA2}:item_1`);

    // Session A events: toolUseId and messageId are both scoped to their runs.
    const evsA = await db.query("SELECT seq, type, run_id, data FROM app.events WHERE session_id = $1 ORDER BY seq", [sessionA]);
    assert.equal((evsA[1]?.data as { toolUseId: string }).toolUseId, `${runA1}:item_0`);
    assert.equal((evsA[2]?.data as { toolUseId: string }).toolUseId, `${runA1}:item_0`);
    assert.equal((evsA[3]?.data as { messageId: string }).messageId, `${runA1}:item_1`);
    assert.equal((evsA[4]?.data as { messageId: string }).messageId, `${runA1}:item_1`);
    assert.equal((evsA[6]?.data as { messageId: string }).messageId, `${runA2}:item_1`);
    assert.equal((evsA[7]?.data as { messageId: string }).messageId, `${runA2}:item_1`);

    // Session B (separate account): preserved strictly under accountB and restored its own reply.
    const msgsB = await db.query("SELECT id, account_id, run_id, role, text FROM app.messages WHERE session_id = $1 ORDER BY seq", [sessionB]);
    assert.deepEqual(
      msgsB.map((m) => [m.id, m.account_id, m.run_id, m.role, m.text]),
      [
        [msgsB[0]?.id, accountB, runB1, "user", "Hello from B"],
        [`${runB1}:item_1`, accountB, runB1, "assistant", "ACCOUNT-B-REPLY"],
      ],
    );

    // Session Gap: runGap1 reply preserved; runGap2 missing reply NOT guessed or fabricated.
    const msgsGap = await db.query("SELECT id, run_id, role, text FROM app.messages WHERE session_id = $1 ORDER BY seq", [sessionGap]);
    assert.deepEqual(
      msgsGap.map((m) => [m.role, m.text, m.run_id]),
      [
        ["user", "Q1", runGap1],
        ["assistant", "A1", runGap1],
        ["user", "Q2", runGap2],
      ],
    );

    // Re-running recovery is strictly idempotent: all 3 sessions are now clean, 0 recovered, 0 events scoped.
    const second = await assessAndRecoverCodexTranscripts(db, { apply: true });
    assert.equal(second.clean, 3);
    assert.equal(second.recovered, 0);
    assert.equal(second.recoverable, 0);
    assert.equal(second.totalGaps, 1, "the missing_completed_reply gap is still honestly reported");
  });
});
