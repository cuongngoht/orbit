import assert from "node:assert/strict";
import { test } from "node:test";
import { GATES, bump, report, shippable } from "../skills/orbit-release/gates.mjs";

// A runner that answers whatever the test wants, so the DECIDING half is tested
// without spawning five child processes per case.
const OK = {
  "--test": "# tests 124\n# pass 124\n# fail 0",
  "cli/check-five-lines.mjs": "0 finding(s): 0 error(s), 0 warning(s)",
  "cli/query.mjs": "\n3 screens, 5 controls, 2 traced effects, 3 cases",
  "cli/plan-check.mjs": "things  no errors, 5 advisory\n\n1 plan(s), 0 error(s), 5 advisory — advisories never change the exit code",
  "cli/schema.mjs": "{ the schema }",
  version: "1.0.0-beta 1.0.0-beta 1.0.0-beta 1.0.0-beta",
  archive: "ok",
  "skills/orbit-release/frontmatter.mjs": "ok",
  "test/no-compat-layer.test.mjs": "# tests 1\n# pass 1\n# fail 0",
};

// Two gates run `node -e`, so the fake answers what the inline script ASKS FOR
// rather than what argv[0] says: keyed on "-e", the archive gate was handed the
// version gate's answer and the fake called a sound repo unshippable.
const asked = (args) => {
  if (args[0] === "-e") return args[1].includes("existsSync") ? "archive" : "version";
  if (args[0] === "--test" && args[1]?.includes("no-compat-layer")) return "test/no-compat-layer.test.mjs";
  return args[0];
};

const runner = (over = {}, code = 0) => (args) => ({
  out: { ...OK, ...over }[asked(args)] ?? "",
  code: args[0] === "cli/query.mjs" ? code : 0,
  read: () => "{ the schema }",
});

test("every gate holds when the repo is in order", () => {
  const rows = report(runner(), GATES);
  assert.equal(rows.length, 10);
  assert.ok(shippable(rows), JSON.stringify(rows));
  assert.equal(rows[0].detail, "124 tests", "the count the definition of done asks to be reported");
  assert.match(rows[3].detail, /1 plan\(s\), 0 error\(s\)/, "the plans are part of done too");
  assert.equal(rows[6].version, "1.0.0-beta", "the VALUE, for the CLI");
  assert.match(rows[6].detail, /a prerelease, so nothing in it is a promise yet/, "the sentence, for the reader");
  assert.match(rows[7].detail, /no top-level bin\//, "the layout a host will accept");
  assert.match(rows[8].detail, /frontmatter shape a host parses/, "and every skill's frontmatter, which a host strips when it cannot parse it");
  assert.equal(rows[9].detail, "1 tests", "the no-compatibility-layer gate");
});

// Each gate has to be able to FAIL, or running them proves nothing -- which is
// the same mistake this whole release exists to remove.
test("each gate fails on its own kind of trouble, and one failure does not hide the rest", () => {
  const failing = (over, code) => report(runner(over, code), GATES).filter((r) => !r.ok);

  assert.deepEqual(failing({ "--test": "# tests 124\n# fail 3" }).map((r) => r.detail), ["3 of 124 failing"]);
  assert.deepEqual(failing({ "--test": "ran some tests" }).map((r) => r.detail), ["node --test printed no count"]);
  assert.match(failing({ "cli/check-five-lines.mjs": "warn x: 6 statements\n1 finding(s)" })[0].detail, /the lint reported findings/);
  assert.match(failing({ "cli/query.mjs": "dangling from: nowhere\n3 screens, 2 hard finding(s)" })[0].detail, /2 hard finding\(s\) — run query check/);
  assert.match(failing({ "cli/plan-check.mjs": "1 plan(s), 4 error(s), 0 advisory" })[0].detail, /4 error\(s\) — run node cli\/plan-check.mjs/);
  assert.deepEqual(failing({ "cli/schema.mjs": "{ something else }" }).map((r) => r.detail), ["stale — run node cli/schema.mjs --write", "stale — run node cli/schema.mjs --write"], "both generated schemas are gated");
  assert.match(failing({ version: "1.0.0-beta 1.2.0 1.0.0-beta" })[0].detail, /package 1.0.0-beta, plugin 1.2.0, marketplace 1.0.0-beta/);
  assert.match(failing({ archive: "a top-level bin/ is back — a host rejects the archive for it" })[0].detail, /top-level bin\//);
  assert.match(failing({ archive: "no .claude-plugin/plugin.json — nothing declares the plugin" })[0].detail, /nothing declares the plugin/);
  assert.match(failing({ "skills/orbit-release/frontmatter.mjs": "skills/x/SKILL.md: line 34: it is at the margin and is not a key" })[0].detail, /skills\/x\/SKILL\.md: line 34/);
  assert.deepEqual(failing({ "test/no-compat-layer.test.mjs": "# tests 1\n# fail 1" }).map((r) => r.detail), ["1 of 1 failing"]);
});

// The gate reads a COUNT, and the character in front of it is the runner's
// business: TAP says "# tests 140", Node 24's spec reporter says "ℹ tests 140".
// Reading one spelling only, the definition of done failed on a new Node with
// "printed no count" — about a suite that had just passed.
test("the suite gate reads the count from either reporter", () => {
  const spec = report(runner({ "--test": "ℹ tests 140\nℹ pass 139\nℹ fail 1" }), GATES);
  assert.equal(spec[0].detail, "1 of 140 failing");

  const tap = report(runner({ "--test": "# tests 140\n# pass 140\n# fail 0" }), GATES);
  assert.equal(tap[0].detail, "140 tests");
});

// The old bug this gate exists for: findings on stdout and an exit code of 0.
test("a clean report with a dirty exit code is still a failure", () => {
  const rows = report(runner({}, 1), GATES);
  assert.ok(!shippable(rows));
  assert.match(rows[2].detail, /run query check/);
});

test("a gate that throws is reported, not allowed to end the run", () => {
  const boom = () => { throw new Error("spawn ENOENT"); };
  const rows = report(boom, GATES);
  assert.equal(rows.length, 10, "all ten still report");
  assert.ok(rows.every((r) => !r.ok && r.detail === "spawn ENOENT"));
});

// Changing a published contract is major, adding to one is minor. Guessing is
// how a consuming repo receives a breaking change in a patch.
test("the bump a change earns comes from the repo rule, not from judgement", () => {
  assert.equal(bump("2.0.0", "changed"), "3.0.0");
  assert.equal(bump("1.2.0", "added"), "1.3.0");
  assert.equal(bump("1.2.3", "fixed"), "1.2.4");
  assert.equal(bump("1.2.3", "release"), "1.2.3", "a released version is already released");
});

// A prerelease publishes no contract, so there is nothing a change to it can
// break. Reading the rule the other way gave `1.0.0-beta` + fixed = "1.0.NaN",
// and + changed = "2.0.0" -- a major bump earned against a promise nobody made.
test("a change during a prerelease advances the prerelease, and release ends it", () => {
  for (const change of ["changed", "added", "fixed"]) assert.equal(bump("1.0.0-beta", change), "1.0.0-beta.2", change);
  assert.equal(bump("1.0.0-beta.2", "changed"), "1.0.0-beta.3");
  assert.equal(bump("1.0.0-rc.9", "fixed"), "1.0.0-rc.10", "and it counts, rather than appending");
  assert.equal(bump("1.0.0-beta", "release"), "1.0.0");
  assert.equal(bump("1.0.0-beta.7", "release"), "1.0.0");
  assert.doesNotMatch(bump("1.0.0-beta", "fixed"), /NaN/);
});

// The CLI is NOT spawned from here, and that is deliberate: ship.mjs runs
// `node --test`, so a test that spawns it would run the suite from inside the
// suite -- this file included. Node refuses the nested run, which is the only
// reason the first version of this test did not recurse forever. The deciding
// half is covered above with a fake runner; the CLI is a dozen lines that bind
// it to a real process, and it is exercised by running it:
//
//   node skills/orbit-release/ship.mjs --bump=added

// The gate is run on whatever OS the releaser is using, and git hands files
// back with that checkout's line endings. Comparing them byte for byte made the
// schema gate fail on every Windows clone -- a gate that reports the OS rather
// than the repo, which is worse than no gate.
test("the schema gate compares content, not line endings", () => {
  const crlf = (args) => ({ out: OK[asked(args)] ?? "", code: 0, read: () => "{ the schema }".replace(/\n/g, "\r\n") + "\r\n" });
  const rows = report(crlf, GATES);
  assert.ok(shippable(rows), JSON.stringify(rows.filter((r) => !r.ok)));
  assert.deepEqual([rows[4].detail, rows[5].detail], ["in sync", "in sync"], "both generated schemas, on a CRLF checkout");
});
