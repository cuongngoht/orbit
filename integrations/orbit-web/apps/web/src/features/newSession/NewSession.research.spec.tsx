import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { settings, sources } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { researchDetail, workspaceSummary, WORKSPACE_ID } from "../../testing/researchFixtures";
import { NewSession } from "./NewSession";

function show() {
  const onCreated = vi.fn();
  const onResearchCreated = vi.fn();
  renderUi(<NewSession settings={settings()} sources={sources()} onCreated={onCreated} onResearchCreated={onResearchCreated} onConnect={vi.fn()} />);
  return { onCreated, onResearchCreated };
}

describe("a new session is a chat or a research session", () => {
  test("a chat by default -- the coding composer as before -- and Research one choice away, needing no repository", async () => {
    fakeApi().on("GET", "/api/research/workspaces", () => []);
    show();
    expect(screen.getByRole("radio", { name: /Chat \/ Coding/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repository: none" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Research/ }));
    expect(screen.getByRole("heading", { name: "What do you want to research?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repository: none" })).toBeNull();
    expect(screen.getByRole("form", { name: "New research session" })).toBeInTheDocument();
    expect(screen.getByText(/sent to Claude \(Anthropic\) to answer/)).toBeInTheDocument();
  });

  test("a new workspace is made, then the session in it -- with the model, and a first question", async () => {
    const a = fakeApi()
      .on("GET", "/api/research/workspaces", () => [])
      .on("POST", "/api/research/workspaces", () => workspaceSummary())
      .on("POST", `/api/research/workspaces/${WORKSPACE_ID}/sessions`, () => researchDetail());
    const { onResearchCreated, onCreated } = show();
    await userEvent.click(screen.getByRole("radio", { name: /Research/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Workspace name/ }), "AI Governance Research");
    await userEvent.type(screen.getByRole("textbox", { name: /First question/ }), "What do these sources say about egress?");
    await userEvent.click(screen.getByRole("button", { name: "Start research" }));
    await waitFor(() => expect(onResearchCreated).toHaveBeenCalledWith(expect.objectContaining({ kind: "research" })));
    expect(a.calls.find((c) => c.method === "POST" && c.path === "/api/research/workspaces")?.body).toEqual({ name: "AI Governance Research", description: "" });
    expect(a.calls.find((c) => c.method === "POST" && c.path.endsWith("/sessions"))?.body).toEqual({ model: "sonnet", effort: "medium", question: "What do these sources say about egress?" });
    expect(onCreated).not.toHaveBeenCalled();
    expect(a.calls.some((c) => c.path.startsWith("/api/repositories") || c.path === "/api/sessions")).toBe(false);
  });

  test("an existing workspace is reused: no workspace is made, nothing is uploaded again", async () => {
    const a = fakeApi()
      .on("GET", "/api/research/workspaces", () => [workspaceSummary()])
      .on("POST", `/api/research/workspaces/${WORKSPACE_ID}/sessions`, () => researchDetail());
    const { onResearchCreated } = show();
    await userEvent.click(screen.getByRole("radio", { name: /Research/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Use an existing one" }));
    await userEvent.click(screen.getByRole("button", { name: "Start research" }));
    await waitFor(() => expect(onResearchCreated).toHaveBeenCalled());
    expect(a.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([`/api/research/workspaces/${WORKSPACE_ID}/sessions`]);
  });
});
