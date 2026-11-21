// A PDF's SELECTABLE text, page by page, through PDF.js (unpdf's serverless build): each page's text keeps its page
// number. No font is installed, no script in the document runs, nothing is rendered (and the worker thread it runs in
// ends with it, taking the document with it). A PDF whose pages carry no text
// (scanned images) is said to be one: research does not read text out of images (no OCR). A password-protected or
// malformed one is refused with what PDF.js said.
import { extractText, getDocumentProxy } from "unpdf";
import { ExtractionError, normalize, type Block, type Extracted } from "../blocks.js";

export async function pdfOf(bytes: Buffer): Promise<Extracted> {
  let pages: string[];
  let total: number;
  try {
    const document = await getDocumentProxy(new Uint8Array(bytes), { useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    const read = await extractText(document, { mergePages: false });
    pages = read.text;
    total = read.totalPages;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") throw new ExtractionError("The PDF is protected by a password: research cannot read it.");
    throw new ExtractionError(`The PDF could not be read (${name || "error"}: ${err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)}).`);
  }
  const blocks: Block[] = pages.flatMap((text, i) => {
    const t = normalize(text);
    return t.length === 0 ? [] : [{ text: t, page: i + 1, heading: null }];
  });
  if (blocks.length === 0) throw new ExtractionError(`The PDF's ${total === 1 ? "page has" : `${total} pages have`} no selectable text -- it may be scanned images. Research does not read text out of images (OCR is not supported).`);
  return { blocks, pages: total, title: null };
}
