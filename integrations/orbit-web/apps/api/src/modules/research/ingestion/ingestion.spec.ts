import assert from "node:assert/strict";
import { test } from "node:test";
import { makeDocx, makeDocxBomb, makePdf, makeTextlessPdf, makeZip } from "../../../testing/research-fixtures.js";
import { ExtractionError, type Block } from "./blocks.js";
import { CHUNK_MAX, CHUNK_TARGET, chunkBlocks, splitLong } from "./chunker.js";
import { detectFetched, detectUpload } from "./detect.js";
import { docxOf } from "./extract/docx.js";
import { htmlOf } from "./extract/html.js";
import { pdfOf } from "./extract/pdf.js";
import { decodeText, markdownOf, textOf } from "./extract/text.js";
import { readZipEntry } from "./extract/zip.js";
import { processDocument } from "./process.js";
import { extractInWorker } from "./worker.js";

test("text is read in its own encoding: a byte order mark, UTF-8, else Windows-1252", () => {
  assert.equal(decodeText(Buffer.from("\ufeffQuản trị dữ liệu", "utf8")), "Quản trị dữ liệu");
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("rò rỉ", "utf16le")])), "rò rỉ");
  assert.equal(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9])), "café", "not UTF-8: Windows-1252");
  assert.deepEqual(textOf(Buffer.from("First paragraph\nstill first.\r\n\r\n\r\nSecond\u0000 one.")).blocks.map((b) => b.text), ["First paragraph\nstill first.", "Second one."]);
});

test("Markdown keeps its headings as sections and its fenced code whole", () => {
  const md = markdownOf(Buffer.from("# Governance\n\nIntro text.\n\n## Prompt injection\n\nBody one.\n\n```\ncode\n\nstill code\n```\n\nAfter."));
  assert.deepEqual(md.blocks.map((b) => [b.heading, b.text]), [[1, "Governance"], [null, "Intro text."], [2, "Prompt injection"], [null, "Body one."], [null, "```\ncode\n\nstill code\n```"], [null, "After."]]);
  assert.equal(md.title, "Governance");
});

test("a web page's readable text: its main content, headings kept, nothing that is not prose", () => {
  const page = htmlOf(`<!doctype html><html><head><title>AI &amp; Risk</title><script>steal()</script><style>p{}</style></head>
    <body><nav>Home | About</nav><main><h1>Agent isolation</h1><p>Agents run   in <b>containers</b>.</p><script>alert(1)</script>
    <ul><li>One</li><li>Two</li></ul><form><input value="secret"></form><pre>  keep
  lines</pre></main><footer>© 2026</footer></body></html>`);
  assert.equal(page.title, "AI & Risk");
  assert.deepEqual(page.blocks.map((b) => [b.heading, b.text]), [[1, "Agent isolation"], [null, "Agents run in containers."], [null, "One"], [null, "Two"], [null, "keep\n lines"]]);
  assert.doesNotMatch(JSON.stringify(page.blocks), /steal|alert|Home|secret|2026/);
});

test("a PDF's selectable text keeps its pages; one with none, or a broken one, is refused with why", async () => {
  const pdf = await pdfOf(makePdf(["Prompt injection is a risk.\nSecond line.", "Data leakage on page two."]));
  assert.equal(pdf.pages, 2);
  assert.deepEqual(pdf.blocks.map((b) => [b.page, b.text]), [[1, "Prompt injection is a risk.\nSecond line."], [2, "Data leakage on page two."]]);
  await assert.rejects(pdfOf(makeTextlessPdf()), (e: Error) => e instanceof ExtractionError && /no selectable text.*OCR is not supported/s.test(e.message));
  await assert.rejects(pdfOf(Buffer.from("%PDF-1.4 nothing else")), (e: Error) => e instanceof ExtractionError && /could not be read/.test(e.message));
});

test("a Word document's paragraphs and headings, read out of its XML; anything else in the package is never opened", () => {
  const doc = docxOf(makeDocx([{ text: "Isolation Report", style: "Title" }, { text: "Scope", style: "Heading1" }, { text: "Agents & tools < limits." }, { text: "" }]));
  assert.deepEqual(doc.blocks.map((b) => [b.heading, b.text]), [[1, "Isolation Report"], [1, "Scope"], [null, "Agents & tools < limits."]]);
  assert.throws(() => docxOf(makeZip([{ name: "notes.txt", data: Buffer.from("x") }])), /not a Word document/);
  assert.throws(() => docxOf(Buffer.from("PK\u0003\u0004 broken")), ExtractionError);
});

test("a ZIP is read in memory and bounded: what inflates past the bound fails, it does not fill memory", () => {
  assert.throws(() => docxOf(makeDocxBomb()), /expands to more than research reads/);
  const big = makeZip([{ name: "word/document.xml", data: Buffer.from("x") , declaredSize: 900 * 1024 * 1024 }]);
  assert.throws(() => readZipEntry(big, "word/document.xml", 1024), /larger than research reads/);
  const encrypted = makeZip([{ name: "word/document.xml", data: Buffer.from("<w:p/>") }]);
  const at = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(1, at + 8);
  assert.throws(() => readZipEntry(encrypted, "word/document.xml", 1024), /encrypted/);
});

test("chunks: about a paragraph or a few, never across a page, anew at each heading -- and each is its place in the text", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} says something about agents and isolation.`).join(" ");
  const blocks: Block[] = [
    { text: "Overview", page: 1, heading: 1 },
    { text: "Short one.", page: 1, heading: null },
    { text: "Short two.", page: 1, heading: null },
    { text: "Next page.", page: 2, heading: null },
    { text: "Details", page: 2, heading: 2 },
    { text: long, page: 2, heading: null },
  ];
  const { chunks, chars } = chunkBlocks(blocks);
  const document = blocks.flatMap((b) => splitLong(b.text)).join("\n\n");
  assert.equal(chars, document.length);
  for (const c of chunks) {
    assert.equal(document.slice(c.charStart, c.charEnd), c.text, `chunk ${c.ordinal} is its place in the text`);
    assert.ok(c.text.length <= Math.max(CHUNK_TARGET, CHUNK_MAX), `chunk ${c.ordinal} is bounded`);
  }
  assert.deepEqual(chunks.slice(0, 3).map((c) => [c.page, c.section, c.text]), [[1, "Overview", "Overview\n\nShort one.\n\nShort two."], [2, "Overview", "Next page."], [2, "Details", "Details"]]);
  assert.ok(chunks.slice(3).every((c) => c.section === "Details" && c.page === 2) && chunks.length >= 5, "a long block is cut, each piece under its heading");
  assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
});

test("what a source is comes from its bytes, never from its name alone", () => {
  assert.deepEqual(detectUpload("report.pdf", makePdf(["x"])), { ok: true, mediaType: "pdf" });
  assert.deepEqual(detectUpload("brief.DOCX", makeDocx([{ text: "x" }])), { ok: true, mediaType: "docx" });
  assert.deepEqual(detectUpload("notes.md", Buffer.from("# hi")), { ok: true, mediaType: "markdown" });
  assert.equal(detectUpload("report.pdf", Buffer.from("just text")).ok, false, "named .pdf, is not one");
  assert.equal(detectUpload("notes.txt", Buffer.from([0x00, 0x01, 0x02])).ok, false, "named .txt, holds binary");
  assert.match((detectUpload("setup.exe", Buffer.from("MZ")) as { reason: string }).reason, /not a kind of file research reads/);
  assert.equal(detectUpload("archive.zip", makeZip([{ name: "a", data: Buffer.from("a") }])).ok, false);
  assert.equal(detectUpload("empty.txt", Buffer.alloc(0)).ok, false);
  assert.deepEqual(detectFetched("text/html; charset=utf-8", "https://e.example/a", Buffer.from("<p>x</p>")), { ok: true, mediaType: "html" });
  assert.deepEqual(detectFetched("application/octet-stream", "https://e.example/paper.pdf", makePdf(["x"])), { ok: true, mediaType: "pdf" });
  assert.equal(detectFetched("image/png", "https://e.example/a.png", Buffer.from("x")).ok, false);
});

test("reading runs in a worker thread: chunks come back, a broken document says why, and the server never runs its content", async () => {
  const ok = await extractInWorker("pdf", makePdf(["Alpha beta gamma.", "Delta."]), 30_000);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok ? ok.processed.chunks.map((c) => [c.page, c.text]) : [], [[1, "Alpha beta gamma."], [2, "Delta."]]);
  const bad = await extractInWorker("docx", Buffer.from("PK\u0003\u0004nope"), 30_000);
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.reason, /ZIP|central directory/);
  await assert.rejects(processDocument("text", Buffer.from("   \n\n  ")), /No text could be read/);
});
