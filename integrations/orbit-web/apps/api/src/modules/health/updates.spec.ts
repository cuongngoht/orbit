// WHETHER A NEWER RELEASE EXISTS, as each publisher says it: the version here against the publisher's newest, a
// security release where the publisher marks one, and -- when a publisher cannot be asked -- "unknown" with why, never
// "up to date". What nothing here reads is "not checked", saying why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUpdates, compareVersions, type FetchJson } from "./updates.js";

const INSTALLED = { claude: "2.1.328", codex: "0.169.0", gh: "2.89.0", az: "2.91.0", node: "24.22.3", orbit: "0.6.0", agy: "1.5.14", git: "2.39.5", python: "3.15.2" };

const answers: Record<string, unknown> = {
  "https://registry.npmjs.org/@anthropic-ai/claude-code/latest": { version: "2.1.341" },
  "https://registry.npmjs.org/@openai/codex/latest": { version: "0.169.0" },
  "https://api.github.com/repos/cli/cli/releases/latest": { tag_name: "v2.90.1" },
  "https://pypi.org/pypi/azure-cli/json": { info: { version: "2.91.0" } },
  // Newest first, as nodejs.org lists them; an older major is not this one's line.
  "https://nodejs.org/dist/index.json": [
    { version: "v25.1.0", security: true },
    { version: "v24.23.1", security: false },
    { version: "v24.23.0", security: true },
    { version: "v24.22.3", security: false },
  ],
};
const feed =
  (over: Record<string, unknown | Error> = {}): FetchJson =>
  (url) => {
    const a = url in over ? over[url] : answers[url];
    if (a instanceof Error) return Promise.reject(a);
    if (a === undefined) return Promise.reject(new Error(`no answer for ${url}`));
    return Promise.resolve(a);
  };
const byName = (list: Awaited<ReturnType<typeof checkUpdates>>) => Object.fromEntries(list.map((c) => [c.component, c]));

test("versions compare as numbers, part by part; a leading v is the version's, anything that is not one is no answer", () => {
  assert.equal(compareVersions("2.1.328", "2.1.341"), -1);
  assert.equal(compareVersions("v2.90.1", "2.89.0"), 1);
  assert.equal(compareVersions("24.22.3", "24.22.3"), 0);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("latest", "1.0.0"), null);
});

test("each publisher's newest against what is here: newer is an update, the same is up to date", async () => {
  const c = byName(await checkUpdates(INSTALLED, feed()));
  assert.deepEqual([c.claude?.state, c.claude?.latest], ["update_available", "2.1.341"]);
  assert.deepEqual([c.codex?.state, c.codex?.latest], ["up_to_date", "0.169.0"]);
  assert.deepEqual([c.gh?.state, c.gh?.latest], ["update_available", "2.90.1"]);
  assert.deepEqual([c.az?.state, c.az?.latest], ["up_to_date", "2.91.0"]);
});

test("Node.js: the newest of this major line, and whether a release since this one was a security release", async () => {
  const c = byName(await checkUpdates(INSTALLED, feed()));
  assert.deepEqual([c.node?.state, c.node?.latest, c.node?.security], ["update_available", "24.23.1", true]);
  const current = byName(await checkUpdates({ ...INSTALLED, node: "24.23.1" }, feed()));
  assert.deepEqual([current.node?.state, current.node?.security], ["up_to_date", false]);
});

test("a publisher that cannot be asked, or names no version, is unknown -- with why -- never up to date", async () => {
  const c = byName(await checkUpdates(INSTALLED, feed({ "https://registry.npmjs.org/@openai/codex/latest": new Error("HTTP 503"), "https://pypi.org/pypi/azure-cli/json": { info: {} } })));
  assert.deepEqual([c.codex?.state, c.codex?.latest], ["unknown", null]);
  assert.match(c.codex?.detail ?? "", /could not be asked: HTTP 503/);
  assert.equal(c.az?.state, "unknown");
  assert.match(c.az?.detail ?? "", /named no version/);
  const none = byName(await checkUpdates({ ...INSTALLED, az: null }, feed()));
  assert.deepEqual([none.az?.state, none.az?.detail], ["unknown", "Not in this image."]);
});

test("what nothing here reads is not checked, and says why; every component is said, in order", async () => {
  const list = await checkUpdates(INSTALLED, feed());
  assert.deepEqual(list.map((c) => c.component), ["claude", "codex", "gh", "az", "node", "orbit", "agy", "git", "python"]);
  const c = byName(list);
  for (const k of ["agy", "git", "python"]) {
    assert.equal(c[k]?.state, "not_checked", k);
    assert.ok((c[k]?.detail ?? "").length > 10, k);
  }
  assert.equal(c.orbit?.state, "unknown", "the Orbit plugin's publisher did not answer this fake");
});
