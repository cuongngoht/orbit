// WHAT AN IMAGE IS, read from its own first bytes -- never from a file name or a content type a client sent: PNG, JPEG,
// GIF or WebP, and its width and height where its header says them. Anything else (SVG, HTML, a renamed file, a header
// cut short) is not an image here. A bounded read of the header only: nothing is decoded.
import type { ImageMediaType } from "@orbit-web/contracts";

export interface Sniffed {
  mediaType: ImageMediaType;
  width: number | null;
  height: number | null;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (b: Buffer, bytes: readonly number[]): boolean => b.length >= bytes.length && bytes.every((x, i) => b[i] === x);

function png(b: Buffer): Sniffed | null {
  if (!startsWith(b, PNG) || b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
  return { mediaType: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b: Buffer): Sniffed | null {
  const magic = b.length >= 10 ? b.toString("latin1", 0, 6) : "";
  if (magic !== "GIF87a" && magic !== "GIF89a") return null;
  return { mediaType: "image/gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

// A start-of-frame marker carries the size (every SOFn but DHT, JPG and DAC, which share the range).
const isFrame = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

// Standalone markers have no length.
const isStandalone = (marker: number): boolean => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);

function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return { width: null, height: null };
    const marker = b[i + 1] as number;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (isStandalone(marker)) {
      i += 2;
      continue;
    }
    const length = b.readUInt16BE(i + 2);
    if (isFrame(marker)) return i + 8 < b.length ? { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) } : { width: null, height: null };
    if (length < 2) return { width: null, height: null };
    i += 2 + length;
  }
  return { width: null, height: null };
}

function jpeg(b: Buffer): Sniffed | null {
  return startsWith(b, [0xff, 0xd8, 0xff]) ? { mediaType: "image/jpeg", ...jpegSize(b) } : null;
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8 " && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X" && b.length >= 30) return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return { width: null, height: null };
}

function webp(b: Buffer): Sniffed | null {
  if (b.length < 16 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  return { mediaType: "image/webp", ...webpSize(b) };
}

export function sniffImage(bytes: Buffer): Sniffed | null {
  return png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes);
}
