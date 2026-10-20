// Health through the whole app: every area the server answers, each row in a word as well as a colour, a link to
// where a person acts, and the one action -- lifting a restriction kept from before autonomy was the default --
// sent on the revision Health showed, with nothing else on the page that writes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { fakeMission } from "../../testing/fakeMission";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let mission: ReturnType<typeof fakeMission>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  mission = fakeMission();
  server = fakeServer(undefined, mission.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Health", () => {
  it("shows every area, each row with its word and where to act, and writes nothing by looking", async () => {
    renderApp("/mission-control/health");
    expect(await screen.findByRole("heading", { level: 1, name: "Health" })).toBeTruthy();
    await screen.findByRole("list", { name: "Health: Automation" });
    for (const area of ["Automation", "Tasks", "Tools and MCP servers", "Agentic hosts"]) expect(screen.getByRole("list", { name: `Health: ${area}` })).toBeTruthy();
    const tasks = screen.getByRole("list", { name: "Health: Tasks" });
    expect(within(tasks).getAllByText("Needs a person").length).toBe(2);
    expect(within(tasks).getByRole("link", { name: "Go there" }).getAttribute("href")).toBe("/mission-control/approvals");
    expect(within(tasks).getByRole("link", { name: "Open the task" }).getAttribute("href")).toMatch(/^\/mission-control\/repo-payments\/checkouts\/b+\/tasks\/tsk-0123456789ab$/);
    expect(within(screen.getByRole("list", { name: "Health: Tools and MCP servers" })).getByRole("link", { name: "Go there" }).getAttribute("href")).toBe("/tools/sqlcmd");
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("is in the sidebar under Mission Control, selected on its own page", async () => {
    renderApp("/mission-control/health");
    await screen.findByRole("heading", { level: 1, name: "Health" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: /^Health/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /^Tasks/ }).getAttribute("aria-current")).not.toBe("page");
  });

  it("shows automation health without a state conversion action", async () => {
    renderApp("/mission-control/health");
    const automation = await screen.findByRole("list", { name: "Health: Automation" });
    expect(within(automation).getByText(/Autonomous by default/)).toBeTruthy();
    expect(within(automation).queryByRole("button")).toBeNull();
  });
});
