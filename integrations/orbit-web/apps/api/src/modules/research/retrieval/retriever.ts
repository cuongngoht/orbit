// RETRIEVAL: the passages a question is answered from, chosen by the server before any model is asked -- and ONLY from
// the revisions a run's evidence is frozen to (the sources the session selected, as they were indexed when it was asked).
// Nothing else of the workspace, and nothing of another workspace, can be returned: the query names those revisions.
//
// The engine is SQLite's own full-text index (FTS5: words stemmed, diacritics folded so "ro ri" finds "rò rỉ"), ranked
// by BM25, ties broken by revision and position so the same question over the same sources gets the same passages.
// When the question's words match few passages (a broad "summarize these"), the openings of the selected sources are
// added -- marked as such -- so the answer has something to stand on. A context budget bounds what is given. The
// interface lets another engine (vectors, a hybrid) take its place without the rest knowing.
import { Inject, Injectable } from "@nestjs/common";
import type { PassageMatch } from "@orbit-web/contracts";
import { Database } from "../../../infra/storage/database.js";
import { chunkOf, type ChunkRecord } from "../store/sources.js";
import type { Row } from "../store/rows.js";

export interface RetrievalRequest {
  revisionIds: readonly string[];
  question: string;
  // Characters of passage text, at most.
  budgetChars: number;
  maxPassages?: number;
}

export interface RetrievedPassage {
  label: string;
  chunk: ChunkRecord;
  score: number | null;
  match: PassageMatch;
  rank: number;
}

export interface Retriever {
  retrieve(r: RetrievalRequest): RetrievedPassage[];
}

export const RETRIEVER = Symbol("RETRIEVER");

export const MAX_PASSAGES = 12;
// Fewer matches than this, and the openings of the selected sources are added.
export const ENOUGH_MATCHES = 4;
const LEADS_PER_SOURCE = 2;

// Words that say nothing about what is asked (English and Vietnamese, with and without their marks).
const STOPWORDS = new Set(
  (
    "a an the is are was were be been being am of in on at to for with by from and or nor not no what which who whom whose when where why how does do did done " +
    "this that these those it its as about can could should would will shall may might must i you we they he she me my our your their them there here if then " +
    "than so such into onto over under also any all some more most other only own same too very just please tell explain describe give list show according " +
    "là la và va của cua có co không khong những nhung các cac một mot được duoc cho với voi trong này nay đó do thì thi mà ma để de theo gì gi nào nao " +
    "như nhu về ve hãy hay bạn ban tôi toi ở o ra vào vao từ tu khi nếu neu thế the sao bao nhiêu nhieu"
  ).split(" "),
);

export const MAX_TERMS = 24;

// The question's words as a full-text query: each quoted (so no word is read as an operator), any of them matching.
export function queryTerms(question: string): string[] {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w) && (w.length >= 2 || /\p{N}/u.test(w)));
  return [...new Set(words)].slice(0, MAX_TERMS);
}

export const matchExpression = (terms: readonly string[]): string => terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");

@Injectable()
export class FtsRetriever implements Retriever {
  constructor(@Inject(Database) private readonly database: Database) {}

  retrieve(r: RetrievalRequest): RetrievedPassage[] {
    const max = r.maxPassages ?? MAX_PASSAGES;
    const revisions = JSON.stringify(r.revisionIds);
    const chosen: { chunk: ChunkRecord; score: number | null; match: PassageMatch }[] = [];
    let used = 0;
    const take = (chunk: ChunkRecord, score: number | null, match: PassageMatch): void => {
      if (chosen.length >= max || chosen.some((c) => c.chunk.id === chunk.id) || used + chunk.text.length > r.budgetChars) return;
      chosen.push({ chunk, score, match });
      used += chunk.text.length;
    };
    for (const hit of this.matches(r.question, revisions, max * 3)) take(chunkOf(hit), Number(hit.score), "fts");
    if (chosen.length < ENOUGH_MATCHES) for (const lead of this.leads(r.revisionIds)) take(lead, null, "lead");
    return chosen.map((c, i) => ({ label: `S${i + 1}`, chunk: c.chunk, score: c.score, match: c.match, rank: i + 1 }));
  }

  private matches(question: string, revisions: string, limit: number): Row[] {
    const terms = queryTerms(question);
    if (terms.length === 0) return [];
    return this.database.db
      .prepare(
        `SELECT c.*, bm25(research_chunks_fts) AS score FROM research_chunks_fts JOIN research_chunks c ON c.id = research_chunks_fts.rowid
         WHERE research_chunks_fts MATCH ? AND c.revision_id IN (SELECT value FROM json_each(?))
         ORDER BY score, c.revision_id, c.ordinal LIMIT ?`,
      )
      .all(matchExpression(terms), revisions, limit) as Row[];
  }

  // The first passages of each revision, taken in turn (the first of each, then the second of each).
  private leads(revisionIds: readonly string[]): ChunkRecord[] {
    const per = revisionIds.map((id) => (this.database.db.prepare("SELECT * FROM research_chunks WHERE revision_id = ? ORDER BY ordinal LIMIT ?").all(id, LEADS_PER_SOURCE) as Row[]).map(chunkOf));
    const out: ChunkRecord[] = [];
    for (let i = 0; i < LEADS_PER_SOURCE; i += 1) for (const list of per) if (list[i] !== undefined) out.push(list[i] as ChunkRecord);
    return out;
  }
}
