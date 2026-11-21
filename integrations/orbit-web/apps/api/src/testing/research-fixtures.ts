// Documents for research's tests, made by code at run time -- never committed as binary files (the repository
// normalizes line endings, which would break a PDF's offsets): a PDF with text on each page, a Word document, a ZIP
// that inflates far beyond what it declares, and a scripted research run that answers from the passages it was given.
import { crc32, deflateRawSync } from "node:zlib";
import type { SpawnScript } from "./fake-process.js";

// A PDF of one page per string (each line a text line in Helvetica), with a correct cross-reference table.
export function makePdf(pages: readonly string[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pagesId = objects.length + pages.length * 2 + 2;
  const kids: number[] = [];
  for (const text of pages) {
    const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const lines = escaped.split("\n").map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${l}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(lines, "latin1")} >>\nstream\n${lines}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// A PDF whose page has no text at all (as a scan's would).
export const makeTextlessPdf = (): Buffer => makePdf([""]);

interface ZipEntry {
  name: string;
  data: Buffer;
  // Declare a different uncompressed size than the data has (a ZIP that lies about itself).
  declaredSize?: number;
}

// A ZIP archive (deflated entries, a central directory, an end record).
export function makeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const compressed = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const size = e.declaredSize ?? e.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A Word document: paragraphs, each with an optional style (Title, Heading1 …).
export function makeDocx(paragraphs: readonly { text: string; style?: string }[]): Buffer {
  const body = paragraphs.map((p) => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xml(p.text)}</w:t></w:r></w:p>`).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;
  return makeZip([
    { name: "[Content_Types].xml", data: Buffer.from(types) },
    { name: "word/document.xml", data: Buffer.from(document) },
  ]);
}

// A Word document whose main part inflates to far more than research reads, while declaring a small size.
export const makeDocxBomb = (): Buffer => makeZip([{ name: "word/document.xml", data: Buffer.alloc(70 * 1024 * 1024, 0x41), declaredSize: 1_000 }]);

// A research run, scripted: it reads the prompt Orbit Web wrote on stdin and answers with what `answer` makes of it --
// streamed as the CLI streams it (init with no tool, text deltas, the whole message, the result line).
export function researchAnswer(answer: (prompt: string) => string, o: { init?: Record<string, unknown>; hang?: boolean } = {}): SpawnScript {
  return (c) => {
    c.onInputClosed(() => {
      const prompt = c.written.join("");
      const text = answer(prompt);
      c.line({ type: "system", subtype: "init", session_id: "research", tools: [], mcp_servers: [], model: "claude-sonnet-5-5", permissionMode: "dontAsk", claude_code_version: "2.1.328", plugins: [], ...o.init });
      c.line({ type: "stream_event", event: { type: "message_start", message: { id: "msg_r" } }, parent_tool_use_id: null });
      c.line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null });
      const half = Math.ceil(text.length / 2);
      c.line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, half) } }, parent_tool_use_id: null });
      if (o.hang) return;
      c.line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(half) } }, parent_tool_use_id: null });
      c.line({ type: "assistant", message: { id: "msg_r", content: [{ type: "text", text }] }, parent_tool_use_id: null });
      c.line({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.001, num_turns: 1, duration_ms: 900, usage: { input_tokens: 10, cache_creation_input_tokens: 700, cache_read_input_tokens: 0, output_tokens: 42 } });
      c.exit(0);
    });
    c.onSignal(() => c.exit(null, "SIGINT"));
  };
}

// The labels of the passages a research prompt holds, and the text of each.
export function passagesOf(prompt: string): { label: string; source: string; text: string }[] {
  return [...prompt.matchAll(/<passage-[0-9a-f]+ label="(S\d+)" source="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/passage-[0-9a-f]+>/g)].map((m) => ({ label: m[1] as string, source: m[2] as string, text: m[3] as string }));
}
