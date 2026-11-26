import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRealDocx, buildZip, CONTENT_TYPES_DOCX, RELS_DOCX } from "../../../testing/docx-fixtures.js";
import { DOCX_LIMITS, validateDocx } from "./docx-validate.js";

test("accepts a real valid DOCX (compressed and uncompressed) with a table and non-ASCII UTF-8 text", () => {
  const compressed = buildRealDocx({
    title: "Báo cáo thị trường Đông Nam Á",
    paragraphs: ["Tổng quan quý 3 — Tiếng Việt · 日本語 · €1,250."],
    table: [
      ["Thị trường", "Doanh thu (USD)", "Ghi chú"],
      ["Việt Nam", "1,200,000", "Tăng trưởng 18%"],
      ["Thái Lan", "950,000", "Ổn định"],
    ],
    compress: true,
  });
  assert.deepEqual(validateDocx(compressed), { ok: true, documentPart: "word/document.xml" });

  const stored = buildRealDocx({
    paragraphs: ["Stored ZIP entries work too."],
    compress: false,
  });
  assert.deepEqual(validateDocx(stored), { ok: true, documentPart: "word/document.xml" });
});

test("rejects plain text or markdown saved with a .docx extension with an actionable message", () => {
  const plain = Buffer.from("# Quarterly Report\n\nThis is plain markdown text, not a Word document.\n", "utf8");
  const res = validateDocx(plain);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /plain text/i);
});

test("rejects incomplete ZIP packages missing required OPC/Word parts or declaring non-Word content types", () => {
  const noContentTypes = buildZip([
    { name: "_rels/.rels", content: RELS_DOCX },
    { name: "word/document.xml", content: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>` },
  ]);
  const r1 = validateDocx(noContentTypes);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.reason, /\[Content_Types\]\.xml/);

  const noRels = buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX },
    { name: "word/document.xml", content: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>` },
  ]);
  const r2 = validateDocx(noRels);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.reason, /_rels\/\.rels/);

  const noDocumentXml = buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX },
    { name: "_rels/.rels", content: RELS_DOCX },
  ]);
  const r3 = validateDocx(noDocumentXml);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.match(r3.reason, /word\/document\.xml/);

  // A spreadsheet package (.xlsx) renamed to .docx must fail content-type validation.
  const xlsxNamedDocx = buildZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    { name: "xl/workbook.xml", content: `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>` },
  ]);
  const r4 = validateDocx(xlsxNamedDocx);
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.match(r4.reason, /WordprocessingML/i);
});

test("rejects damaged ZIP archives, CRC mismatches, malformed XML, missing <w:body>, and oversized inflated parts", () => {
  const valid = buildRealDocx({ paragraphs: ["Valid body."] });
  // Truncated ZIP archive
  const truncated = valid.subarray(0, Math.floor(valid.length / 2));
  assert.equal(validateDocx(truncated).ok, false);

  // Corrupted compressed payload / CRC mismatch (flip a byte in the central directory's expected CRC for word/document.xml)
  const badCrc = Buffer.from(valid);
  const idx = badCrc.lastIndexOf(Buffer.from("word/document.xml", "utf8"));
  assert.ok(idx > 46);
  // Central directory entry starts 46 bytes before the filename; CRC-32 is at +16.
  badCrc.writeUInt32LE((badCrc.readUInt32LE(idx - 46 + 16) ^ 0xffffffff) >>> 0, idx - 46 + 16);
  const crcRes = validateDocx(badCrc);
  assert.equal(crcRes.ok, false);
  if (!crcRes.ok) assert.match(crcRes.reason, /CRC-32/i);

  // Malformed XML inside word/document.xml
  const badXml = buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX },
    { name: "_rels/.rels", content: RELS_DOCX },
    { name: "word/document.xml", content: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r></w:p></w:body></w:document>` },
  ]);
  const xmlRes = validateDocx(badXml);
  assert.equal(xmlRes.ok, false);
  if (!xmlRes.ok) assert.match(xmlRes.reason, /mismatched XML/i);

  // Missing <w:body>
  const noBody = buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX },
    { name: "_rels/.rels", content: RELS_DOCX },
    { name: "word/document.xml", content: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>` },
  ]);
  const bodyRes = validateDocx(noBody);
  assert.equal(bodyRes.ok, false);
  if (!bodyRes.ok) assert.match(bodyRes.reason, /<w:body>/);

  // Bounded processing: a highly-compressible XML part exceeding maxDocumentXmlBytes is rejected without blowing memory.
  const huge = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${"A".repeat(DOCX_LIMITS.maxDocumentXmlBytes + 1024)}</w:t></w:r></w:p></w:body></w:document>`;
  const bomb = buildZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_DOCX },
    { name: "_rels/.rels", content: RELS_DOCX },
    { name: "word/document.xml", content: huge, compress: true },
  ]);
  const bombRes = validateDocx(bomb);
  assert.equal(bombRes.ok, false);
  if (!bombRes.ok) assert.match(bombRes.reason, /size limit/i);
});
