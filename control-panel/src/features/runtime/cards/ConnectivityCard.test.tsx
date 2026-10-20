// Whether the servers a checkout needs can be reached, from each place a component can run.
// What is promised: each location's answer is its own and is never copied to another; a kept answer
// says how old it is and an old one says STALE; reading asks nothing; Check once and Retry are ONE
// request each, carrying the token, naming the target by id and the location and nothing else --
// the attempts and the waits are the engine's, never a loop in the page; and a refusal is shown in
// the server's words.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../../shared/api/client";
import { DB_ID, PAGE_PATH, RUNTIME_PATH, fakeRuntime } from "../../../testing/fakeRuntime";
import { fakeServer } from "../../../testing/fakeServer";
import { renderApp } from "../../../testing/renderApp";
import { isRecord } from "../../../testing/required";

let runtime: ReturnType<typeof fakeRuntime>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  runtime = fakeRuntime({ target: true });
  server = fakeServer(undefined, runtime.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const posts = () => server.calls.filter((c) => c.method !== "GET");
const matrix = () => screen.findByRole("table", { name: "Connectivity of Orders database" });
const rowOf = (table: HTMLElement, where: string) => {
  const row = within(table).getByText(where).closest("tr");
  if (!row) throw new Error(`expected a row for ${where}`);
  return within(row);
};

describe("Connectivity", () => {
  it("shows each location's answer on its own: the host reaches it, the dev container did not", async () => {
    renderApp(PAGE_PATH);
    const table = await matrix();
    const host = rowOf(table, "Host (native)");
    expect(host.getByText("reachable")).toBeTruthy();
    expect(host.getByText("resolves")).toBeTruthy();
    expect(host.getByText("accepts a connection")).toBeTruthy();
    const container = rowOf(table, "Dev Container");
    expect(container.getByText("unreachable")).toBeTruthy();
    expect(container.getByText("does not resolve")).toBeTruthy();
    expect(container.getByText(/attempt 3 of 3 · db\.internal did not resolve \(ENOTFOUND\)/)).toBeTruthy();
  });

  it("an old answer says how old it is and that it is STALE; a fresh one does not", async () => {
    renderApp(PAGE_PATH);
    const table = await matrix();
    expect(rowOf(table, "Dev Container").getByText("stale: check again")).toBeTruthy();
    expect(rowOf(table, "Dev Container").getByText(/checked 2 h ago/)).toBeTruthy();
    expect(rowOf(table, "Host (native)").queryByText("stale: check again")).toBeNull();
    expect(rowOf(table, "Host (native)").getByText(/checked 10 s ago/)).toBeTruthy();
  });

  it("says what a target is, who needs it, that a start waits for it, and what reachable does not mean", async () => {
    renderApp(PAGE_PATH);
    await matrix();
    expect(screen.getByText("db.internal:1433")).toBeTruthy();
    expect(screen.getByText("checked before a start")).toBeTruthy();
    expect(screen.getByText("Needed by web")).toBeTruthy();
    expect(screen.getByText("Retry asks up to 3 time(s), 1000 ms apart, 3000 ms each.")).toBeTruthy();
    expect(screen.getByText("Note: through the office VPN")).toBeTruthy();
    expect(screen.getByText(/Reachable is not ready and not a login/)).toBeTruthy();
  });

  it("reading asks nothing: the connectivity is a GET of what was kept, and nothing is posted", async () => {
    renderApp(PAGE_PATH);
    await matrix();
    expect(server.calls.some((c) => c.method === "GET" && c.path === `${RUNTIME_PATH}/connectivity`)).toBe(true);
    expect(posts()).toEqual([]);
  });

  it("Check once is one request, for one location, naming the target by id -- and what it answered is shown", async () => {
    runtime.state.answers = { ...runtime.state.answers, devcontainer: ["REACHABLE"] };
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Check Orders database from Dev Container once" }));
    await waitFor(() => expect(rowOf(screen.getByRole("table", { name: "Connectivity of Orders database" }), "Dev Container").getByText("reachable")).toBeTruthy());
    const [call, ...more] = posts();
    expect(more).toEqual([]);
    expect([call?.path, call?.body, call?.headers[TOKEN_HEADER]]).toEqual([`${RUNTIME_PATH}/connectivity/${DB_ID}/check`, { provider: "devcontainer" }, "tok-123"]);
    expect(rowOf(screen.getByRole("table", { name: "Connectivity of Orders database" }), "Dev Container").getByText(/checked just now · attempt 1 of 1/)).toBeTruthy();
    expect(rowOf(screen.getByRole("table", { name: "Connectivity of Orders database" }), "Host (native)").getByText(/checked 10 s ago/)).toBeTruthy();
  });

  it("Retry is ONE request: the engine takes the attempts, and the page never asks again on its own", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Retry Orders database from Dev Container" }));
    await waitFor(() => expect(rowOf(screen.getByRole("table", { name: "Connectivity of Orders database" }), "Dev Container").getByText(/checked just now · attempt 3 of 3/)).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts().map((c) => [c.path, c.body])).toEqual([[`${RUNTIME_PATH}/connectivity/${DB_ID}/retry`, { provider: "devcontainer" }]]);
    expect(rowOf(screen.getByRole("table", { name: "Connectivity of Orders database" }), "Dev Container").queryByText("stale: check again")).toBeNull();
  });

  it("every request the card makes says where to ask from, and nothing else: never a host, a port or a command", async () => {
    renderApp(PAGE_PATH);
    fireEvent.click(await screen.findByRole("button", { name: "Check Orders database from Host (native) once" }));
    await waitFor(() => expect(posts().length).toBe(1));
    fireEvent.click(await screen.findByRole("button", { name: "Retry Orders database from Host (native)" }));
    await waitFor(() => expect(posts().length).toBe(2));
    expect(posts().every((c) => isRecord(c.body) && Object.keys(c.body).join() === "provider")).toBe(true);
  });

  it("without the page's token nothing can be checked", async () => {
    window.sessionStorage.removeItem("orbit.control.token");
    renderApp(PAGE_PATH);
    expect((await screen.findByRole("button", { name: "Check Orders database from Host (native) once" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Retry Orders database from Dev Container" }).hasAttribute("disabled")).toBe(true);
  });

  it("a target that is no longer set is refused in the server's words, and nothing is claimed", async () => {
    renderApp(PAGE_PATH);
    const button = await screen.findByRole("button", { name: "Check Orders database from Host (native) once" });
    runtime.state.connectivity = { ...runtime.state.connectivity, targets: [] };
    fireEvent.click(button);
    expect(await screen.findByText(`no connectivity target "${DB_ID}" is set for this machine`)).toBeTruthy();
    expect(screen.getByText("The check was not made")).toBeTruthy();
  });

  it("a place never checked says so once, with no age and nothing it did not ask", async () => {
    runtime.state.connectivity = { ...runtime.state.connectivity, targets: runtime.state.connectivity.targets.map((t) => ({ ...t, observations: { ...t.observations, devcontainer: { target: t.id, provider: "devcontainer", state: "NOT_CHECKED", resolution: "NOT_ATTEMPTED", transport: "NOT_ATTEMPTED", because: "not checked yet", checkedAt: null, attemptsUsed: 0, configuredAttempts: 3, attempts: [], freshness: { age: null, stale: true } } } })) };
    renderApp(PAGE_PATH);
    const row = rowOf(await matrix(), "Dev Container");
    expect(row.getAllByText("not checked yet")).toHaveLength(1);
    expect(row.queryByText("stale: check again")).toBeNull();
    expect([row.getByText("no lookup"), row.getByText("not tried")]).toHaveLength(2);
  });

  it("with no target set, it says where one is named", async () => {
    runtime = fakeRuntime();
    server = fakeServer(undefined, runtime.handle);
    vi.stubGlobal("fetch", server.fetch);
    renderApp(PAGE_PATH);
    expect(await screen.findByText(/No server this checkout needs is named for this machine\. Name one under Settings for this machine/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Check .* once$/ })).toBeNull();
  });
});
