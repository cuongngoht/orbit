import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Customizations, RuntimeConnection, SetupStatus, SystemUpdates, UpdateComponent, UpdateState } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import type { SettingsSection } from "../../hooks/useHashRoute";
import { fakeApi, withStatus, type FakeApi } from "../../testing/fakeApi";
import { pushApp } from "../../testing/events";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { SESSION_ID, authAccount, authStatus, authUser, idleFlow, inventory, sessionViews, settings, setupStatus } from "../../testing/fixtures";
import { CONN_CODEX, connection, connectionsView } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import type { SignOut } from "../auth/useSignOut";
import { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog";

const CUSTOMIZATIONS: Customizations = {
  orbit: { version: "0.6.0", skills: [{ name: "orbit-help", description: "Orbit's coordinator and navigator.", path: "skills/orbit-help/SKILL.md" }], agents: [{ name: "orbit-qa-agent", description: "Runs one bounded QA investigation.", path: "agents/orbit-qa-agent.md" }] },
  projects: [
    {
      sessionId: SESSION_ID,
      title: "Fix sum",
      inventory: inventory({
        plugins: [
          { id: "lint-kit@acme-tools", kind: "declared", source: "acme/claude-plugins", path: null, state: "declared", detail: null },
          { id: "broken@acme-tools", kind: "declared", source: "acme/claude-plugins", path: null, state: "failed", detail: "marketplace not found" },
        ],
      }),
    },
    // A chat started without a repository: nothing of a project's to list.
    { sessionId: "22222222-3333-4444-8555-666666666666", title: "Explain closures", inventory: inventory({ repository: null, skills: [], commands: [], agents: [], plugins: [], claudeMd: false, loaded: false }) },
  ],
};

// The fake API answers the last route registered for a path: the account this dialog reads is given here, not registered
// beside it.
function show(section: SettingsSection, o: { status?: SetupStatus; connector?: "github" | "azure"; api?: FakeApi } = {}) {
  let status = o.status ?? setupStatus();
  const api = (o.api ?? fakeApi())
    .on("GET", "/api/setup/status", () => status)
    .on("GET", "/api/customizations", () => CUSTOMIZATIONS)
    .on("PATCH", "/api/settings", (body) => settings(body as object))
    .on("GET", "/api/auth/sessions", () => sessionViews());
  const signOut: SignOut = { signOut: vi.fn(async () => undefined), signOutEverywhere: vi.fn(async () => undefined), busy: false, error: null, clear: vi.fn() };
  const p: SettingsDialogProps = { section, connector: o.connector ?? null, auth: { ...authStatus(), user: authUser() }, onAuth: vi.fn(), signOut, settings: settings(), onSettings: vi.fn(), onSection: vi.fn(), onClose: vi.fn() };
  renderLive(<SettingsDialog {...p} />);
  return { p, api, signOut, setStatus: (s: SetupStatus) => (status = s), statusReads: () => api.calls.filter((c) => c.path === "/api/setup/status").length };
}

const patches = (api: FakeApi) => api.calls.filter((c) => c.method === "PATCH").map((c) => c.body);
// The account's AI connections (GET /api/connections), and its OpenAI Codex one signed in, with its own models.
const withConnections = (...connections: RuntimeConnection[]) => fakeApi().on("GET", "/api/connections", () => connectionsView({ connections }));
const codexSignedIn = () =>
  connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", method: "subscription", plugins: null, isDefault: true, catalog: { source: "account", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", description: null, efforts: ["low", "medium", "high"], autoMode: true }, { id: "gpt-5.5", label: "GPT-5.5", description: null, efforts: ["low", "medium"], autoMode: true }], recommended: "gpt-6.1-sol", checkedAt: null } });
const sections = (nav: HTMLElement) => within(nav).getAllByRole("button").map((b) => b.textContent).filter((t) => t !== "");
const posted = (api: FakeApi, path: string) => api.calls.find((c) => c.method === "POST" && c.path === path);
const flow = (connector: "github" | "azure", over: object) => pushApp("connector.flow", { connector, flow: { ...idleFlow(), updatedAt: "2026-11-20T00:01:00.000Z", ...over } });
// The app stream this dialog follows is open, and every component that follows it has subscribed: a notification
// pushed before a component's subscribing effect ran would reach nobody.
async function streamOpen() {
  await waitFor(() => expect(FakeEventSource.instances.some((s) => s.url === "/api/events" && !s.closed)).toBe(true));
  await act(async () => undefined);
}

describe("Settings: the sections, over the page", () => {
  test("lists its sections, finds one by what it is about, and closes", async () => {
    const { p } = show("account");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const nav = within(dialog).getByRole("navigation", { name: "Settings sections" });
    expect(sections(nav)).toEqual(["Account", "Appearance", "Code", "AI Connections", "Compute & storage", "Connectors", "MCP servers", "Claude connectors", "Skills", "Plugins", "System"]);
    expect(within(nav).getByRole("button", { name: "Account" })).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getByRole("heading", { name: "Account" })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search settings" }), "effort");
    expect(sections(nav)).toEqual(["Code", "AI Connections"]);
    await userEvent.click(within(nav).getByRole("button", { name: "Code" }));
    expect(p.onSection).toHaveBeenCalledWith("code");
    await userEvent.clear(within(dialog).getByRole("searchbox", { name: "Search settings" }));
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search settings" }), "zzz");
    expect(within(nav).getByText("Nothing matches.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  test("Account: the person and the Orbit account -- profile, company with If-Match, password, sessions -- and the ways out", async () => {
    let accountReply: unknown = authAccount({ companyName: "Octo Labs", version: 4 });
    const api = fakeApi()
      .on("PATCH", "/api/auth/profile", (body) => authUser(body as object))
      .on("PATCH", "/api/account", () => accountReply)
      .on("GET", "/api/account", () => authAccount({ companyName: "Octo Labs", version: 5 }))
      .on("DELETE", "/api/auth/sessions/s-2", () => withStatus(204));
    const { p, signOut } = show("account", { api });
    const account = await screen.findByLabelText("Account");
    expect(account.textContent).toContain("Ann Owner");
    expect(account.textContent).toContain("@admin · Owner · Octo & Co");
    // The email is the user's, and unverified until Orbit can send mail.
    const profile = within(account).getByRole("form", { name: "Your profile" });
    expect(within(profile).getByText("unverified")).toBeInTheDocument();
    const fullName = within(profile).getByRole("textbox", { name: /Full name/ });
    await userEvent.clear(fullName);
    await userEvent.type(fullName, "Ann B. Owner");
    await userEvent.click(within(profile).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/auth/profile")?.body).toEqual({ fullName: "Ann B. Owner" }));
    await waitFor(() => expect(p.onAuth).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ fullName: "Ann B. Owner" }) })));
    // The account is changed against the version read.
    const org = within(account).getByRole("form", { name: "Orbit account" });
    const company = within(org).getByRole("textbox", { name: "Company name" });
    await userEvent.clear(company);
    await userEvent.type(company, "Octo Labs");
    await userEvent.click(within(org).getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH" && c.path === "/api/account")).toBeDefined());
    const patch = api.calls.find((c) => c.method === "PATCH" && c.path === "/api/account");
    expect(patch?.body).toEqual({ companyName: "Octo Labs" });
    expect(patch?.headers["if-match"]).toBe('"3"');
    // A version that moved on is said, and the latest is offered -- never saved over.
    accountReply = withStatus(412, { error: { code: "stale_version", message: "The account changed." } });
    await userEvent.click(within(org).getByRole("button", { name: "Save account" }));
    expect(await within(org).findByText(/The account changed since this page read it: nothing was saved/)).toBeInTheDocument();
    await userEvent.click(within(org).getByRole("button", { name: "Load the latest" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "GET" && c.path === "/api/account")).toBe(true));
    // The sessions of the user: one ended, this browser, or all.
    const sessions = await within(account).findByRole("list", { name: "Signed-in sessions" });
    expect(within(sessions).getByText("This browser")).toBeInTheDocument();
    await userEvent.click(within(sessions).getByRole("button", { name: "Sign out Safari on a phone" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/auth/sessions/s-2")).toBe(true));
    await userEvent.click(within(account).getByRole("button", { name: "Sign out of this browser" }));
    expect(signOut.signOut).toHaveBeenCalled();
    await userEvent.click(within(account).getByRole("button", { name: "Sign out everywhere" }));
    expect(signOut.signOutEverywhere).toHaveBeenCalled();
    expect(within(account).getByRole("form", { name: "Change password" })).toBeInTheDocument();
  });

  test("Account: the access link, to copy or open in another browser -- given only to whoever is in", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const TOKEN = "a-long-and-random-access-token";
    const LINK = `${window.location.origin}/#access=${TOKEN}`;
    show("account", { api: fakeApi().on("GET", "/api/access/link", () => ({ token: TOKEN })) });
    const card = await screen.findByLabelText("Access link");
    expect(await within(card).findByRole("textbox", { name: "Access link" })).toHaveValue(LINK);
    expect(card.textContent).toMatch(/anyone with this link/i);
    await userEvent.click(within(card).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await within(card).findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Open in a new tab" }));
    expect(opened).toHaveBeenCalledWith(LINK, "_blank", "noopener,noreferrer");
    opened.mockRestore();
  });

  test("Account: on this machine alone there is no access link, and it says why", async () => {
    show("account", { api: fakeApi().on("GET", "/api/access/link", () => ({ token: null })) });
    const card = await screen.findByLabelText("Access link");
    expect(await within(card).findByText(/answers this machine only/i)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  test("System: the checks and the versions this container holds", async () => {
    show("system");
    const system = await screen.findByLabelText("System Status");
    expect(system.textContent).toContain("Everything is in place.");
    expect(system.textContent).toContain("0.6.0");
    // The database, as PostgreSQL answers about itself -- never its address, its user or a connection string.
    expect(system.textContent).toContain("PostgreSQL 17.6 · schema 3 · pgvector 0.8.1");
    expect(system.textContent).not.toMatch(/postgres(ql)?:\/\//i);
  });

  test("System: whether a newer release exists -- each component against its publisher's newest, checked when asked, and how to update without a new Orbit Web", async () => {
    const row = (component: UpdateComponent, installed: string | null, latest: string | null, state: UpdateState, security: boolean | null = null, detail: string | null = null) => ({ component, installed, latest, state, security, detail });
    const notYet: SystemUpdates = { checkedAt: null, components: [row("claude", "2.1.328", null, "not_checked", null, "Not checked yet.")], howToUpdate: ["node scripts/update-pins.mjs --apply", "docker compose up -d"] };
    const checked: SystemUpdates = {
      checkedAt: "2026-11-22T08:00:00.000Z",
      components: [row("claude", "2.1.328", "2.1.341", "update_available"), row("codex", "0.169.0", "0.169.0", "up_to_date"), row("node", "24.22.3", "24.23.1", "update_available", true), row("az", "2.91.0", null, "unknown", null, "Its publisher could not be asked: offline"), row("git", "2.39.5", null, "not_checked", null, "Git comes with the image's base system.")],
      howToUpdate: notYet.howToUpdate,
    };
    const api = fakeApi().on("GET", "/api/system/updates", () => notYet).on("POST", "/api/system/updates/check", () => checked);
    show("system", { api });
    const updates = await screen.findByRole("region", { name: "Updates" });
    expect(await within(updates).findByText("Not checked yet.")).toBeInTheDocument();
    await userEvent.click(within(updates).getByRole("button", { name: "Check for updates" }));
    expect(await within(updates).findByText("2.1.341")).toBeInTheDocument();
    const rows = within(updates).getAllByRole("row").map((r) => r.textContent ?? "");
    expect(rows.find((r) => r.startsWith("Claude CLI"))).toMatch(/2\.1\.328.*2\.1\.341.*Update available/);
    expect(rows.find((r) => r.startsWith("OpenAI Codex CLI"))).toMatch(/Up to date/);
    expect(rows.find((r) => r.startsWith("Node.js"))).toMatch(/Security update/);
    expect(rows.find((r) => r.startsWith("Azure CLI"))).toMatch(/Couldn't check: Its publisher could not be asked: offline/);
    expect(rows.find((r) => r.startsWith("Git"))).toMatch(/Not checked: Git comes with the image's base system/);
    expect(within(updates).getByText(/2 updates available/)).toBeInTheDocument();
    expect(within(updates).getByText("node scripts/update-pins.mjs --apply")).toBeInTheDocument();
    expect(posted(api, "/api/system/updates/check")).toBeTruthy();
  });

  test("System: a database that does not answer, or whose schema or pgvector is missing, is said so", async () => {
    const status = setupStatus();
    show("system", { status: { ...status, health: { ...status.health, status: "degraded", database: { ok: false, detail: "PostgreSQL does not answer.", server: null, schema: 2, latestSchema: 3, pgvector: null } } } });
    const system = await screen.findByLabelText("System Status");
    expect(system.textContent).toContain("Something here is not usable.");
    expect(system.textContent).toContain("PostgreSQL does not answer. (PostgreSQL · schema 2 of 3 · pgvector not enabled)");
  });
});

describe("Settings → Connectors: GitHub and Azure DevOps, as Claude's connectors look", () => {
  test("a table of the two connectors: their type, authorization and status", async () => {
    show("connectors", { status: setupStatus({}, { state: "connected", account: { login: "octo", name: "Octo Cat" } }) });
    const table = await screen.findByRole("table", { name: "Connectors" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Connector", "Type", "Authorization", "Status"]);
    const github = within(table).getByRole("row", { name: "GitHub" });
    expect(github.textContent).toContain("CLI · gh");
    expect(github.textContent).toContain("Individual");
    expect(github.textContent).toContain("@octo");
    const azure = within(table).getByRole("row", { name: "Azure DevOps" });
    expect(azure.textContent).toContain("CLI · az");
    expect(within(azure).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  test("GitHub: Connect starts GitHub CLI's device sign-in; its link and code arrive on the app stream; a finished one reads the status again", async () => {
    const { api, statusReads } = show("connectors", { api: fakeApi().on("POST", "/api/github/login", () => ({ ...idleFlow(), state: "starting" })) });
    const table = await screen.findByRole("table", { name: "Connectors" });
    await userEvent.click(within(within(table).getByRole("row", { name: "GitHub" })).getByRole("button", { name: "Connect" }));
    const detail = await screen.findByRole("region", { name: "GitHub connection" });
    await userEvent.click(within(detail).getByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => expect(posted(api, "/api/github/login")).toBeDefined());
    expect(posted(api, "/api/github/login")?.headers["x-orbit-web"]).toBe("1");
    await streamOpen();
    flow("github", { state: "awaiting_user", url: "https://github.com/login/device", code: "WXYZ-1234" });
    expect(await within(detail).findByLabelText("one-time code")).toHaveTextContent("WXYZ-1234");
    expect(within(detail).getByRole("link", { name: "https://github.com/login/device" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(detail).getByText("Waiting for authorization…")).toBeInTheDocument();
    const before = statusReads();
    flow("github", { state: "connected", message: "Connected as octo.", updatedAt: "2026-11-20T00:02:00.000Z" });
    await waitFor(() => expect(statusReads()).toBeGreaterThan(before));
  });

  test("GitHub: a failed sign-in says what the CLI said", async () => {
    show("connectors", { connector: "github" });
    const detail = await screen.findByRole("region", { name: "GitHub connection" });
    await streamOpen();
    flow("github", { state: "failed", message: "failed to authenticate via web browser: HTTP 415" });
    expect(await within(detail).findByText(/HTTP 415/)).toBeInTheDocument();
  });

  test("GitHub: an expired sign-in keeps the chats and offers to connect again; a connected one disconnects", async () => {
    show("connectors", { connector: "github", status: setupStatus({}, { state: "expired", detail: "gh says the sign-in is error." }) });
    const detail = await screen.findByRole("region", { name: "GitHub connection" });
    expect(detail.textContent).toContain("Expired");
    expect(within(detail).getByText(/Your chats are kept/)).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
  });

  test("GitHub connected: who, the switch that lets Claude Code push and open pull requests, and Disconnect", async () => {
    const { api } = show("connectors", { connector: "github", status: setupStatus({}, { state: "connected", account: { login: "octo", name: "Octo Cat" } }), api: fakeApi().on("POST", "/api/github/logout", () => ({})) });
    const detail = await screen.findByRole("region", { name: "GitHub connection" });
    expect(detail.textContent).toContain("Connected as @octo (Octo Cat)");
    const toggle = within(detail).getByRole("switch", { name: "Let Claude Code push and open pull requests with this GitHub sign-in" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(patches(api)).toEqual([{ githubForClaude: true }]));
    await userEvent.click(within(detail).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/github/logout")).toBe(true));
  });

  test("Azure DevOps: Connect sends the optional tenant, and shows the URL and code the Azure CLI printed", async () => {
    const { api } = show("connectors", { connector: "azure", api: fakeApi().on("POST", "/api/azure/login", () => ({ ...idleFlow(), state: "starting" })) });
    const detail = await screen.findByRole("region", { name: "Azure DevOps connection" });
    await userEvent.type(within(detail).getByLabelText("Tenant (optional)"), "contoso.onmicrosoft.com");
    await userEvent.click(within(detail).getByRole("button", { name: "Connect Azure" }));
    await waitFor(() => expect(posted(api, "/api/azure/login")?.body).toEqual({ tenant: "contoso.onmicrosoft.com" }));
    await streamOpen();
    flow("azure", { state: "awaiting_user", url: "https://microsoft.com/devicelogin", code: "DXT2KQ9LM" });
    expect(await within(detail).findByLabelText("Azure one-time code")).toHaveTextContent("DXT2KQ9LM");
    expect(within(detail).getByRole("link", { name: "https://microsoft.com/devicelogin" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("Azure DevOps connected: who and which subscription, Sign out, and the switch that lets Claude Code use it", async () => {
    const azure = { state: "connected" as const, account: { user: "dev@contoso.com", userType: "user", tenantId: "t", subscription: "Contoso Dev", subscriptionId: "s" } };
    const { api } = show("connectors", { connector: "azure", status: setupStatus({}, {}, azure), api: fakeApi().on("POST", "/api/azure/logout", () => ({})) });
    const detail = await screen.findByRole("region", { name: "Azure DevOps connection" });
    expect(detail.textContent).toContain("Signed in as dev@contoso.com · Contoso Dev");
    const toggle = within(detail).getByRole("switch", { name: "Let Claude Code use this Azure sign-in" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(patches(api)).toEqual([{ azureForClaude: true }]));
    await userEvent.click(within(detail).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/azure/logout")).toBe(true));
  });

  test("an image without the Azure CLI says so and offers no sign-in", async () => {
    show("connectors", { connector: "azure", status: setupStatus({}, {}, { state: "unavailable", detail: "The Azure CLI is not installed in this image." }) });
    const detail = await screen.findByRole("region", { name: "Azure DevOps connection" });
    expect(within(detail).getByText(/not installed in this image/)).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Connect Azure" })).toBeNull();
  });

  test("a connector's status on the app stream reads the table again", async () => {
    const { setStatus, statusReads } = show("connectors");
    const table = await screen.findByRole("table", { name: "Connectors" });
    await streamOpen();
    const before = statusReads();
    setStatus(setupStatus({}, { state: "connected", account: { login: "octo", name: null } }));
    pushApp("connector.status", { connector: "github", state: "connected", account: "octo" });
    await waitFor(() => expect(statusReads()).toBeGreaterThan(before));
    expect(await within(table).findByText("@octo")).toBeInTheDocument();
  });
});

describe("Settings → Appearance and Code: saved as they change", () => {
  test("the theme", async () => {
    const { api, p } = show("appearance");
    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(patches(api)).toEqual([{ theme: "dark" }]));
    await waitFor(() => expect(p.onSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" })));
  });

  test("a new chat's AI, model, effort and mode; what a repository brings; the web tools", async () => {
    const { api } = show("code", { api: withConnections(connection()) });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(await within(dialog).findByLabelText("Default AI")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Claude Code"]);
    await userEvent.selectOptions(within(dialog).getByLabelText("Default model"), "opus");
    const effort = within(dialog).getByLabelText(/Default effort/);
    expect(within(effort).getAllByRole("option").map((o) => o.textContent)).toEqual(["Low", "Medium (recommended)", "High"]);
    await userEvent.selectOptions(effort, "high");
    await userEvent.click(within(dialog).getByRole("radio", { name: /^Plan — / }));
    expect(within(dialog).getByRole("switch", { name: "Load project skills" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("switch", { name: "Load project skills" }));
    expect(within(dialog).getByRole("switch", { name: "Run project plugins" })).not.toBeChecked();
    expect(within(dialog).getByText(/runs code — hooks at session start, MCP servers — in this container/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("switch", { name: "Run project plugins" }));
    await userEvent.click(within(dialog).getByRole("switch", { name: /web tools/ }));
    expect(within(dialog).getByText(/No per-run budget cap is set/)).toBeInTheDocument();
    await waitFor(() => expect(patches(api)).toEqual([{ defaultRuntime: "claude", defaultModel: "opus" }, { defaultRuntime: "claude", defaultEffort: "high" }, { defaultRuntime: "claude", defaultMode: "plan" }, { projectSkills: false }, { projectPlugins: true }, { webTools: true }]));
  });

  test("a new chat's defaults wait for an AI: with none signed in, the way to sign one in -- and no model of nobody's", async () => {
    show("code", { api: withConnections() });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(await within(dialog).findByRole("link", { name: "Open AI Connections" })).toHaveAttribute("href", expect.stringContaining("settings=ai-connections"));
    expect(within(dialog).getByText(/sign in with your subscription/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Default AI")).toBeNull();
    expect(within(dialog).queryByLabelText("Default model")).toBeNull();
    // What a repository brings is a chat's whatever AI it will run on.
    expect(within(dialog).getByRole("switch", { name: "Load project skills" })).toBeInTheDocument();
  });

  test("on OpenAI Codex alone, a new chat's AI is Codex and its models are Codex's; Claude Code says where to sign it in", async () => {
    const { api } = show("code", { api: withConnections(codexSignedIn()) });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(await within(dialog).findByLabelText("Default AI")).getAllByRole("option").map((o) => o.textContent)).toEqual(["OpenAI Codex"]);
    const model = within(dialog).getByLabelText("Default model");
    expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["GPT-6.1-Sol", "GPT-5.5"]);
    expect(model).toHaveValue("gpt-6.1-sol");
    expect(within(dialog).getByText(/Claude Code is not signed in/)).toBeInTheDocument();
    await userEvent.selectOptions(model, "gpt-5.5");
    await waitFor(() => expect(patches(api)).toEqual([{ defaultRuntime: "codex", defaultModel: "gpt-5.5" }]));
  });

  test("with Claude Code and OpenAI Codex signed in, the AI is chosen first", async () => {
    const { api } = show("code", { api: withConnections(connection(), codexSignedIn()) });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const ai = await within(dialog).findByLabelText("Default AI");
    expect(within(ai).getAllByRole("option").map((o) => o.textContent)).toEqual(["Claude Code", "OpenAI Codex"]);
    expect(within(dialog).queryByText(/is not signed in/)).toBeNull();
    await userEvent.selectOptions(ai, "codex");
    await waitFor(() => expect(patches(api)).toEqual([{ defaultRuntime: "codex" }]));
  });
});

describe("Settings → Skills and Plugins: what Claude Code is given", () => {
  test("each project's skills, commands and agents, Orbit's own in their tab, and a search over both", async () => {
    const { api } = show("skills");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const project = await within(dialog).findByRole("region", { name: "Skills of Fix sum" });
    expect(within(dialog).queryByRole("region", { name: "Skills of Explain closures" })).toBeNull();
    expect(project.textContent).toContain("Loaded for this chat, as instructions (no hooks, no pre-run commands).");
    expect(project.textContent).toContain("CLAUDE.md: read by Claude Code from the repository.");
    const rows = within(within(project).getByRole("table", { name: "Skills of Fix sum" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("release-notesskillWrite the release notes"), expect.stringContaining("/deploycommandDeploy the preview.")]);
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search skills" }), "deploy");
    await waitFor(() => expect(within(within(project).getByRole("table", { name: "Skills of Fix sum" })).getAllByRole("row")).toHaveLength(2));
    await userEvent.clear(within(dialog).getByRole("searchbox", { name: "Search skills" }));
    await userEvent.click(within(dialog).getByRole("tab", { name: "Orbit" }));
    const orbit = await within(dialog).findByRole("table", { name: "Orbit's skills" });
    expect(orbit.textContent).toContain("orbit-help");
    expect(orbit.textContent).toContain("orbit-qa-agent");
    await streamOpen();
    const reads = api.calls.filter((c) => c.path === "/api/customizations").length;
    pushApp("customizations.changed", { sessionId: SESSION_ID });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/customizations").length).toBeGreaterThan(reads));
  });

  test("the plugins -- Orbit's, and each project's with what became of it -- and the way to the switch", async () => {
    const { p } = show("plugins");
    const table = await screen.findByRole("table", { name: "Plugins" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(4));
    const [, orbit, declared, failed] = within(table).getAllByRole("row");
    expect(orbit?.textContent).toContain("orbit");
    expect(orbit?.textContent).toContain("Loaded");
    expect(declared?.textContent).toContain("lint-kit@acme-tools");
    expect(declared?.textContent).toContain("octo/sum-fixture · acme/claude-plugins");
    expect(declared?.textContent).toContain("Not run");
    expect(failed?.textContent).toContain("Failed");
    await userEvent.click(screen.getByRole("button", { name: "Settings → Code" }));
    expect(p.onSection).toHaveBeenCalledWith("code");
  });
});
