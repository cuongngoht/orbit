// PO Reports through the whole app: the overview says what is missing and
// where to get it, settings are saved against the revision they were read at,
// Data coverage cannot be switched off, per-person numbers start off, and a
// replacement of a standard part waits for a person's confirmation.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeReports, signingIn } from "../../testing/fakeReports";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let reports: ReturnType<typeof fakeReports>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  reports = fakeReports();
  server = fakeServer(undefined, reports.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("PO Reports", () => {
  it("the overview names the project, a missing runtime and where to install it -- and offers no button that runs a report", async () => {
    renderApp("/reports");
    expect(await screen.findByText("portal")).toBeTruthy();
    expect(screen.getByText(/No Python: no Python 3.11 or newer was found/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Install Python" }).getAttribute("href")).toBe("/tools/python");
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
  });

  it("a connection that signs in is shown on the overview by the way it gets in -- never as a credential that is not set", async () => {
    reports.connections.set("azure-acme", signingIn("azure-acme"));
    reports.state.settings = { ...reports.state.settings, provider: "azure-devops", connection: "azure-acme" };
    renderApp("/reports");
    expect(await screen.findByText("azure-acme · Microsoft sign-in")).toBeTruthy();
    expect(screen.queryByText(/No credential set/)).toBeNull();
  });

  it("and so is the connection a report reads through, on the connection tab", async () => {
    reports.connections.set("azure-acme", signingIn("azure-acme"));
    reports.state.settings = { ...reports.state.settings, provider: "azure-devops", connection: "azure-acme" };
    renderApp("/reports/connection");
    expect(await screen.findByText(/acme · https:\/\/dev\.azure\.com · Microsoft sign-in/)).toBeTruthy();
    expect(screen.queryByText(/No credential set/)).toBeNull();
  });

  it("started outside a checkout, every tab says where to start Control", async () => {
    reports.state.inCheckout = false;
    renderApp("/reports/settings");
    expect(await screen.findByText(/Start Orbit Control from the project's checkout/)).toBeTruthy();
  });

  it("settings are saved against the revision they were read at; somebody else's change in between is a 409 to reload", async () => {
    renderApp("/reports/settings");
    fireEvent.click(await screen.findByLabelText("GitHub"));
    fireEvent.change(screen.getByLabelText(/Repositories/), { target: { value: "acme/web\nacme/api" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(reports.state.revision).toBe("rev-1"));
    expect(reports.state.settings.scope).toEqual({ repositories: ["acme/web", "acme/api"] });
    expect(reports.state.settings.provider).toBe("github");
    reports.state.revision = "somebody-else";
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/changed since you opened them/)).toBeTruthy();
  });

  it("data coverage cannot be switched off, and per-person numbers start off", async () => {
    renderApp("/reports/sections");
    const coverage = await screen.findByLabelText("Data coverage & method");
    expect((coverage as HTMLInputElement).disabled).toBe(true);
    expect((coverage as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Contributors") as HTMLInputElement).checked).toBe(false);
  });

  it("a part that replaces a standard one runs only after a person approves it, in a dialog", async () => {
    renderApp("/reports/extensions");
    fireEvent.click(await screen.findByRole("button", { name: "Approve replacement" }));
    expect(await screen.findByText(/The standard part stops running for this project/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reports.state.settings.parts["demo.forecast"]).toEqual({ enabled: true, replace: true }));
    const approve = server.calls.find((c) => c.path === "/api/v1/reports/parts/approve");
    expect(approve?.body).toEqual({ part: "demo.forecast", revision: null });
  });
});
