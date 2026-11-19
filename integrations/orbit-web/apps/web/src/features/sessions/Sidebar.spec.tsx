import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionSummary } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { SESSION_ID, sessionDetail } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { Sidebar } from "./Sidebar";

const OTHER = "11111111-2222-4333-8444-555555555555";
const sessions: SessionSummary[] = [sessionDetail({ status: "running" }), { ...sessionDetail({ id: OTHER, title: "Add API", status: "interrupted" }) }];

describe("the session list", () => {
  test("lists each chat with its repository and status, and opens one", async () => {
    fakeApi();
    const select = vi.fn();
    renderUi(<Sidebar sessions={sessions} selected={SESSION_ID} onSelect={select} onChanged={() => undefined} />);
    expect(screen.getByText("Fix sum")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Add API"));
    expect(select).toHaveBeenCalledWith(OTHER);
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(select).toHaveBeenLastCalledWith(null);
  });

  test("renames and deletes through the API", async () => {
    const changed = vi.fn();
    const api = fakeApi()
      .on("PATCH", `/api/sessions/${OTHER}`, (body) => ({ ...sessions[1], ...(body as object) }))
      .on("DELETE", `/api/sessions/${OTHER}`, () => undefined);
    renderUi(<Sidebar sessions={sessions} selected={null} onSelect={() => undefined} onChanged={changed} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Add API" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByLabelText("Title");
    await userEvent.clear(input);
    await userEvent.type(input, "Add the API");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "Add the API" }));
    await userEvent.click(screen.getByRole("button", { name: "Actions for Add API" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === `/api/sessions/${OTHER}`)).toBe(true));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
