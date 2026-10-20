// What an investigation's journal says as live QA activity: an allow-list per kind, every kind choosing, and nothing
// a request's headers, a check's query or a structured field could leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY, activityOf, SILENT, unchosen } from "../src/investigation/activity.mjs";
import { begunAfter, investigationsOf, MAX_FOLLOWED, stampOf } from "../src/investigation/discover.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { KIND_NAMES, TEXT_LIMIT } from "../src/investigation/vocab.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realIo } from "../src/store/io.mjs";

const AT = "2026-10-08T09:00:00.000Z";

// One record per row that makes the row's `when` hold.
const SAMPLES = {
  observation: [
    { kind: "observation", id: "obs-1", action: "act-1", layer: "console", state: "observed", data: { errors: 2, messages: ["TypeError: x is undefined"] } },
    { kind: "observation", id: "obs-2", action: "act-1", layer: "network", state: "observed", data: { requests: [{ n: 21, method: "POST", endpoint: "/api/refund", status: 500, failed: false, durationMs: 41 }] } },
  ],
};

const sampleOf = (kind) => SAMPLES[kind] ?? [{ kind, id: "x-1", at: AT }];

test("every kind of the journal is a row or named SILENT, and every row is reachable", () => {
  assert.deepEqual(unchosen(), []);
  assert.deepEqual(SILENT.filter((k) => !KIND_NAMES.includes(k)), [], "SILENT names only real kinds");
  for (const kind of Object.keys(ACTIVITY)) {
    const events = sampleOf(kind).flatMap(activityOf);
    assert.equal(events.length, ACTIVITY[kind].length, kind);
    assert.ok(events.every((e) => e.kind.startsWith("qa.")), kind);
  }
  for (const kind of SILENT) assert.deepEqual(activityOf({ kind }), [], kind);
});

test("an undeclared field never reaches an event, and a nested object in a kept field is dropped", () => {
  const [step] = activityOf({ kind: "action", at: AT, id: "act-3", do: "click", on: "role=button[name=Confirm]", identity: { upn: "a@b.c" }, boundary: { mark: 4 }, secret: "x", url: { before: "/orders", after: "/orders/821" }, screenshot: "evidence/act-3.png", state: "done", ms: 133 });
  assert.deepEqual(step, { kind: "qa.step", at: AT, id: "act-3", do: "click", on: "role=button[name=Confirm]", state: "done", ms: 133, url: "/orders/821", screenshot: true });
  const [check] = activityOf({ kind: "check", id: "chk-1", query: "SELECT * FROM t WHERE token='abc'", input: { a: 1 }, state: "observed" });
  assert.ok(!("query" in check) && !("input" in check), "a check never shows its query or its input");
});

test("a failed request is its method, endpoint, status, failure and duration -- never a header, a body or a query", () => {
  const raw = { kind: "observation", id: "obs-9", action: "act-2", layer: "network", state: "observed", data: { requests: [
    { n: 7, method: "GET", endpoint: "/api/orders/{n}", status: 200 },
    { n: 8, method: "POST", endpoint: "/api/refund", status: 500, durationMs: 90, headers: { names: ["authorization"], values: { authorization: "Bearer abc" } }, response: { body: "x" }, queryFp: "ff", payload: { fp: "aa" } },
  ] } };
  const [network] = activityOf(raw);
  assert.deepEqual(network.requests, [{ n: 8, method: "POST", endpoint: "/api/refund", status: 500, failed: false, durationMs: 90 }]);
  assert.ok(!JSON.stringify(network).includes("Bearer"));
  assert.deepEqual(activityOf({ ...raw, data: { requests: [{ n: 1, method: "GET", endpoint: "/", status: 200 }] } }), [], "nothing failed is nothing to show");
  assert.deepEqual(activityOf({ kind: "observation", layer: "console", data: { errors: 0, messages: [] } }), [], "a console with no error is nothing to show");
});

test("text is bounded at TEXT_LIMIT, in a field and inside an array", () => {
  const long = "w".repeat(TEXT_LIMIT * 3);
  const [finding] = activityOf({ kind: "finding", id: "f-1", say: long });
  assert.equal(finding.say.length, TEXT_LIMIT);
  const [cons] = activityOf({ kind: "observation", layer: "console", data: { errors: 1, messages: [long, { nested: true }] } });
  assert.deepEqual(cons.messages.map((m) => m.length), [TEXT_LIMIT], "a string is cut, an object is dropped");
});

test("a run says its verdict, the layers it proved as numbers, and whether it has evidence -- never where", () => {
  const [run] = activityOf({ kind: "run", id: "run-1", case: "refund-flow", status: "FAIL", proved: { ui: 3, api: 1, sql: 0, note: "x" }, evidence: "/Users/x/.orbit/evidence/refund", cause: "PRODUCT_FAILURE" });
  assert.deepEqual([run.status, run.proved, run.evidence], ["FAIL", { ui: 3, api: 1, sql: 0 }, true]);
  assert.ok(!JSON.stringify(run).includes("/Users/"));
});

// ---- discovery ---------------------------------------------------------------------------------

const TASK = "tsk-0123456789ab";

// A real room on a real disk: discovery lists directories, which is what the disk answers.
function room(t, heads) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-discover-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const io = realIo({ now: () => AT });
  const store = createInvestigations(dir, io);
  for (const [id, head] of Object.entries(heads)) store.create({ id, objective: "look", mode: "observe", ...head });
  return { io, store };
}

test("discovery keeps the investigations begun against the task, after it began, newest first -- and reads each first line once", (t) => {
  const { io, store } = room(t, {
    "inv-20261008-090500-aaaa": { runtime: { environment: "env-0123456789ab", task: TASK, sourceTree: "a".repeat(40) } },
    "inv-20261008-091000-bbbb": { runtime: { environment: "env-0123456789ab", task: "tsk-ffffffffffff", sourceTree: "a".repeat(40) } },
    "inv-20261008-080000-cccc": { runtime: { environment: "env-0123456789ab", task: TASK, sourceTree: "a".repeat(40) } },
    "inv-20261008-092000-dddd": {},
  });
  const reads = [];
  const readFrom = io.readFrom;
  io.readFrom = (p, o, m) => (reads.push(p), readFrom(p, o, m));
  const known = new Map();
  const since = stampOf("2026-10-08T09:00:00.000Z");
  assert.deepEqual(investigationsOf(store, { task: TASK, since, known }), ["inv-20261008-090500-aaaa"]);
  assert.equal(reads.length, 3, "the one begun before the task is never opened");
  assert.deepEqual(investigationsOf(store, { task: TASK, since, known }), ["inv-20261008-090500-aaaa"]);
  assert.equal(reads.length, 3, "a first line is read once ever");
  assert.equal(begunAfter("inv-20261008-080000-cccc", since), false);
});

test("a receipt's id is claimed without a listing, still held to its first line, and the answer is bounded", (t) => {
  const heads = Object.fromEntries(Array.from({ length: MAX_FOLLOWED + 5 }, (_, i) => [`inv-20261008-09${String(i).padStart(2, "0")}00-${String(i).padStart(4, "0")}`, { runtime: { task: TASK } }]));
  const { store } = room(t, { ...heads, "inv-20261008-070000-eeee": { runtime: { task: TASK } }, "inv-20261008-070000-ffff": { runtime: { task: "tsk-ffffffffffff" } } });
  assert.deepEqual(investigationsOf(store, { task: TASK, since: null, claimed: ["inv-20261008-070000-eeee", "inv-20261008-070000-ffff", "../etc", "inv-20261008-070000-9999"] }), ["inv-20261008-070000-eeee"]);
  const found = investigationsOf(store, { task: TASK, since: stampOf(AT) });
  assert.equal(found.length, MAX_FOLLOWED);
  assert.deepEqual(found, [...found].sort().reverse(), "newest first");
});

test("1.8.6: a finding's live event says what was expected and what was observed -- strings, bounded; an object there is dropped", () => {
  const [finding] = activityOf({ kind: "finding", at: AT, id: "fnd-1", family: "duplicates", outcome: "CONFIRMED_DEFECT", confidence: "high", say: "two orders", expected: "1 record(s) for one action", actual: "x".repeat(TEXT_LIMIT + 50), evidence: { secret: "x" } });
  assert.equal(finding.kind, "qa.finding");
  assert.equal(finding.expected, "1 record(s) for one action");
  assert.ok(finding.actual.length <= TEXT_LIMIT, "bounded like every string of an event");
  assert.equal(finding.evidence, undefined, "a field the row does not name never reaches an event");
  const [nested] = activityOf({ kind: "finding", at: AT, id: "fnd-2", expected: { rows: 1 }, actual: ["a"] });
  assert.equal(nested.expected, undefined, "an object is dropped, never shown");
});
