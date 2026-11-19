import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { SESSION_ID, orbitPanel } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { OrbitPanel } from "./OrbitPanel";

describe("the Orbit panel", () => {
  test("with no verdict from Orbit it says Unknown, never a pass", async () => {
    fakeApi().on("GET", `/api/sessions/${SESSION_ID}/verification`, () => orbitPanel());
    renderUi(<OrbitPanel sessionId={SESSION_ID} live={null} />);
    expect(await screen.findByLabelText("Orbit verdict")).toHaveTextContent("Unknown");
    expect(screen.getByText(/Claude finishing a run is not a verification/)).toBeInTheDocument();
  });

  test("shows the task, the checks and what blocks completion in Orbit's words", async () => {
    const panel = orbitPanel({
      association: { how: "session", taskId: "tsk-e17dcb29a49f" },
      task: { id: "tsk-e17dcb29a49f", objective: "Fix the addition", lifecycle: "VERIFYING", stage: "VERIFY", stopReason: null, attempt: 1, attemptLimit: 8, terminal: false, revision: 9, changedFiles: 1 },
      planWord: "SCOPED",
      checks: [{ id: "rt-command-00000003", purpose: "test", component: "root", declaredAs: "npm test", state: "passed" }],
      completion: [{ id: "REVIEWED", says: "the change has not been reviewed" }],
      approvals: [{ id: "apr-1", title: "Git push", boundary: "GIT_PUSH", state: "pending", risk: "high", destructive: false, expires: null }],
      sessionChecks: [{ at: "t", kind: "test", program: "node", ok: true }],
      verdict: { word: "unknown", label: "Unknown", source: "Orbit task tsk-e17dcb29a49f is VERIFYING: no verdict yet." },
    });
    fakeApi().on("GET", `/api/sessions/${SESSION_ID}/verification`, () => panel);
    renderUi(<OrbitPanel sessionId={SESSION_ID} live={null} />);
    expect(await screen.findByText("tsk-e17dcb29a49f")).toBeInTheDocument();
    expect(screen.getByText("VERIFYING")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText(/the change has not been reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/Orbit Web shows it and cannot grant it/)).toBeInTheDocument();
    expect(screen.getByLabelText("Orbit verdict")).toHaveTextContent("Unknown");
  });

  test("Verified only when Orbit says so", async () => {
    fakeApi().on("GET", `/api/sessions/${SESSION_ID}/verification`, () => orbitPanel({ verdict: { word: "verified", label: "Verified by Orbit", source: "task tsk-1 lifecycle = COMPLETED" } }));
    renderUi(<OrbitPanel sessionId={SESSION_ID} live={null} />);
    expect(await screen.findByLabelText("Orbit verdict")).toHaveTextContent("Verified by Orbit");
    expect(screen.getByText("task tsk-1 lifecycle = COMPLETED")).toBeInTheDocument();
  });
});
