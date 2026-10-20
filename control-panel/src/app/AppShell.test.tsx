// The shell: the sidebar comes from DESTINATIONS, and the router serves what it lists.
// .test.tsx on purpose: see src/features/skills/SkillsPage.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeServer, fakeSkill, reply } from "../testing/fakeServer";
import { renderApp } from "../testing/renderApp";
import { DESTINATIONS } from "./navigation";

beforeEach(() => {
  vi.stubGlobal("fetch", fakeServer().fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const nav = () => screen.getByRole("navigation", { name: "Main navigation" });
const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("the app shell", () => {
  it("opens on Mission Control's Tasks, and the sidebar lists every destination in the table", async () => {
    const router = renderApp("/");
    expect(await heading("Tasks")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/mission-control");
    for (const d of DESTINATIONS) expect(within(nav()).getByRole("link", { name: new RegExp(d.label) })).toBeTruthy();
    expect(within(nav()).getByRole("link", { name: /Orbit Control/ })).toBeTruthy();
  });

  it("moves between pages from the sidebar, and names the tab after the page", async () => {
    const router = renderApp("/analytics");
    fireEvent.click(within(nav()).getByRole("link", { name: /Skills/ }));
    expect(await heading("Skills")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/skills");
    await waitFor(() => expect(document.title).toBe("Skills · Orbit Control"));
  });

  it("collapses to an icon rail and remembers it on the next visit", async () => {
    renderApp("/skills");
    fireEvent.click(await screen.findByRole("button", { name: "Collapse navigation" }));
    const rail = await screen.findByRole("navigation", { name: "Main navigation" });
    const skills = within(rail).getByRole("link", { name: "Skills" });
    expect(skills.getAttribute("aria-current")).toBe("page");
    expect(within(rail).getByRole("button", { name: "Expand navigation" })).toBeTruthy();
    expect(window.localStorage.getItem("orbit.control.sidebar")).toBe("rail");
  });

  it("flags broken skills in the sidebar from any page", async () => {
    vi.stubGlobal("fetch", fakeServer([fakeSkill("alpha"), fakeSkill("broken", { valid: false, problems: ["the frontmatter has no description"] })]).fetch);
    renderApp("/analytics");
    expect(await within(nav()).findByLabelText("1 skill needs attention")).toBeTruthy();
  });

  it("an address that is not a page says so, and offers a way back", async () => {
    renderApp("/nowhere");
    expect(await heading("Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Mission Control" })).toBeTruthy();
  });
});

// jsdom has no layout and no scrollIntoView: a stand-in records which element the sidebar asked to bring into view.
describe("the sidebar's own scroll", () => {
  const brought: Element[] = [];
  beforeEach(() => {
    brought.length = 0;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value(this: Element) {
        brought.push(this);
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("brings the active item into view when the page opens, and again when the route changes", async () => {
    renderApp("/skills");
    await heading("Skills");
    await waitFor(() => expect(brought.at(-1)?.textContent).toMatch(/^Skills/));
    expect(brought.at(-1)?.getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(nav()).getByRole("link", { name: /Trace/ }));
    await heading("Trace");
    await waitFor(() => expect(brought.at(-1)?.textContent).toMatch(/^Trace/));
    expect(within(nav()).getByRole("link", { name: /Trace/ }).getAttribute("aria-current")).toBe("page");
  });
});

describe("the top bar", () => {
  it("shows who is signed in to Claude on this machine, and the profile -- never a token -- on click", async () => {
    renderApp("/mcp");
    const bar = await screen.findByRole("banner", { name: "Top bar" });
    const chip = await within(bar).findByRole("button", { name: "Signed in to Claude Code as Test Person" });
    expect(within(chip).getByText("Example Org")).toBeTruthy();
    fireEvent.click(chip);
    const surface = await screen.findByLabelText("Claude Code account");
    expect(within(surface).getByText("person@example.test")).toBeTruthy();
    expect(within(surface).getByText("admin")).toBeTruthy();
    expect(within(surface).getByText(/Orbit never reads or uses your Claude Code token/)).toBeTruthy();
  });

  it("says plainly when this machine keeps no Claude profile, and when it cannot tell", async () => {
    vi.stubGlobal("fetch", fakeServer(undefined, (call) => (call.path === "/api/v1/account" ? reply(200, { host: "claude", signedIn: false }) : null)).fetch);
    renderApp("/analytics");
    expect(await screen.findByRole("button", { name: "No Claude Code account profile on this machine" })).toBeTruthy();
  });

  it("a Control server older than the account endpoint answers 'unknown', and the page still works", async () => {
    vi.stubGlobal("fetch", fakeServer(undefined, (call) => (call.path === "/api/v1/account" ? reply(404, { error: { code: "NOT_FOUND", message: "no endpoint at /api/v1/account" } }) : null)).fetch);
    renderApp("/analytics");
    expect(await screen.findByText("Claude account: unknown")).toBeTruthy();
    expect(await heading("Analytics")).toBeTruthy();
  });
});

describe("a page that fails to draw", () => {
  it("is replaced by a message INSIDE the shell -- the sidebar stays -- with the error's own line to report", async () => {
    vi.stubGlobal("fetch", fakeServer(undefined, (call) => (call.path === "/api/v1/router/resources" ? reply(200, { version: 2, summary: [], resources: { version: 2, problems: [], skills: [{ id: "broken" }], agents: [], mcp: [], tools: [], capabilities: [] }, problems: [] }) : null)).fetch);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/mcp/new");
    expect(await screen.findByRole("heading", { level: 1, name: "This page could not be shown" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(within(nav()).getByRole("link", { name: /MCP/ })).toBeTruthy();
    spy.mockRestore();
  });
});
