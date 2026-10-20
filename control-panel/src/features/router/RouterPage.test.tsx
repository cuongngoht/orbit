// The Router Inspector through the whole app: navigation, the effective
// resources, and the whole decision for a prompt -- the requirement graph with
// every candidate weighed, what needs approval, what policy blocks, what is
// missing, and the order it would all be used in.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { fakeServer } from "../../testing/fakeServer";
import { fakeResources } from "../../testing/fakeResources";
import { renderApp } from "../../testing/renderApp";
import { elementOf, required } from "../../testing/required";

let resources: ReturnType<typeof fakeResources>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resources = fakeResources();
  server = fakeServer(undefined, resources.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const nav = () => screen.getByRole("navigation", { name: "Main navigation" });
const resolve = (prompt: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
};

describe("Router", () => {
  it("is reachable from the sidebar, beside MCP, Tools, Skills and Activity", async () => {
    const router = renderApp("/analytics");
    for (const label of ["Router", "MCP", "Tools", "Skills", "Activity"]) expect(within(nav()).getByRole("link", { name: new RegExp(label) })).toBeTruthy();
    fireEvent.click(within(nav()).getByRole("link", { name: /Router/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Router" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/router");
  });

  it("summarises the effective resources the router reads, and how many MCP servers it may choose", async () => {
    renderApp("/router");
    expect(await screen.findByText("13 / 15 enabled")).toBeTruthy();
    expect(screen.getByText("1 usable of 3 · 1 eligible")).toBeTruthy();
    expect(screen.getByText("5 usable of 5")).toBeTruthy();
  });

  it("shows the requirement graph, the candidates weighed for each -- the host's copy never eligible -- and the plan", async () => {
    renderApp("/router");
    resolve("Implement the Microsoft Graph subscription renewal handler");
    const decision = await screen.findByRole("region", { name: "Route decision" });
    expect(within(decision).getByText("development")).toBeTruthy();
    const graph = decision;
    expect(within(graph).getByText("documentation.microsoft")).toBeTruthy();
    fireEvent.click(within(graph).getByText("documentation.microsoft"));
    const candidates = await screen.findByRole("table", { name: "Candidates for documentation.microsoft" });
    const rows = within(candidates).getAllByRole("row").map((r) => r.textContent);
    expect(rows.some((r) => r?.includes("orbit-managed") && r.includes("chosen"))).toBe(true);
    expect(rows.some((r) => r?.includes("external") && r.includes("Orbit does not route to it"))).toBe(true);
    const plan = within(decision).getByRole("list", { name: "Execution plan" });
    expect(within(plan).getAllByRole("listitem").map((li) => li.textContent?.split(" ")[0])).toEqual(["microsoft-learn", "orbit-develop"]);
    expect(within(decision).getByText("No resource was executed.")).toBeTruthy();
    expect(required(server.calls.find((c) => c.path === "/api/v1/router/resolve"), "the resolve request").body).toEqual({ prompt: "Implement the Microsoft Graph subscription renewal handler" });
  });

  it("shows what needs a person's approval and what policy blocks, apart from what is merely missing", async () => {
    renderApp("/router");
    resolve("Review PR 123");
    expect(within(await screen.findByRole("list", { name: "Approval required: MCP" })).getByText("github")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Blocked: MCP" })).getByText(/policy denies it/)).toBeTruthy();
  });

  it("shows what is relevant but missing, with why", async () => {
    renderApp("/router");
    resolve("Verify SQL Server row after order creation");
    const missing = await screen.findByRole("list", { name: "Missing: Tools" });
    expect(within(missing).getByText("sqlcmd")).toBeTruthy();
    expect(within(missing).getByText(/orbit-sql needs sqlserver\.query/)).toBeTruthy();
  });

  it("says so when the server cannot resolve, and Resolve waits for a prompt", async () => {
    resources.state.failResolve = true;
    renderApp("/router");
    expect(elementOf(await screen.findByRole("button", { name: "Resolve" }), HTMLButtonElement, "Resolve").disabled).toBe(true);
    resolve("anything at all");
    expect(await screen.findByText("Could not resolve the prompt")).toBeTruthy();
  });
});
