// Projects through the whole app: every checkout Orbit knows on this machine, from the registry
// alone. The page asks the server for the list and for nothing else -- no runtime, no repository --
// and opening a checkout is navigation to an address that names both identities.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CHECKOUT, KEY, OTHER_CHECKOUT, PAGE_PATH, fakeRuntime } from "../../testing/fakeRuntime";
import { fakeServer, reply } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let runtime: ReturnType<typeof fakeRuntime>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  runtime = fakeRuntime();
  server = fakeServer(undefined, runtime.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Projects", () => {
  it("lists every checkout with the line its last command left, and asks nothing of any runtime", async () => {
    renderApp("/projects");
    expect(await screen.findByText("/work/shop")).toBeTruthy();
    expect(screen.getByText("/work/shop-review")).toBeTruthy();
    expect(screen.getByText("CURRENT")).toBeTruthy();
    expect(screen.getByText("STOPPED")).toBeTruthy();
    expect(server.calls.filter((c) => c.path.includes("/runtime"))).toEqual([]);
    expect(server.calls.filter((c) => c.path.startsWith("/api/v1/projects")).map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/v1/projects"]);
  });

  it("a checkout whose directory is gone is marked, and offers no way in", async () => {
    renderApp("/projects");
    expect(await screen.findByText("missing")).toBeTruthy();
    expect(screen.getByText("its directory is gone")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /\/work\/shop-review/ })).toBeNull();
  });

  it("a checkout whose directory is gone is forgotten only after a person confirms, and the list reads again", async () => {
    renderApp("/projects");
    fireEvent.click(await screen.findByRole("button", { name: "Forget /work/shop-review" }));
    expect(await screen.findByText("Forget this checkout?")).toBeTruthy();
    expect(server.calls.some((c) => c.path.endsWith("/forget"))).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Forget it" }));
    // The dialog names the directory too, and closes on its own schedule: the TABLE is what must lose it.
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Checkouts" })).queryByText("/work/shop-review")).toBeNull(), { timeout: 4000 });
    const sent = server.calls.find((c) => c.path.endsWith("/forget"));
    expect([sent?.method, sent?.path, sent?.body]).toEqual(["POST", `/api/v1/projects/${KEY}/checkouts/${OTHER_CHECKOUT}/forget`, { human: true }]);
    expect(screen.getByText("/work/shop")).toBeTruthy();
  });

  it("a checkout that is there offers no forgetting, and a cancelled one sends nothing", async () => {
    renderApp("/projects");
    expect(await screen.findByText("/work/shop")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Forget /work/shop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forget /work/shop-review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Forget this checkout?")).toBeNull(), { timeout: 4000 });
    expect(server.calls.some((c) => c.path.endsWith("/forget"))).toBe(false);
  });

  it("opening a checkout is navigation to an address that names the project AND the checkout", async () => {
    const router = renderApp("/projects");
    fireEvent.click(await screen.findByRole("link", { name: "Open the runtime of shop at /work/shop" }));
    expect(router.state.location.pathname).toBe(PAGE_PATH);
    expect(PAGE_PATH).toContain(KEY);
    expect(PAGE_PATH).toContain(CHECKOUT);
  });

  it("a machine Orbit was never used on says how a project appears", async () => {
    runtime.state.list = { projects: [] };
    renderApp("/projects");
    expect(await screen.findByText(/Orbit has not been used from any project on this machine yet/)).toBeTruthy();
  });

  it("a list that cannot be read says so, and can be tried again", async () => {
    vi.stubGlobal("fetch", fakeServer(undefined, (call) => (call.path === "/api/v1/projects" ? reply(500, { error: { code: "FAILED", message: "the registry could not be read" } }) : null)).fetch);
    renderApp("/projects");
    expect(await screen.findByText("the registry could not be read", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("the sidebar lists Projects, and it stays the selected page below it", async () => {
    renderApp(PAGE_PATH);
    expect(await screen.findByRole("heading", { name: "Runtime" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Projects" }).length).toBeGreaterThan(0);
  });
});
