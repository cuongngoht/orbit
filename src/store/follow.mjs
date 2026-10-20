// FOLLOW a file by lines: read only what was appended since the last look, and hand back each line
// that ENDED, in order, with its index. A LEAF: it owns no timer and no socket -- whoever follows
// decides when to look (control-server/src/live/), and this decides only what is new.
//
//   createFollower(io, file, { parse, from, keep }) -> { file, offset, count, items, pull() }
//   pull() -> { items: [{ n, record }], reset }
//
// `n` is the line's index among the lines `parse` kept -- exactly what the store's whole-file
// reader numbers it, because `parse` IS the store's own keep-rule (src/task/store.mjs journalLine,
// src/investigation/store.mjs journalLine): one definition, so a live page and a reload can never
// disagree about which line is which. Two deliberate differences, both about a line still being
// written:
//
//   - an UNENDED last line is held, never emitted: a writer may still be extending it, and an
//     emitted line cannot be taken back. The store ends a torn tail before its next append, so the
//     follower and the whole-file reader agree again the moment anything is appended.
//   - a file SMALLER than what was read is a reset: offset, count and kept items go back to zero
//     and the caller starts over (a log pruned and written again; a journal is never shortened).
//
// Bytes are split at "\n" before any decoding: a newline byte never occurs inside a multibyte UTF-8
// character, so a window boundary can split a character only inside the held tail.
export const WINDOW = 256 * 1024;
export const MAX_LINE = 1024 * 1024;

const NEWLINE = 0x0a;
const EMPTY = Buffer.alloc(0);
const NONE = Object.freeze({ items: Object.freeze([]), reset: false });

export function createFollower(io, file, opts = {}) {
  const state = { offset: opts.from ?? 0, count: 0, partial: EMPTY, skipping: false, items: [] };
  const how = { parse: opts.parse ?? ((text) => text), keep: opts.keep === true };
  return { file, items: state.items, get offset() { return state.offset; }, get count() { return state.count; }, pull: () => pulled(io, file, state, how) };
}

function pulled(io, file, state, how) {
  const size = io.size(file);
  if (size === null || size === state.offset) return NONE;
  if (size < state.offset) return reset(state);
  return { items: drained(io, file, state, how), reset: false };
}

function reset(state) {
  Object.assign(state, { offset: 0, count: 0, partial: EMPTY, skipping: false });
  state.items.length = 0;
  return { items: [], reset: true };
}

// Window after window until the file's end as it was when read, so a large backlog never asks for
// one allocation the size of the file.
function drained(io, file, state, how) {
  const out = [];
  let got = io.readFrom(file, state.offset, WINDOW);
  while (got && got.buffer.length > 0) got = another(io, file, state, how, { got, out });
  return out;
}

function another(io, file, state, how, { got, out }) {
  state.offset = got.next;
  out.push(...split(state, got.buffer, how));
  return got.next < got.size ? io.readFrom(file, state.offset, WINDOW) : null;
}

function split(state, buffer, how) {
  const all = Buffer.concat([state.partial, buffer]);
  const end = all.lastIndexOf(NEWLINE);
  const lines = end < 0 ? [] : linesOf(all.subarray(0, end), state);
  state.partial = held(all.subarray(end + 1), state);
  return lines.map((text) => lineOf(text, how.parse)).filter((record) => record !== null).map((record) => counted(state, record, how.keep));
}

// A line longer than MAX_LINE is not one any journal writer makes (each keeps an allow-list of
// short fields): it is dropped, up to its own end, rather than held in memory without bound.
function held(rest, state) {
  if (rest.length <= MAX_LINE) return Buffer.from(rest);
  state.skipping = true;
  return EMPTY;
}

function linesOf(bytes, state) {
  const lines = bytes.toString("utf8").split("\n");
  const kept = state.skipping ? lines.slice(1) : lines;
  state.skipping = false;
  return kept;
}

// What the whole-file readers do: "\r\n" is a line end, an empty line is no line, and what the
// keep-rule refuses is dropped and not counted.
const lineOf = (text, parse) => ((t) => (t.length === 0 ? null : parse(t)))(text.endsWith("\r") ? text.slice(0, -1) : text);

function counted(state, record, keep) {
  const item = { n: state.count, record };
  state.count += 1;
  if (keep) state.items.push(item);
  return item;
}
