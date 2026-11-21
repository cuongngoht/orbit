// A Word document's text (.docx): the paragraphs of its main part (word/document.xml), in order, with the headings its
// styles mark (Title, Heading 1-6) -- read as text out of the XML. Macros, embedded objects, images and every other
// part of the package are never opened, let alone run; deleted tracked changes are not text.
import { ExtractionError, normalize, type Block, type Extracted } from "../blocks.js";
import { readZipEntry } from "./zip.js";

// The main part of a document, at most (its XML, not the file).
const DOCUMENT_XML_LIMIT = 64 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export const decodeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith("#x")) return safeCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return safeCodePoint(Number.parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? "";
  });

const safeCodePoint = (n: number): string => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");

const PARAGRAPH = /<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g;
const RUN_PART = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;
const STYLE = /<w:pStyle\s+w:val="([^"]+)"/;

function headingOf(paragraph: string): number | null {
  const style = STYLE.exec(paragraph)?.[1]?.toLowerCase() ?? "";
  if (style === "title") return 1;
  const level = /^heading(\d)$/.exec(style)?.[1];
  return level === undefined ? null : Math.min(6, Number(level));
}

function paragraphText(paragraph: string): string {
  let text = "";
  for (const m of paragraph.matchAll(RUN_PART)) text += m[1] !== undefined ? decodeXml(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n";
  return normalize(text);
}

export function docxOf(bytes: Buffer): Extracted {
  const xml = readZipEntry(bytes, "word/document.xml", DOCUMENT_XML_LIMIT);
  if (xml === null) throw new ExtractionError("The file is a ZIP archive, but not a Word document (it has no word/document.xml).");
  const body = xml.toString("utf8");
  const blocks: Block[] = [];
  for (const m of body.matchAll(PARAGRAPH)) {
    const text = paragraphText(m[0]);
    if (text.length > 0) blocks.push({ text, page: null, heading: headingOf(m[0]) });
  }
  if (blocks.length === 0) throw new ExtractionError("The Word document has no text.");
  return { blocks, pages: null, title: blocks.find((b) => b.heading !== null)?.text ?? null };
}
