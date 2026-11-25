// Images made in code for the tests (a binary fixture would be rewritten by the checkout's line-ending rules): a real,
// decodable PNG of one colour, and the headers of the other kinds -- all an image's sniffing reads.
import { crc32, deflateSync } from "node:zlib";

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = (w: number, h: number): Buffer => {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = 8; // bit depth
  d[9] = 2; // truecolour
  return d;
};

// A whole PNG, filled with one colour (keep it small: w x h x 3 bytes before compression).
export function pngOf(w: number, h: number, rgb: [number, number, number] = [220, 20, 20]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w * 3 }, (_, i) => rgb[i % 3]))]);
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr(w, h)), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

// Only a PNG's signature and header: an image of any size claimed, nothing to draw.
export const pngHeaderOf = (w: number, h: number): Buffer => Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr(w, h)), chunk("IEND", Buffer.alloc(0))]);

export function jpegOf(w: number, h: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0", "latin1"), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

export function gifOf(w: number, h: number): Buffer {
  const b = Buffer.alloc(13);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return Buffer.concat([b, Buffer.from([0x3b])]);
}

const riff = (fourcc: string, body: Buffer): Buffer => {
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(12 + body.length, 4);
  header.write("WEBP", 8, "latin1");
  header.write(fourcc, 12, "latin1");
  header.writeUInt32LE(body.length, 16);
  return Buffer.concat([header, body]);
};

export function webpLossyOf(w: number, h: number): Buffer {
  const body = Buffer.alloc(10);
  body.set([0x9d, 0x01, 0x2a], 3);
  body.writeUInt16LE(w & 0x3fff, 6);
  body.writeUInt16LE(h & 0x3fff, 8);
  return riff("VP8 ", body);
}

export function webpLosslessOf(w: number, h: number): Buffer {
  const body = Buffer.alloc(5);
  body[0] = 0x2f;
  body.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1);
  return riff("VP8L", body);
}

export function webpExtendedOf(w: number, h: number): Buffer {
  const body = Buffer.alloc(10);
  body.writeUIntLE(w - 1, 4, 3);
  body.writeUIntLE(h - 1, 7, 3);
  return riff("VP8X", body);
}
