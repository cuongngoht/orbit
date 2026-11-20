// WHAT A SOURCE IS, decided from its bytes -- never from its name alone: a PDF starts as a PDF does, a Word document is
// a ZIP archive, and text is text (no NUL byte, readable). The name (an upload) or the content type (a URL) only says
// which of these to expect; a file that is not what it says, or is none of these, is refused before it is stored.
import { RESEARCH_UPLOAD_EXTENSIONS, type ResearchMediaType } from "@orbit-web/contracts";

export type Detected = { ok: true; mediaType: ResearchMediaType } | { ok: false; reason: string };

const EXTENSIONS: Record<string, ResearchMediaType> = { ".pdf": "pdf", ".docx": "docx", ".txt": "text", ".md": "markdown", ".markdown": "markdown", ".html": "html", ".htm": "html" };

const CONTENT_TYPES: Record<string, ResearchMediaType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
};

// Whether a page's content type is one research could read (checked before its body is read at all).
export const readableContentType = (contentType: string | null): boolean => {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "" || type === "application/octet-stream" || CONTENT_TYPES[type] !== undefined;
};

const isPdf = (b: Buffer): boolean => b.subarray(0, 1024).includes("%PDF-");
const isZip = (b: Buffer): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
// Text: no NUL byte in what is read of it (a UTF-16 file starts with its byte order mark and is read as such).
const isText = (b: Buffer): boolean => (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff) || !b.subarray(0, 65_536).includes(0);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

function confirm(expected: ResearchMediaType, bytes: Buffer, said: string): Detected {
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (expected === "pdf") return isPdf(bytes) ? { ok: true, mediaType: "pdf" } : { ok: false, reason: `${said} a PDF, but it is not one.` };
  if (expected === "docx") return isZip(bytes) ? { ok: true, mediaType: "docx" } : { ok: false, reason: `${said} a Word document (.docx), but it is not one.` };
  if (isPdf(bytes) || isZip(bytes) || !isText(bytes)) return { ok: false, reason: `${said} text, but it holds binary data.` };
  return { ok: true, mediaType: expected };
}

export function detectUpload(fileName: string, bytes: Buffer): Detected {
  const expected = EXTENSIONS[extensionOf(fileName)];
  if (expected === undefined) return { ok: false, reason: `${fileName} is not a kind of file research reads: it reads ${RESEARCH_UPLOAD_EXTENSIONS.join(", ")}.` };
  return confirm(expected, bytes, `${fileName} is named as`);
}

// What a URL answered: its content type says what to expect (a generic one -- octet-stream -- defers to the URL's
// extension); the bytes must be that.
export function detectFetched(contentType: string | null, url: string, bytes: Buffer): Detected {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const byType = CONTENT_TYPES[type];
  const byName = type === "" || type === "application/octet-stream" ? EXTENSIONS[extensionOf(new URL(url).pathname)] : undefined;
  const expected = byType ?? byName;
  if (expected === undefined) return { ok: false, reason: `The page answered with ${type || "no content type"}, which research does not read (it reads web pages, PDF, Word, text and Markdown).` };
  return confirm(expected, bytes, "The page was said to be");
}
