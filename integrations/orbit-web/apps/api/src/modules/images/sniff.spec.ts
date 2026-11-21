import assert from "node:assert/strict";
import { test } from "node:test";
import { gifOf, jpegOf, pngOf, webpLosslessOf, webpLossyOf, webpExtendedOf } from "../../testing/image-fixtures.js";
import { sniffImage } from "./sniff.js";

test("an image is what its own first bytes say: PNG, JPEG, GIF or WebP, with the size its header gives", () => {
  assert.deepEqual(sniffImage(pngOf(64, 48)), { mediaType: "image/png", width: 64, height: 48 });
  assert.deepEqual(sniffImage(jpegOf(1920, 1080)), { mediaType: "image/jpeg", width: 1920, height: 1080 });
  assert.deepEqual(sniffImage(gifOf(32, 16)), { mediaType: "image/gif", width: 32, height: 16 });
  assert.deepEqual(sniffImage(webpLossyOf(800, 600)), { mediaType: "image/webp", width: 800, height: 600 });
  assert.deepEqual(sniffImage(webpLosslessOf(300, 200)), { mediaType: "image/webp", width: 300, height: 200 });
  assert.deepEqual(sniffImage(webpExtendedOf(4000, 3000)), { mediaType: "image/webp", width: 4000, height: 3000 });
});

test("nothing else is an image: SVG, HTML, text, a renamed file, a header cut short", () => {
  const notImages = [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from("<!doctype html><html><body>hi</body></html>"),
    Buffer.from("just some text"),
    Buffer.from("%PDF-1.7\n"),
    Buffer.alloc(0),
    pngOf(10, 10).subarray(0, 12),
    Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt "),
  ];
  for (const bytes of notImages) assert.equal(sniffImage(bytes), null, bytes.toString("latin1").slice(0, 20));
});

test("a JPEG whose markers never say its size is still a JPEG, of unknown size; a scan that runs off the end stops", () => {
  const bare = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
  assert.deepEqual(sniffImage(bare), { mediaType: "image/jpeg", width: null, height: null });
  const lying = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]);
  assert.deepEqual(sniffImage(lying), { mediaType: "image/jpeg", width: null, height: null });
});
