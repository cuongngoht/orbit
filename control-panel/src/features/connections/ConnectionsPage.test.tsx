// Connections through the whole app: listed with how each gets in -- where its
// credential comes from, or the sign-in it keeps a session for -- created, given
// a credential that then exists nowhere in the page, and tested with the
// permission a token lacks named. (The Authentication card has its own tests.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { fakeReports, signingIn } from "../../testing/fakeReports";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";
import { required } from "../../testing/required";
import { docLabel, newerTest } from "./connectionWords";
import type { ConnectionTest } from "./connections.types";

const PAT = "github_pat_11PANELCANARY000000000000000000000000000000000000000000000000000";

let reports: ReturnType<typeof fakeReports>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  reports = fakeReports();
  server = fakeServer(undefined, reports.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

function sectionOf(title: string): HTMLElement {
  const found = screen.getByRole("heading", { name: title }).closest("section");
  if (!found) throw new Error(`no section titled ${title}`);
  return found;
}

describe("Connections", () => {
  it("lists each connection with where its credential comes from -- never what it is", async () => {
    renderApp("/connections");
    expect(await screen.findByText("github-acme")).toBeTruthy();
    expect(screen.getByText("Stored in this machine's OS secret store")).toBeTruthy();
    expect(screen.getByText(/Credentials: macOS Keychain/)).toBeTruthy();
  });

  it("lists a connection that signs in by the way it gets in -- never as a missing credential, which it keeps none of by design", async () => {
    reports.connections.set("azure-acme", signingIn("azure-acme"));
    renderApp("/connections");
    expect(await screen.findByText("azure-acme")).toBeTruthy();
    expect(screen.getByText("Microsoft sign-in")).toBeTruthy();
    expect(screen.getByText("Stored in this machine's OS secret store"), "a credential connection still says where it comes from").toBeTruthy();
    expect(screen.queryByText("No credential set")).toBeNull();
  });

  it("a credential connection with no credential set still says so", async () => {
    reports.connections.set("github-bare", { ...required(reports.connections.get("github-acme"), "the github-acme connection"), id: "github-bare", credential: { set: false, from: null } });
    renderApp("/connections");
    expect(await screen.findByText("github-bare")).toBeTruthy();
    expect(screen.getByText("No credential set")).toBeTruthy();
  });

  it("creates a connection with the fields its provider asks for, and opens it", async () => {
    const router = renderApp("/connections");
    fireEvent.click(await screen.findByRole("button", { name: "New connection" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "github-other" } });
    fireEvent.change(screen.getByLabelText(/Owner/), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/connections/github-other"));
    const post = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/connections");
    expect(post?.body).toEqual({ id: "github-other", provider: "github", organization: "other" });
    expect(post?.headers[TOKEN_HEADER]).toBe("tok-123");
  });

  it("a credential goes to the server once and is gone from the page, the cache and the browser's storage", async () => {
    renderApp("/connections/github-acme");
    const input = await screen.findByLabelText("Credential");
    fireEvent.change(input, { target: { value: PAT } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(await screen.findByText("Stored. It will not be shown again.")).toBeTruthy();
    expect(reports.received).toEqual([{ id: "github-acme", body: { value: PAT } }]);
    expect((screen.getByLabelText("Credential") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML.includes(PAT)).toBe(false);
    expect(JSON.stringify({ ...window.sessionStorage }).includes(PAT) || JSON.stringify({ ...window.localStorage }).includes(PAT)).toBe(false);
  });

  it("an environment variable is named instead of a value when that is what the person chooses", async () => {
    renderApp("/connections/github-acme");
    fireEvent.change(await screen.findByLabelText("Environment variable"), { target: { value: "REPORT_GITHUB_PAT" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this variable" }));
    expect(await screen.findByText(/read from that variable when a report runs/)).toBeTruthy();
    expect(reports.received[0]?.body).toEqual({ env: "REPORT_GITHUB_PAT" });
  });

  it("a test names each check, and the permission a token lacks", async () => {
    renderApp("/connections/github-acme");
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    const checks = await screen.findByRole("list", { name: "Checks" });
    expect(within(checks).getByText("authentication")).toBeTruthy();
    expect(within(checks).getByText("needs actions: read")).toBeTruthy();
    expect(within(sectionOf("Test")).getByText(/Something this report reads is not readable/)).toBeTruthy();
  });
});

describe("What a connection page shows", () => {
  const ran: ConnectionTest = { at: "2026-09-25T06:33:00Z", ok: false, identity: "Lan Nguyen", checks: [] };
  const kept: ConnectionTest = { at: "2026-09-25T06:35:58Z", ok: true, identity: "Lan Nguyen", checks: [] };

  it("the latest test, even when somebody else ran it after this page did", () => {
    expect(newerTest(ran, kept)).toBe(kept);
    expect(newerTest(kept, ran)).toBe(kept);
    expect(newerTest(undefined, kept)).toBe(kept);
    expect(newerTest(ran, undefined)).toBe(ran);
    expect(newerTest(undefined, undefined)).toBeUndefined();
  });

  it("two documentation pages on one host read as two", () => {
    expect(docLabel("https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate")).toBe("learn.microsoft.com › use-personal-access-tokens-to-authenticate");
    expect(docLabel("https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/oauth#scopes")).toBe("learn.microsoft.com › oauth#scopes");
    expect(docLabel("https://docs.github.com/")).toBe("docs.github.com");
  });
});
