import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DiffView, parseDiff } from "./DiffView";

const DIFF = ["diff --git a/sum.mjs b/sum.mjs", "index 1..2 100644", "--- a/sum.mjs", "+++ b/sum.mjs", "@@ -1,2 +1,2 @@", "-export const sum = (a, b) => a - b;", "+export const sum = (a, b) => a + b;", " // end", ""].join("\n");

describe("the diff view", () => {
  test("numbers each line as git's hunk header says", () => {
    const lines = parseDiff(DIFF);
    expect(lines.filter((l) => l.kind !== "meta").map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["hunk", null, null],
      ["del", 1, null],
      ["add", null, 1],
      ["ctx", 2, 2],
    ]);
  });

  test("shows added and removed lines with their code highlighted, and escapes it", () => {
    render(<DiffView diff={DIFF.replace("// end", "<script>alert(1)</script>")} language="javascript" />);
    const table = screen.getByRole("table", { name: "Diff" });
    expect(table.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    expect(table.querySelectorAll('[data-kind="del"]')).toHaveLength(1);
    expect(table.querySelector("script")).toBeNull();
    expect(table.textContent).toContain("a + b");
  });
});
