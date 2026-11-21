// A document's text as research reads it: BLOCKS in reading order (a paragraph, a heading, a page's text), each with
// the page it is on when the format says so -- never a page a parser did not give.
export interface Block {
  text: string;
  page: number | null;
  // A heading's level (1-6), or null for body text.
  heading: number | null;
}

export interface Extracted {
  blocks: Block[];
  pages: number | null;
  title: string | null;
}

// A document research cannot read, and why -- said to a person as it is.
export class ExtractionError extends Error {}

// What the text of any format goes through: one normalization (NFC, line ends, no control or zero-width characters,
// no trailing spaces), so a passage reads and searches the same whatever it came from.
// eslint-disable-next-line no-control-regex -- control characters are removed
const UNWANTED = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\u200e\u200f\ufeff]/g;

export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(UNWANTED, "")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/[ \t\u00a0]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Plain text in paragraphs (blank lines between them).
export const paragraphs = (text: string, page: number | null = null): Block[] =>
  normalize(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => ({ text: p, page, heading: null }));
