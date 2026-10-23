// THE STORE DOORS: the mission journal keeps only what a kind declares, scrubbed, stamped by the store's own clock,
// with a torn tail ended before the next line; a follower and a whole-file read number every line the same; a
// published definition is immutable, versioned by its content, read back with its digest checked, and never offered
// once a person revoked it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIo } from "./fakes/io.mjs";
import { createFollower } from "../../src/store/follow.mjs";
import { createJournal } from "../src/store/journal.mjs";
import { journalLine } from "../src/store/line.mjs";
import { digestOf, readDefinition, writeDefinition } from "../src/store/definitions.mjs";
import { indexOf } from "../src/store/registry.mjs";
import { readPolicy, writePolicy } from "../src/store/policy.mjs";
import { roomsOf } from "../src/store/rooms.mjs";
import { FREE_TEXT, KINDS } from "../src/mission/vocab.mjs";

const SPEC = { kinds: KINDS, freeText: FREE_TEXT, noun: "mission", busy: "busy" };

const journalIn = (io) => createJournal(io, "/store/satellite/missions/msn-000000000001", SPEC);

test("a line keeps only its kind's fields, scrubbed, one printable line, dated by the store", () => {
  const io = fakeIo({ now: () => "2026-10-22T00:00:00.000Z" });
  const line = journalIn(io).append("action.refused", { id: "act-1", rule: "X", say: "token=abc123secret\nnext", extra: "dropped", at: "1999-01-01" });
  assert.deepEqual(line, { at: "2026-10-22T00:00:00.000Z", id: "act-1", rule: "X", say: "token [redacted] next", kind: "action.refused" });
});

test("a kind nobody declared is refused, and a journal begins once", () => {
  const j = journalIn(fakeIo());
  assert.throws(() => j.append("action.teleported", {}), (e) => e.code === "KIND_UNKNOWN");
  j.begin("mission.created", { id: "msn-000000000001", schema: 1 });
  assert.throws(() => j.begin("mission.created", { id: "msn-000000000001" }), (e) => e.code === "ALREADY_EXISTS");
});

test("a torn tail is ended before the next line, and a follower numbers lines as the whole-file reader does", () => {
  const io = fakeIo();
  const j = journalIn(io);
  j.append("action.intended", { id: "act-1" });
  io.files.set(j.file, `${io.files.get(j.file)}{"torn`);
  j.append("action.intended", { id: "act-2" });
  const follower = createFollower(io, j.file, { parse: journalLine, keep: true });
  assert.deepEqual([j.read().map((r) => r.id), follower.pull().items.map((it) => [it.n, it.record.id])], [["act-1", "act-2"], [[0, "act-1"], [1, "act-2"]]]);
});

const ROOMS = roomsOf("/store");

const role = (extra = {}) => ({ id: "rol-logs-analyst", kind: "role", schemaVersion: 1, scope: "project", dependencies: [], compatibility: {}, content: { displayName: "LogsAnalyst", responsibilities: [{ activity: "analyze", subject: "logs" }], requestedPermissionProfile: "READ_ONLY", ...extra }, provenance: { by: "engine" } });

test("the same content is the version already there; new content is the next version; both read back intact", () => {
  const io = fakeIo();
  const first = writeDefinition(io, ROOMS, role());
  const again = writeDefinition(io, ROOMS, { ...role(), provenance: { by: "another mission" } });
  const next = writeDefinition(io, ROOMS, role({ purpose: "a sharper purpose" }));
  assert.deepEqual([first.reused, again.reused, again.pin, next.record.version], [false, true, first.pin, "1.0.1"]);
  assert.equal(readDefinition(io, ROOMS, first.pin).contentDigest, digestOf(role()));
});

test("a definition changed by hand is corrupt: never read back, never offered", () => {
  const io = fakeIo();
  const w = writeDefinition(io, ROOMS, role());
  const file = [...io.files.keys()].find((k) => k.endsWith(".json") && k.includes("rol-logs-analyst"));
  io.files.set(file, io.files.get(file).replace("LogsAnalyst", "Administrator"));
  assert.throws(() => readDefinition(io, ROOMS, w.pin), (e) => e.code === "DEFINITION_CORRUPT");
  assert.deepEqual(indexOf(io, ROOMS, "role", { revoked: [] }).map((r) => [r.corrupt, r.eligibility.offered]), [[true, false]]);
});

test("an older version is superseded but still readable by its pin; a revoked one is offered to nobody", () => {
  const io = fakeIo();
  const old = writeDefinition(io, ROOMS, role());
  writeDefinition(io, ROOMS, role({ purpose: "newer" }));
  const rows = indexOf(io, ROOMS, "role", { revoked: [{ ref: "rol-logs-analyst", because: "a person revoked it" }] });
  assert.deepEqual(rows.map((r) => [r.version, r.eligibility.superseded, r.eligibility.revoked, r.eligibility.offered]), [["1.0.0", true, true, false], ["1.0.1", false, true, false]]);
  assert.equal(readDefinition(io, ROOMS, old.pin).version, "1.0.0");
});

test("a person's policy is read with defaults, and a terminal can never write it", () => {
  const io = fakeIo();
  assert.equal(readPolicy(io, ROOMS.policyFile).limits.maxConcurrency, 3);
  assert.throws(() => writePolicy(io, ROOMS.policyFile, { limits: { maxConcurrency: 20 } }, { door: null }), (e) => e.code === "SATELLITE_PERSON_UNPROVEN");
  const w = writePolicy(io, ROOMS.policyFile, { limits: { maxConcurrency: 1 } }, { door: "control", at: "2026-10-22T00:00:00.000Z" });
  assert.equal(w.limits.maxConcurrency, 1);
  assert.throws(() => writePolicy(io, ROOMS.policyFile, { limits: { maxConcurrency: 2 } }, { door: "control", revision: "stale" }), (e) => e.code === "STALE_REVISION");
});
