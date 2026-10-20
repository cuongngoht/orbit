import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { formatLesson, makeLesson, parseLesson } from "../src/learn/lesson.mjs";
import { gradeOf, worthKeeping } from "../src/learn/confidence.mjs";
import { lessonId } from "../src/learn/fingerprint.mjs";
import { priorFrom, suppressed, tombstoneFor } from "../src/learn/forget.mjs";
import { promote } from "../src/learn/promote.mjs";
import { createLessons } from "../src/learn/lessons.mjs";
import { storePaths } from "../src/learn/store.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { fakeLessons } from "./fakes/lessons.mjs";

const subject = { kind: "saw", family: "failures", topic: "orbit-ui-failures", about: "case:create-thing", key: "step 2 click home/Add" };

const lesson = (over = {}) => makeLesson({ ...subject, statement: "create-thing stops at step 2", ...over }, { now: () => "2026-09-20T00:00:00.000Z", host: "laptop-a" });

const seen = (over = {}) => ({ ...subject, statement: "create-thing stops at step 2", for: 3, against: 0, hosts: 2, runs: 5, notes: 0, sessions: ["a@1", "b@2", "a@3"], evidenceRuns: [], evidenceNotes: [], missing: [], confirmed: "2026-09-20T00:00:00.000Z", ...over });

test("a lesson round-trips through its own file, in LF and in CRLF", () => {
  const l = lesson({ applies: ["case create-thing"], notWhen: ["laptop-a"] });
  const text = formatLesson(l);
  assert.deepEqual(parseLesson(text, "f.md"), { ...l, file: "f.md" });
  assert.deepEqual(parseLesson(text.replace(/\n/g, "\r\n"), "f.md"), { ...l, file: "f.md" });
});

// The reader must never be taught that a missing section means "all known".
test("a lesson always renders what it does not know, even when that is nothing", () => {
  assert.match(formatLesson(lesson()), /## Not known\n\n- nothing/);
  assert.match(formatLesson(lesson({ evidence: { missing: ["the failure message"] } })), /## Not known\n\n- the failure message/);
});

// A file this tool did not write is the one case where it cannot know what it
// would be destroying, so it is skipped and reported -- never rewritten.
test("a file this tool did not write is skipped and reported, and left on disk", () => {
  const io = fakeIo();
  const store = createLessons("/store", io);
  // Built with join, like the store itself: a literal "/store/…" key never
  // matched on Windows, where join gives a backslash-separated path, so the
  // fake io never found the file and the note it should have logged never fired.
  const handwritten = join(storePaths("/store").lessons, "handwritten.md");
  io.files.set(handwritten, "a person typed this");
  assert.deepEqual(store.all(), []);
  assert.equal(io.notes[0].kind, "unreadable-lesson");
  assert.equal(io.files.get(handwritten), "a person typed this");
});

// The whole no-duplicates guarantee: the id is the SUBJECT, so a restatement
// updates in place instead of appending a twin.
test("the id is the subject, so a restatement updates in place", () => {
  const a = lessonId(subject);
  const b = lessonId({ ...subject, statement: "completely different wording" });
  assert.equal(a, b);
  assert.equal(a, "saw--failures--case-create-thing--step-2-click-home-add");
});

// An inference must never be able to become an instruction by being repeated.
test("what a person said and what the runs showed are two lessons that can never merge", () => {
  assert.notEqual(lessonId(subject), lessonId({ ...subject, kind: "said" }));
  assert.match(formatLesson(lesson()), /Inferred from the ledger/);
  assert.match(formatLesson(lesson({ kind: "said" })), /A person said so/);
});

test("one session is an observation and is never written down", () => {
  const store = fakeLessons();
  const out = promote(store, [seen({ for: 1, sessions: ["a@1"] })], { head: "abc" });
  assert.equal(store.all().length, 0, "the ledger already holds a single failure");
  assert.equal(out.observations.length, 1);
  assert.match(out.observations[0].why, /one session/);
  assert.equal(worthKeeping(seen({ for: 1 }), "candidate"), false);
});

test("three runs in one session are one confirmation, not three", () => {
  const one = gradeOf(seen({ for: 1, runs: 3, sessions: ["a@1"] }), null, "abc");
  assert.equal(one.state, "candidate");
  const three = gradeOf(seen({ for: 3, runs: 3 }), null, "abc");
  assert.equal(three.state, "validated");
});

// Repeating an analysis over the same evidence must not make a second lesson.
test("running twice over the same evidence leaves one lesson, with the same id", () => {
  const store = fakeLessons();
  promote(store, [seen()], { head: "abc", now: () => "2026-09-20T00:00:00.000Z" });
  const first = store.all()[0];
  promote(store, [seen({ confirmed: "2026-09-21T00:00:00.000Z" })], { head: "abc", now: () => "2026-09-21T00:00:00.000Z" });
  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].id, first.id);
  assert.equal(store.all()[0].firstSeen, first.firstSeen, "the first sighting must not reset every run");
});

// "No longer observed" and "proven false" are different claims and must never
// collapse into one state.
test("contradicting evidence demotes; the frontend moving on only makes it stale", () => {
  assert.equal(gradeOf(seen({ against: 1 }), null, "abc").state, "candidate");
  const rejected = gradeOf(seen({ for: 2, against: 2 }), null, "abc");
  assert.equal(rejected.state, "rejected");
  assert.match(rejected.because, /contradicted, not merely unobserved/);

  const stale = gradeOf(seen({ fe_commit: "abc" }), null, "def5678");
  assert.equal(stale.state, "stale");
  assert.match(stale.because, /Not observed lately is not the same as false/);
});

// Two copies of one note must not let the same remark vote twice.
test("notes appear in the reason but never move the ladder", () => {
  const without = gradeOf(seen({ notes: 0 }), null, "abc");
  const with2 = gradeOf(seen({ notes: 2 }), null, "abc");
  assert.equal(without.state, with2.state);
  assert.match(with2.because, /2 note\(s\)/);
  assert.equal(gradeOf(seen({ for: 1, notes: 9 }), null, "abc").state, "candidate", "notes cannot promote a single session");
});

test("forgetting stops the same lesson being derived again from the same history", () => {
  const store = fakeLessons();
  promote(store, [seen({ evidenceNotes: [], sessions: ["a@1", "b@2", "a@3"] })], { head: "abc" });
  const l = store.all()[0];
  store.addTombstone(tombstoneFor(l, { scope: "evidence" }));
  store.remove(l.id);

  assert.ok(tombstoneFor(l, {}).evh.length > 0, "the tombstone must actually cite something, or the subset test below is vacuous");
  const again = promote(store, [seen({ sessions: ["a@1", "b@2", "a@3"] })], { head: "abc" });
  assert.equal(store.all().length, 0, "it must not come back from the history it was forgotten over");
  assert.equal(again.suppressed.length, 1);
});

test("the same claim with new evidence is revived, and says so", () => {
  const store = fakeLessons();
  const l = lesson({ sessions: 3, evidence: { sessions: ["a@1", "b@2"], notes: [] } });
  store.addTombstone(tombstoneFor(l, { scope: "evidence" }));

  const grown = { ...seen(), sessions: ["a@1", "b@2", "c@9"] };
  const out = promote(store, [grown], { head: "abc" });
  assert.equal(out.revived.length, 1);
  assert.match(out.revived[0].why, /1 more time/);
  assert.equal(store.all().length, 1);
});

test("forget --forever suppresses on the claim alone, whatever happens next", () => {
  const l = lesson({ sessions: 3, evidence: { sessions: ["a@1"], notes: [] } });
  const tomb = { ...tombstoneFor(l, { scope: "always" }), at: "2026-09-18T00:00:00.000Z" };
  const grown = { ...l, evidence: { sessions: ["a@1", "b@2", "c@3"], notes: [] } };
  assert.equal(suppressed(grown, [tomb]).yes, true);
});

// A tombstone has to recognise the lesson without keeping what it said.
test("a tombstone keeps no word of what was deleted", () => {
  const l = lesson({ statement: "the Add dialog is present before it is usable", applies: ["frontend abc1234"], evidence: { sessions: ["laptop-b@2026-09-01"], notes: ["home-add--animates.md"] } });
  const text = JSON.stringify(tombstoneFor(l, { scope: "evidence" }));
  for (const word of ["dialog", "usable", "present", "abc1234", "laptop-b", "animates"]) {
    assert.ok(!text.includes(word), `the tombstone leaked "${word}"`);
  }
  assert.ok(text.includes(l.id), "the subject is the one thing it must keep, to suppress it");
});

test("a forgotten lesson stays rejected until strictly more sessions support it", () => {
  const tomb = { id: lessonId(subject), fp: "x", evh: [], sessions: 3, at: "2026-09-18T00:00:00.000Z" };
  const prior = priorFrom([tomb], lessonId(subject));
  assert.equal(gradeOf(seen({ for: 3 }), prior, "abc").state, "rejected");
  assert.equal(gradeOf(seen({ for: 4 }), prior, "abc").state, "validated");
});

test("forget keeps no backup, so nothing on disk still holds the text", () => {
  const io = fakeIo();
  const store = createLessons("/store", io);
  store.save(lesson());
  store.save({ ...lesson(), statement: "changed" });
  const backup = join(storePaths("/store").lessons, "saw--failures--case-create-thing--step-2-click-home-add.md.bak");
  assert.ok(io.files.has(backup), "an ordinary save does keep one");

  store.remove(lesson().id);
  const left = [...io.files.keys()].filter((f) => f.includes("saw--failures"));
  assert.deepEqual(left, [], `forget left ${left.join(", ")}`);
});
