// RESEARCH, END TO END THROUGH THE API: a workspace of sources needs no repository and no GitHub; its sources are stored
// on the server, read and indexed; a session asks questions answered only from passages retrieved from the sources it
// selects -- a source it does not select is never retrieved --; the answer's citations are the server's, checked against
// the passages the run was given, and open the exact passage of the exact revision; notes and findings stay; a second
// session reuses the sources; deleting a session keeps them; and everything is there again after a restart. Claude Code is
// stood in for by a script that answers from the passages it is given (the real CLI is exercised by the acceptance run).
// The search itself is PostgreSQL's full-text search: Vietnamese found with or without its marks, English stemmed, and
// never a passage of a source the session did not select.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { applyDelta, type ResearchFinding, type ResearchNote, type ResearchSessionDetail, type ResearchSourceContent, type ResearchSourceSummary, type ResearchWorkspaceDetail, type ResearchWorkspaceSummary, type SourcesStatus } from "@orbit-web/contracts";
import { Db } from "../../src/infra/db/db.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { RETRIEVER, type Retriever } from "../../src/modules/research/retrieval/retriever.js";
import { SourceStore } from "../../src/modules/research/store/sources.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { eventually, researchRun, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";
import { answered, errorCode, newWorkspace, settledSource, upload, uploaded } from "../../src/testing/research-client.js";
import { makeDocx, makePdf, passagesOf, researchAnswer } from "../../src/testing/research-fixtures.js";

// Answers "What do the sources say about <word>?" from the passages it was given: it cites the passage holding the word,
// or says the selected sources do not -- and then makes up a label its run was never given, to be caught.
export function scholar(prompt: string): string {
  const question = /<question>\n([\s\S]*?)\n<\/question>/.exec(prompt)?.[1] ?? "";
  const word = /about ([\p{L}-]+)/iu.exec(question)?.[1] ?? "";
  const hit = passagesOf(prompt).find((p) => word !== "" && p.text.toLowerCase().includes(word.toLowerCase()));
  return hit !== undefined ? `The sources say ${word} is covered [${hit.label}].` : `The selected sources do not contain enough evidence about ${word} [S9].`;
}

const POLICY = makePdf(["Agent isolation policy.\nAgents run in isolated containers.", "Section two: network egress is denied by default."]);
const CODENAMES = makeDocx([{ text: "Project codenames", style: "Title" }, { text: "The secret project codename is Zephyr-Nine." }]);

const ask = async (h: Harness, sessionId: string, text: string): Promise<ResearchSessionDetail> => {
  const r = await h.send("POST", `/api/research/sessions/${sessionId}/messages`, { text });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return eventually(async () => (await h.get(`/api/research/sessions/${sessionId}`)).body as ResearchSessionDetail, (s) => s.status !== "running" && s.messages.length > 0 && s.messages.at(-1)?.role === "assistant");
};

const promptOf = (fake: FakeProcessPort, n: number): string => (fake.children.filter((c) => researchRun(c.call.file, c.call.args))[n] as { child: FakeChild }).child.written.join("");

// What only a person makes in governance: the account's policy revisions, its overrides, its approvals.
async function policyCounts(h: Harness): Promise<Record<string, number>> {
  const [row] = await h.sql("SELECT (SELECT count(*) FROM governance.policy_revisions) AS revisions, (SELECT count(*) FROM governance.policy_overrides) AS overrides, (SELECT count(*) FROM governance.approvals) AS approvals");
  return { revisions: Number(row?.revisions), overrides: Number(row?.overrides), approvals: Number(row?.approvals) };
}

describe("research, end to end -- with no repository and no GitHub", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let workspace: ResearchWorkspaceSummary;
  let policy: ResearchSourceSummary;
  let codenames: ResearchSourceSummary;
  let leakage: ResearchSourceSummary;
  let first: ResearchSessionDetail;
  let second: ResearchSessionDetail;
  let policyBefore: Record<string, number>;
  let note: ResearchNote;
  let finding: ResearchFinding;

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()))
      .on(program("gh", "auth", "status"), { run: { code: 1, stderr: "You are not logged into any GitHub hosts.\n" } })
      .on(researchRun, { spawn: researchAnswer(scholar) });
    h = await startHarness({ fake });
    policyBefore = await policyCounts(h);
  });
  after(() => h.close());

  test("a workspace is made with no repository and GitHub not connected", async () => {
    assert.notEqual(((await h.get("/api/sources")).body as SourcesStatus).sources.find((s) => s.source === "github")?.state, "connected");
    workspace = await newWorkspace(h);
    assert.deepEqual([workspace.access, workspace.owner, workspace.sourceCount, workspace.sessionCount], ["owner", "octo@example.com", 0, 0]);
    assert.deepEqual(((await h.get("/api/research/workspaces")).body as ResearchWorkspaceSummary[]).map((w) => w.id), [workspace.id]);
    assert.match(((await h.get(`/api/research/workspaces/${workspace.id}`)).body as ResearchWorkspaceDetail).storage, /On the Orbit server/);
  });

  test("sources are stored, read and indexed: a PDF keeps its pages, a Word document its text, a pasted note its words", async () => {
    policy = await uploaded(h, workspace.id, "NIST policy.pdf", POLICY);
    codenames = await uploaded(h, workspace.id, "codenames.docx", CODENAMES);
    const pasted = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/text`, { title: "Leakage notes", text: "# Leakage\n\nData leakage happens when prompts include secrets." , format: "markdown" });
    assert.equal(pasted.status, 202);
    leakage = pasted.body as ResearchSourceSummary;
    [policy, codenames, leakage] = await Promise.all([policy, codenames, leakage].map((s) => settledSource(h, s.id)));
    assert.deepEqual([policy.state, policy.mediaType, policy.revision?.pages, policy.revision?.number, policy.title, policy.origin], ["ready", "pdf", 2, 1, "NIST policy", "NIST policy.pdf"]);
    assert.deepEqual([codenames.state, codenames.mediaType], ["ready", "docx"]);
    assert.deepEqual([leakage.state, leakage.mediaType, leakage.kind], ["ready", "markdown", "text"]);
    assert.match(policy.revision?.contentHash ?? "", /^[0-9a-f]{64}$/);
    const again = await upload(h, workspace.id, "copy.pdf", POLICY);
    assert.equal(again.status, 409, "the same bytes are already a source");
    assert.equal(errorCode(again), "duplicate_source");
  });

  test("a session selects some sources: one it does not select is never retrieved, and a made-up citation is removed", async () => {
    const created = await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet", sources: [policy.id, leakage.id] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    first = created.body as ResearchSessionDetail;
    assert.deepEqual([first.kind, first.workspaceName, first.selection.sort()], ["research", "AI Governance Research", [policy.id, leakage.id].sort()]);
    const detail = await ask(h, first.id, "What do the sources say about Zephyr?");
    assert.equal(detail.status, "completed");
    const given = passagesOf(promptOf(fake, 0));
    assert.deepEqual([...new Set(given.map((p) => p.source))].sort(), ["Leakage notes", "NIST policy"], "only the selected sources were retrieved from");
    assert.doesNotMatch(promptOf(fake, 0), /Zephyr-Nine|codenames/, "the codenames document was not selected: none of it reached the model");
    const answer = detail.messages.at(-1);
    assert.equal(answer?.text, "The selected sources do not contain enough evidence about Zephyr.", "the label no passage had is removed");
    assert.deepEqual(answer?.citations, []);
    const { events } = await h.events(`/api/research/sessions/${first.id}/events`, { until: (es) => es.some((e) => e.type === "research.citation.recorded") });
    assert.deepEqual((events.find((e) => e.type === "research.citation.recorded")?.data as { rejected: string[] }).rejected, ["S9"]);
  });

  test("with the source selected, the answer cites it -- and the citation opens the exact passage of the exact revision", async () => {
    assert.equal((await h.send("PUT", `/api/research/sessions/${first.id}/sources`, { sources: [policy.id, codenames.id, leakage.id] })).status, 200);
    const detail = await ask(h, first.id, "What do the sources say about Zephyr?");
    assert.ok(passagesOf(promptOf(fake, 1)).some((p) => p.source === "codenames" && p.text.includes("Zephyr-Nine")));
    const answer = detail.messages.at(-1);
    assert.match(answer?.text ?? "", /^The sources say Zephyr is covered \[S\d+\]\.$/);
    const citation = answer?.citations[0];
    assert.ok(citation);
    assert.deepEqual([citation.sourceId, citation.revisionId, citation.sourceTitle, citation.page, citation.sourceAvailable, citation.revisionCurrent], [codenames.id, codenames.revision?.id, "codenames", null, true, true]);
    assert.match(citation.quote, /Zephyr-Nine/);
    const content = (await h.get(`/api/research/sources/${codenames.id}/content?revision=${citation.revisionId}&around=${citation.chunkOrdinal}`)).body as ResearchSourceContent;
    const chunk = content.chunks.find((c) => c.ordinal === citation.chunkOrdinal);
    assert.equal(chunk?.text, citation.quote, "the citation's passage is the extracted text at its place");
    assert.deepEqual([chunk?.charStart, chunk?.charEnd], [citation.charStart, citation.charEnd]);
    const isolation = await ask(h, first.id, "What do the sources say about isolated?");
    assert.deepEqual([isolation.messages.at(-1)?.citations[0]?.sourceId, isolation.messages.at(-1)?.citations[0]?.page], [policy.id, 1], "a PDF's page is the page its passage is on");
  });

  test("the stream numbers what it keeps, sends the answer as it is written, and a reconnect gets only what came after", async () => {
    const { frames, events } = await h.events(`/api/research/sessions/${first.id}/events`, { until: (es) => es.filter((e) => e.type === "research.run.completed").length === 3 });
    const durable = frames.filter((f) => f.data.seq !== null);
    assert.deepEqual(durable.map((f) => Number(f.id)), durable.map((f) => f.data.seq));
    assert.deepEqual(durable.map((f) => f.data.seq), durable.map((_, i) => i + 1));
    const order = ["research.message.completed", "research.status", "research.run.started", "research.message.started", "research.message.completed", "research.citation.recorded", "research.run.completed", "research.status"];
    let at = -1;
    for (const t of order) {
      const next = events.map((e) => e.type).indexOf(t, at + 1);
      assert.ok(next > at, `${t} after ${at}`);
      at = next;
    }
    const detail = (await h.get(`/api/research/sessions/${first.id}`)).body as ResearchSessionDetail;
    const later = await h.events(`/api/research/sessions/${first.id}/events`, { lastEventId: detail.lastSeq - 2, until: (es) => es.length >= 2, timeoutMs: 2_000 });
    assert.deepEqual(later.events.map((e) => e.seq), [detail.lastSeq - 1, detail.lastSeq]);
  });

  test("notes and findings stay; a finding's review is a person's, and rewording a reviewed one makes it a draft again", async () => {
    const detail = (await h.get(`/api/research/sessions/${first.id}`)).body as ResearchSessionDetail;
    const citation = detail.messages.flatMap((m) => m.citations).find((c) => c.sourceId === codenames.id);
    const made = await h.send("POST", `/api/research/workspaces/${workspace.id}/notes`, { title: "Codename", body: "Zephyr-Nine, per the codenames document.", sessionId: first.id, citationId: citation?.id });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    note = made.body as ResearchNote;
    assert.equal(note.citation?.quote, citation?.quote);
    const created = await h.send("POST", `/api/research/workspaces/${workspace.id}/findings`, { title: "Agents are isolated", statement: "Agents run in isolated containers.", sessionId: first.id, citations: [citation?.id] });
    assert.equal(created.status, 201);
    finding = created.body as ResearchFinding;
    assert.deepEqual([finding.code, finding.status, finding.citations.length], ["F-001", "draft", 1]);
    assert.equal((await h.send("PATCH", `/api/research/findings/${finding.id}`, { status: "reviewed" })).status, 409, "a draft is reviewed only once it asks for review");
    assert.equal(((await h.send("PATCH", `/api/research/findings/${finding.id}`, { status: "needs_review" })).body as ResearchFinding).status, "needs_review");
    const reviewed = (await h.send("PATCH", `/api/research/findings/${finding.id}`, { status: "reviewed" })).body as ResearchFinding;
    assert.deepEqual([reviewed.status, reviewed.reviewedBy], ["reviewed", "octo@example.com"]);
    const reworded = (await h.send("PATCH", `/api/research/findings/${finding.id}`, { statement: "Agents run in isolated containers, per the policy." })).body as ResearchFinding;
    assert.deepEqual([reworded.status, reworded.reviewedBy], ["draft", null]);
    for (const step of ["needs_review", "reviewed"]) await h.send("PATCH", `/api/research/findings/${finding.id}`, { status: step });
    const second = (await h.send("POST", `/api/research/workspaces/${workspace.id}/findings`, { title: "Egress", statement: "Denied by default." })).body as ResearchFinding;
    assert.equal(second.code, "F-002");
  });

  test("a second session reuses the workspace's sources -- nothing is uploaded again -- and deleting the first keeps them", async () => {
    second = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "haiku", effort: "low", question: "What do the sources say about leakage?" })).body as ResearchSessionDetail;
    assert.deepEqual(second.selection.sort(), [policy.id, codenames.id, leakage.id].sort(), "all the workspace's sources, by default");
    const done = await answered(h, second.id);
    assert.equal(done.messages.at(-1)?.citations[0]?.sourceId, leakage.id, "the first question was asked at once");
    for (const s of [policy, codenames, leakage]) assert.deepEqual(((await h.get(`/api/research/sources/${s.id}/revisions`)).body as { number: number }[]).map((r) => r.number), [1], "no source was stored or read again");
    assert.equal((await h.send("DELETE", `/api/research/sessions/${first.id}`)).status, 204);
    assert.equal((await h.get(`/api/research/sessions/${first.id}`)).status, 404);
    const sources = (await h.get(`/api/research/workspaces/${workspace.id}/sources`)).body as ResearchSourceSummary[];
    assert.deepEqual(sources.map((s) => [s.id, s.state]), [policy, codenames, leakage].map((s) => [s.id, "ready"]));
    const notes = (await h.get(`/api/research/workspaces/${workspace.id}/notes`)).body as ResearchNote[];
    assert.deepEqual([notes[0]?.id, notes[0]?.sessionId, notes[0]?.citation?.sessionId, notes[0]?.citation?.quote], [note.id, null, null, note.citation?.quote], "the note, and the citation it keeps, outlive the session");
  });

  test("research made no policy -- a reviewed finding is never one -- and every run of it was decided under the account's policy", async () => {
    assert.deepEqual(await policyCounts(h), policyBefore, "no policy revision, override or approval came from research");
    // The runs of the session deleted above went with it; the record of each run's start did not.
    const runs = (await h.sql("SELECT id, account_id FROM research.research_runs WHERE workspace_id = $1", [workspace.id])).map((r) => ({ id: String(r.id), account: String(r.account_id) }));
    assert.ok(runs.length >= 1, `the runs of this workspace's remaining session (${runs.length})`);
    assert.ok(runs.every((r) => r.account === h.accountId), "each run is the workspace's account's");
    const started = (await h.sql("SELECT DISTINCT run_id, account_id FROM governance.audit_events WHERE event_type = 'run.started' AND workspace_id = $1", [workspace.id])).map((r) => ({ id: String(r.run_id), account: String(r.account_id) }));
    assert.ok(started.length >= 4, `every research run's start is on the account's audit record, the deleted session's too (${started.length})`);
    assert.ok(started.every((r) => r.account === h.accountId), "on the workspace's account's record");
    assert.ok(runs.every((r) => started.some((s) => s.id === r.id)), "each run kept is one whose start was recorded");
  });

  test("after a restart, the workspace, its sources, sessions, conversation, notes and findings are all there", async () => {
    await h.close(true);
    h = await startHarness({ dataDir: h.dataDir, database: h.database, fake: signedIn(new FakeProcessPort(new NodeProcessPort())).on(researchRun, { spawn: researchAnswer(scholar) }) });
    assert.deepEqual(((await h.get("/api/research/workspaces")).body as ResearchWorkspaceSummary[]).map((w) => [w.id, w.sourceCount, w.sessionCount]), [[workspace.id, 3, 1]]);
    const sources = (await h.get(`/api/research/workspaces/${workspace.id}/sources`)).body as ResearchSourceSummary[];
    assert.deepEqual(sources.map((s) => s.state), ["ready", "ready", "ready"]);
    const detail = (await h.get(`/api/research/sessions/${second.id}`)).body as ResearchSessionDetail;
    assert.deepEqual(detail.messages.map((m) => m.role), ["user", "assistant"]);
    assert.equal(detail.messages[1]?.citations[0]?.sourceId, leakage.id);
    assert.equal(((await h.get(`/api/research/workspaces/${workspace.id}/notes`)).body as ResearchNote[])[0]?.title, "Codename");
    const findings = (await h.get(`/api/research/workspaces/${workspace.id}/findings`)).body as ResearchFinding[];
    assert.deepEqual(findings.map((f) => [f.code, f.status]), [["F-002", "draft"], ["F-001", "reviewed"]]);
    const content = (await h.get(`/api/research/sources/${policy.id}/content`)).body as ResearchSourceContent;
    assert.deepEqual(content.chunks.map((c) => c.page), [1, 2]);
    const more = await ask(h, second.id, "What do the sources say about egress?");
    assert.equal(more.messages.at(-1)?.citations[0]?.page, 2);
  });
});

describe("an answer streamed to a page that connects in the middle of it is never doubled", () => {
  test("the text written so far comes once, from offset 0, and the rest is appended", async () => {
    let child: FakeChild | null = null;
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(researchRun, {
      spawn: (c, call: Call) => {
        child = c;
        researchAnswer(() => "Agents run in isolated containers [S1].", { hang: true })(c, call);
      },
    });
    const h = await startHarness({ fake });
    try {
      const workspace = await newWorkspace(h);
      await settledSource(h, (await uploaded(h, workspace.id, "policy.pdf", POLICY)).id);
      const session = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet" })).body as ResearchSessionDetail;
      await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "What do the sources say about isolated?" });
      await eventually(() => child?.written.length ?? 0, (n) => n > 0);
      const mid = await h.events(`/api/research/sessions/${session.id}/events`, { until: (es) => es.some((e) => e.type === "research.message.delta"), timeoutMs: 5_000 });
      const deltas = mid.events.filter((e) => e.type === "research.message.delta").map((e) => e.data as { messageId: string; offset: number; text: string });
      const once = deltas.reduce(applyDelta, "");
      const twice = [...deltas, ...deltas].reduce(applyDelta, "");
      assert.ok(once.length > 0 && "Agents run in isolated containers [S1].".startsWith(once), `what was written so far: ${once}`);
      assert.equal(twice, once, "replayed twice, applied once");
      assert.ok(mid.frames.filter((f) => f.data.type === "research.message.delta").every((f) => f.id === null), "a delta is transient: no id");
      assert.equal((await h.send("POST", `/api/research/sessions/${session.id}/stop`)).status, 202);
      const stopped = await answered(h, session.id);
      assert.equal(stopped.status, "interrupted", "a stopped run is never completed");
      assert.deepEqual([stopped.messages.at(-1)?.partial, stopped.messages.at(-1)?.text], [true, "Agents run in isolated containers [S1].".slice(0, 20)]);
    } finally {
      await h.close();
    }
  });
});

// Answers by quoting back every passage it was given, each cited: what a model reading its references would write.
const quoting = (prompt: string): string => passagesOf(prompt).map((p) => `${p.text} [${p.label}]`).join("\n\n") || "Nothing in the references.";

// The passages a prompt holds that the search MATCHED (not openings of a source given when few matched).
const matchedOf = (prompt: string): string[] =>
  [...prompt.matchAll(/<passage-[0-9a-f]+ label="S\d+" source="[^"]*"[^>]*retrieved="matched the question's words">\n([\s\S]*?)\n<\/passage-[0-9a-f]+>/g)].map((m) => m[1] as string);

describe("the search: Vietnamese with or without its marks, English stemmed, and only ever what the session selected", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let workspace: ResearchWorkspaceSummary;
  let vietnamese: ResearchSourceSummary;
  let english: ResearchSourceSummary;
  let weather: ResearchSourceSummary;
  const retriever = (): Retriever => h.app.get<Retriever>(RETRIEVER);
  const text = async (title: string, body: string): Promise<ResearchSourceSummary> => {
    const made = await h.send("POST", `/api/research/workspaces/${workspace.id}/sources/text`, { title, text: body });
    assert.equal(made.status, 202, JSON.stringify(made.body));
    return settledSource(h, (made.body as ResearchSourceSummary).id);
  };
  const search = (question: string, sources: readonly ResearchSourceSummary[]) =>
    retriever().retrieve({ accountId: h.accountId as string, workspaceId: workspace.id, revisionIds: sources.map((s) => s.revision?.id as string), question, budgetChars: 24_000 });

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(researchRun, { spawn: researchAnswer(quoting) });
    h = await startHarness({ fake });
    workspace = await newWorkspace(h, "Tìm kiếm");
    vietnamese = await text("Sự cố", "Rò rỉ dữ liệu khách hàng xảy ra khi khóa API bị lộ trong nhật ký.");
    english = await text("Incident", "The servers were compromised by attackers who reused leaked credentials.");
    weather = await text("Weather", "Tomorrow is sunny with a light breeze. Servers of ice cream are busy.");
  });
  after(() => h.close());

  test("Vietnamese is found with its marks and without them -- the same passage, matched", async () => {
    for (const question of ["Rò rỉ dữ liệu xảy ra khi nào?", "ro ri du lieu xay ra khi nao?", "RÒ RỈ DỮ LIỆU"]) {
      const hits = await search(question, [vietnamese, english, weather]);
      const matched = hits.filter((p) => p.match === "fts");
      assert.deepEqual(matched.map((p) => p.chunk.sourceId), [vietnamese.id], question);
      assert.match(matched[0]?.chunk.text ?? "", /Rò rỉ dữ liệu/, "what is given is the text as it was written, marks and all");
      assert.ok((matched[0]?.score ?? 0) > 0, "ranked by the full-text rank");
    }
  });

  test("English words are stemmed: another form of a word still matches", async () => {
    const matched = (await search("Was a server compromised?", [vietnamese, english])).filter((p) => p.match === "fts");
    assert.deepEqual(matched.map((p) => p.chunk.sourceId), [english.id]);
    const credential = (await search("credential reuse", [english])).filter((p) => p.match === "fts");
    assert.equal(credential.length, 1);
  });

  test("a question is answered only from the sources its session selects; one not selected never reaches the model", async () => {
    const session = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet", sources: [english.id] })).body as ResearchSessionDetail;
    await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "What do the servers do?" });
    const done = await answered(h, session.id);
    assert.equal(done.status, "completed");
    const prompt = promptOf(fake, 0);
    assert.deepEqual(matchedOf(prompt).map((t) => t.includes("compromised")), [true], "the selected source matched");
    assert.doesNotMatch(prompt, /ice cream|sunny|Rò rỉ/, "the sources not selected -- even one that holds the word -- reached nothing");
    assert.deepEqual(new Set(done.messages.at(-1)?.citations.map((c) => c.sourceId)), new Set([english.id]));
  });

  test("an empty selection searches nothing at all, and the question is still answered, with no reference", async () => {
    const db = h.app.get(Db);
    const original = db.query.bind(db);
    const asked: string[] = [];
    db.query = ((text: string, params?: Parameters<Db["query"]>[1]) => (asked.push(text), original(text, params))) as Db["query"];
    try {
      assert.deepEqual(await search("servers", []), []);
    } finally {
      db.query = original;
    }
    assert.equal(asked.filter((q) => /research_chunks/.test(q)).length, 0, "no query of the passages was made");
    const session = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet", sources: [] })).body as ResearchSessionDetail;
    assert.deepEqual(session.selection, []);
    await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "What do the servers do?" });
    const done = await answered(h, session.id);
    assert.equal(done.status, "completed", "a conversation with no source selected is still a conversation");
    const prompt = promptOf(fake, 1);
    assert.deepEqual(passagesOf(prompt), []);
    assert.match(prompt, /No reference this time/);
    assert.deepEqual(done.messages.at(-1)?.citations, [], "no reference, no citation");
  });

  test("two revisions of one source, however close together, never get one number", async () => {
    const store = h.app.get(SourceStore);
    const made = await Promise.all(
      Array.from({ length: 12 }, (_, i) => store.addRevision({ id: randomUUID(), sourceId: weather.id, contentHash: `${i}`.padStart(64, "0"), byteSize: 1, mediaType: "text", fileName: null, url: null, finalUrl: null, fetchedAt: null })),
    );
    assert.deepEqual(made.map((r) => r.number).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 2), "revision 1 was the upload; these are 2 to 13, each once");
    assert.ok(made.every((r) => r.accountId === h.accountId && r.workspaceId === workspace.id), "each revision is its source's account's and workspace's");
  });

  test("deleting a source keeps what its citations quoted, as of their revision", async () => {
    const quoted = await text("Quoted", "Zebra crossings are painted every spring.");
    const session = (await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet", sources: [quoted.id] })).body as ResearchSessionDetail;
    await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "When are zebra crossings painted?" });
    const done = await answered(h, session.id);
    const citation = done.messages.at(-1)?.citations[0];
    assert.ok(citation);
    assert.deepEqual([citation.sourceId, citation.revisionId, citation.sourceAvailable], [quoted.id, quoted.revision?.id, true]);
    assert.equal((await h.send("DELETE", `/api/research/sources/${quoted.id}`)).status, 204);
    const after = (await h.get(`/api/research/sessions/${session.id}`)).body as ResearchSessionDetail;
    const kept = after.messages.at(-1)?.citations[0];
    assert.deepEqual([kept?.id, kept?.quote, kept?.revisionId, kept?.sourceTitle, kept?.sourceAvailable], [citation.id, citation.quote, citation.revisionId, "Quoted", false], "the quote stays; the source is said to be gone");
    assert.equal((await h.sql("SELECT count(*) AS n FROM research.research_chunks WHERE source_id = $1", [quoted.id]))[0]?.n, 0, "its passages went with it");
  });
});
