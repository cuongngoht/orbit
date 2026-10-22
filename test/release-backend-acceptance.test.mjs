// The release gate for native BACKEND acceptance (skills/orbit-release/backend.mjs; PBI 21): a recorded run counts
// only when it was on this very source and matched every stack and variant the ground truth names; in a pipeline it
// is awaited, never failed, and a release is refused until it holds.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acceptanceOf, backendSourceDigest, expectedRuns } from "../skills/orbit-release/backend.mjs";
import { awaited } from "../skills/orbit-release/hosts.mjs";

const TRUTH = { stacks: { "stack-a": { variants: { correct: {}, broken: {} } }, "stack-b": { variants: { correct: {} } } } };
const runs = (matched = true) => expectedRuns(TRUTH).map((r) => ({ ...r, matched }));

test("every stack and variant the ground truth names is a run a release needs", () => {
  assert.deepEqual(expectedRuns(TRUTH), [{ stack: "stack-a", variant: "correct" }, { stack: "stack-a", variant: "broken" }, { stack: "stack-b", variant: "correct" }]);
});

test("a recorded run counts only on this very source, and only when it matched every run the truth names", () => {
  const expected = expectedRuns(TRUTH);
  assert.equal(acceptanceOf({ schema: 1, sourceDigest: "d", runs: runs() }, "d", expected).ok, true);
  assert.match(acceptanceOf(null, "d", expected).detail, /no acceptance run is recorded/);
  assert.match(acceptanceOf({ schema: 1, sourceDigest: "older", runs: runs() }, "d", expected).detail, /on another source/);
  const short = acceptanceOf({ schema: 1, sourceDigest: "d", runs: runs().slice(0, 2) }, "d", expected);
  assert.deepEqual([short.ok, /stack-b correct/.test(short.detail)], [false, true]);
  assert.equal(acceptanceOf({ schema: 1, sourceDigest: "d", runs: runs(false) }, "d", expected).ok, false, "a run that did not match is no acceptance");
});

test("in a pipeline the record is awaited, never failed; a release still needs it", () => {
  const row = acceptanceOf(null, "d", expectedRuns(TRUTH));
  assert.deepEqual([awaited(row, true).ok, awaited(row, true).pending, awaited(row, false).ok], [true, true, false]);
});

test("the source digest is the engine's and the acceptance's, the same on any checkout's line ends", () => {
  const a = mkdtempSync(join(tmpdir(), "orbit-backend-src-"));
  const b = mkdtempSync(join(tmpdir(), "orbit-backend-src-"));
  for (const [root, eol] of [[a, "\n"], [b, "\r\n"]]) {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "acceptance"), { recursive: true });
    writeFileSync(join(root, "src", "x.mjs"), `export const x = 1;${eol}`);
    writeFileSync(join(root, "acceptance", "truth.json"), `{}${eol}`);
    writeFileSync(join(root, "package.json"), `{"version":"0.1.0"}${eol}`);
  }
  assert.equal(backendSourceDigest(a), backendSourceDigest(b));
  writeFileSync(join(b, "acceptance", "truth.json"), "{\"changed\":true}\n");
  assert.notEqual(backendSourceDigest(a), backendSourceDigest(b), "a change to the acceptance is a change the acceptance must see again");
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});
