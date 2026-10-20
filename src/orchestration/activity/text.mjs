// What a running command printed, made into LINES an observation may read and keep (ADR 0020). A child's output is
// untrusted data: it is never an instruction, and nothing in it reaches a disk, a page or a terminal before it has
// been split, cut and cleaned here.
//
//   createSplitter(maxBytes) -> { push(bytes) -> [text], end() -> [text] }
//     bytes are split at the last "\n" BEFORE decoding -- a newline byte never sits inside a multi-byte UTF-8
//     character, so what precedes it decodes whole and a character a chunk boundary cut waits in the held tail.
//     "\r\n" is a line end. A line longer than maxBytes is cut there (back to a character's first byte, marked "…")
//     and the rest of it dropped up to its end: what is held never grows past maxBytes, however long a child writes
//     without a newline.
//   plain(text) -> string           what a parser reads: escape sequences removed whole (CSI, OSC up to its
//                                    terminator, DCS/PM/APC, any other ESC sequence), then every control character
//                                    and reordering mark (src/printable.mjs) -- a carriage return included, so
//                                    nothing a child prints can overwrite the line it follows; indentation kept
//   cleaned(text, maxChars) -> string   what is KEPT of any text: plain, masked by SHAPE (src/scrub.mjs), trimmed,
//                                    cut to maxChars code points. A secret split across two chunks is whole by
//                                    then: masking happens on lines, never on chunks
import { printable } from "../../printable.mjs";
import { scrub } from "../../scrub.mjs";

const NEWLINE = 0x0a;
const EMPTY = Buffer.alloc(0);
const CUT = "…";

export function createSplitter(maxBytes) {
  const s = { held: EMPTY, skipping: false, maxBytes };
  return { push: (bytes) => pushed(s, Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes))), end: () => ended(s) };
}

function pushed(s, bytes) {
  const all = Buffer.concat([s.held, bytes]);
  const end = all.lastIndexOf(NEWLINE);
  const lines = end < 0 ? [] : linesIn(s, all.subarray(0, end));
  return [...lines, ...heldBack(s, end < 0 ? all : all.subarray(end + 1))];
}

// The first part finishes a line that was being skipped (it was already handed out, cut); the rest are lines.
function linesIn(s, bytes) {
  const parts = bytes.toString("utf8").split("\n");
  const kept = s.skipping ? parts.slice(1) : parts;
  s.skipping = false;
  return kept.map((t) => fitted(t, s.maxBytes));
}

// What waits for the next push. A tail longer than the bound is a line nobody will end soon: its first part is handed
// out now, cut, and the rest of it is dropped as it arrives.
function heldBack(s, tail) {
  const over = !s.skipping && tail.length > s.maxBytes;
  s.held = s.skipping || over ? EMPTY : Buffer.from(tail);
  s.skipping = s.skipping || over;
  return over ? [cutAt(tail, s.maxBytes)] : [];
}

const fitted = (text, maxBytes) => ((line) => (Buffer.byteLength(line, "utf8") <= maxBytes ? line : cutAt(Buffer.from(line, "utf8"), maxBytes)))(text.endsWith("\r") ? text.slice(0, -1) : text);

const characterStart = (bytes, n) => (n > 0 && (bytes[n] & 0xc0) === 0x80 ? characterStart(bytes, n - 1) : n);

const cutAt = (bytes, maxBytes) => `${bytes.subarray(0, characterStart(bytes, maxBytes)).toString("utf8")}${CUT}`;

function ended(s) {
  const tail = s.held.length && !s.skipping ? [fitted(s.held.toString("utf8"), s.maxBytes)] : [];
  Object.assign(s, { held: EMPTY, skipping: false });
  return tail;
}

// ---- cleaning ----------------------------------------------------------------------------------------------

const SEQUENCES = [
  /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)/g,
  /\u001b\[[0-?]*[ -/]*[@-~]/g,
  /\u001b[P^_][^\u001b]*(?:\u001b\\|$)/g,
  /\u001b[ -/]*[0-~]?/g,
  /\u009b[0-?]*[ -/]*[@-~]/g,
];

const withoutSequences = (text) => SEQUENCES.reduce((t, re) => t.replace(re, ""), String(text ?? ""));

const capped = (text, n) => ((cps) => (cps.length > n ? `${cps.slice(0, n).join("")}${CUT}` : text))([...text]);

// What a parser reads: no sequence, no control character, its indentation kept (a protocol may nest by it).
export const plain = (text) => printable(withoutSequences(text).replace(/\t/g, " "));

// What an observation KEEPS of any text: plain, masked, trimmed, bounded.
export const cleaned = (text, maxChars) => capped(scrub(plain(text)).trim(), maxChars);
