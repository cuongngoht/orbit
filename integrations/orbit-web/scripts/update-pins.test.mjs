// THE IMAGE'S PINS, MOVED (scripts/update-pins.mjs): read from the Dockerfile as it is, moved only to what each
// publisher released -- GitHub CLI only with both archives' SHA-256 from its own checksums file -- and written back
// changing those lines alone. (The publishers here are fakes: no test asks a real one.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checksumOf, planPins, readPins, withPins } from "./update-pins.mjs";

const DOCKERFILE = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "docker", "Dockerfile"), "utf8");
const SUMS = (v) => [`${"a".repeat(64)}  gh_${v}_linux_amd64.tar.gz`, `${"b".repeat(64)}  gh_${v}_linux_arm64.tar.gz`, `${"c".repeat(64)}  gh_${v}_macOS_arm64.zip`].join("\n");
const fake = (over = {}) => async (url) => {
  const answers = {
    "https://registry.npmjs.org/@anthropic-ai/claude-code/latest": JSON.stringify({ version: "2.1.400" }),
    "https://registry.npmjs.org/@openai/codex/latest": JSON.stringify({ version: "0.169.0" }),
    "https://api.github.com/repos/cli/cli/releases/latest": JSON.stringify({ tag_name: "v2.95.0" }),
    "https://github.com/cli/cli/releases/download/v2.95.0/gh_2.95.0_checksums.txt": SUMS("2.95.0"),
    ...over,
  };
  if (!(url in answers)) throw new Error(`no answer for ${url}`);
  return answers[url];
};

test("the pins are read from the Dockerfile as it is", () => {
  const pins = readPins(DOCKERFILE);
  for (const name of ["CLAUDE_CODE_VERSION", "CODEX_VERSION", "GH_VERSION", "GH_SHA256_AMD64", "GH_SHA256_ARM64", "AZURE_CLI_VERSION", "AGY_VERSION"]) assert.ok(pins.has(name), name);
});

test("each moves only to what its publisher released; GitHub CLI with both archives' checksums; the same version moves nothing", async () => {
  const { changes, notes } = await planPins(readPins(DOCKERFILE), fake());
  assert.equal(changes.CLAUDE_CODE_VERSION, "2.1.400");
  assert.equal("CODEX_VERSION" in changes, false, "Codex is already at npm's newest");
  assert.deepEqual([changes.GH_VERSION, changes.GH_SHA256_AMD64, changes.GH_SHA256_ARM64], ["2.95.0", "a".repeat(64), "b".repeat(64)]);
  assert.ok(notes.some((n) => /Azure CLI/.test(n)) && notes.some((n) => /Antigravity/.test(n)) && notes.some((n) => /NODE_IMAGE/.test(n)), "what a person moves by hand is said");
});

test("a checksums file without an archive moves nothing of GitHub CLI, and says why; a publisher that fails is said too", async () => {
  const { changes, notes } = await planPins(readPins(DOCKERFILE), fake({ "https://github.com/cli/cli/releases/download/v2.95.0/gh_2.95.0_checksums.txt": SUMS("2.95.0").split("\n")[0], "https://registry.npmjs.org/@anthropic-ai/claude-code/latest": new Error("x") }));
  assert.equal("GH_VERSION" in changes, false);
  assert.ok(notes.some((n) => /GitHub CLI 2\.95\.0 not moved: .*linux_arm64/.test(n)), notes.join("\n"));
});

test("written back, only the moved lines change", () => {
  const moved = withPins(DOCKERFILE, { CLAUDE_CODE_VERSION: "2.1.400", GH_SHA256_AMD64: "a".repeat(64) });
  const before = DOCKERFILE.split("\n");
  const after = moved.split("\n");
  assert.equal(after.length, before.length);
  const differing = after.map((l, i) => (l === before[i] ? null : l)).filter((l) => l !== null);
  assert.deepEqual(differing, ["ARG CLAUDE_CODE_VERSION=2.1.400", `ARG GH_SHA256_AMD64=${"a".repeat(64)}`]);
  assert.equal(readPins(moved).get("CLAUDE_CODE_VERSION"), "2.1.400");
  assert.equal(checksumOf(SUMS("1.0.0"), "gh_1.0.0_linux_arm64.tar.gz"), "b".repeat(64));
  assert.equal(checksumOf(SUMS("1.0.0"), "gh_1.0.0_linux_s390x.tar.gz"), null);
});
