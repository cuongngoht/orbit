// What a person SEES of a round: a board of who has reviewed, who is at work and what is left, derived
// from the round's own fold -- so the text, the quiet line and the JSON cannot disagree -- and made of
// task status only. A summary is a template filled with counts; no field carries a reasoning trace, a
// candidate's words or an escape sequence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldOf } from "../src/requirements/roundtable/model.mjs";
import { brief, eventsOf, headline, progressOf, render, say } from "../src/requirements/roundtable/progress.mjs";
import { ACTIVITIES, ACTORS, PROGRESS_FIELDS, STATE_NAMES } from "../src/requirements/roundtable/vocab.mjs";

const ROOT = "req-aaaaaaaaaaaa";
const reviewed = (sequence, perspective, count, over = {}) => ({ v: 1, kind: "reviewed", sequence, digest: "d1", perspective, outcome: "reviewed", candidates: Array.from({ length: count }, (_, i) => ({ id: `${perspective}-${i + 1}`, slots: [{ subject: "export", aspect: `a${i}` }], asks: "SENTINEL-CANDIDATE-WORDS?", blocking: false })), ...over });
const closed = (sequence, over = {}) => ({ v: 1, kind: "round-closed", sequence, digest: "d1", after: "d2", round: 1, pooled: 9, retained: 4, questions: [], asked: 3, settled: 1, failed: [], ...over });
const board = (lines, digest = "d1", stop = null, open = 0) => eventsOf({ root: ROOT, fold: foldOf(lines, digest), stop, open });
const states = (events) => Object.fromEntries(events.map((e) => [e.actor, e.state]));

test("a round that has begun: every perspective queued, the first one at work, and nothing else on the board", () => {
  const events = board([]);
  assert.deepEqual(states(events), { product: "working", domain: "queued", qa: "queued", socrates: "queued" });
  assert.equal(events[0].summary, "reviewing actor, goal and scope");
  assert.equal(events[0].activity, "reviewing-intent");
  assert.equal(events[1].summary, "");
});

test("a perspective that handed in is completed with how many it found; the next queued one is the one at work", () => {
  const events = board([reviewed(1, "product", 2), reviewed(2, "domain", 3)]);
  assert.deepEqual(states(events), { product: "completed", domain: "completed", qa: "working", socrates: "queued" });
  assert.deepEqual(events.slice(0, 2).map((e) => e.summary), ["2 candidate ambiguities", "3 candidate ambiguities"]);
  assert.equal(board([reviewed(1, "product", 1)])[0].summary, "1 candidate ambiguity");
});

test("a failed review is on the board as a failure, never as coverage, and the round goes on to the critic", () => {
  const events = board([reviewed(1, "product", 2), reviewed(2, "domain", 0, { outcome: "failed", candidates: [] }), reviewed(3, "qa", 1)]);
  assert.deepEqual(states(events), { product: "completed", domain: "failed", qa: "completed", socrates: "working" });
  assert.match(events[1].summary, /not counted as coverage/);
  assert.deepEqual([events[3].activity, events[3].total, events[3].summary], ["challenging-candidates", 3, "challenging 3 candidates"]);
});

test("a closed round shows every perspective's own count and what the critic kept, asked and found settled", () => {
  const lines = [reviewed(1, "product", 2), reviewed(2, "domain", 3), reviewed(3, "qa", 4), closed(4)];
  const events = board(lines, "d2", "waiting-human", 3);
  assert.deepEqual(states(events), { product: "completed", domain: "completed", qa: "completed", socrates: "completed", roundtable: "waiting-human" });
  assert.equal(events[3].summary, "9 candidates → 4 retained · 3 asked · 1 already settled");
  assert.deepEqual([events[4].summary, events[4].activity], ["Human decision required · 3 questions", "waiting-for-human"]);
});

test("a round with nothing to challenge skips the critic, and a round no reviewer could review says so", () => {
  const none = [reviewed(1, "product", 0), reviewed(2, "domain", 0), reviewed(3, "qa", 0), closed(4, { pooled: 0, retained: 0, asked: 0, settled: 0, after: "d1" })];
  const empty = board(none, "d1", "no-new-questions");
  assert.deepEqual([empty[3].state, empty[3].summary, empty[4].state], ["skipped", "no candidates to challenge", "completed"]);
  const dead = ["product", "domain", "qa"].map((p, i) => reviewed(i + 1, p, 0, { outcome: "failed", candidates: [] }));
  const failed = board([...dead, closed(4, { pooled: 0, retained: 0, asked: 0, settled: 0, failed: ["product", "domain", "qa"], after: "d1" })], "d1", "reviewer-failed");
  assert.deepEqual([failed.map((e) => e.state).slice(0, 3), failed.at(-1).state], [["failed", "failed", "failed"], "failed"]);
});

test("the round limit is the whole board: no round was begun, so nothing is queued", () => {
  const events = board([closed(1, { digest: "a", after: "b" }), closed(2, { digest: "b", after: "c" }), closed(3, { digest: "c", after: "d" })], "e", "round-limit");
  assert.deepEqual(events.map((e) => [e.actor, e.state]), [["roundtable", "skipped"]]);
  assert.match(events[0].summary, /limit of 3 rounds/);
});

test("every event is task status inside the declared fields, states and actors -- and a field nobody declared is dropped", () => {
  const events = board([reviewed(1, "product", 2)]);
  for (const e of events) {
    assert.deepEqual(Object.keys(e).filter((k) => !PROGRESS_FIELDS.includes(k)), []);
    assert.ok(STATE_NAMES.includes(e.state) && ACTORS.includes(e.actor));
    assert.ok(!e.activity || ACTIVITIES.includes(e.activity));
    assert.equal(e.type, "roundtable.progress");
  }
  assert.deepEqual(Object.keys(progressOf({ type: "roundtable.progress", actor: "qa", state: "working", reasoning: "step by step", transcript: "x" })).sort(), ["actor", "state", "type"]);
});

test("the board never carries a candidate's words, however it is rendered", () => {
  const lines = [reviewed(1, "product", 2), reviewed(2, "domain", 3), reviewed(3, "qa", 4), closed(4)];
  const everything = JSON.stringify(board(lines, "d2", "waiting-human", 3)) + render(board(lines, "d2", "waiting-human", 3)).join("\n");
  assert.equal(everything.includes("SENTINEL-CANDIDATE-WORDS"), false);
});

test("the text board: a glyph and a name, the status beneath, three dots only while somebody is at work", () => {
  const text = render(board([reviewed(1, "product", 2)])).join("\n");
  assert.equal(text, ["✓ Product", "  2 candidate ambiguities", "◐ Domain", "  reviewing rules and state transitions...", "○ QA", "○ Socrates"].join("\n"));
  assert.equal(/\u001b/.test(text), false, "no escape sequence: the board is append-only and works anywhere");
});

test("a whole document in words: the header, the board, the questions with suggestions marked as such, and the envelope last", () => {
  const events = board([reviewed(1, "product", 2), reviewed(2, "domain", 3), reviewed(3, "qa", 4), closed(4)], "d2", "waiting-human", 2);
  const doc = { root: ROOT, identity: { provider: "tracker", id: "4312" }, round: 1, stop: "waiting-human", next: null, events, questions: [{ id: "rq-aaaaaaaaaaaa", state: "open", blocking: true, asks: "Which users may export reports?", proposed: "Only users with export permission" }, { id: "rq-bbbbbbbbbbbb", state: "open", blocking: false, asks: "Does export respect the filters?" }] };
  const text = say(doc);
  assert.match(text, /^Requirement Roundtable · req-aaaaaaaaaaaa \(tracker 4312\) · Round 1\n\n✓ Product/);
  assert.match(text, /\? Human decision required · 2 questions/);
  assert.match(text, /rq-aaaaaaaaaaaa {2}BLOCKING {2}Which users may export reports\?\n {4}suggestion, not a decision: Only users with export permission/);
  assert.match(text, /rq-bbbbbbbbbbbb {12}Does export respect the filters\?/);
  assert.equal(say({ ...doc, envelope: { perspective: "qa" } }).split("\n").at(-1), 'ENVELOPE  {"perspective":"qa"}');
});

test("the quiet line is one line: where the round stands, and what to do next", () => {
  assert.equal(brief({ root: ROOT, round: 1, stop: "waiting-human", questions: [{}, {}, {}], events: [] }), `ROUNDTABLE  ${ROOT} round 1 · waiting-human · 3 question(s)`);
  assert.equal(brief({ root: ROOT, round: 2, stop: null, next: "domain", did: "product reviewed (2 candidates)", events: [] }), `ROUNDTABLE  ${ROOT} round 2 · product reviewed (2 candidates) · next domain`);
  assert.equal(brief({ root: ROOT, round: 1, stop: null, next: "product", events: [] }).includes("\n"), false);
  assert.match(headline({ root: ROOT, round: 3 }), /Round 3/);
});
