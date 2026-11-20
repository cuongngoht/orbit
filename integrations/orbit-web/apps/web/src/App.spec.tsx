import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Settings } from "@orbit-web/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./App";
import { fakeApi, withStatus } from "./testing/fakeApi";
import { claudeStatus, setupStatus, signedOutClaude } from "./testing/fixtures";

const SETTINGS: Settings = { defaultModel: "sonnet", defaultEffort: "medium", defaultMode: "autonomous", projectPlugins: true, webTools: false, azureForClaude: false, theme: "system", maxBudgetUsd: null };
const github = { state: "connected" as const, account: { login: "octo", name: "Octo Cat" } };
const refused = (status: number, code: string, message: string) => withStatus(status, { error: { code, message } });

afterEach(() => {
  window.location.hash = "";
});

describe("Orbit Web opens on the Claude sign-in, and the Claude account is its sign-in", () => {
  test("signed out: the sign-in page, and nothing but the sign-in is asked of the API", async () => {
    const api = fakeApi().on("GET", "/api/claude/status", () => signedOutClaude());
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(api.calls.map((c) => c.path).filter((p) => !p.startsWith("/api/claude/"))).toEqual([]);
  });

  test("in token mode the access token is asked for first", async () => {
    fakeApi().on("GET", "/api/claude/status", () => refused(401, "access_token_required", "This Orbit Web needs its access token."));
    render(<App />);
    expect(await screen.findByLabelText("Access token")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Orbit Web" })).toBeNull();
  });

  test("signed in: the account is in the header and in Settings; Sign out returns to the sign-in page", async () => {
    window.location.hash = "#/settings";
    let signedIn = true;
    const api = fakeApi()
      .on("GET", "/api/claude/status", () => (signedIn ? claudeStatus() : signedOutClaude()))
      .on("GET", "/api/settings", () => SETTINGS)
      .on("GET", "/api/setup/status", () => setupStatus({}, github))
      .on("POST", "/api/claude/logout", () => ((signedIn = false), signedOutClaude()));
    render(<App />);
    const account = await screen.findByRole("button", { name: "Signed in as octo@example.com" });
    expect((await screen.findByLabelText("Claude Account")).textContent).toContain("octo@example.com");
    expect(screen.getByLabelText("Claude Account").textContent).toContain("Octo Org · max");
    await userEvent.click(account);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/api/claude/logout"]);
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  test("a sign-out the API refuses while Claude works in a chat is said, and Orbit Web stays open", async () => {
    window.location.hash = "#/setup";
    fakeApi()
      .on("GET", "/api/claude/status", () => claudeStatus())
      .on("GET", "/api/settings", () => SETTINGS)
      .on("GET", "/api/setup/status", () => setupStatus())
      .on("POST", "/api/claude/logout", () => refused(409, "run_active", "Claude is still working in a chat. Stop it before signing out."));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as octo@example.com" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByText("Claude is still working in a chat. Stop it before signing out.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Orbit Web" })).toBeNull();
    expect(screen.getByRole("button", { name: "Signed in as octo@example.com" })).toBeInTheDocument();
  });

  test("a sign-in that ended elsewhere (a terminal, an expiry) closes the workspace", async () => {
    window.location.hash = "#/setup";
    let signedIn = true;
    fakeApi()
      .on("GET", "/api/claude/status", () => (signedIn ? claudeStatus() : signedOutClaude()))
      .on("GET", "/api/settings", () => SETTINGS)
      .on("GET", "/api/setup/status", () => {
        signedIn = false;
        return refused(401, "claude_sign_in_required", "Sign in to Orbit Web with your Claude account first.");
      });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
  });
});
