import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionSummary } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../testing/fakeApi";
import { SESSION_ID, authAccount, authUser, sessionSummary } from "../testing/fixtures";
import { renderUi } from "../testing/render";
import { Sidebar, type SidebarProps } from "./Sidebar";

const OTHER = "11111111-2222-4333-8444-555555555555";
const NO_REPO = "22222222-3333-4444-8555-666666666666";
const CHATS: SessionSummary[] = [
  sessionSummary({ status: "running" }),
  sessionSummary({ id: OTHER, title: "Add the API", source: "azure", repository: "contoso/Platform/api", status: "failed" }),
  sessionSummary({ id: NO_REPO, title: "Explain closures", source: null, repository: null, branch: null, workBranch: null, status: "completed" }),
];

function show(over: Partial<SidebarProps> = {}) {
  const p: SidebarProps = {
    sessions: CHATS,
    loading: false,
    selected: SESSION_ID,
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
    ...over,
  };
  renderUi(<Sidebar {...p} />);
  return p;
}

describe("the sidebar", () => {
  test("lists the chats, newest first as given, each with a dot while it works or when it failed; one opens on click", async () => {
    fakeApi();
    const p = show();
    const chats = screen.getByRole("list", { name: "Chats" });
    expect(within(chats).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Fix sum"), expect.stringContaining("Add the API"), expect.stringContaining("Explain closures")]);
    expect(within(chats).getByLabelText("working")).toBeInTheDocument();
    expect(within(chats).getByLabelText("failed")).toBeInTheDocument();
    expect(within(chats).getByRole("button", { name: /^Fix sum/ })).toHaveAttribute("aria-current", "page");
    expect(within(chats).getByRole("button", { name: /^Add the API/ })).toHaveAttribute("title", "Add the API — contoso/Platform/api");
    await userEvent.click(within(chats).getByRole("button", { name: /^Add the API/ }));
    expect(p.onOpen).toHaveBeenCalledWith(OTHER);
    await userEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(p.onNew).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(p.onCustomize).toHaveBeenCalled();
  });

  test("Search narrows the chats by title or repository; Escape ends it", async () => {
    fakeApi();
    show();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    const search = screen.getByRole("searchbox", { name: "Search chats" });
    await userEvent.type(search, "platform");
    const chats = screen.getByRole("list", { name: "Chats" });
    await waitFor(() => expect(within(chats).getAllByRole("listitem")).toHaveLength(1));
    expect(within(chats).getByText("Add the API")).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "nothing like this");
    expect(await within(chats).findByText("No chat matches.")).toBeInTheDocument();
    await userEvent.type(search, "{Escape}");
    expect(await screen.findByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(within(chats).getAllByRole("listitem")).toHaveLength(3);
  });

  test("renames and deletes a chat through the API, and says so to the page", async () => {
    const api = fakeApi()
      .on("PATCH", `/api/sessions/${OTHER}`, (body) => ({ ...CHATS[1], ...(body as object) }))
      .on("DELETE", `/api/sessions/${OTHER}`, () => undefined);
    const p = show();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Add the API" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByLabelText("Title");
    await userEvent.clear(input);
    await userEvent.type(input, "Add the REST API");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "Add the REST API" }));
    await waitFor(() => expect(p.onRenamed).toHaveBeenCalledWith(expect.objectContaining({ id: OTHER, title: "Add the REST API" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Actions for Add the API" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete “Add the API”?" });
    expect(confirm.textContent).toContain("Nothing was pushed from it.");
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === `/api/sessions/${OTHER}`)).toBe(true));
    expect(p.onDeleted).toHaveBeenCalledWith(OTHER);
  });

  test("the person signed in to Orbit at the bottom, by full name: Settings, Sign out", async () => {
    fakeApi();
    const p = show();
    const button = screen.getByRole("button", { name: "Signed in as Ann Owner" });
    expect(button.textContent).toContain("Ann Owner");
    await userEvent.click(button);
    expect(await screen.findByText("Signed in to Orbit")).toBeInTheDocument();
    expect(screen.getByText("@admin · Octo & Co")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Claude/);
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(p.onSettings).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Signed in as Ann Owner" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(p.onSignOut).toHaveBeenCalled();
  });

  test("folded, it keeps New session, Customize and the account, and opens again", async () => {
    fakeApi();
    const p = show({ collapsed: true });
    expect(screen.queryByRole("list", { name: "Chats" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(p.onNew).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Customize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signed in as Ann Owner" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open the sidebar" }));
    expect(p.onToggle).toHaveBeenCalled();
  });

  test("the Office entry opens the office and is the current page while it is open", async () => {
    fakeApi();
    const onOffice = vi.fn();
    show({ onOffice, office: true, selected: null });
    const office = screen.getByRole("button", { name: "Office" });
    expect(office).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "New session" })).not.toHaveAttribute("aria-current");
    await userEvent.click(office);
    expect(onOffice).toHaveBeenCalled();
  });

  test("no chats yet, and while signing out the account cannot be used twice", () => {
    fakeApi();
    show({ sessions: [], selected: null, signingOut: true });
    expect(screen.getByText("No chats yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signed in as Ann Owner" })).toBeDisabled();
  });
});
