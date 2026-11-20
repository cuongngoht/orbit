// CHUNKS: a document's blocks cut into passages a question can retrieve -- about a paragraph or a few, never across a
// page (so a passage's page is the page it is on) and starting anew at each heading (so a passage's section is the
// heading above it). A block longer than a chunk may be is cut at a line break, a sentence's end or a space. The
// document's text is the chunks' text joined by a blank line, and each chunk's place in it is kept (charStart,
// charEnd): a locator into the extracted text, never a guess.
import type { ChunkDraft } from "../store/sources.js";
import { ExtractionError, type Block } from "./blocks.js";

export const CHUNK_TARGET = 1_200;
export const CHUNK_MAX = 1_800;
export const DOCUMENT_CHARS_LIMIT = 4_000_000;
export const SECTION_LENGTH = 160;

const SEPARATOR = "\n\n";

// A long block in pieces of at most `max`, each cut where a reader would.
export function splitLong(text: string, max = CHUNK_MAX): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("。")) + 1;
    const cut = [window.lastIndexOf("\n"), sentence, window.lastIndexOf(" ")].find((c) => c > max / 2) ?? max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

export interface Chunked {
  chunks: ChunkDraft[];
  chars: number;
}

export function chunkBlocks(blocks: readonly Block[]): Chunked {
  const chunks: ChunkDraft[] = [];
  let offset = 0;
  let first = true;
  let section: string | null = null;
  let open: { page: number | null; section: string | null; start: number; parts: string[] } | null = null;
  const close = () => {
    if (open === null) return;
    const text = open.parts.join(SEPARATOR);
    chunks.push({ ordinal: chunks.length, page: open.page, section: open.section, charStart: open.start, charEnd: open.start + text.length, text });
    open = null;
  };
  for (const block of blocks) {
    for (const piece of splitLong(block.text)) {
      const start = first ? 0 : offset + SEPARATOR.length;
      first = false;
      offset = start + piece.length;
      if (offset > DOCUMENT_CHARS_LIMIT) throw new ExtractionError(`The document's text is longer than research reads (${DOCUMENT_CHARS_LIMIT.toLocaleString("en")} characters).`);
      if (block.heading !== null) section = piece.slice(0, SECTION_LENGTH);
      const current = open as { page: number | null; section: string | null; start: number; parts: string[] } | null;
      const fits = current !== null && current.page === block.page && block.heading === null && current.parts.join(SEPARATOR).length + SEPARATOR.length + piece.length <= CHUNK_TARGET;
      if (fits && current !== null) current.parts.push(piece);
      else {
        close();
        open = { page: block.page, section, start, parts: [piece] };
      }
    }
  }
  close();
  return { chunks, chars: offset };
}
