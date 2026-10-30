// Autonomous improvement through the whole app: what the engine found, read with every count a count of campaigns and
// every metric its numerator over its denominator (or not available); a candidate's page with the baseline beside it,
// the gates and the history; a person's promote and reject made on the revision the page read -- a stale one says so --
// and the project's bounds saved the same way. Nothing on these pages runs an evaluation.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeImprovement } from "../../testing/fakeImprovement";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let imp: ReturnType<typeof fakeImprovement>;

beforeEach(() => {
  imp = fakeImprovement();
  vi.stubGlobal("fetch", fakeServer(undefined, imp.handle).fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Autonomous improvement", () => {
  it("shows what was found as counts of campaigns and metrics with their denominators, and runs nothing", async () => {
    renderApp("/improvement");
    expect(await screen.findByRole("link", { name: "imp-0123456789ab" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(screen.getAllByText(/not available/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^(run|start|evaluate|execute)/i })).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("a candidate's page shows the version it replaces beside it, the gates, and what nobody measured", async () => {
    renderApp("/improvement/repo-shop/campaigns/imp-0123456789ab");
    const evaluations = await screen.findByRole("table", { name: "Evaluations" }, { timeout: 5000 });
    expect(within(evaluations).getAllByText(/^met 0 of 3 ·/).length).toBe(2);
    expect(within(evaluations).getAllByText(/^met 3 of 3 ·/).length).toBe(2);
    expect(within(evaluations).getAllByText(/tokens: not available/).length).toBe(2);
    expect(within(screen.getByRole("list", { name: "Promotion gates" })).getByText("✗ POLICY_ALLOWS")).toBeTruthy();
    expect(screen.getByText("release-x:0.1.1:bbbbbbbb")).toBeTruthy();
  });

  it("a person promotes on the revision the page read; a campaign that moved since is named, never overwritten", async () => {
    renderApp("/improvement/repo-shop/campaigns/imp-0123456789ab");
    fireEvent.click(await screen.findByRole("button", { name: "Promote" }, { timeout: 5000 }));
    imp.state.campaign = { ...imp.state.campaign, revision: 22 };
    fireEvent.click(within(await screen.findByRole("alertdialog", {}, { timeout: 5000 })).getByRole("button", { name: "Promote" }));
    expect(await screen.findByText(/The campaign moved since you opened it/, {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(imp.state.calls.filter((c) => c.method === "GET" && c.path.endsWith("imp-0123456789ab")).length).toBeGreaterThan(1));
    fireEvent.click(await screen.findByRole("button", { name: "Promote" }, { timeout: 5000 }));
    fireEvent.click(within(await screen.findByRole("alertdialog", {}, { timeout: 5000 })).getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(imp.state.campaign.phase).toBe("PROMOTED"));
    const promote = imp.state.calls.filter((c) => c.path.endsWith("/promote")).at(-1);
    expect((promote?.body as { expectedRevision: number }).expectedRevision).toBe(22);
  });

  it("a person rejects a candidate with a sentence of why", async () => {
    renderApp("/improvement/repo-shop/campaigns/imp-0123456789ab");
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }, { timeout: 5000 }));
    const dialog = await screen.findByRole("alertdialog", {}, { timeout: 5000 });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "not what this project wants" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(imp.state.campaign.phase).toBe("REJECTED"));
    expect((imp.state.calls.filter((c) => c.path.endsWith("/reject")).at(-1)?.body as { because: string }).because).toBe("not what this project wants");
  });

  it("the project's bounds are saved on the revision read, and the page is read-only without the token", async () => {
    renderApp("/improvement?tab=settings");
    fireEvent.change(await screen.findByLabelText("improvement.minSessions", {}, { timeout: 5000 }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(imp.state.settingsRev).toBe("rev-1"));
    expect(imp.state.values.minSessions).toBe(3);
    window.sessionStorage.removeItem("orbit.control.token");
    renderApp("/improvement?tab=settings");
    expect((await screen.findAllByText(/Read-only/, {}, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});
