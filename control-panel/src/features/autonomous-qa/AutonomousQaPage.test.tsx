// Autonomous QA through the whole app: off by default with every blocker
// named, approving an environment and a mode is a person's save against the
// revision it read, production refuses a writing mode, a contract that is not
// JSON is never sent, and an investigation's report opens -- with no button
// anywhere that starts an investigation.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeAutonomousQa } from "../../testing/fakeAutonomousQa";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let aqa: ReturnType<typeof fakeAutonomousQa>;

beforeEach(() => {
  aqa = fakeAutonomousQa();
  vi.stubGlobal("fetch", fakeServer(undefined, aqa.handle).fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Autonomous QA", () => {
  it("is off by default, names what is missing, and offers nothing that runs an investigation", async () => {
    renderApp("/autonomous-qa");
    expect(await screen.findByText(/Autonomous QA is off/)).toBeTruthy();
    expect(screen.getByText(/autonomous QA is off for this project/)).toBeTruthy();
    expect(screen.getByText(/no environment is approved/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(run|start|explore)/i })).toBeNull();
  });

  it("the list says where each investigation stands and whether it waits for a person", async () => {
    renderApp("/autonomous-qa");
    expect(await screen.findByText("paused — needs-requirement · 1 question(s) waiting for a person")).toBeTruthy();
    expect(screen.getByText(/explore-write · test · hybrid/)).toBeTruthy();
  });

  it("the loop's limits and the memory switch are a person's settings, saved with the rest", async () => {
    renderApp("/autonomous-qa");
    fireEvent.change(await screen.findByLabelText(/Decisions per investigation/), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("switch", { name: /Keep what an investigation verified/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(aqa.state.settings.limits.decisions).toBe(80));
    expect(aqa.state.settings.memory.project).toBe(false);
  });

  it("outside a checkout it says where to start Control", async () => {
    aqa.state.inCheckout = false;
    renderApp("/autonomous-qa");
    expect(await screen.findByText(/Start Orbit Control from the project's checkout/)).toBeTruthy();
  });

  it("approving an environment and a mode is saved against the revision it was read at", async () => {
    renderApp("/autonomous-qa");
    fireEvent.click(await screen.findByRole("switch", { name: /Autonomous QA is off/ }));
    fireEvent.change(screen.getByLabelText("Environment id"), { target: { value: "test" } });
    fireEvent.change(screen.getByLabelText(/^Origin/), { target: { value: "https://app.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add environment" }));
    fireEvent.click(screen.getByLabelText("explore-write"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(aqa.state.revision).toBe("rev-1"));
    expect(aqa.state.settings.enabled).toBe(true);
    expect(aqa.state.settings.environments).toEqual([{ id: "test", origin: "https://app.test", kind: "test", modes: ["explore-write"] }]);
    aqa.state.revision = "somebody-else";
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/changed since you opened them/)).toBeTruthy();
  });

  it("a production environment offers no writing mode", async () => {
    renderApp("/autonomous-qa");
    fireEvent.change(await screen.findByLabelText("Environment id"), { target: { value: "prod" } });
    fireEvent.change(screen.getByLabelText(/^Origin/), { target: { value: "https://app.example" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "production" } });
    fireEvent.click(screen.getByRole("button", { name: "Add environment" }));
    const explore = screen.getByLabelText("explore-write");
    expect(explore.hasAttribute("disabled")).toBe(true);
  });

  it("a contract that is not JSON is never sent", async () => {
    renderApp("/autonomous-qa");
    fireEvent.change(await screen.findByLabelText(/Tenancy contract/), { target: { value: "{ not json" } });
    expect(await screen.findByText(/The tenancy contract is not JSON/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("lists every investigation with its outcomes, and opens the redacted report", async () => {
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    URL.createObjectURL = vi.fn(() => "blob:report");
    renderApp("/autonomous-qa");
    expect(await screen.findByText("why Save sends two requests")).toBeTruthy();
    expect(screen.getByText("confirmed 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open report inv-20260925-120000-ab12" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("blob:report", "_blank", "noopener"));
    expect(aqa.state.reports).toEqual(["inv-20260925-120000-ab12"]);
  });

  it("a generation's limits are a person's too: a write budget and a repair budget may be none, and a test gets at least ten seconds", async () => {
    renderApp("/autonomous-qa");
    fireEvent.change(await screen.findByLabelText(/Writes a generated test may be granted/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/Repairs of a design's representation/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/Seconds a generated test may run/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Attempts of one frozen version/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(aqa.state.settings.limits.writes).toBe(0));
    expect([aqa.state.settings.limits.repairs, aqa.state.settings.limits.caseSeconds, aqa.state.settings.limits.attempts]).toEqual([0, 10, 5]);
  });

  it("an investigation's generated tests are read only: the word each attempt earned, its design and its frozen case -- nothing that runs one", async () => {
    renderApp("/autonomous-qa");
    fireEvent.click(await screen.findByRole("button", { name: "Generated tests of inv-20260925-120000-ab12" }));
    expect(await screen.findByText("permission-enforced")).toBeTruthy();
    expect(screen.getByText("SATISFIED (MET)")).toBeTruthy();
    expect(screen.getByText("endpoint:invoice-read")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Design of permission-enforced" }));
    expect(await screen.findByText(/"identityRef": "tenant-a-reader"/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Frozen case of permission-enforced" }));
    expect(await screen.findByText(/"capability": "orbit.http.read"/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(run|repair|promote|retry)/i })).toBeNull();
  });
});
