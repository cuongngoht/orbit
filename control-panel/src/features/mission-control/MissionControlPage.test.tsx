// Mission Control through the whole app: the machine's task executions across projects, as the
// server's projection says -- counters, rows, filters, the approval queue -- and a page that only
// reads until a person decides something.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeMission } from "../../testing/fakeMission";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { DESTINATIONS, HOME } from "../../app/navigation";

let mission: ReturnType<typeof fakeMission>;
let server: ReturnType<typeof fakeServer>;

function serve(over: Parameters<typeof fakeMission>[0] = {}) {
  mission = fakeMission(over);
  server = fakeServer(undefined, mission.handle);
  vi.stubGlobal("fetch", server.fetch);
}

// A counter, found by its label -- not the filter tab that shares its words.
function tile(label: string): HTMLElement {
  const name = screen.getAllByText(label, { selector: "span" }).find((el) => !el.closest('[role="tab"]'));
  const root = name?.closest<HTMLElement>("div, a");
  if (!root) throw new Error(`no tile for ${label}`);
  return root;
}

beforeEach(() => {
  serve();
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Mission Control", () => {
  it("is the home of Orbit Control: Tasks, Approvals and Health come first, and everything else stays reachable under Advanced", () => {
    const first = DESTINATIONS.filter((d) => d.group === "Mission Control").map((d) => d.label);
    expect(first).toEqual(["Tasks", "Approvals", "Health"]);
    expect(HOME).toBe("/mission-control");
    expect(DESTINATIONS[0]?.group).toBe("Mission Control");
    expect(DESTINATIONS.filter((d) => d.group === "Advanced").map((d) => d.label)).toEqual(["Analytics", "Work", "Projects", "Automation limits", "Improvement", "Router", "Activity", "Trace"]);
  });

  it("counts what the machine's tasks are doing, and lists each under its project", async () => {
    renderApp("/mission-control");
    expect(await screen.findByText("PBI-482 — Refund validation")).toBeTruthy();
    expect(within(tile("Running")).getByText("1")).toBeTruthy();
    expect(within(tile("Waiting approval")).getByText("1")).toBeTruthy();
    expect(within(tile("Blocked")).getByText("1")).toBeTruthy();
    expect(within(tile("Completed today")).getByText("1")).toBeTruthy();
    const payments = screen.getByRole("list", { name: "Tasks of payments-api" });
    expect(within(payments).getByText("WAITING_APPROVAL")).toBeTruthy();
    // A task still going is marked active, in a word as well as a glyph, with the stage it is in and what runs.
    expect(within(payments).getByText(/REGRESSION · Attempt 3 \/ 8 · 1 running/)).toBeTruthy();
    expect(within(payments).getByRole("img", { name: "active" }).textContent).toBe("●");
    const admin = screen.getByRole("list", { name: "Tasks of admin-ui" });
    expect(within(admin).getByText("BLOCKED")).toBeTruthy();
    expect(within(admin).getByText(/the requirement cannot be worked on as it stands/)).toBeTruthy();
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("shows what waits for a person, machine-wide, with everything needed to decide it", async () => {
    renderApp("/mission-control");
    const queue = await screen.findByRole("region", { name: "Approvals (1)" });
    expect(within(queue).getByText("database.migrate")).toBeTruthy();
    expect(within(queue).getByText("dev")).toBeTruthy();
    expect(within(queue).getByText("Integration verification needs schema v82.")).toBeTruthy();
    expect(within(queue).getByText("DEV database state will be changed.")).toBeTruthy();
    expect(within(queue).getByRole("link", { name: "Review the task" })).toBeTruthy();
  });

  it("filters to what is blocked, or to one project", async () => {
    renderApp("/mission-control");
    await screen.findByText("PBI-482 — Refund validation");
    fireEvent.click(screen.getByRole("tab", { name: "Blocked" }));
    expect(screen.queryByText("PBI-482 — Refund validation")).toBeNull();
    expect(screen.getByText("BUG-218 Search crash")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "repo-shop" } });
    expect(screen.getByText("PBI-500 Checkout totals")).toBeTruthy();
    expect(screen.queryByText("BUG-218 Search crash")).toBeNull();
  });

  it("says so when nothing has run on this machine, and invents nothing", async () => {
    serve({ view: null, others: [] });
    renderApp("/mission-control");
    expect(await screen.findByText(/No task execution has been recorded on this machine yet/)).toBeTruthy();
    expect(within(tile("Running")).getByText("0")).toBeTruthy();
  });

  it("a server that could not answer is said, and Retry reads again", async () => {
    serve({ overviewFailures: 2 });
    renderApp("/mission-control");
    expect(await screen.findByText("Could not read the tasks on this machine", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("PBI-482 — Refund validation")).toBeTruthy();
  });

  it("opening a task is navigation to an address that names its project, its checkout and the task", async () => {
    const router = renderApp("/mission-control");
    fireEvent.click(await screen.findByRole("link", { name: "PBI-482 — Refund validation" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/mission-control/repo-payments/checkouts/${"b".repeat(64)}/tasks/tsk-0123456789ab`));
  });
});
