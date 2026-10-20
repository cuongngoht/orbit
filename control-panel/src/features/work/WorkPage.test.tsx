// A tracked work through the whole app: what it says it came to, what stands behind that, the files and checks the host's
// hooks OBSERVED, and the task that joined it -- from the engine's one view, never from a guess. The server here is an in-memory
// stand-in, so nothing in this file is evidence that a host's hook ran.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TASK, M_CHECKOUT, M_KEY } from "../../testing/fakeMission";
import { fakeServer } from "../../testing/fakeServer";
import { WORK, WORK_PAGE, fakeWork, workView } from "../../testing/fakeWork";
import { renderApp } from "../../testing/renderApp";

function serve(over: Parameters<typeof fakeWork>[0] = {}) {
  const work = fakeWork(over);
  const server = fakeServer(undefined, work.handle);
  vi.stubGlobal("fetch", server.fetch);
  return { work, server };
}

beforeEach(() => {
  serve();
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const card = (title: string) => {
  const root = screen.getByRole("heading", { name: title }).closest<HTMLElement>("section");
  if (!root) throw new Error(`no card ${title}`);
  return root;
};

function fact(scope: HTMLElement, term: string): string {
  return within(scope).getByText(term, { selector: "dt" }).nextElementSibling?.textContent ?? "";
}

describe("Work page", () => {
  it("shows the request, its mode, where it stands and what stands behind that -- as three separate things", async () => {
    renderApp(WORK_PAGE);
    expect(await screen.findByRole("heading", { level: 1, name: "Fix the refund limit" })).toBeTruthy();
    const standing = card("Where it stands");
    expect(fact(standing, "Mode")).toMatch(/^autonomous/);
    expect(fact(standing, "Routed to")).toBe("orbit-develop — a small change");
    expect(fact(standing, "Item")).toBe("PBI-482");
    expect(fact(standing, "Lifecycle")).toBe("REPORTED DONE — refund limit fixed");
    expect(fact(standing, "Evidence")).toMatch(/^reported — reported by the host or a person; no owner confirmed it/);
    expect(fact(standing, "Session")).toBe("its session ended");
  });

  it("never calls a reported done verified: the evidence badge says reported", async () => {
    renderApp(WORK_PAGE);
    await screen.findByRole("heading", { level: 1, name: "Fix the refund limit" });
    expect(screen.getByText("evidence: reported")).toBeTruthy();
    expect(screen.queryByText(/evidence: verified/)).toBeNull();
  });

  it("lists the files that were observed, flags a shared one, and says it is not the checkout's diff", async () => {
    renderApp(WORK_PAGE);
    const files = await screen.findByRole("list", { name: "Files observed" });
    const items = within(files).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/src\/RefundService\.cs.*observed/);
    expect(items[1]).toMatch(/src\/Shared\.cs.*shared — another session was also seen writing it/);
    expect(within(card("Files observed")).getByText(/not the checkout's diff/)).toBeTruthy();
  });

  it("names a check by its words, says how it ended, and marks it superseded once a later edit was seen", async () => {
    renderApp(WORK_PAGE);
    const checks = await screen.findByRole("list", { name: "Checks observed" });
    expect(within(checks).getByText(/dotnet \(named like a test\)/)).toBeTruthy();
    expect(within(checks).getByText(/ended ok · superseded by a later edit/)).toBeTruthy();
    expect(within(card("Checks observed")).queryByText(/passed/i)).toBeNull();
  });

  it("shows what was proved and what was not, as the host reported it", async () => {
    renderApp(WORK_PAGE);
    await screen.findByRole("heading", { level: 1, name: "Fix the refund limit" });
    const summary = card("What it came to");
    expect(within(within(summary).getByRole("list", { name: "Proved (as reported)" })).getByText("the unit test ended ok")).toBeTruthy();
    expect(within(within(summary).getByRole("list", { name: "Not verified" })).getByText("the screen was not looked at")).toBeTruthy();
  });

  it("links a task that joined the work to its own page, and shows its state as its journal says", async () => {
    const router = renderApp(WORK_PAGE);
    const tasks = await screen.findByRole("list", { name: "Linked tasks" });
    expect(within(tasks).getByText("EXECUTING")).toBeTruthy();
    fireEvent.click(within(tasks).getByRole("link", { name: TASK }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/mission-control/${M_KEY}/checkouts/${M_CHECKOUT}/tasks/${TASK}`));
  });

  it("shows the handoff that kept the same work", async () => {
    renderApp(WORK_PAGE);
    const handoffs = await screen.findByRole("list", { name: "Handoffs" });
    expect(within(handoffs).getByText(/developer → autonomous \(tsk-0123456789ab\)/)).toBeTruthy();
  });

  it("says what the host could not show instead of an empty block", async () => {
    serve({ view: workView({ coverage: { host: "antigravity", observation: "automatic", edits: "native file tools", commands: "native command tool", outcome: "unknown: command completion is not reported", sessionEnd: false, limits: [] }, warnings: ["no session end: an ended session cannot be told from a quiet one, so INTERRUPTED is never derived"] }) });
    renderApp(WORK_PAGE);
    const limits = await screen.findByRole("list", { name: "Limits" });
    expect(within(limits).getByText(/INTERRUPTED is never derived/)).toBeTruthy();
    expect(fact(card("What could be seen"), "Session end")).toBe("not reported");
  });

  it("answers an unknown work in the server's own words, and writes nothing", async () => {
    const { server } = serve({ view: null });
    renderApp(WORK_PAGE);
    expect(await screen.findByText(/no tracked work like that is kept for this checkout/)).toBeTruthy();
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("Work list", () => {
  it("lists a checkout's works by what was reported, and opens one", async () => {
    const router = renderApp("/work");
    const list = await screen.findByRole("list", { name: "Works of payments" });
    expect(within(list).getByText("REPORTED DONE")).toBeTruthy();
    fireEvent.click(within(list).getByRole("link", { name: "Fix the refund limit" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/work/${M_KEY}/checkouts/${M_CHECKOUT}/works/${WORK}`));
  });

  it("is a page of the sidebar and makes no write", async () => {
    const { server } = serve();
    renderApp("/work");
    await screen.findByRole("list", { name: "Works of payments" });
    expect(screen.getByRole("link", { name: /^Work$/ })).toBeTruthy();
    expect(server.calls.every((c) => c.method === "GET")).toBe(true);
  });
});
