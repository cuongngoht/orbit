// RETRIEVAL: the passages a question is answered from, chosen by the server before any model is asked -- and ONLY from
// the revisions a run's evidence is frozen to (the sources the session selected, as they were indexed when it was asked),
// of THAT workspace of THAT account. Every query names all three in its WHERE clause: nothing of another revision,
// another workspace or another account can come back, and no query is made at all when no revision is given.
//
// The engine is PostgreSQL's own full-text search: each passage is indexed by its text folded for search (fold.ts: so
// "ro ri" finds "rò rỉ"), English words stemmed, no word dropped as a stop word (research.orbit_search, the schema). A
// question's words, folded the same way, are OR-ed into one query; passages are ordered by PostgreSQL's full-text rank
// (ts_rank_cd -- a cover-density rank, not BM25), ties broken by revision and position, so the same question over the
// same sources gets the same passages. When the question's words match few passages (a broad "summarize these"), the
// openings of the selected sources are added -- marked as such -- so the answer has something to stand on. A context
// budget bounds what is given. The interface lets another engine (vectors, a hybrid) take its place without the rest
// knowing.
import { Inject, Injectable } from "@nestjs/common";
import type { PassageMatch } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { chunkOf, CHUNK_COLUMNS, type ChunkRecord } from "../store/sources.js";
import { foldForSearch } from "./fold.js";

export interface RetrievalRequest {
  // The account and the workspace the revisions belong to: a revision of anything else is never read.
  accountId: string;
  workspaceId: string;
  revisionIds: readonly string[];
  question: string;
  // Characters of passage text, at most.
  budgetChars: number;
  maxPassages?: number;
}

export interface RetrievedPassage {
  label: string;
  chunk: ChunkRecord;
  // The full-text rank (higher: more relevant); null for an opening passage.
  score: number | null;
  match: PassageMatch;
  rank: number;
}

export interface Retriever {
  retrieve(r: RetrievalRequest): Promise<RetrievedPassage[]>;
}

export const RETRIEVER = Symbol("RETRIEVER");

export const MAX_PASSAGES = 12;
// Fewer matches than this, and the openings of the selected sources are added.
export const ENOUGH_MATCHES = 4;
const LEADS_PER_SOURCE = 2;

// The text search configuration the index was built with (the schema): a query must be read by the same one.
export const SEARCH_CONFIG = "research.orbit_search";

// Words that say nothing about what is asked (English and Vietnamese, with and without their marks -- a question is
// folded before it is split, so the folded forms are what match).
const STOPWORDS = new Set(
  (
    "a an the is are was were be been being am of in on at to for with by from and or nor not no what which who whom whose when where why how does do did done " +
    "this that these those it its as about can could should would will shall may might must i you we they he she me my our your their them there here if then " +
    "than so such into onto over under also any all some more most other only own same too very just please tell explain describe give list show according " +
    "là la và va của cua có co không khong những nhung các cac một mot được duoc cho với voi trong này nay đó do thì thi mà ma để de theo gì gi nào nao " +
    "như nhu về ve hãy hay bạn ban tôi toi ở o ra vào vao từ tu khi nếu neu thế the sao bao nhiêu nhieu"
  )
    .split(" ")
    .map(foldForSearch),
);

export const MAX_TERMS = 24;

// The question's words as search terms: folded, letters and digits only, stopwords out, each once, at most MAX_TERMS.
export function queryTerms(question: string): string[] {
  const words = (foldForSearch(question).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w) && (w.length >= 2 || /\p{N}/u.test(w)));
  return [...new Set(words)].slice(0, MAX_TERMS);
}

// The terms as one tsquery text, any of them matching. A term holds letters and digits only (queryTerms), so it can be
// no operator; each is quoted as a lexeme all the same. The text is a query PARAMETER, read by to_tsquery -- never SQL.
export const tsqueryOf = (terms: readonly string[]): string => terms.map((t) => `'${t.replace(/'/g, "''")}'`).join(" | ");

@Injectable()
export class PgTextRetriever implements Retriever {
  constructor(@Inject(Db) private readonly db: Db) {}

  async retrieve(r: RetrievalRequest): Promise<RetrievedPassage[]> {
    if (r.revisionIds.length === 0) return [];
    const max = r.maxPassages ?? MAX_PASSAGES;
    const chosen: { chunk: ChunkRecord; score: number | null; match: PassageMatch }[] = [];
    let used = 0;
    const take = (chunk: ChunkRecord, score: number | null, match: PassageMatch): void => {
      if (chosen.length >= max || chosen.some((c) => c.chunk.id === chunk.id) || used + chunk.text.length > r.budgetChars) return;
      chosen.push({ chunk, score, match });
      used += chunk.text.length;
    };
    for (const hit of await this.matches(r, max * 3)) take(hit.chunk, hit.score, "fts");
    if (chosen.length < ENOUGH_MATCHES) for (const lead of await this.leads(r)) take(lead, null, "lead");
    return chosen.map((c, i) => ({ label: `S${i + 1}`, chunk: c.chunk, score: c.score, match: c.match, rank: i + 1 }));
  }

  private async matches(r: RetrievalRequest, limit: number): Promise<{ chunk: ChunkRecord; score: number }[]> {
    const terms = queryTerms(r.question);
    if (terms.length === 0) return [];
    const rows = await this.db.query(
      `SELECT ${CHUNK_COLUMNS.split(", ").map((c) => `c.${c}`).join(", ")}, ts_rank_cd(c.tsv, q) AS score
       FROM research_chunks c, to_tsquery('${SEARCH_CONFIG}', $1) AS q
       WHERE c.account_id = $2 AND c.workspace_id = $3 AND c.revision_id = ANY($4::text[]) AND c.tsv @@ q
       ORDER BY score DESC, c.revision_id, c.ordinal
       LIMIT $5`,
      [tsqueryOf(terms), r.accountId, r.workspaceId, r.revisionIds, limit],
    );
    return rows.map((row) => ({ chunk: chunkOf(row), score: Number(row.score) }));
  }

  // The first passages of each revision, taken in turn (the first of each, then the second of each), in the order the
  // revisions were given.
  private async leads(r: RetrievalRequest): Promise<ChunkRecord[]> {
    const rows = await this.db.query(
      `SELECT ${CHUNK_COLUMNS} FROM (
         SELECT ${CHUNK_COLUMNS}, row_number() OVER (PARTITION BY revision_id ORDER BY ordinal) AS n
         FROM research_chunks WHERE account_id = $1 AND workspace_id = $2 AND revision_id = ANY($3::text[])
       ) x WHERE n <= $4 ORDER BY revision_id, ordinal`,
      [r.accountId, r.workspaceId, r.revisionIds, LEADS_PER_SOURCE],
    );
    const byRevision = new Map<string, ChunkRecord[]>();
    for (const row of rows) {
      const chunk = chunkOf(row);
      byRevision.set(chunk.revisionId, [...(byRevision.get(chunk.revisionId) ?? []), chunk]);
    }
    const per = r.revisionIds.map((id) => byRevision.get(id) ?? []);
    const out: ChunkRecord[] = [];
    for (let i = 0; i < LEADS_PER_SOURCE; i += 1) for (const list of per) if (list[i] !== undefined) out.push(list[i] as ChunkRecord);
    return out;
  }
}
