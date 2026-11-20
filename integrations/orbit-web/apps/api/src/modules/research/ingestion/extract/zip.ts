// One file out of a ZIP archive, in memory and bounded -- what a Word document needs, and nothing more. The central
// directory is read for the one entry asked for; nothing is extracted to disk, no path in the archive is used, an
// encrypted or ZIP64 archive is refused, and inflating stops at the bound (a "ZIP bomb" fails, it does not fill memory).
import { inflateRawSync } from "node:zlib";
import { ExtractionError } from "../blocks.js";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 10_000;

function endOfCentralDirectory(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - 22 - 65_535);
  for (let at = zip.length - 22; at >= lowest; at -= 1) if (zip.readUInt32LE(at) === EOCD) return at;
  throw new ExtractionError("The file is not a readable ZIP archive (no central directory).");
}

// The bytes of `name`, inflated to at most `maxBytes`; null when the archive has no such entry.
export function readZipEntry(zip: Buffer, name: string, maxBytes: number): Buffer | null {
  if (zip.length < 22) throw new ExtractionError("The file is too short to be a ZIP archive.");
  const end = endOfCentralDirectory(zip);
  const entries = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const offset = zip.readUInt32LE(end + 16);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new ExtractionError("ZIP64 archives are not read.");
  if (entries > MAX_ENTRIES || offset + size > zip.length) throw new ExtractionError("The ZIP archive's directory is not valid.");
  let at = offset;
  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) throw new ExtractionError("The ZIP archive's directory is damaged.");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const uncompressed = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entryName = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if ((flags & 0x1) !== 0) throw new ExtractionError("The document is encrypted: research cannot read it.");
    if (uncompressed > maxBytes) throw new ExtractionError(`The document's text part is larger than research reads (${Math.round(maxBytes / 1_048_576)} MB).`);
    return inflated(zip, local, compressed, method, maxBytes);
  }
  return null;
}

function inflated(zip: Buffer, local: number, compressed: number, method: number, maxBytes: number): Buffer {
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) throw new ExtractionError("The ZIP archive's entry is damaged.");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  if (start + compressed > zip.length) throw new ExtractionError("The ZIP archive is cut short.");
  const data = zip.subarray(start, start + compressed);
  if (method === 0) return Buffer.from(data);
  if (method !== 8) throw new ExtractionError(`The ZIP archive uses a compression method research does not read (${method}).`);
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (err) {
    const tooLarge = (err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test(String((err as Error).message));
    throw new ExtractionError(tooLarge ? `The document expands to more than research reads (${Math.round(maxBytes / 1_048_576)} MB).` : "The document's compressed data is damaged.");
  }
}
