// The worker thread one document is read in (process.ts): what it read, or why it could not -- a reason a person can
// read, never a stack.
import { parentPort, workerData } from "node:worker_threads";
import type { ResearchMediaType } from "@orbit-web/contracts";
import { ExtractionError } from "./blocks.js";
import { processDocument } from "./process.js";

const job = workerData as { mediaType: ResearchMediaType; bytes: Uint8Array };

processDocument(job.mediaType, Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength)).then(
  (processed) => parentPort?.postMessage({ ok: true, processed }),
  (err: unknown) => parentPort?.postMessage({ ok: false, reason: err instanceof ExtractionError ? err.message : `It could not be read (${err instanceof Error ? err.name : "error"}).` }),
);
