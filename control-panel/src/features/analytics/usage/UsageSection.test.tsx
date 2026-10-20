// Analytics' Usage section through the whole app: what ran in a window, every
// number with its denominator, the flows, least privilege, and the empty trail.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeServer } from "../../../testing/fakeServer";
import { fakeTrail, fakeUsage } from "../../../testing/fakeTrace";
import { renderApp } from "../../../testing/renderApp";
import { elementOf } from "../../../testing/required";

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  server = fakeServer(undefined, fakeTrail({ usage: (days) => fakeUsage(days) }));
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const usage = async () => within(await screen.findByRole("region", { name: "Usage" }));

const figure = (name: string) => elementOf(screen.getByRole("heading", { level: 2, name }).closest("figure"), HTMLElement, `the ${name} chart`);

describe("Analytics usage", () => {
  it("counts what ran, and every count says what it is out of", async () => {
    renderApp("/analytics");
    const section = await usage();
    expect(await section.findByText("of 7 commands run")).toBeTruthy();
    expect(section.getByText("across 2 sessions")).toBeTruthy();
    expect(section.getByText("2 other commands beside them")).toBeTruthy();
    expect(section.getByText("1 subagent · 9 tool uses")).toBeTruthy();
    expect(section.getByRole("link", { name: /^Prompts 3 / }).getAttribute("href")).toBe("/trace");
  });

  it("plots each Orbit command by its runs, with the same values as a table", async () => {
    renderApp("/analytics");
    await (await usage()).findByRole("heading", { level: 2, name: "Orbit commands" });
    const bars = within(figure("Orbit commands")).getAllByRole("listitem");
    expect(bars.map((b) => b.textContent)).toEqual(["cli/context3", "cli/knowledge verify2"]);
    fireEvent.click(within(within(figure("Orbit commands")).getByRole("toolbar", { name: "Orbit commands view" })).getByRole("radio", { name: "Table" }));
    const table = within(figure("Orbit commands")).getByRole("table", { name: "Orbit commands" });
    expect(within(table).getByRole("columnheader", { name: "Command" })).toBeTruthy();
    expect(within(table).getByText("2 runs")).toBeTruthy();
  });

  it("gives a command's full name on hover, because the label is cut to fit its column", async () => {
    renderApp("/analytics");
    await (await usage()).findByRole("heading", { level: 2, name: "Orbit commands" });
    const chart = within(figure("Orbit commands"));
    expect(chart.getByTitle("cli/context")).toBeTruthy();
    expect(chart.getByTitle("cli/knowledge verify").textContent).toBe("cli/knowledge verify");
  });

  it("shows how prompts flowed, and what failed with its denominator and what came next", async () => {
    renderApp("/analytics");
    const section = await usage();
    const paths = await section.findByRole("list", { name: "Common paths" });
    expect(within(paths).getByText("orbit:orbit-develop → cli/context → cli/knowledge verify ✖")).toBeTruthy();
    expect(within(paths).getByText(/2 prompts/)).toBeTruthy();
    const failing = within(section.getByRole("list", { name: "Failing steps" })).getByRole("listitem");
    expect(failing.textContent).toMatch(/cli\/knowledge verify — failed 1 of 2 runs · then \(end of turn\) \(1\)/);
  });

  it("holds each skill's pre-approved commands against what it ran", async () => {
    renderApp("/analytics");
    const section = await usage();
    expect(within(await section.findByRole("list", { name: "Ran without pre-approval" })).getByText("cli/trace turns")).toBeTruthy();
    expect(within(section.getByRole("list", { name: "Pre-approved but never run" })).getByText(/knowledge\.mjs why/)).toBeTruthy();
    expect(section.getByText(/a skill never started in this window is not judged/)).toBeTruthy();
  });

  it("an empty window says so, and what the trail would never keep", async () => {
    vi.stubGlobal("fetch", fakeServer().fetch);
    renderApp("/analytics");
    const section = await usage();
    expect(await section.findByRole("heading", { level: 2, name: "Nothing recorded in this window" })).toBeTruthy();
    expect(section.getByText(/Never kept: a prompt's text, a response, a command's arguments/)).toBeTruthy();
    expect(section.queryByRole("heading", { level: 2, name: "Orbit commands" })).toBeNull();
  });

  it("reads another window only when one is chosen", async () => {
    renderApp("/analytics");
    await (await usage()).findByText("of 7 commands run");
    expect(server.calls.some((c) => c.path === "/api/v1/analytics/usage?days=30")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "7 days" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/analytics/usage?days=7")).toBe(true));
  });
});
