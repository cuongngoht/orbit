// How autonomous a person lets Orbit be: two revisioned documents, written only through Orbit Control's door,
// narrowed machine → project with each effective value saying who set it, and a budget that never widens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realIo } from "../src/store/io.mjs";
import { AUTOMATION_DOOR, AUTOMATION_SETTINGS_INVALID, FIELDS, FIXED, defaultsOf, effectiveOf, narrowedBudget, readAutomation, settingsProblems, writeAutomation } from "../src/automation/settings.mjs";

const AT = "2026-10-08T10:00:00.000Z";
const PERSON = { revision: null, door: "control", at: AT };

function room(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-automation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("nothing kept reads as the defaults with no revision, and reading writes nothing", (t) => {
  const dir = room(t);
  const got = readAutomation(realIo(), join(dir, "automation", "settings.json"));
  assert.deepEqual(got.settings, defaultsOf());
  assert.equal(got.revision, null);
  assert.equal(got.exists, false);
  assert.deepEqual(readdirSync(dir), [], "a read creates no directory and no file");
});

test("the defaults are autonomous-first: nothing to turn on, and the skill factory safe-automatic", () => {
  const d = defaultsOf();
  assert.equal("enabled" in d, false);
  assert.equal("mode" in d, false);
  assert.equal("explicitHelp" in d.trigger, false);
  assert.equal(d.trigger.arbitraryPrompt, true, "the router may SAY a workflow fits; it never starts one");
  assert.equal(d.skillFactory.maxSkillsPerTask, 2);
  assert.equal("restrictions" in effectiveOf([]), false);
});

test("only Orbit Control's door writes: a terminal or an agent is refused and nothing is written", (t) => {
  const file = join(room(t), "settings.json");
  for (const door of [undefined, null, "terminal", "session"]) {
    assert.throws(() => writeAutomation(realIo(), file, { execution: { maxAttempts: 9 } }, { revision: null, door, at: AT }), (e) => e.code === AUTOMATION_DOOR);
  }
  assert.equal(existsSync(file), false);
});

test("a write names the revision it read; a stale one is refused and leaves the document as it was", (t) => {
  const file = join(room(t), "settings.json");
  const first = writeAutomation(realIo(), file, { execution: { maxAttempts: 3 } }, PERSON);
  assert.equal(first.settings.execution.maxAttempts, 3);
  assert.equal(first.settings.skillFactory.maxSkillsPerTask, 2, "an untouched field keeps its default");
  assert.match(first.revision, /^[0-9a-f]{16}$/);
  assert.throws(() => writeAutomation(realIo(), file, { execution: { maxAttempts: 5 } }, { ...PERSON, revision: "0000000000000000" }), (e) => e.code === "STALE_REVISION");
  assert.equal(readAutomation(realIo(), file).settings.execution.maxAttempts, 3);
  assert.equal(writeAutomation(realIo(), file, { execution: { maxAttempts: 5 } }, { ...PERSON, revision: first.revision }).settings.execution.maxAttempts, 5);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).updatedBy, "person");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).schema, 3);
});

test("a value out of range, a field nobody declared and a fixed field are refused, never clamped", (t) => {
  assert.equal(settingsProblems({ mode: "yolo" }).length, 1);
  assert.equal(settingsProblems({ skillFactory: { maxSkillsPerTask: 11 } }).length, 1);
  assert.equal(settingsProblems({ execution: { environment: "host" } }).length, 1);
  assert.equal(settingsProblems({ somewhere: true }).length, 1);
  for (const key of Object.keys(FIXED)) {
    const [a, b] = key.split(".");
    assert.match(settingsProblems({ [a]: { [b]: !FIXED[key] } })[0], /fixed/);
  }
  const file = join(room(t), "settings.json");
  assert.throws(() => writeAutomation(realIo(), file, { skillFactory: { allowExecutableCode: true } }, PERSON), (e) => e.code === AUTOMATION_SETTINGS_INVALID);
  assert.equal(existsSync(file), false);
});

test("a retired switch is no setting: writing one is refused even through Control's door, and nothing is written", (t) => {
  const file = join(room(t), "settings.json");
  for (const changes of [{ enabled: true }, { enabled: false }, { mode: "supervised" }, { trigger: { explicitHelp: false } }, { skillFactory: { mode: "suggest" } }]) {
    assert.throws(() => writeAutomation(realIo(), file, changes, PERSON), (e) => e.code === AUTOMATION_SETTINGS_INVALID, JSON.stringify(changes));
  }
  assert.equal(existsSync(file), false);
});

test("every field names a reader that exists and reads it — a setting nothing reads would lie", () => {
  for (const f of FIELDS) {
    const file = f.readBy.split(" ")[0];
    assert.ok(existsSync(file), `${f.path.join(".")} is read by ${file}, which does not exist`);
    assert.ok(readFileSync(file, "utf8").includes(f.token ?? f.path.at(-1)), `${file} never mentions ${f.path.join(".")}`);
  }
});

const doc = (by, content) => ({ by, content });



test("narrowing never widens: adding a document never makes any field looser than without it", () => {
  const machine = doc("machine", { skillFactory: { maxSkillsPerTask: 4 }, execution: { maxAttempts: 6, maxMinutes: 60 } });
  const projects = [{}, { live: { open: false } }, { skillFactory: { maxSkillsPerTask: 0 } }, { execution: { maxAttempts: 2, maxMinutes: 10 } }, { skillFactory: { maxSkillsPerTask: 9 } }];
  const alone = effectiveOf([machine]).fields;
  for (const p of projects) {
    const both = effectiveOf([machine, doc("project", p)]).fields;
    for (const f of FIELDS) {
      const k = f.path.join(".");
      const looser = { and: () => alone[k].value === false && both[k].value === true, min: () => alone[k].value !== null && both[k].value !== null && both[k].value > alone[k].value, order: () => f.values.indexOf(both[k].value) > f.values.indexOf(alone[k].value) }[f.narrow]();
      assert.equal(looser, false, `${JSON.stringify(p)} widened ${k}`);
    }
  }
});

test("a task's budget is what was asked, never above what the settings allow", () => {
  const values = effectiveOf([doc("machine", { execution: { maxAttempts: 4, maxActions: 50, maxMinutes: 30 } })]).values;
  assert.deepEqual(narrowedBudget(values, {}), { attempts: 4, actions: 50, minutes: 30 });
  assert.deepEqual(narrowedBudget(values, { attempts: 9, actions: 10, minutes: 300 }), { attempts: 4, actions: 10, minutes: 30 });
  assert.deepEqual(narrowedBudget(effectiveOf([]).values, { minutes: 15 }), { attempts: 4, actions: 100, minutes: 15 }, "no minute limit set: what was asked");
});
