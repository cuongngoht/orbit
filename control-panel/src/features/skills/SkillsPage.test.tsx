// The Skills pages, through the whole app: list, search, editor, guard, delete.
//
// .test.tsx on purpose: a bare `node --test` at the repository root collects
// *.test.ts on Node >= 23 and would try to run this outside Vitest.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { fakeServer, fakeSkill, skillMd } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { required } from "../../testing/required";

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  server = fakeServer();
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const listCalls = () => server.calls.filter((c) => c.method === "GET" && c.path === "/api/v1/skills").length;
const editor = async () => (await screen.findByRole("textbox", { name: /SKILL\.md/ })) as HTMLTextAreaElement;
const nav = () => screen.getByRole("navigation", { name: "Main navigation" });

describe("Skills list", () => {
  it("lists every skill the server reports, with its description and whether it is user invocable", async () => {
    renderApp("/skills");
    expect(await screen.findByRole("link", { name: "alpha" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "beta" })).toBeTruthy();
    expect(screen.getByText("The alpha skill.")).toBeTruthy();
    expect(screen.getAllByText("User-invocable")).toHaveLength(2);
  });

  it("searches name and description, and the URL remembers it", async () => {
    const router = renderApp("/skills");
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search skills" }), { target: { value: "beta" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: "alpha" })).toBeNull());
    expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
    expect(router.state.location.search).toBe("?q=beta");
  });

  it("a search that matches nothing says so and offers to clear it", async () => {
    renderApp("/skills?q=zzz");
    fireEvent.click(await screen.findByRole("button", { name: "Clear search and filter" }));
    expect(await screen.findByRole("link", { name: "alpha" })).toBeTruthy();
  });

  it("names each allowed tool, and what it is narrowed to, when the count is focused", async () => {
    renderApp("/skills");
    const [count] = await screen.findAllByText("2 allowed tools");
    fireEvent.focus(count);
    const tip = await screen.findByRole("tooltip");
    expect(within(tip).getByText("Read")).toBeTruthy();
    expect(within(tip).getByText("Bash")).toBeTruthy();
    expect(within(tip).getByText("only node x")).toBeTruthy();
  });

  it("filters by tab, with each tab's count", async () => {
    vi.stubGlobal("fetch", fakeServer([fakeSkill("alpha"), fakeSkill("quiet", { userInvocable: false })]).fetch);
    renderApp("/skills");
    fireEvent.click(await screen.findByRole("tab", { name: "Model-only (1)" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "alpha" })).toBeNull());
    expect(screen.getByRole("link", { name: "quiet" })).toBeTruthy();
  });
});

describe("Skill editor", () => {
  it("opens at /skills/:id with the whole SKILL.md, frontmatter included", async () => {
    const router = renderApp("/skills");
    fireEvent.click(await screen.findByRole("link", { name: "alpha" }));
    expect((await editor()).value).toBe(skillMd("alpha", "The alpha skill."));
    expect(router.state.location.pathname).toBe("/skills/alpha");
    expect(screen.getByRole("heading", { level: 1, name: /alpha/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves through PUT with the token and the revision it was edited on, then refreshes the list", async () => {
    renderApp("/skills/alpha");
    const box = await editor();
    const before = listCalls();
    fireEvent.change(box, { target: { value: skillMd("alpha", "Edited.") } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    const put = server.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/v1/skills/alpha");
    expect(put.body).toEqual({ content: skillMd("alpha", "Edited."), revision: "rev-1" });
    expect(put.headers[TOKEN_HEADER]).toBe("tok-123");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Edited.")).toBeTruthy();
    expect(listCalls()).toBeGreaterThan(before);
  });

  it("shows the server's validation problems and keeps what was typed", async () => {
    renderApp("/skills/alpha");
    const box = await editor();
    server.state.rejectNextSave = true;
    fireEvent.change(box, { target: { value: "---\nname: alpha\n---\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Not saved/)).toBeTruthy();
    expect(screen.getByText("the frontmatter has no description")).toBeTruthy();
    expect(box.value).toBe("---\nname: alpha\n---\n");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("leaving with unsaved changes asks first -- from the sidebar too -- and Keep editing stays", async () => {
    const router = renderApp("/skills/alpha");
    fireEvent.change(await editor(), { target: { value: "typed but never saved" } });
    fireEvent.click(within(nav()).getByRole("link", { name: /Analytics/ }));
    // Fluent marks a dialog aria-hidden while it settles which layer is modal: read it with hidden: true, and wait for
    // the button this test presses rather than the dialog around it (a slow runner draws the two a beat apart).
    const dialog = await screen.findByRole("alertdialog", { hidden: true });
    expect(await within(dialog).findByText("Leave without saving?")).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Keep editing", hidden: true }, { timeout: 5000 }));
    await waitFor(() => expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull());
    expect(router.state.location.pathname).toBe("/skills/alpha");
    expect((await editor()).value).toBe("typed but never saved");
  });

  it("Discard changes leaves without saving anything", async () => {
    const router = renderApp("/skills/alpha");
    fireEvent.change(await editor(), { target: { value: "typed but never saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Skills" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/skills");
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("Deleting a skill", () => {
  it("asks first, says the whole directory goes and a backup comes first, and Cancel deletes nothing", async () => {
    renderApp("/skills");
    fireEvent.click(await screen.findByRole("button", { name: "Delete alpha" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete alpha?")).toBeTruthy();
    expect(within(dialog).getByText(/removes the entire skill directory.*including the scripts, helpers and templates/)).toBeTruthy();
    expect(within(dialog).getByText("A backup will be created first.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(server.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("deletes on confirmation, then the refreshed list no longer has the skill and the backup is named", async () => {
    renderApp("/skills");
    fireEvent.click(await screen.findByRole("button", { name: "Delete alpha" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete skill" }));
    expect(await screen.findByText(/Deleted alpha\. Backup: 2026-09-23T10-15-30-123Z\/alpha/)).toBeTruthy();
    const del = server.calls.find((c) => c.method === "DELETE")!;
    expect(del.path).toBe("/api/v1/skills/alpha");
    expect(del.headers[TOKEN_HEADER]).toBe("tok-123");
    await waitFor(() => expect(screen.queryByRole("link", { name: "alpha" })).toBeNull());
    expect(screen.getByRole("link", { name: "beta" })).toBeTruthy();
  });

  it("without a token the page is read-only: nothing can be deleted or saved", async () => {
    window.sessionStorage.clear();
    renderApp("/skills");
    const deletes = (await screen.findAllByRole("button", { name: /^Read-only/ })) as HTMLButtonElement[];
    expect(deletes).toHaveLength(2);
    expect(deletes.every((b) => b.disabled)).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "alpha" }));
    expect((await editor()).readOnly).toBe(true);
    expect(screen.getByText(/has no mutation token/)).toBeTruthy();
  });
});

describe("Skill resources", () => {
  it("shows what a skill provides, requires and can use, and who resolves each -- derived, and a missing one said out loud", async () => {
    const { fakeResources } = await import("../../testing/fakeResources");
    const resources = fakeResources();
    server = fakeServer(undefined, resources.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp("/skills/alpha");
    const provides = await screen.findByRole("list", { name: "Provides" });
    expect(within(provides).getByText("development.implementation")).toBeTruthy();
    const requires = screen.getByRole("list", { name: "Requires" });
    expect(required(within(requires).getByText(/project\.context/).closest("li"), "the project.context need").textContent).toContain("→ project-context");
    expect(required(within(requires).getByText(/repository\.read/).closest("li"), "the repository.read need").textContent).toContain("Missing");
    const optional = screen.getByRole("list", { name: "Optional requirements" });
    expect(required(within(optional).getByText(/documentation\.microsoft/).closest("li"), "the documentation.microsoft need").textContent).toContain("When a task names it");
    expect(within(optional).getByText("Orbit-managed MCP")).toBeTruthy();
    expect(server.calls.filter((c) => c.path === "/api/v1/skills/alpha/resources" && c.method === "GET")).toHaveLength(1);
  });
});
