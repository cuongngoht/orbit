// A project's report settings: every write names the revision it read, a stale
// one is refused, a credential is never a setting, and what a scope may name is
// the provider's to say. Plus the old standalone skill's config, taken once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { readSettings, revisionOf, setPath, writeSettings } from "../src/project-report/settings.mjs";
import { reportRoom } from "../src/project-report/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";

function room(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-settings-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return reportRoom(base);
}

const write = (r, next, revision = null, by = "orbit") => writeSettings(r, realIo(), { next, revision, by, providers: providers(), now: "2026-09-25T04:00:00Z" });

test("the first write needs no revision; every later one names the one it read, and a stale one is refused", (t) => {
  const r = room(t);
  assert.equal(readSettings(r, realIo()).exists, false);
  const first = write(r, { provider: "github", timezone: "Asia/Ho_Chi_Minh" });
  const read = readSettings(r, realIo());
  assert.equal(read.revision, first.revision);
  const second = write(r, { ...read.settings, period: { months: 3 } }, read.revision);
  assert.notEqual(second.revision, first.revision);
  assert.throws(() => write(r, { ...read.settings, sections: { "orbit.report.section.ai": false } }, read.revision), (e) => e instanceof Refused && /changed since they were read/.test(e.message));
  assert.equal(readSettings(r, realIo()).settings.period.months, 3, "the change somebody else made a minute ago is still there");
});

test("the revision is the content's: the same settings, spelled in another order, are the same revision", () => {
  assert.equal(revisionOf({ provider: "github", scope: { repositories: ["a/b"] } }), revisionOf({ scope: { repositories: ["a/b"] }, provider: "github", revision: "x", updatedAt: "y" }));
});

test("what a setting may say is checked -- a credential never, a scope by its provider, a zone by this machine", (t) => {
  const r = room(t);
  const cases = [
    [{ provider: "github", token: "x" }, /a credential is never a setting/],
    [{ provider: "gitlab" }, /provider must be one of github, azure-devops/],
    [{ provider: "github", scope: { project: "x" } }, /a github scope may name repositories/],
    [{ provider: "azure-devops", scope: { project: "https://dev.azure.com/acme/Portal" } }, /scope\.project: the project's NAME .* not its URL/],
    [{ timezone: "Mars/Olympus" }, /not a time zone this machine knows/],
    [{ period: { months: 0 } }, /1 to 60/],
    [{ output: { dir: "relative/dir" } }, /absolute path/],
    [{ mapping: { magic: 1 } }, /mapping may name/],
  ];
  for (const [next, says] of cases) assert.throws(() => write(r, next), says, JSON.stringify(next));
  assert.equal(write(r, { provider: "azure-devops", scope: { project: "Acme Portal 365" } }).scope.project, "Acme Portal 365", "a name with spaces is a name");
});

test("key=value onto the settings: JSON when it parses as JSON, else text", () => {
  const doc = setPath({ scope: {} }, "scope.repositories", '["acme/web"]');
  assert.deepEqual(doc.scope.repositories, ["acme/web"]);
  assert.equal(setPath({}, "timezone", "Asia/Ho_Chi_Minh").timezone, "Asia/Ho_Chi_Minh");
  assert.equal(setPath({}, "period.months", "3").period.months, 3);
});

