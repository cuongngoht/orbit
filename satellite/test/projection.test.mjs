// THE PROJECTION: a journal written by hand (two agent runs open at once, and a nested action inside one of them),
// and the events it must name -- written out field by field (fixtures/two-runs.events.json), NOT computed by the code
// under test. Replaying the whole journal, following it line by line, and following it through Orbit Live's own
// follower in uneven windows must all name those events, at every cursor.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createFollower } from "../../src/store/follow.mjs";
import { FACTORY_WORDS, liveViewOf } from "../src/live/view.mjs";
import { SUMMARIZED } from "../src/live/render/plain.mjs";
import { FOLDED_KINDS } from "../src/mission/fold.mjs";
import { KIND_NAMES } from "../src/mission/vocab.mjs";
import { createProjection, eventsOf } from "../src/projection/fold.mjs";
import { EVENT_FIELDS } from "../src/projection/event.mjs";
import { journalLine } from "../src/store/line.mjs";
import { fakeIo } from "./fakes/io.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const JOURNAL = readFileSync(join(HERE, "fixtures", "two-runs.journal.jsonl"), "utf8");

const RECORDS = JOURNAL.split("\n").filter(Boolean).map(journalLine);

const EXPECTED = JSON.parse(readFileSync(join(HERE, "fixtures", "two-runs.events.json"), "utf8"));

const incremental = (records) => ((p) => records.map((r) => p.push(r)))(createProjection());

test("a whole replay names exactly the events written out by hand", () => {
  assert.deepEqual(eventsOf(RECORDS), EXPECTED);
});

test("at every cursor, replay and incremental projection agree with each other and with the hand-written events", () => {
  for (let k = 0; k <= RECORDS.length; k += 1) assert.deepEqual([eventsOf(RECORDS.slice(0, k)), incremental(RECORDS.slice(0, k))], [EXPECTED.slice(0, k), EXPECTED.slice(0, k)], `cursor ${k}`);
});

test("following the journal through Orbit Live's follower, in uneven windows, names the same events", () => {
  const io = fakeIo();
  const p = createProjection();
  const follower = createFollower(io, "/m/journal.jsonl", { parse: journalLine, keep: false });
  for (const cut of [0, 333, 1200, 1201, 2500, JOURNAL.length]) (io.files.set("/m/journal.jsonl", JOURNAL.slice(0, cut)), follower.pull().items.forEach((it) => p.push(it.record)));
  assert.deepEqual(p.events(), EXPECTED);
});

test("two runs keep their own modes, and a nested action's end gives the run its own mode back", () => {
  const modesAt = (k) => ((p) => (RECORDS.slice(0, k).forEach((r) => p.push(r)), liveViewOf(p.model(), p.events()).agents.map((a) => [a.id, a.mode])))(createProjection());
  assert.deepEqual(modesAt(13), [["arn-1", "DISPATCHING"], ["arn-2", "DIAGNOSING"]]);
  assert.deepEqual(modesAt(14), [["arn-1", "EXPLORING"], ["arn-2", "DIAGNOSING"]]);
  assert.deepEqual(modesAt(19), [["arn-1", null], ["arn-2", "DIAGNOSING"]]);
});

test("every event carries every field of the contract, and every journal kind is folded and said", () => {
  for (const e of EXPECTED) assert.deepEqual(Object.keys(e), EVENT_FIELDS);
  assert.deepEqual(KIND_NAMES.filter((k) => !FOLDED_KINDS.includes(k)), []);
  assert.deepEqual(KIND_NAMES.filter((k) => !SUMMARIZED.includes(k) && !FACTORY_WORDS[k]), []);
});
