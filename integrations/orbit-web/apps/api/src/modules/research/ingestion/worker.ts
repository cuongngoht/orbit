// Runs process.ts in a worker thread of its own, bounded in time and memory: a document that takes too long is
// stopped, one that needs too much memory ends its worker -- either way the source fails with a reason, and the server
// goes on.
import { Worker } from "node:worker_threads";
import type { ResearchMediaType } from "@orbit-web/contracts";
import type { Processed } from "./process.js";

export type Extraction = { ok: true; processed: Processed } | { ok: false; reason: string };

const HEAP_MB = 512;

export function extractInWorker(mediaType: ResearchMediaType, bytes: Buffer, timeoutMs: number): Promise<Extraction> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (e: Extraction) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(e);
    };
    const worker = new Worker(new URL("./extract-worker.js", import.meta.url), { workerData: { mediaType, bytes: new Uint8Array(bytes) }, resourceLimits: { maxOldGenerationSizeMb: HEAP_MB } });
    const timer = setTimeout(() => done({ ok: false, reason: `Reading it took longer than ${Math.round(timeoutMs / 1000)} seconds, so it was stopped.` }), timeoutMs);
    worker.on("message", (m: Extraction) => done(m));
    worker.on("error", (err) => done({ ok: false, reason: (err as { code?: string }).code === "ERR_WORKER_OUT_OF_MEMORY" ? `Reading it needed more than ${HEAP_MB} MB of memory, so it was stopped.` : `It could not be read (${err.name}).` }));
    worker.on("exit", (code) => done({ ok: false, reason: `Reading it ended unexpectedly (${code}).` }));
  });
}
