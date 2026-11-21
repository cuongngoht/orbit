import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionSummary } from "@orbit-web/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./App";
import { takeAccessLink } from "./services/accessLink";
import { fakeApi, withStatus, type FakeApi } from "./testing/fakeApi";
import { FakeEventSource } from "./testing/fakeEventSource";
import { pushApp } from "./testing/events";
import { SESSION_ID, accountView, claudeStatus, idleFlow, sessionDetail, sessionSummary, settings, setupStatus, signedOutClaude, sources } from "./testing/fixtures";

const refused = (status: number, code: string, message: string) => withStatus(status, { error: { code, message } });

// A signed-in Orbit Web with nothing connected and no chat yet.
function signedIn(chats: SessionSummary[] = []): FakeApi {
  return fakeApi()
    .on("GET", "/api/claude/status", () => claudeStatus())
    .on("GET", "/api/settings", () => settings())
    .on("GET", "/api/sessions", () => chats)
    .on("GET", "/api/sources", () => sources())
    .on("GET", "/api/setup/status", () => setupStatus())
    .on("GET", "/api/account", () => accountView());
}

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

describe("Orbit Web opens on the Claude sign-in, and the Claude account is its sign-in", () => {
  test("signed out: the sign-in page, and nothing but the sign-in is asked of the API", async () => {
    const api = fakeApi().on("GET", "/api/claude/status", () => signedOutClaude());
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(api.calls.map((c) => c.path).filter((p) => !p.startsWith("/api/claude/"))).toEqual([]);
    expect(FakeEventSource.instances.map((s) => s.url)).not.toContain("/api/events");
  });

  test("a share link opens the read-only chat at once: no access token, no sign-in, nothing else of Orbit Web asked", async () => {
    const token = "B".repeat(43);
    window.history.replaceState(null, "", `/#/share/${token}`);
    const api = fakeApi().on("GET", `/api/shared/${token}`, () => ({ title: "Fix sum", repository: null, source: null, sharedAt: "2026-11-20T04:00:00.000Z", includeTools: false, events: [] }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Fix sum" })).toBeInTheDocument();
    expect(api.calls.map((c) => c.path)).toEqual([`/api/shared/${token}`]);
    window.history.replaceState(null, "", "/");
  });

  test("in token mode the access token is asked for first; the Claude sign-in waits for it", async () => {
    fakeApi().on("GET", "/api/claude/status", () => refused(401, "access_token_required", "This Orbit Web needs its access token."));
    render(<App />);
    expect(await screen.findByLabelText(/Access token/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Claude" })).toBeDisabled();
  });

  test("an access link goes straight to Claude's authorize link, and leaves no token in the address", async () => {
    const TOKEN = "0123456789abcdef0123456789abcdef";
    window.history.replaceState(null, "", `/#access=${TOKEN}`);
    takeAccessLink();
    let granted = false;
    const api = fakeApi()
      .on("GET", "/api/claude/status", () => (granted ? signedOutClaude() : refused(401, "access_token_required", "This Orbit Web needs its access token.")))
      .on("POST", "/api/access", () => ((granted = true), undefined))
      .on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }));
    render(<App />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/claude/login")).toBe(true));
    act(() => FakeEventSource.last("/api/claude/login/events").emit({ ...idleFlow(), state: "awaiting_user", url: "https://claude.com/cai/oauth/authorize?x=1", needsCode: true, updatedAt: "2026-11-19T00:01:00.000Z" }));
    expect(await screen.findByRole("link", { name: "https://claude.com/cai/oauth/authorize?x=1" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Access token/)).toBeNull();
    expect(api.calls.find((c) => c.path === "/api/access")?.body).toEqual({ token: TOKEN });
    expect(window.location.href).not.toContain(TOKEN);
  });

  test("a browser with no session signs in itself even when the CLI is signed in, and the verified sign-in is exchanged for its session", async () => {
    let session = false;
    const api = fakeApi()
      .on("GET", "/api/claude/status", () => (session ? claudeStatus() : signedOutClaude({ runtime: "connected" })))
      .on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }))
      .on("POST", "/api/claude/session", () => ((session = true), claudeStatus()))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sessions", () => [])
      .on("GET", "/api/sources", () => sources());
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/claude/login")).toBe(true));
    act(() => FakeEventSource.last("/api/claude/login/events").emit({ ...idleFlow(), state: "connected", message: "Signed in to Claude as octo@example.com.", updatedAt: "2026-11-19T00:02:00.000Z" }));
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === "/api/claude/session").length).toBe(1);
  });

  test("a change carries this browser session's CSRF token", async () => {
    const api = signedIn().on("PATCH", "/api/settings", () => settings());
    render(<App />);
    await screen.findByRole("heading", { name: "What should Orbit work on?" });
    const { send } = await import("./services/api");
    await send("PATCH", "/api/settings", { theme: "dark" });
    expect(api.calls.find((c) => c.method === "PATCH")?.headers?.["x-orbit-csrf"]).toBe("c".repeat(64));
  });

  test("a sign-in that ended elsewhere (a terminal, an expiry) closes the workspace", async () => {
    let signedInNow = true;
    fakeApi()
      .on("GET", "/api/claude/status", () => (signedInNow ? claudeStatus() : signedOutClaude()))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/sessions", () => {
        signedInNow = false;
        return refused(401, "claude_sign_in_required", "Sign in to Orbit Web with your Claude account first.");
      });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
  });
});

describe("signed in: the workspace, as in Claude Code", () => {
  test("opens at once on a new session with the composer -- no connector is needed -- and follows the app stream", async () => {
    signedIn();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repository: none" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Model Sonnet 5.5, effort Medium" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mode Autonomous" })).toBeInTheDocument();
    const sidebar = screen.getByRole("navigation", { name: "Orbit" });
    expect(within(sidebar).getByRole("button", { name: "New session" })).toBeInTheDocument();
    expect(await within(sidebar).findByText("No chats yet.")).toBeInTheDocument();
    expect(FakeEventSource.instances.map((s) => s.url)).toContain("/api/events");
  });

  test("the account sits at the bottom of the sidebar; its menu opens Settings, and Sign out signs this browser out and returns to the sign-in page, which opens a new sign-in", async () => {
    let signedInNow = true;
    const api = signedIn()
      .on("GET", "/api/claude/status", () => (signedInNow ? claudeStatus() : signedOutClaude({ runtime: "connected" })))
      .on("DELETE", "/api/claude/session", () => ((signedInNow = false), signedOutClaude({ runtime: "connected" })))
      .on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as octo@example.com" }));
    expect(await screen.findByText("Octo Org · max")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(window.location.hash).toBe("#/?settings=account");
    expect(within(dialog).getByLabelText("Account").textContent).toContain("octo@example.com");
    expect(within(dialog).getByLabelText("Account").textContent).toContain("Octo Org · max");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    // The dialog's close transition hides the rest of the page from assistive technology for a moment: wait for it.
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as octo@example.com" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    await waitFor(() => expect(api.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /api/claude/session", "POST /api/claude/login"]));
  });

  test("signing the account out everywhere, which the API refuses while Claude works in a chat, is said, and Orbit Web stays open", async () => {
    signedIn().on("POST", "/api/claude/logout", () => refused(409, "run_active", "Claude is still working in a chat. Stop it before signing out."));
    window.location.hash = "#/?settings=account";
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Sign the account out everywhere" }));
    expect(await within(dialog).findByText("Claude is still working in a chat. Stop it before signing out.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Orbit Web" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message", hidden: true })).toBeInTheDocument();
  });

  test("sending the first message creates the chat -- with no repository -- and opens it", async () => {
    const created = sessionSummary({ source: null, repository: null, branch: null, workBranch: null, status: "preparing", title: "Explain the CLI" });
    const api = signedIn()
      .on("POST", "/api/sessions", () => created)
      .on("GET", `/api/sessions/${SESSION_ID}`, () => sessionDetail({ ...created }));
    render(<App />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message" }), "Explain the CLI{Enter}");
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${SESSION_ID}`));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ repository: null, branch: null, model: "sonnet", effort: "medium", mode: "autonomous", prompt: "Explain the CLI" });
    expect(await screen.findByRole("region", { name: "Chat" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Chats" })).getByText("Explain the CLI")).toBeInTheDocument();
    expect(FakeEventSource.instances.map((s) => s.url)).toContain(`/api/sessions/${SESSION_ID}/events`);
  });

  test("the sidebar follows the app stream: a chat appears, works, and an open chat removed elsewhere goes back to a new session", async () => {
    window.location.hash = `#/chat/${SESSION_ID}`;
    signedIn([sessionSummary()]).on("GET", `/api/sessions/${SESSION_ID}`, () => sessionDetail());
    render(<App />);
    const chats = await screen.findByRole("list", { name: "Chats" });
    expect(await within(chats).findByText("Fix sum")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances.some((s) => s.url === "/api/events")).toBe(true));
    pushApp("session.summary", { session: sessionSummary({ id: "11111111-2222-4333-8444-555555555555", title: "Add the API", status: "running", updatedAt: "2026-11-20T01:00:00.000Z" }) });
    expect(await within(chats).findByText("Add the API")).toBeInTheDocument();
    expect(within(chats).getByLabelText("working")).toBeInTheDocument();
    expect(within(chats).getAllByRole("listitem")[0]?.textContent).toContain("Add the API");
    pushApp("session.removed", { sessionId: SESSION_ID });
    await waitFor(() => expect(within(chats).queryByText("Fix sum")).toBeNull());
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/");
  });

  test("a source that is not connected is connected from the repository picker, in Settings → Connectors", async () => {
    signedIn();
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Repository: none" }));
    await userEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(window.location.hash).toBe("#/?settings=connectors");
    expect(await within(dialog).findByRole("region", { name: "GitHub connection" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
  });

  test("Settings opens from the URL over the open view, and Customize opens its Skills", async () => {
    window.location.hash = "#/?settings=code";
    signedIn().on("GET", "/api/customizations", () => ({ orbit: { version: "0.6.0", skills: [], agents: [] }, projects: [] }));
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Code" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("switch", { name: "Run project plugins" })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(await screen.findByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/?settings=skills");
  });

  test("the sidebar folds, and stays folded on the next visit", async () => {
    signedIn();
    const { unmount } = render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Close the sidebar" }));
    expect(screen.getByRole("button", { name: "Open the sidebar" })).toBeInTheDocument();
    unmount();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Open the sidebar" })).toBeInTheDocument();
  });
});
