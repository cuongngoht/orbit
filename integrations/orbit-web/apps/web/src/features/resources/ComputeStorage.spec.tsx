import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { authSession } from "../../testing/fixtures";
import { AS_OF, resourceSummary } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { ComputeStorageSection } from "./ComputeStorageSection";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const rowOf = (table: HTMLElement, first: string) => within(table).getAllByRole("row").find((r) => r.textContent?.startsWith(first)) as HTMLElement;

describe("Settings → Compute & storage: what the account's employees may use, level by level", () => {
  test("the host's capacity and how it was learned, the budget beside its authorization, what is reserved and free, storage by category, and how much runs or waits", async () => {
    fakeApi().on("GET", "/api/office/resources", () => resourceSummary());
    renderLive(<ComputeStorageSection />);
    const capacity = await screen.findByRole("region", { name: "Infrastructure capacity" });
    expect(within(capacity).getByText("Detected from this host")).toBeInTheDocument();
    const cap = within(capacity).getByRole("table", { name: "Capacity" });
    expect(rowOf(cap, "CPU").textContent).toBe("CPU8 vCPU2 vCPU6 vCPU");
    expect(rowOf(cap, "Memory").textContent).toBe("Memory16 GiB4 GiB12 GiB");
    expect(capacity.textContent).toContain("Hard limit — the kernel refuses past it");
    const budget = within(screen.getByRole("region", { name: "Account budget" })).getByRole("table", { name: "Budget and authorization" });
    expect(rowOf(budget, "Persistent storage").textContent).toBe("Persistent storage100 GiB180 GiB");
    expect(rowOf(budget, "Work at the same time").textContent).toBe("Work at the same time34");
    const now = screen.getByRole("region", { name: "Now" });
    expect(now.textContent).toContain("CPU reserved2.5 vCPU");
    expect(now.textContent).toContain("CPU available3.5 vCPU");
    expect(now.textContent).toContain("Waiting for resources1");
    expect(now.textContent).toContain("Cannot start as configured0");
    expect(now.textContent).toContain("An idle employee reserves no CPU or memory");
    const storage = within(screen.getByRole("region", { name: "Storage" })).getByRole("table", { name: "Storage by category" });
    expect(rowOf(storage, "Desks and toolboxes").textContent).toBe("Desks and toolboxes25 GiB2 GiB");
    expect(rowOf(storage, "Artifacts").textContent).toBe("Artifacts0 MiB256 MiB");
  });

  test("Re-check reads the host again now, and shows what it gives -- and the budget that followed it", async () => {
    const resized = resourceSummary({ capacity: { ...resourceSummary().capacity, total: { cpuMillis: 16_000, memoryMiB: 32 * 1024, storageMiB: 400 * 1024 }, usable: { cpuMillis: 14_000, memoryMiB: 28 * 1024, storageMiB: 360 * 1024 } } });
    const api = fakeApi()
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("POST", "/api/office/resources/capacity/check", () => resized);
    renderLive(<ComputeStorageSection />);
    const capacity = await screen.findByRole("region", { name: "Infrastructure capacity" });
    expect(capacity.textContent).toContain("Re-check reads the host again now");
    await userEvent.click(within(capacity).getByRole("button", { name: "Re-check" }));
    await waitFor(() => expect(rowOf(within(capacity).getByRole("table", { name: "Capacity" }), "CPU").textContent).toBe("CPU16 vCPU2 vCPU14 vCPU"));
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/office/resources/capacity/check");
    expect(post?.headers["x-orbit-web"]).toBe("1");
  });

  test("a Re-check the host cannot answer says why, and changes nothing", async () => {
    fakeApi()
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("POST", "/api/office/resources/capacity/check", () => withStatus(422, { error: { code: "capacity_unreadable", message: "The sandbox provider (the allocator) did not answer: the host's capacity is left as it was last read." } }));
    renderLive(<ComputeStorageSection />);
    const capacity = await screen.findByRole("region", { name: "Infrastructure capacity" });
    await userEvent.click(within(capacity).getByRole("button", { name: "Re-check" }));
    expect(await within(capacity).findByText(/did not answer/)).toBeInTheDocument();
    expect(rowOf(within(capacity).getByRole("table", { name: "Capacity" }), "CPU").textContent).toBe("CPU8 vCPU2 vCPU6 vCPU");
  });

  test("a field nobody touched is never sent, however its value rounds on the page (18374 MiB shown as 17.94 GiB)", async () => {
    const base = resourceSummary().budget;
    const budget = { ...base, cpuMillis: 50, storageMiB: 18374, authorized: { ...base.authorized, storageMiB: 18374 } };
    const api = fakeApi()
      .on("GET", "/api/office/resources", () => resourceSummary({ budget }))
      .on("PATCH", "/api/office/resources/budget", () => resourceSummary());
    renderLive(<ComputeStorageSection />);
    const form = await screen.findByRole("form", { name: "Change the budget" });
    expect(within(form).getByRole("spinbutton", { name: /^Persistent storage/ })).toHaveValue(17.94);
    const cpu = within(form).getByRole("spinbutton", { name: /^CPU \(vCPU\)/ });
    await userEvent.clear(cpu);
    await userEvent.type(cpu, "0.04");
    await userEvent.click(within(form).getByRole("button", { name: "Save the budget" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")?.body, "only the CPU, typed; the storage stays as it is").toEqual({ cpuMillis: 40 });
  });

  test("the budget is lowered against the version read, and never offered above the operator's authorization", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("PATCH", "/api/office/resources/budget", () => resourceSummary({ budget: { ...resourceSummary().budget, cpuMillis: 4000, version: 3 } }));
    renderLive(<ComputeStorageSection />);
    const form = await screen.findByRole("form", { name: "Change the budget" });
    const save = within(form).getByRole("button", { name: "Save the budget" });
    expect(save).toBeDisabled();
    const cpu = within(form).getByRole("spinbutton", { name: /^CPU \(vCPU\)/ });
    await userEvent.clear(cpu);
    await userEvent.type(cpu, "8");
    expect(within(form).getByText("At most 6 vCPU, the operator's authorization.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.clear(cpu);
    await userEvent.type(cpu, "4");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ cpuMillis: 4000 });
    expect(patch?.headers["if-match"]).toBe('"2"');
    expect(form.textContent).toContain("node dist/cli/governance.js budget set");
  });

  test("a budget that moved on is not saved over: the latest is offered", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("PATCH", "/api/office/resources/budget", () => withStatus(412, { error: { code: "stale_version", message: "stale" } }));
    renderLive(<ComputeStorageSection />);
    const form = await screen.findByRole("form", { name: "Change the budget" });
    const concurrent = within(form).getByRole("spinbutton", { name: /^Work at the same time/ });
    await userEvent.clear(concurrent);
    await userEvent.type(concurrent, "2");
    await userEvent.click(within(form).getByRole("button", { name: "Save the budget" }));
    expect(await within(form).findByText("The budget changed since this page read it: nothing was saved.")).toBeInTheDocument();
    const reads = api.calls.filter((c) => c.path === "/api/office/resources").length;
    await userEvent.click(within(form).getByRole("button", { name: "Load the latest" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/office/resources").length).toBeGreaterThan(reads));
  });

  test("observed use: what the running attempts were last measured using, a block of its own -- apart from what admission reserved and from the storage committed", async () => {
    fakeApi().on("GET", "/api/office/resources", () => resourceSummary());
    const { unmount } = renderLive(<ComputeStorageSection />);
    const observed = await screen.findByRole("region", { name: "Observed use" });
    expect(observed.textContent).toContain("Memory now1.8 GiB");
    expect(observed.textContent).toContain("Memory at peak2.5 GiB");
    expect(observed.textContent).toContain("CPU time340 s");
    expect(observed.textContent).toContain("Attempts measured2");
    expect(observed.textContent).toContain("never what they reserved");
    expect(observed.textContent).toMatch(/Sampled .+\./);
    // Reserved stays in its own block, and says it is not use.
    const now = screen.getByRole("region", { name: "Now" });
    expect(now.textContent).toContain("Memory reserved5 GiB");
    expect(now.textContent).not.toContain("Memory now");
    expect(now.textContent).toContain("Reserved is what admission holds for running work, not what it uses");
    unmount();
    // A number nobody measured is said as such; nothing sampled lately says so, never a zero.
    fakeApi().on("GET", "/api/office/resources", () => resourceSummary({ observed: { runs: 1, memoryCurrentMiB: 512, memoryPeakMiB: null, cpuSeconds: null, sampledAt: AS_OF } }));
    const partly = renderLive(<ComputeStorageSection />);
    const some = await screen.findByRole("region", { name: "Observed use" });
    expect(some.textContent).toContain("Memory now512 MiB");
    expect(some.textContent).toContain("Memory at peaknot measured");
    expect(some.textContent).toContain("CPU timenot measured");
    partly.unmount();
    fakeApi().on("GET", "/api/office/resources", () => resourceSummary({ observed: { runs: 0, memoryCurrentMiB: null, memoryPeakMiB: null, cpuSeconds: null, sampledAt: null } }));
    renderLive(<ComputeStorageSection />);
    const none = await screen.findByRole("region", { name: "Observed use" });
    expect(within(none).getByText("Nothing measured lately.")).toBeInTheDocument();
    expect(none.textContent).not.toContain("Memory now");
  });

  test("a budget below what running work holds says it is over budget until that work ends -- nothing is stopped", async () => {
    const base = resourceSummary();
    fakeApi().on("GET", "/api/office/resources", () => resourceSummary({ budget: { ...base.budget, cpuMillis: 2000 } }));
    renderLive(<ComputeStorageSection />);
    expect(await screen.findByText("Over budget until running work ends: new work waits; nothing running is stopped.")).toBeInTheDocument();
  });
});
