// REPOSITORY SAFETY for the release that introduced Satellite (0.1.1): everything it changed outside satellite/ is on
// the allow-list a person approved for it -- the skill and agents that make /orbit:satellite exist, their switches and
// routing rows, the release's version files (the two shipped packs carry the engine's version too), its documentation
// and the native backend acceptance it recorded (docs/backend-acceptance.json, written only by `acceptance/run.mjs
// --record`) -- and nothing else. Everything since the baseline is checked, committed or not, for as long as
// package.json says this is that release; a later release is not held to it. Skipped where the baseline is not in this
// clone's history (CI's shallow checkout).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const RELEASE = "0.1.1";

export const BASELINE = "2f13edcfc3672d742ac572282edc2e12e8a09856";

export const ALLOWED_FILES = new Set(["package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "plugin.json", ".codex-plugin/plugin.json", "catalog/components.json", "CHANGELOG.md", "README.md", "docs/agents/layout.md", "docs/agents/extend.md", "docs/hosts.md", "docs/orbit-current-contract.md", "hooks/hooks.json", "skills/orbit-api-test/extension.json", "skills/orbit-backend-test/extension.json", "docs/backend-acceptance.json"]);

export const ALLOWED_PATTERNS = [/^satellite\//, /^skills\/satellite\//, /^agents\/satellite-[a-z]+\.md$/, /^docs\/adr\/0041-[a-z0-9-]+\.md$/];

export const allowed = (path) => ALLOWED_FILES.has(path) || ALLOWED_PATTERNS.some((re) => re.test(path));

const git = (args) => spawnSync("git", args, { cwd: REPO, encoding: "utf8" });

const lines = (r) => (r.status === 0 ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : []);

// Everything that differs from the baseline now: every commit since it, what is staged or not, and what is untracked.
const changedSince = () => [...lines(git(["diff", "--name-only", BASELINE])), ...lines(git(["ls-files", "--others", "--exclude-standard"]))];

const thisRelease = () => JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version === RELEASE;

const baselineHere = () => git(["cat-file", "-e", `${BASELINE}^{commit}`]).status === 0;

const skipped = () => (!baselineHere() ? "the baseline commit is not in this clone's history" : !thisRelease() ? `a later release than ${RELEASE}: the release that introduced Satellite was held to this when it shipped` : false);

test("outside satellite/, the release that introduced Satellite changes only what was approved", { skip: skipped() }, () => {
  const changed = [...new Set(changedSince())];
  assert.ok(changed.some((p) => p.startsWith("satellite/")), "nothing under satellite/ changed — the check lost its subject");
  assert.deepEqual(changed.filter((p) => !allowed(p)), []);
});

test("the allow-list names what it allows, and refuses an engine file", () => {
  assert.equal(allowed("satellite/src/mission/loop.mjs"), true);
  assert.equal(allowed("agents/satellite-reader.md"), true);
  assert.equal(allowed("src/task/store.mjs"), false);
  assert.equal(allowed("hooks/live-pane.tsx"), false);
});
