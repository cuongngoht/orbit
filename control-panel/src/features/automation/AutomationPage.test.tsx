// Automation limits through the whole app: autonomous by default and saying so, with no switch that turns it on
// or picks a mode; a restriction kept from before shown and lifted on the revision read; a person's save of a
// limit against the revision it read, a stale save named as such, a project that can only narrow, the policy
// shown and never a switch, host readiness that says what is unavailable, and generated playbooks moved only by
// a person -- with nothing on the page that starts a workflow.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeAutomation } from "../../testing/fakeAutomation";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let auto: ReturnType<typeof fakeAutomation>;

beforeEach(() => {
  auto = fakeAutomation();
  vi.stubGlobal("fetch", fakeServer(undefined, auto.handle).fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Automation", () => {
  it("is autonomous by default, offers no switch that turns it on or picks a mode, and nothing that starts a workflow", async () => {
    renderApp("/automation");
    expect(await screen.findByText(/Autonomous by default/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "enabled" })).toBeNull();
    expect(screen.queryByLabelText("mode")).toBeNull();
    expect(screen.queryByLabelText("skillFactory.mode")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(run|start|execute)/i })).toBeNull();
  });

  it("offers no historical restriction or conversion action", async () => {
    renderApp("/automation");
    expect(await screen.findByText(/Autonomous by default/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lift and use the default" })).toBeNull();
  });

  it("a person changes a limit, saved against the revision it was read at", async () => {
    renderApp("/automation?tab=execution");
    fireEvent.change(await screen.findByLabelText("execution.maxAttempts"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(auto.state.machineRev).toBe("rev-1"));
    expect(auto.state.machine).toEqual({ execution: { maxAttempts: 3 } });
  });

  it("a save on a revision somebody moved says so instead of overwriting", async () => {
    renderApp("/automation");
    fireEvent.click(await screen.findByRole("switch", { name: "trigger.arbitraryPrompt" }));
    auto.state.machineRev = "rev-elsewhere";
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Somebody changed these settings/)).toBeTruthy();
  });

  it("each value says who set it, and a project can only narrow what the machine allows", async () => {
    auto.state.machine = { execution: { maxAttempts: 2 } };
    auto.state.machineRev = "rev-0";
    renderApp("/automation?tab=execution");
    expect(await screen.findByText(/Effective: 2 \(this machine\)/)).toBeTruthy();
    await screen.findByRole("option", { name: "Project shop" });
    fireEvent.change(screen.getByLabelText("Settings for"), { target: { value: "repo-shop" } });
    expect(await screen.findByText(/Project repo-shop: it can only narrow/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("execution.maxAttempts"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(auto.state.projectRev).toBe("rev-1"));
    expect(await screen.findByText(/Effective: 2 \(this machine\)/)).toBeTruthy();
  });

  it("the tab row wraps in a narrow window, so no tab is clipped behind the edge", async () => {
    renderApp("/automation?tab=general");
    const tabs = await screen.findByRole("tablist", { name: "Automation" });
    expect(getComputedStyle(tabs).flexWrap).toBe("wrap");
    expect(within(tabs).getByRole("tab", { name: "Generated skills" })).toBeTruthy();
  });

  it("governance shows what a workflow may do alone, and push, merge and deploy never", async () => {
    renderApp("/automation?tab=governance");
    expect(await screen.findByText("push-merge-deploy")).toBeTruthy();
    expect(screen.getAllByText("Never").length).toBeGreaterThan(0);
  });

  it("the Live tab says which host has what, and how to install the status line without writing it", async () => {
    renderApp("/automation?tab=live");
    expect(await screen.findByText(/cli\/host.mjs render --host=claude --kind=statusline/)).toBeTruthy();
    expect(screen.getByText("Unavailable on this host")).toBeTruthy();
  });

  it("generated playbooks: viewed, disabled by a person, and never activated while their files changed", async () => {
    renderApp("/automation?tab=skills");
    expect(await screen.findByText("release-checklist-verification")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByText(/Read the checklist/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(auto.state.moves).toEqual(["disable"]));
    auto.state.skill = { ...auto.state.skill, quarantined: true };
    fireEvent.click(screen.getByRole("button", { name: "Test again" }));
    await waitFor(() => expect(auto.state.moves).toContain("revalidate"));
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
  });
});
