// INGESTION: what turns a stored file into a source a question can retrieve from -- in the background, a few at a time
// (ORBIT_WEB_RESEARCH_INGEST_CONCURRENCY), each document read in a worker thread of its own (worker.ts):
//
//   upload / pasted text   stored (object-store.ts) -> a pending revision -> read -> chunked -> indexed -> ready
//   URL                    fetched (url-fetcher.ts) -> stored -> a revision (a new one only when the bytes changed) -> …
//
// A revision is immutable once indexed: a URL fetched again makes a new one, and the earlier one stays readable for the
// citations that cite it. A source whose newest snapshot could not be read keeps the one it had, as `stale`. Every
// failure says why, and a failed source can be tried again. A restart picks up what was pending, from the start of the
// document (what an interrupted attempt indexed is removed first), so nothing is half indexed.
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../../config/config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { ObjectStore } from "../sources/object-store.js";
import { CHUNK_BATCH, SourceStore, type RevisionRecord, type SourceRecord } from "../store/sources.js";
import { WorkspaceStore } from "../store/workspaces.js";
import { ResearchViews } from "../views.js";
import { detectFetched } from "./detect.js";
import { FetchError, fetchUrl, URL_ADDRESS_POLICY, type AddressPolicy } from "./url-fetcher.js";
import { extractInWorker } from "./worker.js";

export const OBJECT_STORE = Symbol("OBJECT_STORE");

type Job = { kind: "read"; revisionId: string } | { kind: "fetch"; sourceId: string };

const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r));

@Injectable()
export class IngestionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("ResearchIngestion");
  private readonly queue: Job[] = [];
  private readonly queued = new Set<string>();
  private running = 0;
  private stopped = false;
  private readonly idle: (() => void)[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    @Inject(ResearchViews) private readonly views: ResearchViews,
    @Inject(URL_ADDRESS_POLICY) private readonly policy: AddressPolicy,
  ) {}

  // What a restart cut short is picked up again.
  onModuleInit(): void {
    void this.objects.sweep();
    for (const r of this.sources.pendingRevisions()) this.enqueue({ kind: "read", revisionId: r.id });
    for (const s of this.sources.inState(["queued", "processing"])) {
      const pending = this.sources.latestRevision(s.id)?.status === "pending";
      if (s.kind === "url" && !pending) this.enqueue({ kind: "fetch", sourceId: s.id });
    }
  }

  onApplicationShutdown(): void {
    this.stopped = true;
  }

  read(revisionId: string): void {
    this.enqueue({ kind: "read", revisionId });
  }

  fetch(sourceId: string): void {
    this.enqueue({ kind: "fetch", sourceId });
  }

  // Resolves once nothing is queued or running (tests, shutdown).
  whenIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  private enqueue(job: Job): void {
    const key = job.kind === "read" ? `read:${job.revisionId}` : `fetch:${job.sourceId}`;
    if (this.queued.has(key) || this.stopped) return;
    this.queued.add(key);
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (!this.stopped && this.running < this.config.research.ingestConcurrency && this.queue.length > 0) {
      const job = this.queue.shift() as Job;
      this.running += 1;
      void this.run(job).finally(() => {
        this.queued.delete(job.kind === "read" ? `read:${job.revisionId}` : `fetch:${job.sourceId}`);
        this.running -= 1;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) for (const r of this.idle.splice(0)) r();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      if (job.kind === "read") await this.readRevision(job.revisionId);
      else await this.fetchSource(job.sourceId);
    } catch (err) {
      this.logger.error(`research ingestion failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private moved(source: SourceRecord): void {
    this.workspaces.touch(source.workspaceId);
    this.views.notifySource(source.id);
  }

  private async readRevision(revisionId: string): Promise<void> {
    const revision = this.sources.revision(revisionId);
    const source = revision === null ? null : this.sources.get(revision.sourceId);
    if (revision === null || source === null || revision.status !== "pending") return;
    this.sources.restart(revision.id);
    this.moved(this.sources.setState(source.id, "processing", null));
    let bytes: Buffer;
    try {
      bytes = await this.objects.read(revision.workspaceId, revision.contentHash);
    } catch {
      return this.failed(source, revision, "The stored file could not be read back.");
    }
    const extraction = await extractInWorker(revision.mediaType, bytes, this.config.research.extractTimeoutMs);
    if (this.sources.get(source.id) === null) return;
    if (!extraction.ok) return this.failed(source, revision, extraction.reason);
    const { chunks, chars, pages } = extraction.processed;
    for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
      if (this.sources.get(source.id) === null) return;
      this.sources.writeChunkBatch(revision, chunks.slice(i, i + CHUNK_BATCH));
      await yieldNow();
    }
    this.sources.indexed(revision.id, { pages, chars, chunks: chunks.length });
    this.moved(this.sources.promote(source.id, revision.id));
  }

  // A revision that could not be read: the source keeps the revision it had (stale), or has none (failed).
  private failed(source: SourceRecord, revision: RevisionRecord, reason: string): void {
    this.sources.failed(revision.id, reason);
    const current = this.sources.get(source.id);
    if (current === null) return;
    this.moved(current.currentRevisionId !== null ? this.sources.setState(source.id, "stale", `The newest snapshot (revision ${revision.number}) could not be read: ${reason} The earlier one is still used.`) : this.sources.setState(source.id, "failed", reason));
  }

  private async fetchSource(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (source === null || source.kind !== "url" || source.origin === null) return;
    this.moved(this.sources.setState(source.id, "processing", null));
    const keep = (reason: string) => this.moved(source.currentRevisionId !== null ? this.sources.setState(source.id, "stale", `It could not be fetched again: ${reason} The snapshot taken earlier is still used.`) : this.sources.setState(source.id, "failed", reason));
    if (!this.config.research.urlImport) return keep("Importing from a URL is switched off on this Orbit Web (ORBIT_WEB_RESEARCH_URL_IMPORT=off).");
    let fetched;
    try {
      fetched = await fetchUrl(source.origin, { maxBytes: this.config.research.maxUrlBytes, timeoutMs: this.config.research.fetchTimeoutMs, policy: this.policy });
    } catch (err) {
      return keep(err instanceof FetchError ? err.message : "The page could not be fetched.");
    }
    const detected = detectFetched(fetched.contentType, fetched.finalUrl, fetched.bytes);
    if (!detected.ok) return keep(detected.reason);
    if (this.sources.get(source.id) === null) return;
    const stored = await this.objects.put(source.workspaceId, fetched.bytes);
    const current = source.currentRevisionId === null ? null : this.sources.revision(source.currentRevisionId);
    if (current !== null && current.contentHash === stored.hash) {
      this.moved(this.sources.promote(source.id, current.id));
      return;
    }
    const revision = this.sources.addRevision({ id: randomUUID(), sourceId: source.id, workspaceId: source.workspaceId, contentHash: stored.hash, byteSize: stored.size, mediaType: detected.mediaType, fileName: null, url: source.origin, finalUrl: fetched.finalUrl, fetchedAt: fetched.fetchedAt });
    await this.readRevision(revision.id);
  }
}
