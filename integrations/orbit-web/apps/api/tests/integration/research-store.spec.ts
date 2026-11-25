// RESEARCH'S RECORDS IN POSTGRESQL, below the API: every row carries its workspace's account and the database holds it to
// its parent's; a revision is numbered by its source's own counter however many are added at once; the full-text search
// folds Vietnamese, stems English, and reads only the revisions, the workspace and the account it is given; a citation
// outlives its session and its source; deleting a workspace takes everything it holds.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { Db } from "../../src/infra/db/db.js";
import { migrate } from "../../src/infra/db/migrate.js";
import { PgTextRetriever } from "../../src/modules/research/retrieval/retriever.js";
import { EvidenceStore } from "../../src/modules/research/store/evidence.js";
import { ResearchRunStore, ResearchSessionStore } from "../../src/modules/research/store/sessions.js";
import { SourceStore, type RevisionRecord, type SourceRecord } from "../../src/modules/research/store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "../../src/modules/research/store/workspaces.js";
import { createTestDatabase, type TestDatabase } from "../../src/testing/database.js";

const SEARCH_PATH = ["app", "research", "governance", "public"];

describe("research's records in PostgreSQL", () => {
  let t: TestDatabase;
  let db: Db;
  let workspaces: WorkspaceStore;
  let sources: SourceStore;
  let sessions: ResearchSessionStore;
  let runs: ResearchRunStore;
  let evidence: EvidenceStore;
  let retriever: PgTextRetriever;
  const alice = randomUUID();
  const bob = randomUUID();

  const account = async (id: string) => db.query("INSERT INTO app.accounts (id, display_name, created_at, updated_at) VALUES ($1, '', $2, $2)", [id, new Date().toISOString()]);
  const workspace = (accountId: string, name: string) => workspaces.create({ id: randomUUID(), accountId, ownerEmail: `${name}@example.com`, name, description: "" });
  const indexed = async (w: WorkspaceRecord, title: string, chunks: { text: string; section?: string }[]): Promise<{ source: SourceRecord; revision: RevisionRecord }> => {
    const source = await sources.create({ id: randomUUID(), workspaceId: w.id, kind: "text", title, origin: null, state: "queued", createdBy: "x@example.com" });
    const revision = await sources.addRevision({ id: randomUUID(), sourceId: source.id, contentHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), byteSize: 1, mediaType: "text", fileName: null, url: null, finalUrl: null, fetchedAt: null });
    let at = 0;
    await sources.writeChunkBatch(
      revision,
      chunks.map((c, ordinal) => {
        const start = at;
        at += c.text.length + 2;
        return { ordinal, page: null, section: c.section ?? null, charStart: start, charEnd: start + c.text.length, text: c.text };
      }),
    );
    await sources.indexed(revision.id, { pages: null, chars: at, chunks: chunks.length });
    return { source: (await sources.promote(source.id, revision.id)) as SourceRecord, revision };
  };

  before(async () => {
    t = await createTestDatabase();
    db = new Db({ url: t.url, poolMax: 8, connectTimeoutMs: 5_000, statementTimeoutMs: 30_000, searchPath: SEARCH_PATH });
    await migrate(db);
    [workspaces, sources, sessions, runs, evidence, retriever] = [new WorkspaceStore(db), new SourceStore(db), new ResearchSessionStore(db), new ResearchRunStore(db), new EvidenceStore(db), new PgTextRetriever(db)];
    await account(alice);
    await account(bob);
  });
  after(async () => {
    await db.close();
    await t.drop();
  });

  test("a workspace is its account's; an account sees its own and those shared with its identity's email", async () => {
    const mine = await workspace(alice, "alice");
    const theirs = await workspace(bob, "bob");
    assert.deepEqual((await workspaces.visibleTo({ accountId: alice, email: "alice@example.com" })).map((w) => w.id), [mine.id]);
    await workspaces.share(theirs, ["alice@example.com"], "bob@example.com");
    assert.deepEqual(new Set((await workspaces.visibleTo({ accountId: alice, email: "alice@example.com" })).map((w) => w.id)), new Set([mine.id, theirs.id]));
    assert.deepEqual(await workspaces.emails(theirs.id), ["alice@example.com"]);
    await workspaces.share(theirs, [], "bob@example.com");
    assert.deepEqual((await workspaces.visibleTo({ accountId: alice, email: "alice@example.com" })).map((w) => w.id), [mine.id], "unshared: gone again");
    await assert.rejects(db.query("UPDATE research.research_workspaces SET account_id = $2 WHERE id = $1", [mine.id, bob]), /never moves to another account/);
  });

  test("every child carries its workspace's account, and the database refuses one that does not", async () => {
    const w = await workspace(alice, "children");
    const { source, revision } = await indexed(w, "Doc", [{ text: "Some words." }]);
    assert.deepEqual([source.accountId, revision.accountId, revision.workspaceId], [alice, alice, w.id]);
    const [chunk] = await sources.chunks(revision.id, 0, 1);
    assert.equal(chunk?.accountId, alice);
    // A source of Alice's workspace named as Bob's: refused by the composite key.
    await assert.rejects(db.query("INSERT INTO research.research_sources (id, account_id, workspace_id, kind, title, state, created_by, created_at, updated_at) VALUES ($1, $2, $3, 'text', 'x', 'queued', 'x', now(), now())", [randomUUID(), bob, w.id]), /foreign key/);
    const theirs = await workspace(bob, "selector");
    const session = await sessions.create({ id: randomUUID(), workspaceId: theirs.id, title: "s", model: "sonnet", effort: "low", draftQuestion: null, createdBy: "bob@example.com" }, []);
    await assert.rejects(sessions.setSelection(session.id, [source.id]), /foreign key/, "a session of Bob's selects no source of Alice's");
  });

  test("a revision is numbered by its source's own counter: many at once never share a number", async () => {
    const w = await workspace(alice, "numbers");
    const { source } = await indexed(w, "Counted", [{ text: "One." }]);
    const made = await Promise.all(Array.from({ length: 20 }, () => sources.addRevision({ id: randomUUID(), sourceId: source.id, contentHash: "f".repeat(64), byteSize: 1, mediaType: "text", fileName: null, url: null, finalUrl: null, fetchedAt: null })));
    assert.deepEqual(made.map((r) => r.number).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2));
  });

  test("the search folds Vietnamese, stems English, ranks, and reads only what it is given", async () => {
    const w = await workspace(alice, "search");
    const vi = await indexed(w, "Sự cố", [{ text: "Rò rỉ dữ liệu khách hàng xảy ra khi khóa API bị lộ.", section: "Đánh giá rủi ro" }, { text: "Phần hai không liên quan." }]);
    const en = await indexed(w, "Incident", [{ text: "The servers were compromised by attackers." }]);
    const other = await indexed(await workspace(alice, "elsewhere"), "Elsewhere", [{ text: "Rò rỉ dữ liệu ở nơi khác." }]);
    const ask = (question: string, revisionIds: string[], workspaceId = w.id, accountId = alice) => retriever.retrieve({ accountId, workspaceId, revisionIds, question, budgetChars: 10_000 });
    const all = [vi.revision.id, en.revision.id];
    for (const q of ["rò rỉ dữ liệu", "ro ri du lieu", "RO RI DU LIEU"]) {
      const fts = (await ask(q, all)).filter((p) => p.match === "fts");
      assert.deepEqual(fts.map((p) => p.chunk.ordinal), [0], q);
      assert.equal(fts[0]?.chunk.revisionId, vi.revision.id, q);
    }
    assert.deepEqual((await ask("danh gia rui ro", all)).filter((p) => p.match === "fts").map((p) => p.chunk.ordinal), [0], "a section's title is searched too");
    assert.deepEqual((await ask("server compromise", all)).filter((p) => p.match === "fts").map((p) => p.chunk.revisionId), [en.revision.id], "stemmed");
    assert.deepEqual(await ask("server", []), [], "no revision given: nothing, and no query");
    // Another workspace's revision, named outright: not read -- the query is held to the workspace and the account.
    assert.deepEqual((await ask("ro ri du lieu", [other.revision.id])).length, 0);
    assert.deepEqual((await ask("ro ri du lieu", [vi.revision.id], w.id, bob)).length, 0, "nor another account's");
    // Few matches: the openings of the given revisions are added, marked as such, in turn.
    const leads = await ask("nothing matches this", all);
    assert.deepEqual(leads.map((p) => [p.match, p.chunk.revisionId, p.chunk.ordinal]), [["lead", vi.revision.id, 0], ["lead", en.revision.id, 0], ["lead", vi.revision.id, 1]]);
    assert.deepEqual(leads.map((p) => p.label), ["S1", "S2", "S3"]);
  });

  test("a citation outlives its session (and its source); a finding keeps its citations in order", async () => {
    const w = await workspace(alice, "evidence");
    const { source, revision } = await indexed(w, "Quoted", [{ text: "Quoted words." }]);
    const session = await sessions.create({ id: randomUUID(), workspaceId: w.id, title: "s", model: "sonnet", effort: "low", draftQuestion: null, createdBy: "alice@example.com" }, [source.id]);
    assert.deepEqual(await sessions.selection(session.id), [source.id]);
    const run = await runs.start({ id: randomUUID(), sessionId: session.id, model: "sonnet", effort: "low", questionId: null }, [{ sourceId: source.id, revisionId: revision.id, title: "Quoted" }], [{ label: "S1", chunkId: 1, sourceId: source.id, revisionId: revision.id, rank: 1, score: 0.5, match: "fts" }]);
    assert.equal(run.accountId, alice);
    assert.deepEqual((await runs.passages(run.id)).map((p) => [p.label, p.score, p.match]), [["S1", 0.5, "fts"]]);
    const citation = { id: randomUUID(), workspaceId: w.id, sessionId: session.id, runId: run.id, messageId: randomUUID(), label: "S1", sourceId: source.id, revisionId: revision.id, revisionNumber: 1, chunkOrdinal: 0, page: null, section: null, charStart: 0, charEnd: 13, sourceTitle: "Quoted", quote: "Quoted words.", match: "fts" as const, rank: 1, score: 0.5 };
    const second = { ...citation, id: randomUUID(), label: "S2" };
    await evidence.addCitations([citation, second]);
    const finding = await evidence.addFinding({ id: randomUUID(), workspaceId: w.id, sessionId: session.id, number: await workspaces.nextFinding(w.id), title: "F", statement: "S", createdBy: "alice@example.com" }, [second.id, citation.id]);
    assert.equal(finding.number, 1);
    assert.deepEqual((await evidence.findingCitations(finding.id)).map((c) => c.id), [second.id, citation.id], "in the order given");
    await sessions.delete(session.id);
    assert.equal((await evidence.citation(citation.id))?.sessionId, null, "the session went; the citation stays, without it");
    assert.equal((await evidence.finding(finding.id))?.sessionId, null);
    await evidence.dropUnreferenced(w.id);
    assert.ok(await evidence.citation(citation.id), "a finding still rests on it: kept");
    await sources.delete(source.id);
    assert.equal((await evidence.citation(citation.id))?.quote, "Quoted words.", "and it outlives its source");
    assert.equal((await db.one("SELECT count(*) AS n FROM research.research_chunks WHERE source_id = $1", [source.id]))?.n, 0);
  });

  test("the journal numbers a session's events by its own counter, concurrently, and reads back what it wrote", async () => {
    const w = await workspace(alice, "journal");
    const session = await sessions.create({ id: randomUUID(), workspaceId: w.id, title: "j", model: "sonnet", effort: "low", draftQuestion: null, createdBy: "alice@example.com" }, []);
    const written = await Promise.all(Array.from({ length: 15 }, (_, i) => sessions.append(session.id, "research.status", { status: "ready", reason: `n${i}` }, null)));
    assert.deepEqual(written.map((e) => e.seq).sort((a, b) => (a ?? 0) - (b ?? 0)), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.equal(await sessions.head(session.id), 15);
    const read = await sessions.since(session.id, 10, 100, 13);
    assert.deepEqual(read.map((e) => e.seq), [11, 12, 13]);
    assert.equal(read[0]?.stream, "research");
  });

  test("deleting a workspace takes everything it holds, and nothing of another's", async () => {
    const w = await workspace(alice, "doomed");
    const keep = await workspace(alice, "kept");
    const { source } = await indexed(w, "Gone", [{ text: "Gone words." }]);
    const kept = await indexed(keep, "Kept", [{ text: "Kept words." }]);
    await sessions.create({ id: randomUUID(), workspaceId: w.id, title: "s", model: "sonnet", effort: "low", draftQuestion: null, createdBy: "alice@example.com" }, [source.id]);
    await workspaces.delete(w.id);
    const [left] = await db.query(
      "SELECT (SELECT count(*) FROM research.research_sources WHERE workspace_id = $1) AS sources, (SELECT count(*) FROM research.research_chunks WHERE workspace_id = $1) AS chunks, (SELECT count(*) FROM research.research_sessions WHERE workspace_id = $1) AS sessions",
      [w.id],
    );
    assert.deepEqual([left?.sources, left?.chunks, left?.sessions], [0, 0, 0]);
    assert.ok(await sources.get(kept.source.id));
  });
});
