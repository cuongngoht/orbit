// Tools & Runtimes through the whole app: ready and needing attention, an
// explicit Install, one that fails, a re-check, and one tool's sources.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { fakeServer } from "../../testing/fakeServer";
import { fakeResources } from "../../testing/fakeResources";
import { renderApp } from "../../testing/renderApp";

let resources: ReturnType<typeof fakeResources>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resources = fakeResources();
  server = fakeServer(undefined, resources.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section")!;

describe("Tools", () => {
  it("splits what is ready from what needs attention, with where each was found", async () => {
    renderApp("/tools");
    await screen.findByRole("heading", { name: "Ready" });
    expect(within(section("Ready")).getByText("GIT")).toBeTruthy();
    expect(within(section("Ready")).getByText(/1\.0\.0 · System/)).toBeTruthy();
    const attention = section("Needs attention");
    expect(within(attention).getByText("SQLCMD")).toBeTruthy();
    expect(within(attention).getByText("Not installed")).toBeTruthy();
    expect(within(attention).getByRole("button", { name: "Install SQLCMD" })).toBeTruthy();
    expect(within(section("Ready")).queryByRole("button", { name: /Install/ })).toBeNull();
  });

  it("installs only when asked, with the token, and the tool becomes ready", async () => {
    renderApp("/tools");
    fireEvent.click(await screen.findByRole("button", { name: "Install SQLCMD" }));
    await waitFor(() => expect(within(section("Ready")).getByText("SQLCMD")).toBeTruthy());
    const post = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/tools/sqlcmd/install")!;
    expect(post.headers[TOKEN_HEADER]).toBe("tok-123");
    expect(within(section("Ready")).getByText(/1\.10\.0 · Orbit Managed/)).toBeTruthy();
  });

  it("says why an install failed, and nothing moved", async () => {
    resources.state.failInstall = true;
    renderApp("/tools");
    fireEvent.click(await screen.findByRole("button", { name: "Install SQLCMD" }));
    expect(await screen.findByText("SQLCMD was not installed")).toBeTruthy();
    expect(screen.getByText(/does not match the SHA-256/)).toBeTruthy();
    expect(within(section("Needs attention")).getByText("SQLCMD")).toBeTruthy();
  });

  it("Check again asks the server to look for every tool", async () => {
    renderApp("/tools");
    await screen.findByRole("heading", { name: "Ready" });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "POST" && c.path.endsWith("/refresh")).map((c) => c.path).sort()).toEqual(["/api/v1/tools/git/refresh", "/api/v1/tools/sqlcmd/refresh"]));
  });

  it("a tool's page lists every source in order, and offers the private install", async () => {
    renderApp("/tools/sqlcmd");
    expect(await screen.findByRole("heading", { level: 1, name: "SQLCMD" })).toBeTruthy();
    const sources = section("Detected sources");
    expect(within(sources).getByText("Project")).toBeTruthy();
    expect(within(sources).getByText("Orbit Managed")).toBeTruthy();
    expect(within(sources).getByText("not installed")).toBeTruthy();
    expect(within(sources).getAllByText("not found")).toHaveLength(2);
    expect(within(section("Installation")).getByText(/Install privately for Orbit — version 1\.10\.0/)).toBeTruthy();
    expect(within(section("Installation")).getByRole("button", { name: "Install SQLCMD" })).toBeTruthy();
  });
});
