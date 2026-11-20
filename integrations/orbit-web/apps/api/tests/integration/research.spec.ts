// RESEARCH, END TO END THROUGH THE API: a workspace of sources needs no repository and no GitHub; its sources are stored
// on the server, read and indexed; a session asks questions answered only from passages retrieved from the sources it
// selects -- a source it does not select is never retrieved --; the answer's citations are the server's, checked against
// the passages the run was given, and open the exact passage of the exact revision; notes and findings stay; a second
// session reuses the sources; deleting a session keeps them; and everything is there again after a restart. Claude Code is
// stood in for by a script that answers from the passages it is given (the real CLI is exercised by the acceptance run).
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { applyDelta, type ResearchFinding, type ResearchNote, type ResearchSessionDetail, type ResearchSourceContent, type ResearchSourceSummary, type ResearchWorkspaceDetail, type ResearchWorkspaceSummary, type SourcesStatus } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
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

function governanceCounts(dataDir: string): Record<string, number> {
  const db = new DatabaseSync(join(dataDir, "governance", "governance.db"));
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    return Object.fromEntries(tables.map((t) => [t, Number((db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n)]));
  } finally {
    db.close();
  }
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
  let governanceBefore: Record<string, number>;
  let note: ResearchNote;
  let finding: ResearchFinding;

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()))
      .on(program("gh", "auth", "status"), { run: { code: 1, stderr: "You are not logged into any GitHub hosts.\n" } })
      .on(researchRun, { spawn: researchAnswer(scholar) });
    h = await startHarness({ fake });
    governanceBefore = governanceCounts(h.dataDir);
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

  test("nothing research did reached governance's records", () => {
    assert.deepEqual(governanceCounts(h.dataDir), governanceBefore);
  });

  test("after a restart, the workspace, its sources, sessions, conversation, notes and findings are all there", async () => {
    await h.close(true);
    h = await startHarness({ dataDir: h.dataDir, fake: signedIn(new FakeProcessPort(new NodeProcessPort())).on(researchRun, { spawn: researchAnswer(scholar) }) });
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
