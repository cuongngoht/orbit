import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { validateAnalysis } from "../src/goal/analyze.mjs";
import { intakeFromText, persistIntake } from "../src/goal/intake.mjs";
import { normalizeSpec } from "../src/goal/spec.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { modelOf } from "../src/goal/model.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ctx = { project: "acme-web", checkout: "co-111111111111", session: "s-1", host: "test" };

test("intake accepts long multiline specification", () => {
  const text = "# Order Management\n\nAC1: create orders\nAC2: reject invalid\n".repeat(50);
  const intake = intakeFromText(ctx, text);
  assert.match(intake.id, /^goal-[0-9a-f]{12}$/);
  assert.ok(intake.title.length <= 240);
});

test("empty specification is refused", () => {
  assert.throws(() => normalizeSpec("   \n"), Refused);
});

test("analysis requires traceable acceptance criteria", () => {
  const digest = "abcd1234".repeat(8);
  assert.throws(() => validateAnalysis({ objective: "Build it", requirements: [], acceptance: [{ statement: "x", sourceRef: "bad" }] }, digest), Refused);
});

test("persisted goal survives read back", () => {
  const io = fakeIo();
  const goals = createGoals("/store/acme", io);
  const intake = intakeFromText(ctx, "Fix payment double charge\nExpected: one payment\n");
  persistIntake(goals, io, intake);
  const records = goals.read(intake.id);
  assert.equal(records[0].kind, "created");
  assert.equal(modelOf(records).meta.title, intake.title);
});

// A goal's journal is append-only like a task's: a line a killed process tore is dropped, and the next append ends it
// first, so every record written after it reads back.
test("a goal journal's torn last line is ended before the next record, which reads back", () => {
  const io = fakeIo();
  const goals = createGoals("/store/acme", io);
  const id = "goal-0123456789ab";
  goals.begin(id, { id, title: "t" });
  io.files.set(goals.journalFile(id), `${io.files.get(goals.journalFile(id))}{"at":"2026-10-06T21:04:00Z","kind":"spe`);
  assert.deepEqual(goals.read(id).map((l) => l.kind), ["created"], "the fragment is not a line");
  goals.append(id, "paused", { id, because: "a person stopped it" });
  assert.deepEqual(goals.read(id).map((l) => l.kind), ["created", "paused"]);
});

test("Vietnamese specification is stored verbatim", () => {
  const vi = "Người dùng có thể hủy đơn chưa thanh toán.\nAC1: Hủy thành công.";
  const intake = intakeFromText(ctx, vi);
  assert.match(intake.title, /Người dùng/);
});
