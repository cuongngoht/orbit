import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../testing/fakeApi";
import { authAccount, authUser, sessionSummary } from "../testing/fixtures";
import { renderUi } from "../testing/render";
import { RESEARCH_ID, researchSummary } from "../testing/researchFixtures";
import { Sidebar, type SidebarProps } from "./Sidebar";

const SHARED = "33333333-4444-4555-8666-777777777777";

function show(over: Partial<SidebarProps> = {}) {
  const p: SidebarProps = {
    sessions: [sessionSummary({ updatedAt: "2026-11-19T00:00:00.000Z" }), sessionSummary({ id: SHARED, title: "Alice's fix", access: "shared", owner: "alice@example.com", updatedAt: "2026-11-18T00:00:00.000Z" })],
    research: [researchSummary({ updatedAt: "2026-11-20T00:00:00.000Z" })],
    loading: false,
    selected: null,
    collapsed: false,
    user: authUser(),
    account: authAccount(),
    signingOut: false,
    onToggle: vi.fn(),
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onCustomize: vi.fn(),
    onSettings: vi.fn(),
    onSignOut: vi.fn(),
    onRenamed: vi.fn(),
    onDeleted: vi.fn(),
    onResearchRenamed: vi.fn(),
    onResearchDeleted: vi.fn(),
    ...over,
  };
  renderUi(<Sidebar {...p} />);
  return p;
}

describe("research sessions in the sidebar", () => {
  test("listed beside the chats, newest first, said to be research; one shared with this account is marked", async () => {
    fakeApi();
    const p = show();
    const list = screen.getByRole("list", { name: "Chats" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Egress research"), expect.stringContaining("Fix sum"), expect.stringContaining("Alice's fix")]);
    await userEvent.click(within(list).getByRole("button", { name: /^Egress research \(research\)/ }));
    expect(p.onOpen).toHaveBeenCalledWith(RESEARCH_ID);
    expect(within(list).getByRole("img", { name: "Shared with you by alice@example.com" })).toBeInTheDocument();
  });

  test("filtered by kind: all, chats only, research only", async () => {
    fakeApi();
    show();
    const list = screen.getByRole("list", { name: "Chats" });
    await userEvent.click(screen.getByRole("tab", { name: "Research" }));
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Egress research")]);
    await userEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  test("renaming and deleting one go to research's own routes; deleting keeps the workspace's sources", async () => {
    const a = fakeApi()
      .on("PATCH", `/api/research/sessions/${RESEARCH_ID}`, () => researchSummary({ title: "Egress, renamed" }))
      .on("DELETE", `/api/research/sessions/${RESEARCH_ID}`, () => undefined);
    const p = show();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Egress research" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("dialog", { name: "Rename research session" })).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Title" });
    await userEvent.clear(box);
    await userEvent.type(box, "Egress, renamed{Enter}");
    await waitFor(() => expect(p.onResearchRenamed).toHaveBeenCalledWith(expect.objectContaining({ title: "Egress, renamed" })));
    expect(a.calls.find((c) => c.method === "PATCH")?.path).toBe(`/api/research/sessions/${RESEARCH_ID}`);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Egress research" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/keeps its sources, notes and findings/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(p.onResearchDeleted).toHaveBeenCalledWith(RESEARCH_ID));
    expect(p.onDeleted).not.toHaveBeenCalled();
  });
});
