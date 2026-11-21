import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionSummary } from "@orbit-web/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./App";
import { takeAccessLink } from "./services/accessLink";
import { fakeApi, withStatus, type FakeApi } from "./testing/fakeApi";
import { FakeEventSource } from "./testing/fakeEventSource";
import { pushApp } from "./testing/events";
import { SESSION_ID, TRIAL, authStatus, authUser, governanceOverview, sessionDetail, sessionSummary, sessionViews, settings, setupRequired, setupStatus, signedOut, sources } from "./testing/fixtures";
import { EMP_ANA, connectionsView, employeeDetail, resourceSummary } from "./testing/officeFixtures";

const refused = (status: number, code: string, message: string) => withStatus(status, { error: { code, message } });

// A signed-in Orbit Web with nothing connected and no chat yet.
function signedIn(chats: SessionSummary[] = []): FakeApi {
  return fakeApi()
    .on("GET", "/api/auth/status", () => authStatus())
    .on("GET", "/api/settings", () => settings())
    .on("GET", "/api/sessions", () => chats)
    .on("GET", "/api/sources", () => sources())
    .on("GET", "/api/setup/status", () => setupStatus())
    .on("GET", "/api/auth/sessions", () => sessionViews());
}

// What a page asked of the API that changes something.
const changes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
// Anything that would start or touch an AI provider's sign-in.
const providerCalls = (api: FakeApi) => api.calls.filter((c) => c.path.startsWith("/api/claude/login") || c.path.startsWith("/api/claude/session") || (c.method !== "GET" && c.path.startsWith("/api/connections")));

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

describe("Orbit Web opens on Orbit's own sign-in, and no AI provider is asked", () => {
  test("signed out: the sign-in form, and nothing but the sign-in is asked of the API", async () => {
    const api = fakeApi().on("GET", "/api/auth/status", () => signedOut());
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Username" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password\W*$/)).toHaveAttribute("type", "password");
    expect(screen.queryByText(/Continue with Claude/)).toBeNull();
    expect(api.calls.map((c) => c.path)).toEqual(["/api/auth/status"]);
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

  test("in token mode the access token is asked for first; Orbit's sign-in waits for it", async () => {
    fakeApi().on("GET", "/api/auth/status", () => refused(401, "access_token_required", "This Orbit Web needs its access token."));
    render(<App />);
    expect(await screen.findByLabelText(/Access token/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  test("an access link opens Orbit's sign-in, and leaves no token in the address", async () => {
    const TOKEN = "0123456789abcdef0123456789abcdef";
    window.history.replaceState(null, "", `/#access=${TOKEN}`);
    takeAccessLink();
    let granted = false;
    const api = fakeApi()
      .on("GET", "/api/auth/status", () => (granted ? signedOut() : refused(401, "access_token_required", "This Orbit Web needs its access token.")))
      .on("POST", "/api/access", () => ((granted = true), undefined));
    render(<App />);
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Access token/)).toBeNull();
    expect(api.calls.find((c) => c.path === "/api/access")?.body).toEqual({ token: TOKEN });
    expect(window.location.href).not.toContain(TOKEN);
    expect(providerCalls(api)).toEqual([]);
  });

  test("signing in sends the username and password, opens the workspace with the user's full name, and starts no provider sign-in", async () => {
    let session = false;
    const api = signedIn()
      .on("GET", "/api/auth/status", () => (session ? authStatus() : signedOut()))
      .on("POST", "/api/auth/login", () => ((session = true), authStatus()));
    render(<App />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Username" }), "admin");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "a long passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/api/auth/login")?.body).toEqual({ username: "admin", password: "a long passphrase" });
    expect(within(screen.getByRole("navigation", { name: "Orbit" })).getByRole("button", { name: "Signed in as Ann Owner" })).toBeInTheDocument();
    expect(changes(api)).toEqual(["POST /api/auth/login"]);
    expect(providerCalls(api)).toEqual([]);
  });

  test("a wrong password is said as the API says it, and too many attempts as a wait", async () => {
    let reply = refused(401, "invalid_credentials", "The username or the password is not right.");
    fakeApi()
      .on("GET", "/api/auth/status", () => signedOut())
      .on("POST", "/api/auth/login", () => reply);
    render(<App />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Username" }), "admin");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("The username or the password is not right.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password\W*$/)).toHaveValue("");
    reply = refused(429, "too_many_attempts", "Too many attempts: wait 30 seconds.");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "wrong again");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Too many attempts: wait 30 seconds.")).toBeInTheDocument();
  });

  test("a new installation shows the first administrator's setup, and the setup opens the workspace", async () => {
    let done = false;
    const api = signedIn()
      .on("GET", "/api/auth/status", () => (done ? authStatus() : setupRequired()))
      .on("POST", "/api/auth/setup", () => ((done = true), authStatus()));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Set up Orbit Web" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /One-time setup code/ }), "ABCD-EFGH-1234");
    await userEvent.type(screen.getByRole("textbox", { name: /Full name/ }), "Ann Owner");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "violet harbour lantern");
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "violet harbour lantern");
    await userEvent.click(screen.getByRole("button", { name: "Create the administrator" }));
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/api/auth/setup")?.body).toMatchObject({ code: "ABCD-EFGH-1234", username: "admin", fullName: "Ann Owner", password: "violet harbour lantern" });
  });

  test("a trial installation shows the red trial bar before and after signing in, and its Change password opens Settings → Account", async () => {
    let session = false;
    signedIn()
      .on("GET", "/api/auth/status", () => (session ? authStatus({ trial: TRIAL }) : signedOut({ trial: TRIAL })))
      .on("POST", "/api/auth/login", () => ((session = true), authStatus({ trial: TRIAL })));
    render(<App />);
    const bar = await screen.findByText(/Trial login admin \/ 123456 — change the password, never expose this installation/);
    expect(bar).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "admin");
    await userEvent.type(screen.getByLabelText(/^Password\W*$/), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "What should Orbit work on?" });
    expect(screen.getByText(/Trial login admin \/ 123456/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(window.location.hash).toBe("#/?settings=account");
    expect(within(dialog).getByRole("form", { name: "Change password" })).toBeInTheDocument();
  });

  test("a password set by somebody else must be changed before anything opens, and the change opens the workspace", async () => {
    let changed = false;
    const api = signedIn()
      .on("GET", "/api/auth/status", () => authStatus({ user: authUser({ mustChangePassword: !changed }) }))
      .on("POST", "/api/auth/password", () => ((changed = true), authStatus()));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Orbit" })).toBeNull();
    expect(api.calls.some((c) => c.path === "/api/sessions")).toBe(false);
    await userEvent.type(screen.getByLabelText(/^Current password/), "123456");
    await userEvent.type(screen.getByLabelText(/^New password/), "violet harbour lantern");
    await userEvent.type(screen.getByLabelText(/Repeat the new password/), "violet harbour lantern");
    await userEvent.click(screen.getByRole("button", { name: "Change password and continue" }));
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/api/auth/password")?.body).toEqual({ currentPassword: "123456", newPassword: "violet harbour lantern" });
  });

  test("a change carries this browser session's CSRF token", async () => {
    const api = signedIn().on("PATCH", "/api/settings", () => settings());
    render(<App />);
    await screen.findByRole("heading", { name: "What should Orbit work on?" });
    const { send } = await import("./services/api");
    await send("PATCH", "/api/settings", { theme: "dark" });
    expect(api.calls.find((c) => c.method === "PATCH")?.headers?.["x-orbit-csrf"]).toBe("c".repeat(64));
  });

  test("a session that ended elsewhere (sign out everywhere, an expiry) closes the workspace", async () => {
    let signedInNow = true;
    fakeApi()
      .on("GET", "/api/auth/status", () => (signedInNow ? authStatus() : signedOut()))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/sessions", () => {
        signedInNow = false;
        return refused(401, "sign_in_required", "Sign in to Orbit first.");
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
    const sidebar = screen.getByRole("navigation", { name: "Orbit" });
    expect(within(sidebar).getByRole("button", { name: "New session" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Office" })).toBeInTheDocument();
    expect(await within(sidebar).findByText("No chats yet.")).toBeInTheDocument();
    expect(FakeEventSource.instances.map((s) => s.url)).toContain("/api/events");
  });

  test("the account menu opens Settings; Sign out signs this browser out of Orbit and returns to the sign-in form", async () => {
    let signedInNow = true;
    const api = signedIn()
      .on("GET", "/api/auth/status", () => (signedInNow ? authStatus() : signedOut()))
      .on("POST", "/api/auth/logout", () => ((signedInNow = false), withStatus(204)));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ann Owner" }));
    expect(await screen.findByText("@admin · Octo & Co")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(window.location.hash).toBe("#/?settings=account");
    expect(within(dialog).getByLabelText("Account").textContent).toContain("Ann Owner");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ann Owner" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(changes(api)).toEqual(["POST /api/auth/logout"]);
    expect(providerCalls(api)).toEqual([]);
  });

  test("Sign out everywhere ends every session of the user", async () => {
    let signedInNow = true;
    const api = signedIn()
      .on("GET", "/api/auth/status", () => (signedInNow ? authStatus() : signedOut()))
      .on("POST", "/api/auth/logout-all", () => ((signedInNow = false), withStatus(204)));
    window.location.hash = "#/?settings=account";
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Sign out everywhere" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(changes(api)).toEqual(["POST /api/auth/logout-all"]);
  });

  test("a chat that needs an AI connection says where to connect one, with a link -- never a sign-in page", async () => {
    signedIn().on("POST", "/api/sessions", () => refused(409, "connection_required", "No Claude Code connection is connected."));
    render(<App />);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message" }), "Explain the CLI{Enter}");
    expect(await screen.findByText(/Connect Claude Code in Settings → AI Connections/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open AI Connections" });
    expect(link).toHaveAttribute("href", "#/?settings=ai-connections");
    expect(screen.queryByRole("heading", { name: "Sign in to Orbit Web" })).toBeNull();
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
  });

  test("Settings opens from the URL over the open view, and Customize opens its Skills", async () => {
    window.location.hash = "#/?settings=code";
    signedIn().on("GET", "/api/customizations", () => ({ orbit: { version: "0.6.0", skills: [], agents: [] }, projects: [] }));
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Code" })).toBeInTheDocument();
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

  test("Governance opens with the sign-in itself: the account's own console, its header naming the account", async () => {
    const api = signedIn().on("GET", "/api/governance/overview", () => governanceOverview());
    render(<App />);
    const sidebar = await screen.findByRole("navigation", { name: "Orbit" });
    await userEvent.click(within(sidebar).getByRole("button", { name: "Governance" }));
    expect(await screen.findByText("Policy in effect")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/governance/overview");
    expect(within(screen.getByRole("main")).getAllByText("Octo & Co").length).toBeGreaterThan(0);
    expect(api.calls.filter((c) => c.path.startsWith("/api/governance")).map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/governance/overview"]);
  });

  test("an office page is in the address: a reload of #/office/employee/<id>/resources opens that employee's Sandbox & resources", async () => {
    window.location.hash = `#/office/employee/${EMP_ANA}/resources`;
    const api = signedIn()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("GET", "/api/connections", () => connectionsView());
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Office · Employee" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Personal Sandbox" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sandbox & resources" })).toHaveAttribute("aria-selected", "true");
    expect(api.calls.some((c) => c.path === `/api/employees/${EMP_ANA}`)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(window.location.hash).toBe("#/office"));
  });
});
