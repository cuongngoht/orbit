// Where a model-carried benchmark run happens (0.5.0 backlog B8): in a Claude Code cloud session a person starts, and
// never in GitHub Actions. No workflow runs the autonomous ship or a real coding host, and none is handed a coding
// host's credential; the pipelines keep what needs no credential -- the fast tier (`ship.mjs --ci`) and the benchmark's
// conformance tier (its `controls` and `scripted` jobs).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");

// A workflow as it runs: its comments, which may say anything, left out.
const text = (name) => readFileSync(join(WORKFLOWS, name), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

// A workflow's top-level jobs, read by their indentation: two spaces under `jobs:`.
const jobsOf = (yml) => (yml.split(/^jobs:\s*$/m)[1] ?? "").split("\n").map((l) => /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l)?.[1]).filter(Boolean);

test("no workflow runs the autonomous ship or a real coding host: model-carried runs happen in a Claude Code cloud session", () => {
  assert.equal(existsSync(join(WORKFLOWS, "release.yml")), false, "release.yml ran the autonomous ship in GitHub Actions");
  for (const name of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    assert.doesNotMatch(text(name), /secrets\.(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN)/, `${name} hands a coding host's credential to a job`);
    assert.doesNotMatch(text(name), /node skills\/orbit-release\/ship\.mjs(?! --ci)/, `${name} runs the ship beyond its fast tier`);
  }
});

// 0.5.0 (B6's review): orbit-qa's controls -- whole runs carried by its scripted hosts in the controller's own process,
// no model and no credential -- were the one suite the conformance tier never ran. Every suite is in it now, and a suite
// whose controls run the QA worker has its job build that image.
test("the conformance tier's controls matrix holds every suite the benchmark has, and the QA suite's job builds the QA worker its controls run in", () => {
  const yml = text("benchmark.yml");
  const suites = readdirSync(join(WORKFLOWS, "..", "..", "benchmark", "suites"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const matrix = (/^\s+suite: \[([^\]]+)\]/m.exec(yml)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(matrix, suites, "a suite left out of the matrix is a suite whose controls no pull request runs");
  assert.match(yml, /- suite: orbit-qa\n\s+images: --qa-worker/);
  assert.match(yml, /node benchmark\/run\.mjs build --verifier \$\{\{ matrix\.images \}\}/);
  assert.match(yml, /timeout-minutes: \$\{\{ matrix\.minutes \|\| 240 \}\}/);
});

test("the benchmark workflow keeps its conformance tier -- controls and scripted, no credential -- and nothing else", () => {
  const yml = text("benchmark.yml");
  assert.deepEqual(jobsOf(yml), ["controls", "scripted"]);
  assert.doesNotMatch(yml, /environment:\s*benchmark|--repair|inputs\.tier/, "no job reaches a credential, a repair or a tier only the autonomous job used");
  assert.match(text("ci.yml"), /node skills\/orbit-release\/ship\.mjs --ci/, "ship.mjs --ci stays the CI gate");
});
