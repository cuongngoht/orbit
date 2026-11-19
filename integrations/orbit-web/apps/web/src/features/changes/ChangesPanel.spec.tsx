import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { SESSION_ID } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { ChangesPanel } from "./ChangesPanel";

const REPORT = {
  sessionId: SESSION_ID,
  repository: "octo/sum-fixture",
  baseBranch: "main",
  workBranch: "orbit-web/0b6c2f5e",
  currentBranch: "orbit-web/0b6c2f5e",
  baseCommit: "a".repeat(40),
  headCommit: "a".repeat(40),
  upstream: null,
  files: [
    { path: "logo.png", oldPath: null, kind: "added", additions: null, deletions: null, binary: true },
    { path: "sum.mjs", oldPath: null, kind: "modified", additions: 1, deletions: 1, binary: false },
  ],
  totals: { files: 2, additions: 1, deletions: 1 },
  checkedAt: "2026-11-19T00:00:00.000Z",
};

describe("the changes panel", () => {
  test("lists the changed files git reported, with counts, and shows a file's diff", async () => {
    const api = fakeApi()
      .on("GET", `/api/sessions/${SESSION_ID}/changes`, () => REPORT)
      .on("GET", `/api/sessions/${SESSION_ID}/changes/file`, (_b, url) => ({ path: url.searchParams.get("path"), kind: "modified", binary: false, tooLarge: false, language: "javascript", diff: "@@ -1 +1 @@\n-export const sum = (a, b) => a - b;\n+export const sum = (a, b) => a + b;\n" }));
    renderUi(<ChangesPanel sessionId={SESSION_ID} version={0} />);
    expect(await screen.findByText(/2 files changed/)).toBeInTheDocument();
    expect(screen.getByText("orbit-web/0b6c2f5e from main")).toBeInTheDocument();
    expect(screen.getByText("binary")).toBeInTheDocument();
    await userEvent.click(screen.getByText("sum.mjs"));
    const table = await screen.findByRole("table", { name: "Diff" });
    expect(table.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    expect(api.calls.at(-1)?.path).toBe(`/api/sessions/${SESSION_ID}/changes/file?path=sum.mjs`);
  });

  test("a workspace still being prepared is said as such", async () => {
    const { withStatus } = await import("../../testing/fakeApi");
    fakeApi().on("GET", `/api/sessions/${SESSION_ID}/changes`, () => withStatus(409, { error: { code: "workspace_not_ready", message: "This session's workspace is not ready yet." } }));
    renderUi(<ChangesPanel sessionId={SESSION_ID} version={0} />);
    expect(await screen.findByText(/not ready yet/)).toBeInTheDocument();
  });
});
