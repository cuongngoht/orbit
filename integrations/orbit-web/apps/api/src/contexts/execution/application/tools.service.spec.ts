import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "../../shared/domain.js";
import { pathOf } from "./tools.service.js";

const refused = (v: unknown, writable: boolean): boolean => {
  try {
    pathOf(v, writable);
    return false;
  } catch (err) {
    return err instanceof DomainError && err.code === "bad_path";
  }
};

test("an employee's path stays inside its areas: read in /work, /output, /input, /toolbox, /team; write never in /input", () => {
  assert.equal(pathOf("/work/report.md", true), "/work/report.md");
  assert.equal(pathOf("/output/", true), "/output");
  assert.equal(pathOf("/input/source.pdf", false), "/input/source.pdf");
  assert.equal(refused("/input/source.pdf", true), true);
  assert.equal(pathOf("/toolbox/scripts/sum.py", true), "/toolbox/scripts/sum.py");
  assert.equal(pathOf("/team/notes.md", true), "/team/notes.md");
});

test("anything else is refused: above an area, another directory, a relative or empty path, a NUL, a lookalike prefix", () => {
  for (const p of ["/work/../etc/passwd", "/work/a/../../x", "/etc/passwd", "/", "", "work/x", "/data/connections/x", "/work\u0000/x", "/workspace/x", "/outputs/x", 42, null, `/work/${"a".repeat(1100)}`]) {
    assert.equal(refused(p, false), true, String(p));
  }
});
