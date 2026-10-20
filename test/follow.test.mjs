// A follower reads only what was appended, and numbers each line exactly as the store's whole-file reader does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFollower, MAX_LINE } from "../src/store/follow.mjs";
import { guardedIo } from "../src/store/guard.mjs";
import { realIo } from "../src/store/io.mjs";
import { createTasks, journalLine, JOURNAL } from "../src/task/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

// The journal's path as the store builds it -- with this platform's separator, which is the key the fake disk is asked by.
const FILE = createTasks("/store", fakeIo()).journalFile("tsk-0123456789ab");
const line = (n) => JSON.stringify({ at: `2026-10-08T00:00:0${n % 10}.000Z`, kind: "stage", stage: `S${n}` });

function followed(text, opts = {}) {
  const io = fakeIo();
  io.files.set(FILE, text);
  return { io, follower: createFollower(io, FILE, { parse: journalLine, keep: true, ...opts }) };
}

test("a follower emits each ended line once, in order, and its n is the whole-file reader's index -- CRLF, blank and garbled lines included", () => {
  const parts = [line(0), "", "not json", line(1), JSON.stringify({ no: "kind" }), `${line(2)}\r`, "{\"kind\":", line(3), "[1,2]", line(4)];
  const text = `${parts.join("\n")}\n`;
  const { io, follower } = followed(text);
  const got = follower.pull();
  const whole = createTasks("/store", io).read("tsk-0123456789ab");
  assert.deepEqual(got.items.map((it) => it.record), whole);
  assert.deepEqual(got.items.map((it) => it.n), whole.map((_, i) => i));
  assert.deepEqual(follower.pull().items, [], "nothing new is nothing");
});

test("only what was appended is read, and it continues the numbering", () => {
  const { io, follower } = followed(`${line(0)}\n${line(1)}\n`);
  follower.pull();
  const reads = [];
  const readFrom = io.readFrom;
  io.readFrom = (p, offset, max) => (reads.push(offset), readFrom(p, offset, max));
  io.files.set(FILE, `${io.files.get(FILE)}${line(2)}\n`);
  const got = follower.pull();
  assert.deepEqual(got.items.map((it) => [it.n, it.record.stage]), [[2, "S2"]]);
  assert.deepEqual(reads, [Buffer.byteLength(`${line(0)}\n${line(1)}\n`)], "one read, from where the last one stopped");
});

test("a torn tail is held, not emitted; once the store ends it, the follower agrees with the whole-file reader", () => {
  const { io, follower } = followed(`${line(0)}\n${line(1)}`);
  assert.deepEqual(follower.pull().items.map((it) => it.n), [0], "the unended line waits");
  io.files.set(FILE, `${io.files.get(FILE)}\n${line(2)}\n`);
  assert.deepEqual(follower.pull().items.map((it) => [it.n, it.record.stage]), [[1, "S1"], [2, "S2"]]);
  assert.equal(follower.count, createTasks("/store", io).read("tsk-0123456789ab").length);
});

test("a line split across a read window is put back together, a multibyte character included", () => {
  const io = fakeIo();
  const words = ["é", "日本語", "🙂", "plain"];
  io.files.set(FILE, words.map((w, i) => JSON.stringify({ kind: "stage", stage: `${w}${i}` })).join("\n").concat("\n"));
  const small = { ...io, readFrom: (p, offset) => io.readFrom(p, offset, 7) };
  const got = createFollower(small, FILE, { parse: journalLine }).pull();
  assert.deepEqual(got.items.map((it) => it.record.stage), words.map((w, i) => `${w}${i}`));
});

test("a file that shrank is a reset: offset, count and kept items go back to zero, and the next pull starts over", () => {
  const { io, follower } = followed(`${line(0)}\n${line(1)}\n${line(2)}\n`);
  follower.pull();
  io.files.set(FILE, `${line(9)}\n`);
  const reset = follower.pull();
  assert.deepEqual([reset.reset, follower.offset, follower.count, follower.items.length], [true, 0, 0, 0]);
  assert.deepEqual(follower.pull().items.map((it) => [it.n, it.record.stage]), [[0, "S9"]]);
});

test("keep: false keeps nothing; a line longer than MAX_LINE is dropped up to its own end and the next one still arrives", () => {
  const io = fakeIo();
  io.files.set(FILE, `${"x".repeat(MAX_LINE + 10)}\n${line(1)}\n`);
  const small = { ...io, readFrom: (p, offset, max) => io.readFrom(p, offset, Math.min(max, MAX_LINE / 4)) };
  const follower = createFollower(small, FILE, { parse: journalLine });
  assert.deepEqual(follower.pull().items.map((it) => it.record.stage), ["S1"]);
  assert.equal(follower.items.length, 0);
});

test("a file that is not there yet is nothing new, and a follower may start at a byte offset", () => {
  const io = fakeIo();
  assert.deepEqual(createFollower(io, FILE).pull(), { items: [], reset: false });
  io.files.set(FILE, "first\nsecond\n");
  assert.deepEqual(createFollower(io, FILE, { from: 6 }).pull().items.map((it) => it.record), ["second"]);
});

test("readFrom: the real disk reads a range by offset, answers null for a missing file, and guardedIo passes it through", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-follow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, JOURNAL);
  writeFileSync(file, "0123456789");
  const io = guardedIo(dir, realIo());
  const got = io.readFrom(file, 3, 4);
  assert.deepEqual([got.buffer.toString(), got.next, got.size], ["3456", 7, 10]);
  assert.deepEqual([io.readFrom(file, 10, 4).buffer.length, io.readFrom(file, 10, 4).next], [0, 10]);
  assert.equal(io.readFrom(join(dir, "none"), 0, 4), null);
});
