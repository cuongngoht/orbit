import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { renderUi } from "../../testing/render";
import { NewChat } from "./NewChat";

const REPOS = {
  repositories: [
    { fullName: "octo/sum-fixture", owner: "octo", name: "sum-fixture", private: true, defaultBranch: "main", updatedAt: null, archived: false, fork: false },
    { fullName: "acme/tools", owner: "acme", name: "tools", private: false, defaultBranch: "trunk", updatedAt: null, archived: false, fork: false },
  ],
  fetchedAt: "2026-11-19T00:00:00.000Z",
  partial: false,
};

// The repository list's own options (the model and branch pickers hold <option>s too).
const repoOptions = async () => within(await screen.findByRole("listbox", { name: "Repositories" })).findAllByRole("option");

const BRANCHES = { repository: "octo/sum-fixture", branches: [{ name: "main", protected: true, commit: null, isDefault: true }, { name: "dev", protected: false, commit: null, isDefault: false }] };

describe("a new chat", () => {
  test("search narrows the repositories; choosing one loads its branches with the default first", async () => {
    fakeApi().on("GET", "/api/repositories", () => REPOS).on("GET", "/api/repositories/octo/sum-fixture/branches", () => BRANCHES);
    renderUi(<NewChat defaultModel="sonnet" onCreated={() => undefined} />);
    expect(await repoOptions()).toHaveLength(2);
    await userEvent.type(screen.getByLabelText("Search repositories"), "sum");
    const [only, ...rest] = await repoOptions();
    expect(rest).toHaveLength(0);
    expect(only?.textContent).toContain("Private");
    await userEvent.click(only as HTMLElement);
    await waitFor(() => expect(screen.getByLabelText("Branch")).toHaveValue("main"));
    expect(screen.getByLabelText("Branch").textContent).toContain("dev");
  });

  test("refresh reads the list again from GitHub CLI", async () => {
    const api = fakeApi().on("GET", "/api/repositories", () => REPOS);
    renderUi(<NewChat defaultModel="sonnet" onCreated={() => undefined} />);
    await repoOptions();
    await userEvent.click(screen.getByRole("button", { name: "Refresh the repository list" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/repositories?refresh=1")).toBe(true));
  });

  test("the chosen repository, branch, model and prompt create the session", async () => {
    const created = vi.fn();
    const api = fakeApi()
      .on("GET", "/api/repositories", () => REPOS)
      .on("GET", "/api/repositories/octo/sum-fixture/branches", () => BRANCHES)
      .on("POST", "/api/sessions", (body) => ({ id: "0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f", title: "Fix", repository: "octo/sum-fixture", branch: "dev", workBranch: null, model: "opus", status: "preparing", statusReason: null, createdAt: "", updatedAt: "", ...(body as object) }));
    renderUi(<NewChat defaultModel="sonnet" onCreated={created} />);
    await userEvent.click((await repoOptions())[0] as HTMLElement);
    await waitFor(() => expect(screen.getByLabelText("Branch")).toHaveValue("main"));
    await userEvent.selectOptions(screen.getByLabelText("Branch"), "dev");
    expect(screen.getByLabelText("Claude model")).toHaveValue("sonnet");
    await userEvent.selectOptions(screen.getByLabelText("Claude model"), "opus");
    await userEvent.type(screen.getByLabelText("Message"), "Fix the addition{Enter}");
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ repository: "octo/sum-fixture", branch: "dev", model: "opus", prompt: "Fix the addition" });
  });

  test("a GitHub CLI error is shown as it was said", async () => {
    fakeApi().on("GET", "/api/repositories", () => withStatus(502, { error: { code: "github_unavailable", message: "GitHub CLI could not list repositories: exited with code 1" } }));
    renderUi(<NewChat defaultModel="sonnet" onCreated={() => undefined} />);
    expect(await screen.findByText(/GitHub CLI could not list repositories/)).toBeInTheDocument();
  });
});
