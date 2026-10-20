// Every shipped SKILL.md and agent opens with frontmatter a host can parse (1.8.9, skills/orbit-release/frontmatter.mjs).
// A host that cannot parse one strips the whole block and ships the skill with no name, no description and no allowed
// tools -- 1.8.8's orbit-engineer, over one list item that lost its indent. The suite holds every file to
// it, and the ship gate asks the same question of the archive.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LINE_RULES, declaredFiles, frontmatterProblem, problems } from "../skills/orbit-release/frontmatter.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("every skill and agent this plugin ships has frontmatter a host can parse", () => {
  assert.ok(declaredFiles(ROOT).length >= 30, "every SKILL.md and every agent is read");
  assert.deepEqual(problems(ROOT), []);
});

const block = (...lines) => ["---", ...lines, "---", "", "# Body"].join("\n");

test("the 1.8.8 break is refused at its line: a list item at the margin", () => {
  const broken = block("name: orbit-x", "description: >", "  Does a thing.", "allowed-tools:", "  - Bash(node a.mjs*)", "- Bash(node b.mjs*)", "user-invocable: true");
  assert.equal(frontmatterProblem(broken), "line 7: it is at the margin and is not a key — an item of the list above it lost its indent");
  assert.equal(frontmatterProblem(broken.replace("- Bash(node b.mjs*)", "  - Bash(node b.mjs*)")), null, "indented, it is a list item again");
});

test("a file checked out with CRLF line ends is read as the same lines: Windows, or a consumer's repository", () => {
  assert.equal(frontmatterProblem("---\r\nname: a\r\ndescription: b\r\n---\r\n# a\r\n"), null);
  assert.match(frontmatterProblem("---\r\nname: a\r\n- loose\r\n---\r\n"), /^line 3: it is at the margin/);
});

test("each mistake that breaks a host's parse is named; what the shipped files do is allowed", () => {
  assert.match(frontmatterProblem("# no frontmatter"), /does not open with a --- line/);
  assert.match(frontmatterProblem("---\nname: x\n# never closed"), /never closed/);
  assert.match(frontmatterProblem(block("name: x", "allowed-tools:", "\t- Bash(x)")), /a tab indents it/);
  assert.match(frontmatterProblem(block("  name: x")), /indented under no key/);
  assert.match(frontmatterProblem(block("name: x", "argument-hint: do this: then that")), /quote the value/);
  assert.equal(frontmatterProblem(block("name: x", 'argument-hint: "do this: then that"')), null, "quoted, it is one value");
  assert.equal(frontmatterProblem(block("name: x", "description: >", "  A sentence: with a colon inside a folded block.", "", "  And a second paragraph.")), null);
  assert.equal(LINE_RULES.length, 4);
});

test("the ship gate runs the same check over the archive", () => {
  const gates = readFileSync(join(ROOT, "skills", "orbit-release", "gates.mjs"), "utf8");
  assert.match(gates, /every skill and agent opens with frontmatter a host can parse/);
  assert.match(gates, /skills\/orbit-release\/frontmatter\.mjs/);
});
