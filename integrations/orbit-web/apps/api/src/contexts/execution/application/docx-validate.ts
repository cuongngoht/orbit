// BOUNDED DOCX VALIDATION (Issue #3): verifies that bytes submitted as a `.docx` deliverable form a valid, undamaged
// Open Packaging Conventions (OPC) ZIP archive containing the required WordprocessingML parts (`[Content_Types].xml`,
// `_rels/.rels`, and the main Word document XML part it references) with valid CRC-32 checksums and well-formed XML.
//
// Everything runs strictly in memory with explicit size, entry-count, inflation and XML-structure bounds so malformed,
// plain-text, truncated, or ZIP-bomb inputs fail fast with an actionable reason and never exhaust memory or CPU.
import { crc32, inflateRawSync } from "node:zlib";

export const DOCX_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 10_000,
  maxMetaXmlBytes: 4 * 1024 * 1024,
  maxDocumentXmlBytes: 16 * 1024 * 1024,
  maxTotalInflatedBytes: 24 * 1024 * 1024,
  maxXmlDepth: 512,
  maxXmlTags: 250_000,
} as const;

export type DocxValidationResult = { ok: true; documentPart: string } | { ok: false; reason: string };

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const OPC_CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const OPC_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOC_REL_TYPES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
]);
const WORD_MAIN_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  "application/vnd.ms-word.document.macroenabled.main+xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
]);
const WORD_MAIN_NS = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  expectedCrc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

const fail = (reason: string): DocxValidationResult => ({ ok: false, reason });

function looksLikePlainText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  if (sample.length === 0) return false;
  let printable = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128) printable += 1;
  }
  return printable / sample.length > 0.9;
}

function findEocd(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - 22 - 65_535);
  for (let at = zip.length - 22; at >= lowest; at -= 1) {
    if (zip.readUInt32LE(at) !== EOCD_SIG) continue;
    const commentLen = zip.readUInt16LE(at + 20);
    if (at + 22 + commentLen === zip.length) return at;
  }
  return -1;
}

function parseZipDirectory(zip: Buffer): { ok: true; entries: Map<string, ZipEntry> } | { ok: false; reason: string } {
  if (zip.length === 0) return { ok: false, reason: "the file is empty" };
  if (zip.length > DOCX_LIMITS.maxArchiveBytes) return { ok: false, reason: `the file exceeds the ${Math.round(DOCX_LIMITS.maxArchiveBytes / 1_048_576)} MiB DOCX limit` };
  if (zip.length < 22 || zip.readUInt32LE(0) !== LOCAL_SIG) {
    return { ok: false, reason: looksLikePlainText(zip) ? "the file contains plain text rather than a ZIP-based Word (.docx) package" : "the file does not start with a valid ZIP header" };
  }
  const eocd = findEocd(zip);
  if (eocd === -1) return { ok: false, reason: "the ZIP archive is truncated or missing its End of Central Directory record" };
  const disk = zip.readUInt16LE(eocd + 4);
  const cdDisk = zip.readUInt16LE(eocd + 6);
  const countOnDisk = zip.readUInt16LE(eocd + 8);
  const countTotal = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || countOnDisk !== countTotal) return { ok: false, reason: "multi-disk ZIP archives are not valid DOCX packages" };
  if (countTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, reason: "ZIP64 archives are not supported for DOCX deliverables" };
  if (countTotal === 0) return { ok: false, reason: "the ZIP archive contains no entries" };
  if (countTotal > DOCX_LIMITS.maxEntries) return { ok: false, reason: `the ZIP archive has too many entries (limit ${DOCX_LIMITS.maxEntries})` };
  if (cdOffset + cdSize > eocd) return { ok: false, reason: "the ZIP central directory extends past the end of the archive" };

  const entries = new Map<string, ZipEntry>();
  let at = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let i = 0; i < countTotal; i += 1) {
    if (at + 46 > cdEnd || zip.readUInt32LE(at) !== CENTRAL_SIG) return { ok: false, reason: "the ZIP central directory is damaged" };
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const expectedCrc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const uncompressedSize = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    if (at + 46 + nameLen + extraLen + commentLen > cdEnd) return { ok: false, reason: "a ZIP central directory entry is truncated" };
    if ((flags & 0x1) !== 0) return { ok: false, reason: "encrypted ZIP entries are not allowed in DOCX deliverables" };
    if (method !== 0 && method !== 8) return { ok: false, reason: `unsupported ZIP compression method (${method})` };
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) return { ok: false, reason: "ZIP64 entries are not supported for DOCX deliverables" };
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) return { ok: false, reason: `unsafe archive entry path "${name.slice(0, 80)}"` };
    if (localOffset + 30 > cdOffset || zip.readUInt32LE(localOffset) !== LOCAL_SIG) return { ok: false, reason: `damaged local header for archive entry "${name.slice(0, 80)}"` };
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > cdOffset) return { ok: false, reason: `truncated data for archive entry "${name.slice(0, 80)}"` };
    entries.set(name, { name, flags, method, expectedCrc, compressedSize, uncompressedSize, localOffset });
  }
  return { ok: true, entries };
}

function inflateEntry(zip: Buffer, entry: ZipEntry, maxBytes: number, budget: { remaining: number }): { ok: true; data: Buffer } | { ok: false; reason: string } {
  const limit = Math.min(maxBytes, budget.remaining);
  if (entry.uncompressedSize > limit) return { ok: false, reason: `part "${entry.name}" exceeds the bounded validation size limit` };
  const localNameLen = zip.readUInt16LE(entry.localOffset + 26);
  const localExtraLen = zip.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + localNameLen + localExtraLen;
  const raw = zip.subarray(start, start + entry.compressedSize);
  let out: Buffer;
  if (entry.method === 0) {
    if (raw.length > limit) return { ok: false, reason: `part "${entry.name}" exceeds the bounded validation size limit` };
    out = Buffer.from(raw);
  } else {
    try {
      out = inflateRawSync(raw, { maxOutputLength: limit });
    } catch (err) {
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      const tooLarge = code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test(msg);
      return { ok: false, reason: tooLarge ? `part "${entry.name}" expands past the bounded validation size limit` : `part "${entry.name}" has damaged compressed data` };
    }
  }
  if (out.length !== entry.uncompressedSize) return { ok: false, reason: `part "${entry.name}" size does not match the ZIP directory` };
  if (crc32(out) !== entry.expectedCrc) return { ok: false, reason: `part "${entry.name}" failed CRC-32 integrity verification` };
  budget.remaining -= out.length;
  return { ok: true, data: out };
}

function decodeUtf8Xml(bytes: Buffer, part: string): { ok: true; text: string } | { ok: false; reason: string } {
  try {
    let text = utf8Strict.decode(bytes);
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    if (/<!(?:DOCTYPE|ENTITY)\b/i.test(text)) return { ok: false, reason: `part "${part}" contains disallowed XML DOCTYPE/ENTITY declarations` };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: `part "${part}" is not valid UTF-8 XML` };
  }
}

interface XmlSummary {
  rootTag: string;
  rootAttrs: string;
  hasWordBody: boolean;
}

// Linear, bounded XML well-formedness check: verifies matching tag nesting, properly terminated quotes/comments/CDATA/
// processing instructions, and captures the root element + presence of `<w:body>` / `<body>`.
function checkXmlWellFormed(xml: string, part: string): { ok: true; summary: XmlSummary } | { ok: false; reason: string } {
  const stack: string[] = [];
  let rootTag = "";
  let rootAttrs = "";
  let rootClosed = false;
  let hasWordBody = false;
  let tags = 0;
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (rootTag === "" && xml.slice(i).trim().length > 0) return { ok: false, reason: `part "${part}" has non-XML text before root element` };
      if (rootClosed && xml.slice(i).trim().length > 0) return { ok: false, reason: `part "${part}" has trailing text after root element` };
      break;
    }
    if ((rootTag === "" || rootClosed) && xml.slice(i, lt).trim().length > 0) {
      return { ok: false, reason: `part "${part}" has stray text outside the XML root element` };
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end === -1) return { ok: false, reason: `part "${part}" has an unclosed XML comment` };
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end === -1) return { ok: false, reason: `part "${part}" has an unclosed CDATA section` };
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end === -1) return { ok: false, reason: `part "${part}" has an unclosed XML processing instruction` };
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      return { ok: false, reason: `part "${part}" contains an unsupported XML declaration` };
    }

    // Scan to closing '>' while respecting single/double quoted attribute values.
    let quote: string | null = null;
    let gt = -1;
    for (let j = lt + 1; j < n; j += 1) {
      const ch = xml[j] as string;
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "<") {
        return { ok: false, reason: `part "${part}" has an unclosed XML tag` };
      } else if (ch === ">") {
        gt = j;
        break;
      }
    }
    if (gt === -1 || quote !== null) return { ok: false, reason: `part "${part}" has truncated or unclosed XML markup` };
    const inner = xml.slice(lt + 1, gt).trim();
    if (inner.length === 0) return { ok: false, reason: `part "${part}" has an empty XML tag` };

    tags += 1;
    if (tags > DOCX_LIMITS.maxXmlTags) return { ok: false, reason: `part "${part}" exceeds the bounded XML tag limit` };

    if (inner.startsWith("/")) {
      const closeName = inner.slice(1).trim();
      const top = stack.pop();
      if (top !== closeName) return { ok: false, reason: `part "${part}" has mismatched XML closing tag </${closeName}>` };
      if (stack.length === 0) rootClosed = true;
    } else {
      if (rootClosed) return { ok: false, reason: `part "${part}" has multiple XML root elements` };
      const selfClosing = inner.endsWith("/");
      const body = selfClosing ? inner.slice(0, -1).trim() : inner;
      const m = /^([A-Za-z_][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(body);
      if (m === null) return { ok: false, reason: `part "${part}" has an invalid XML tag name` };
      const tagName = m[1] as string;
      const attrs = m[2] ?? "";
      if (rootTag === "") {
        rootTag = tagName;
        rootAttrs = attrs;
      }
      const localName = tagName.includes(":") ? tagName.slice(tagName.indexOf(":") + 1) : tagName;
      if (localName === "body") hasWordBody = true;
      if (!selfClosing) {
        stack.push(tagName);
        if (stack.length > DOCX_LIMITS.maxXmlDepth) return { ok: false, reason: `part "${part}" exceeds maximum XML nesting depth` };
      } else if (stack.length === 0) {
        rootClosed = true;
      }
    }
    i = gt + 1;
  }

  if (rootTag === "" || stack.length > 0) return { ok: false, reason: `part "${part}" has incomplete or unclosed XML elements` };
  return { ok: true, summary: { rootTag, rootAttrs, hasWordBody } };
}

function readAttr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m === null ? null : (m[1] ?? m[2] ?? null);
}

function localNameOf(tag: string): string {
  const idx = tag.indexOf(":");
  return idx === -1 ? tag : tag.slice(idx + 1);
}

function normalizeOpcTarget(target: string): string | null {
  const clean = target.trim().replace(/^\/+/, "");
  if (clean.length === 0 || clean.includes("\\") || clean.split("/").includes("..")) return null;
  return clean;
}

function hasWordContentType(contentTypesXml: string, documentPart: string): boolean {
  const expectedPart = `/${documentPart}`.toLowerCase();
  let sawAnyMainType = false;
  for (const m of contentTypesXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Override\s+([^>]*?)\/?\s*>/g)) {
    const attrs = m[1] ?? "";
    const partName = readAttr(attrs, "PartName")?.toLowerCase();
    const contentType = readAttr(attrs, "ContentType")?.toLowerCase();
    if (contentType !== undefined && WORD_MAIN_CONTENT_TYPES.has(contentType)) {
      sawAnyMainType = true;
      if (partName === expectedPart) return true;
    }
  }
  return sawAnyMainType;
}

function findOfficeDocumentTarget(relsXml: string): string | null {
  for (const m of relsXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\s+([^>]*?)\/?\s*>/g)) {
    const attrs = m[1] ?? "";
    const type = readAttr(attrs, "Type");
    const target = readAttr(attrs, "Target");
    const mode = readAttr(attrs, "TargetMode");
    if (mode?.toLowerCase() === "external") continue;
    if (type !== null && OFFICE_DOC_REL_TYPES.has(type) && target !== null) {
      return normalizeOpcTarget(target);
    }
  }
  return null;
}

export function validateDocx(bytes: Buffer): DocxValidationResult {
  const dir = parseZipDirectory(bytes);
  if (!dir.ok) return fail(dir.reason);
  const { entries } = dir;
  const budget = { remaining: DOCX_LIMITS.maxTotalInflatedBytes };

  // 1. Required OPC part: [Content_Types].xml
  const ctEntry = entries.get("[Content_Types].xml");
  if (ctEntry === undefined) return fail("missing required package part [Content_Types].xml");
  const ctRaw = inflateEntry(bytes, ctEntry, DOCX_LIMITS.maxMetaXmlBytes, budget);
  if (!ctRaw.ok) return fail(ctRaw.reason);
  const ctText = decodeUtf8Xml(ctRaw.data, "[Content_Types].xml");
  if (!ctText.ok) return fail(ctText.reason);
  const ctXml = checkXmlWellFormed(ctText.text, "[Content_Types].xml");
  if (!ctXml.ok) return fail(ctXml.reason);
  if (localNameOf(ctXml.summary.rootTag) !== "Types" || !ctXml.summary.rootAttrs.includes(OPC_CONTENT_TYPES_NS)) {
    return fail("[Content_Types].xml does not declare a valid OPC Types root element");
  }

  // 2. Required OPC part: _rels/.rels pointing to the main Word document part
  const relsEntry = entries.get("_rels/.rels");
  if (relsEntry === undefined) return fail("missing required package relationships part _rels/.rels");
  const relsRaw = inflateEntry(bytes, relsEntry, DOCX_LIMITS.maxMetaXmlBytes, budget);
  if (!relsRaw.ok) return fail(relsRaw.reason);
  const relsText = decodeUtf8Xml(relsRaw.data, "_rels/.rels");
  if (!relsText.ok) return fail(relsText.reason);
  const relsXml = checkXmlWellFormed(relsText.text, "_rels/.rels");
  if (!relsXml.ok) return fail(relsXml.reason);
  if (localNameOf(relsXml.summary.rootTag) !== "Relationships" || !relsXml.summary.rootAttrs.includes(OPC_RELS_NS)) {
    return fail("_rels/.rels does not declare a valid OPC Relationships root element");
  }
  const documentPart = findOfficeDocumentTarget(relsText.text);
  if (documentPart === null) return fail("_rels/.rels is missing the officeDocument relationship to the main Word document");

  // 3. Content types must declare a WordprocessingML main document type (not e.g. an .xlsx or .pptx archive renamed .docx)
  if (!hasWordContentType(ctText.text, documentPart)) {
    return fail(`[Content_Types].xml does not declare a WordprocessingML main document content type for /${documentPart}`);
  }

  // 4. Required main Word document part (typically word/document.xml)
  const docEntry = entries.get(documentPart);
  if (docEntry === undefined) return fail(`missing required Word document part "${documentPart}" referenced by _rels/.rels`);
  const docRaw = inflateEntry(bytes, docEntry, DOCX_LIMITS.maxDocumentXmlBytes, budget);
  if (!docRaw.ok) return fail(docRaw.reason);
  const docText = decodeUtf8Xml(docRaw.data, documentPart);
  if (!docText.ok) return fail(docText.reason);
  const docXml = checkXmlWellFormed(docText.text, documentPart);
  if (!docXml.ok) return fail(docXml.reason);
  const hasWordNs = [...WORD_MAIN_NS].some((ns) => docXml.summary.rootAttrs.includes(ns));
  if (localNameOf(docXml.summary.rootTag) !== "document" || !hasWordNs) {
    return fail(`"${documentPart}" does not have a valid WordprocessingML <w:document> root element`);
  }
  if (!docXml.summary.hasWordBody) {
    return fail(`"${documentPart}" is missing a WordprocessingML <w:body> element`);
  }

  // 5. Optional document relationships part (if present, must be intact and well-formed XML)
  const slash = documentPart.lastIndexOf("/");
  const docRelsName = slash === -1 ? `_rels/${documentPart}.rels` : `${documentPart.slice(0, slash)}/_rels/${documentPart.slice(slash + 1)}.rels`;
  const docRelsEntry = entries.get(docRelsName);
  if (docRelsEntry !== undefined) {
    const raw = inflateEntry(bytes, docRelsEntry, DOCX_LIMITS.maxMetaXmlBytes, budget);
    if (!raw.ok) return fail(raw.reason);
    const decoded = decodeUtf8Xml(raw.data, docRelsName);
    if (!decoded.ok) return fail(decoded.reason);
    const checked = checkXmlWellFormed(decoded.text, docRelsName);
    if (!checked.ok) return fail(checked.reason);
  }

  return { ok: true, documentPart };
}
