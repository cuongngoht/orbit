// Security catalogs through the whole app (ADR 0040): Orbit's default is shown in effect until a
// project enables one, a catalog is adopted only as it was previewed, enabling and marking are a
// person's saves against the revision they read, a mark needs its reason, and nothing on the page
// runs an assessment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeSecurity } from "../../testing/fakeSecurity";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let security: ReturnType<typeof fakeSecurity>;

beforeEach(() => {
  security = fakeSecurity();
  vi.stubGlobal("fetch", fakeServer(undefined, security.handle).fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

describe("Security catalogs", () => {
  it("shows Orbit's default in effect, and offers nothing that runs an assessment", async () => {
    renderApp("/security");
    expect(await screen.findByText(/Orbit's default: this project has enabled no catalog/)).toBeTruthy();
    expect(screen.getByText(/asvs-5\.0\.0-l1 5\.0\.0/, { selector: "li" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(assess|run|scan|start)/i })).toBeNull();
  });

  it("previews a link, then adopts exactly what the preview showed, against the revision read", async () => {
    renderApp("/security");
    fireEvent.change(await screen.findByLabelText("Link (https)"), { target: { value: "https://catalogs.example/acme.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview link" }));
    expect(await screen.findByText(/2 control\(s\), digest bbbbbbbbbbbb/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adopt acme-policy 1" }));
    await waitFor(() => expect(security.state.adopted.map((c) => c.catalog)).toEqual(["acme-policy"]));
    expect(security.state.fetched).toEqual(["https://catalogs.example/acme.json"]);
  });

  it("a document that is not JSON is never sent", async () => {
    renderApp("/security");
    fireEvent.change(await screen.findByLabelText("Catalog document (JSON)"), { target: { value: "{ not json" } });
    expect(await screen.findByText(/Not JSON/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview document" }).hasAttribute("disabled")).toBe(true);
  });

  it("enabling a catalog for this project is saved against the revision it was read at, and a stale one says so", async () => {
    renderApp("/security");
    fireEvent.click(await screen.findByLabelText(/asvs-5\.0\.0-l1 5\.0\.0 · aaaaaaaaaaaa/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(security.state.enabled.map((e) => e.catalog)).toEqual(["asvs-5.0.0-l1"]));
    security.state.project = "somebody-else";
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/changed since you opened them/)).toBeTruthy();
  });

  it("a control is marked not applicable only with its reason, and the mark can be taken back", async () => {
    renderApp("/security");
    await screen.findByRole("option", { name: "v5.0.0-8.1.1" });
    fireEvent.change(screen.getByLabelText("Control"), { target: { value: "v5.0.0-8.1.1" } });
    expect(screen.getByRole("button", { name: "Mark not applicable" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Why it does not apply"), { target: { value: "documented in the platform handbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark not applicable" }));
    await waitFor(() => expect(security.state.marks.map((m) => [m.control, m.why])).toEqual([["v5.0.0-8.1.1", "documented in the platform handbook"]]));
    fireEvent.click(await screen.findByRole("button", { name: "Take back" }));
    await waitFor(() => expect(security.state.marks).toEqual([]));
  });
});
