// READING ONE DOCUMENT, whatever it is: its blocks by format, then its chunks. Pure -- bytes in, chunks out -- and run in a
// worker thread of its own (worker.ts), so a large or hostile file never stops the server's event loop and is stopped
// when it takes too long or too much memory.
import type { ResearchMediaType } from "@orbit-web/contracts";
import type { ChunkDraft } from "../store/sources.js";
import { ExtractionError, type Extracted } from "./blocks.js";
import { chunkBlocks } from "./chunker.js";
import { docxOf } from "./extract/docx.js";
import { htmlOf } from "./extract/html.js";
import { pdfOf } from "./extract/pdf.js";
import { decodeText, markdownOf, textOf } from "./extract/text.js";

export interface Processed {
  chunks: ChunkDraft[];
  chars: number;
  pages: number | null;
  title: string | null;
}

const READERS: Record<ResearchMediaType, (bytes: Buffer) => Extracted | Promise<Extracted>> = {
  pdf: pdfOf,
  docx: docxOf,
  html: (bytes) => htmlOf(decodeText(bytes)),
  markdown: markdownOf,
  text: textOf,
};

export async function processDocument(mediaType: ResearchMediaType, bytes: Buffer): Promise<Processed> {
  const extracted = await READERS[mediaType](bytes);
  const { chunks, chars } = chunkBlocks(extracted.blocks);
  if (chunks.length === 0) throw new ExtractionError("No text could be read from it.");
  return { chunks, chars, pages: extracted.pages, title: extracted.title };
}
