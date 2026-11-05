// The release policy as shipped (skills/orbit-release/ship/policy.json, ADR 0049) on its own: the one host it names; the
// paths it protects; its limits; and the release artifact read from a real `git archive` -- what a host refuses, asked
// of the archive itself, and a content digest that two archives of one tree share. The policy held to the benchmark's
// own suites, both ways, reads benchmark/suites/ and is test/benchmark-release-policy.test.mjs: a subject the benchmark
// freezes without its harness (`doctor --preflight`) carries none of it, and nothing here reads benchmark/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ARCHIVE_RULES, contentDigest, entriesOf } from "../skills/orbit-release/ship/artifact.mjs";
import { limitsOf, matchesAny, policyOf } from "../skills/orbit-release/ship/policy.mjs";
import { GIT_ENV } from "./fakes/ship-world.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const POLICY = policyOf(readFileSync(join(ROOT, "skills", "orbit-release", "ship", "policy.json"), "utf8"));

test("Claude Code is the one coding host a release needs; no other host is named", () => {
  assert.deepEqual([POLICY.host.cli, POLICY.host.basis, POLICY.host.endpoints], ["claude-code", "coding-host", ["api.anthropic.com"]]);
  assert.doesNotMatch(readFileSync(join(ROOT, "skills", "orbit-release", "ship", "policy.json"), "utf8"), /grok|codex|antigravity|agy/i);
  assert.deepEqual(POLICY.optional, ["native host acceptance", "native backend acceptance"]);
});

test("no repair may touch what judges it: the harness, the checks, the release itself, the pipelines", () => {
  for (const p of ["benchmark/lib/source/judge.mjs", "benchmark/suites/orbit-source/orbit-src-002/verifier/spec.mjs", "test/benchmark-cases.test.mjs", "skills/orbit-release/ship/policy.json", "skills/orbit-release/gates.mjs", ".github/workflows/ci.yml", "acceptance/truth.json", "docs/host-acceptance.json", "test/fakes/ship-world.mjs", "src/lint/five-lines.mjs", "cli/check-five-lines.mjs", "package.json"]) assert.ok(matchesAny(POLICY.protected, p), p);
  for (const p of ["src/improvement/oracle.mjs", "src/orchestration/failure.mjs", "test/improvement-core.test.mjs"]) assert.ok(!matchesAny(POLICY.protected, p), `${p} is a repair's to change`);
});

test("limits are the policy's, or a person's within its bounds -- never past them", () => {
  assert.deepEqual(limitsOf(POLICY, {}), POLICY.limits);
  assert.equal(limitsOf(POLICY, { usd: 50, minutes: undefined }).usd, 50);
  assert.throws(() => limitsOf(POLICY, { cycles: 99 }), /--cycles is 1\.\.6/);
  assert.throws(() => limitsOf(POLICY, { usd: Number.NaN }), /out of bounds/);
  assert.throws(() => policyOf(JSON.stringify({ ...POLICY, host: { cli: "grok", basis: "coding-host", endpoints: ["x"] } })), /claude-code/);
});

test("a limit out of bounds is refused by the flag a person typed, never by the policy's own key", () => {
  assert.throws(() => limitsOf(POLICY, { autonomousRetries: 9 }), (e) => /--retries is 0\.\.3/.test(e.message) && !/autonomousRetries/.test(e.message));
  assert.throws(() => limitsOf(POLICY, { repairAttempts: 9 }), (e) => /--attempts is 1\.\.5/.test(e.message) && !/repairAttempts/.test(e.message));
  assert.throws(() => limitsOf(POLICY, { minutes: 1, usd: 9999 }), /--minutes is 10\.\.10080, --usd is 0\.\.2000/);
});

// ---- the artifact ----------------------------------------------------------------------------------------------------------

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" });

function repoWith(t, files, links = {}) {
  const repo = mkdtempSync(join(tmpdir(), "orbit-artifact-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const [rel, target] of Object.entries(links)) symlinkSync(target, join(repo, rel));
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "one");
  return repo;
}

const archived = (repo, ref = "HEAD") => ((f) => (git(repo, "archive", "--format=zip", "-o", f, ref), readFileSync(f)))(join(repo, "..", `${repo.split(/[\\/]/).at(-1)}-${ref.replace(/\W/g, "")}.zip`));

const refused = (buf) => ARCHIVE_RULES.filter((r) => r.fails(entriesOf(buf))).map((r) => r.says.split(" -- ")[0]);

test("the release artifact is held to what a host refuses on the ARCHIVE: a symlink, a bin/, tooling export-ignore should keep out", (t) => {
  const FILES = { ".claude-plugin/plugin.json": "{}\n", "src/a.mjs": "export const a = 1;\n", ".gitattributes": "/benchmark/** export-ignore\n/link export-ignore\n", "benchmark/run.mjs": "// tooling\n" };
  const ok = repoWith(t, FILES, process.platform === "win32" ? {} : { link: "src/a.mjs" });
  assert.deepEqual(refused(archived(ok)), [], "export-ignore kept the tooling and the link out");
  assert.ok(entriesOf(archived(ok)).some((e) => e.name === ".claude-plugin/plugin.json"));
  const bad = repoWith(t, { ...FILES, ".gitattributes": "", "bin/orbit": "#!/bin/sh\n" }, process.platform === "win32" ? {} : { link: "src/a.mjs" });
  assert.deepEqual(refused(archived(bad)), ["a top-level bin/", ...(process.platform === "win32" ? [] : ["a symbolic link"]), "a file of development tooling that never ships (benchmark/, acceptance/, integrations/)"]);
  assert.deepEqual(refused(archived(repoWith(t, { "src/a.mjs": "1\n" }))), ["no .claude-plugin/plugin.json at the archive's root"]);
});

test("two archives of one tree share their content digest, whatever commit they came from; another tree does not", (t) => {
  const repo = repoWith(t, { ".claude-plugin/plugin.json": "{}\n", "src/a.mjs": "export const a = 1;\n" });
  const first = archived(repo);
  git(repo, "commit", "-q", "--allow-empty", "-m", "the same tree, another commit", "--date=2001-01-01T00:00:00");
  const second = archived(repo, "HEAD");
  assert.equal(contentDigest(second), contentDigest(first));
  writeFileSync(join(repo, "src", "a.mjs"), "export const a = 2;\n");
  git(repo, "commit", "-qam", "another tree");
  assert.notEqual(contentDigest(archived(repo, "HEAD")), contentDigest(first));
});
