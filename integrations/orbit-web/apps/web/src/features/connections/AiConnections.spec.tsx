import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { pushApp } from "../../testing/events";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { CSRF, authSession } from "../../testing/fixtures";
import { CONN_CLAUDE, CONN_CLAUDE_KEY, CONN_CODEX, PLUGIN_DIGEST, connection, connectionsView } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { AiConnectionsSection } from "./AiConnectionsSection";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const card = async (name: string) => screen.findByRole("region", { name });

describe("Settings → AI Connections: three CLIs, each said as its own CLI says it", () => {
  test("tells apart signing in to Orbit, connecting a provider, enabling a plugin and granting connectors", async () => {
    fakeApi().on("GET", "/api/connections", () => connectionsView());
    renderLive(<AiConnectionsSection />);
    const helper = await screen.findByLabelText("What is what");
    for (const t of ["Signing in to Orbit", "Connecting a provider", "Enabling a plugin", "Granting connectors"]) expect(within(helper).getByText(t)).toBeInTheDocument();
    expect(await card("Claude Code")).toBeInTheDocument();
    expect(await card("OpenAI Codex")).toBeInTheDocument();
    expect(await card("Google Antigravity")).toBeInTheDocument();
  });

  test("a CLI that is not installed says why, and offers no connection", async () => {
    fakeApi().on("GET", "/api/connections", () => connectionsView());
    renderLive(<AiConnectionsSection />);
    const codex = await card("OpenAI Codex");
    expect(within(codex).getByText("Not installed")).toBeInTheDocument();
    expect(within(codex).getByText(/codex was not found on this server's PATH/)).toBeInTheDocument();
    expect(within(codex).getByRole("button", { name: "Add a connection" })).toBeDisabled();
    expect(within(codex).getByText(/the CLI is not installed on this server/)).toBeInTheDocument();
  });

  test("a way of signing in that is not permitted or not verified is shown disabled, with its note and its source", async () => {
    fakeApi().on("GET", "/api/connections", () => connectionsView());
    renderLive(<AiConnectionsSection />);
    const agy = await card("Google Antigravity");
    const row = within(agy).getByRole("listitem", { name: "Subscription sign-in: Not permitted" });
    expect(row.textContent).toContain("not permitted by the provider's terms");
    expect(within(row).getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://antigravity.google/terms");
    await userEvent.click(within(agy).getByRole("button", { name: "Add a connection" }));
    const form = within(agy).getByRole("form", { name: "Add a Google Antigravity connection" });
    expect(within(form).getByRole("radio", { name: /Subscription sign-in — Not permitted/ })).toBeDisabled();
    expect(within(form).getByRole("radio", { name: "API key" })).toBeEnabled();
    const codex = await card("OpenAI Codex");
    expect(within(codex).getByRole("listitem", { name: "API key: Not verified" })).toBeInTheDocument();
  });

  test("a connection: its label, the default mark, its method, its status in words, who it is signed in as, its models and efforts, its capabilities", async () => {
    fakeApi().on("GET", "/api/connections", () => connectionsView());
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    expect(conn.textContent).toContain("Default");
    expect(conn.textContent).toContain("Subscription sign-in");
    expect(within(conn).getByText("Connected")).toBeInTheDocument();
    expect(conn.textContent).toContain("Signed in as ann@example.com");
    expect(conn.textContent).toContain("Models from your account");
    const models = within(conn).getByRole("list", { name: "Models of Claude subscription" });
    expect(models.textContent).toContain("Sonnet 5.5 (sonnet) · recommended — effort Low, Medium, High");
    expect(models.textContent).toContain("Haiku 5.5 (haiku) — no effort levels");
    const caps = within(conn).getByLabelText("Runtime capabilities");
    expect(caps.textContent).toContain("Web search");
    expect(caps.textContent).toContain("Run without local tools (employees)");
  });

  test("three answers kept apart on a card: authenticated (its status), which use it serves now, whether it runs employees -- an unsupported use left out", async () => {
    fakeApi().on("GET", "/api/connections", () =>
      connectionsView({
        connections: [
          connection(),
          connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", method: "api_key", isDefault: true, capabilities: { start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit: "no", pluginObservation: "no" }, plugins: null }),
        ],
      }),
    );
    renderLive(<AiConnectionsSection />);
    const claude = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    const uses = within(claude).getByLabelText("What this connection can be used for");
    expect(uses.textContent).toBe("ChatUsableResearchUsableAI employeesUsable");
    const codex = await within(await card("OpenAI Codex")).findByRole("listitem", { name: "Connection ChatGPT" });
    const codexUses = within(codex).getByLabelText("What this connection can be used for");
    // Research runs on Claude Code: it is not shown as "off" on Codex, it is not shown at all.
    expect(codexUses.textContent).toBe("ChatUsableAI employeesNot usable");
    expect(within(codex).getByText(/^AI employees: its model plane is not held to Orbit's tools/)).toBeInTheDocument();
  });

  test("where the operator switched signing in from a card off, a subscription shows the one terminal command to run on the server -- nothing of that sign-in passes through Orbit", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fakeApi().on("GET", "/api/connections", () => connectionsView({ connections: [connection({ auth: "disconnected", identity: null, reason: "No login in this connection's folder yet.", signInHere: false })] }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    expect(within(conn).getByText("Disconnected")).toBeInTheDocument();
    const command = within(conn).getByLabelText("Terminal command");
    expect(command).toHaveTextContent(`docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js ${CONN_CLAUDE}`);
    expect(conn.textContent).toContain("The sign-in URL and code never pass through Orbit");
    expect(within(conn).queryByRole("region", { name: "Sign in Claude subscription" })).toBeNull();
    await userEvent.click(within(conn).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(`docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js ${CONN_CLAUDE}`);
    expect(await within(conn).findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  test("Sign in on its card: the CLI's own sign-in runs on the server, its link opens in a new tab, and the code pasted goes back to it", async () => {
    const URL_ = "https://claude.com/cai/oauth/authorize?code=true&state=s1";
    const flow = (state: string, over: Record<string, unknown> = {}) => ({ connectionId: CONN_CLAUDE, mine: true, startedBy: "Ann", flow: { state, url: null, code: null, needsCode: false, message: null, startedAt: "2026-11-22T01:00:00.000Z", updatedAt: new Date().toISOString(), ...over } });
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView({ connections: [connection({ auth: "disconnected", identity: null, reason: "Nobody is signed in in this connection's home." })] }))
      .on("GET", `/api/connections/${CONN_CLAUDE}/sign-in`, () => flow("idle"))
      .on("POST", `/api/connections/${CONN_CLAUDE}/sign-in`, () => flow("awaiting_user", { url: URL_, needsCode: true }))
      .on("POST", `/api/connections/${CONN_CLAUDE}/sign-in/code`, () => flow("connected", { message: "Connected: Claude Code says it is signed in as ann@example.com." }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    const panel = within(conn).getByRole("region", { name: "Sign in Claude subscription" });
    expect(within(conn).queryByLabelText("Terminal command")).toBeNull();
    await userEvent.click(within(conn).getByRole("button", { name: "Use the server's terminal instead" }));
    expect(within(conn).getByLabelText("Terminal command")).toHaveTextContent(`connect.js ${CONN_CLAUDE}`);
    await userEvent.click(within(conn).getByRole("button", { name: "Hide the terminal command" }));
    expect(within(conn).queryByLabelText("Terminal command")).toBeNull();
    expect(panel.textContent).toContain("Sign in with your Claude account");
    await userEvent.click(await within(panel).findByRole("button", { name: "Sign in" }));
    const link = await within(panel).findByRole("link", { name: "Sign-in link" });
    expect(link).toHaveAttribute("href", URL_);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const loads = api.calls.filter((c) => c.method === "GET" && c.path === "/api/connections").length;
    await userEvent.type(within(panel).getByRole("textbox", { name: /Paste the code/ }), "the-code-0123#s1");
    await userEvent.click(within(panel).getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/sign-in/code"))?.body).toEqual({ code: "the-code-0123#s1" }));
    expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/sign-in/code"))?.headers["x-orbit-csrf"]).toBe(CSRF);
    await waitFor(() => expect(api.calls.filter((c) => c.method === "GET" && c.path === "/api/connections").length).toBeGreaterThan(loads), { timeout: 3000 });
  });

  test("Codex: the link and the one-time code to enter there -- nothing to paste back", async () => {
    fakeApi()
      .on("GET", "/api/connections", () => connectionsView({ installations: connectionsView().installations.map((i) => (i.runtime === "codex" ? { ...i, state: "installed", version: "0.169.0", detail: null } : i)), connections: [connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", auth: "disconnected", identity: null, plugins: null })] }))
      .on("GET", `/api/connections/${CONN_CODEX}/sign-in`, () => ({ connectionId: CONN_CODEX, mine: true, startedBy: "Ann", flow: { state: "awaiting_user", url: "https://auth.openai.com/codex/device", code: "VQZB-WOWS4", needsCode: false, message: null, startedAt: null, updatedAt: new Date().toISOString() } }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("OpenAI Codex")).findByRole("listitem", { name: "Connection ChatGPT" });
    expect(await within(conn).findByLabelText("One-time code")).toHaveTextContent("VQZB-WOWS4");
    expect(within(conn).getByRole("link", { name: "Sign-in link" })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
    expect(within(conn).queryByRole("textbox", { name: /Paste the code/ })).toBeNull();
    expect(conn.textContent).toContain("turns Connected by itself");
  });

  test("a sign-in another browser started: who, and nothing of its link or code", async () => {
    fakeApi()
      .on("GET", "/api/connections", () => connectionsView({ connections: [connection({ auth: "disconnected", identity: null })] }))
      .on("GET", `/api/connections/${CONN_CLAUDE}/sign-in`, () => ({ connectionId: CONN_CLAUDE, mine: false, startedBy: "Bao", flow: { state: "awaiting_user", url: null, code: null, needsCode: false, message: null, startedAt: null, updatedAt: new Date().toISOString() } }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    expect(await within(conn).findByText(/Bao is signing this connection in right now, from another browser/)).toBeInTheDocument();
    expect(within(conn).queryByRole("link", { name: "Sign-in link" })).toBeNull();
    expect(within(conn).getByRole("button", { name: "Cancel that sign-in" })).toBeInTheDocument();
  });

  test("adding a subscription starts its sign-in on its card by itself; Reconnect on a connected one runs it again", async () => {
    let made = false;
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView({ connections: made ? [connection({ auth: "disconnected", identity: null })] : [] }))
      .on("POST", "/api/connections", () => {
        made = true;
        return withStatus(201, connection({ auth: "disconnected", identity: null }));
      })
      .on("POST", `/api/connections/${CONN_CLAUDE}/sign-in`, () => ({ connectionId: CONN_CLAUDE, mine: true, startedBy: "Ann", flow: { state: "awaiting_user", url: "https://claude.com/cai/oauth/authorize?state=s2", code: null, needsCode: true, message: null, startedAt: null, updatedAt: new Date().toISOString() } }));
    renderLive(<AiConnectionsSection />);
    const claude = await card("Claude Code");
    await userEvent.click(within(claude).getByRole("button", { name: "Add a connection" }));
    const form = within(claude).getByRole("form", { name: "Add a Claude Code connection" });
    expect(form.textContent).toContain("Adding it starts its sign-in right away");
    await userEvent.click(within(form).getByRole("button", { name: "Add connection" }));
    expect(await within(claude).findByRole("link", { name: "Sign-in link" }, { timeout: 3000 })).toHaveAttribute("href", "https://claude.com/cai/oauth/authorize?state=s2");
    expect(api.calls.filter((c) => c.method === "POST" && c.path === `/api/connections/${CONN_CLAUDE}/sign-in`)).toHaveLength(1);
  });

  test("Reconnect on a connected subscription runs its sign-in again, here", async () => {
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("POST", `/api/connections/${CONN_CLAUDE}/sign-in`, () => ({ connectionId: CONN_CLAUDE, mine: true, startedBy: "Ann", flow: { state: "awaiting_user", url: "https://claude.com/cai/oauth/authorize?state=s3", code: null, needsCode: true, message: null, startedAt: null, updatedAt: new Date().toISOString() } }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    expect(within(conn).queryByRole("region", { name: "Sign in Claude subscription" })).toBeNull();
    await userEvent.click(within(conn).getByRole("button", { name: "Reconnect" }));
    expect(await within(conn).findByRole("link", { name: "Sign-in link" })).toHaveAttribute("href", "https://claude.com/cai/oauth/authorize?state=s3");
    expect(api.calls.some((c) => c.method === "POST" && c.path === `/api/connections/${CONN_CLAUDE}/sign-in`)).toBe(true);
  });

  test("an API key is typed once, sent once, and never shown back", async () => {
    const KEY = "sk-ant-api03-ThisIsTheSecretKeyValue_0123456789";
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("POST", "/api/connections", () => withStatus(201, connection({ id: CONN_CLAUDE_KEY, method: "api_key", label: "Claude key", terminalCommand: null, isDefault: false })));
    renderLive(<AiConnectionsSection />);
    const claude = await card("Claude Code");
    await userEvent.click(within(claude).getByRole("button", { name: "Add a connection" }));
    const form = within(claude).getByRole("form", { name: "Add a Claude Code connection" });
    await userEvent.click(within(form).getByRole("radio", { name: "API key" }));
    const field = within(form).getByLabelText(/^API key/, { selector: "input[type=password]" });
    expect(field).toHaveAttribute("type", "password");
    await userEvent.type(within(form).getByRole("textbox", { name: /Label/ }), "Claude key");
    await userEvent.type(field, KEY);
    await userEvent.click(within(form).getByRole("button", { name: "Add connection" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/connections")).toBe(true));
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/connections");
    expect(post?.body).toEqual({ runtime: "claude", method: "api_key", label: "Claude key", apiKey: KEY });
    expect(post?.headers["x-orbit-csrf"]).toBe(CSRF);
    await waitFor(() => expect(within(claude).queryByRole("form", { name: "Add a Claude Code connection" })).toBeNull());
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  test("the Orbit plugin on Claude Code: version and digest, a switch per use, and a grant names the digest shown", async () => {
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView({ connections: [connection({ plugins: { ...(connection().plugins as NonNullable<ReturnType<typeof connection>["plugins"]>), useCases: { chat: { approved: false, needsConfirmation: false, decidedAt: null }, employee: { approved: true, needsConfirmation: true, decidedAt: "2026-11-20T00:00:00.000Z" } } } })] }))
      .on("PUT", `/api/connections/${CONN_CLAUDE}/plugins/orbit`, () => connection().plugins);
    renderLive(<AiConnectionsSection />);
    const plugin = await within(await card("Claude Code")).findByRole("region", { name: "Plugins → Orbit" });
    expect(plugin.textContent).toContain("Version 0.6.0");
    expect(plugin.textContent).toContain(PLUGIN_DIGEST.slice(0, 12));
    // A grant made for an earlier version is not a grant of this one: it waits for a confirmation.
    expect(within(plugin).getByText("Needs your confirmation")).toBeInTheDocument();
    expect(within(plugin).getByRole("switch", { name: "Use the Orbit plugin for employees" })).not.toBeChecked();
    await userEvent.click(within(plugin).getByRole("switch", { name: "Use the Orbit plugin in chats" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ useCase: "chat", approved: true, digest: PLUGIN_DIGEST }));
  });

  test("never an Orbit plugin switch on Codex or Antigravity", async () => {
    fakeApi().on(
      "GET",
      "/api/connections",
      () =>
        connectionsView({
          connections: [connection(), connection({ id: "c1000000-0000-4000-8000-000000000009", runtime: "agy", label: "Gemini key", method: "api_key", terminalCommand: null, plugins: null, isDefault: true })],
        }),
    );
    renderLive(<AiConnectionsSection />);
    const agy = await card("Google Antigravity");
    expect(await within(agy).findByRole("listitem", { name: "Connection Gemini key" })).toBeInTheDocument();
    expect(within(agy).queryByRole("region", { name: "Plugins → Orbit" })).toBeNull();
    expect(within(agy).queryByRole("switch")).toBeNull();
    expect(within(await card("OpenAI Codex")).queryByRole("switch")).toBeNull();
    expect(within(await card("Claude Code")).getAllByRole("switch")).toHaveLength(2);
  });

  test("Re-check asks the CLI again; Disconnect says what it does, asks first, then signs the CLI out", async () => {
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("POST", `/api/connections/${CONN_CLAUDE}/check`, () => connection())
      .on("POST", `/api/connections/${CONN_CLAUDE}/disconnect`, () => connection({ auth: "disconnected" }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    await userEvent.click(within(conn).getByRole("button", { name: "Re-check" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/connections/${CONN_CLAUDE}/check`)).toBe(true));
    expect(conn.textContent).toMatch(/Disconnect signs the CLI out of this connection and removes its login: the 2 employee\(s\) on it take no new work/);
    await userEvent.click(within(conn).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Claude subscription?" });
    expect(dialog.textContent).toContain("Nothing switches to another provider by itself.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/connections/${CONN_CLAUDE}/disconnect`)).toBe(true));
  });

  test("a fallback list is labelled as one, and an expired login is said as Authentication required", async () => {
    fakeApi().on("GET", "/api/connections", () => connectionsView({ canHire: false, connections: [connection({ auth: "auth_required", reason: "The login expired.", catalog: { ...connection().catalog, source: "fallback" } })] }));
    renderLive(<AiConnectionsSection />);
    const conn = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    expect(within(conn).getByText("Authentication required")).toBeInTheDocument();
    expect(conn.textContent).toContain("A fallback list, not read from your account: chats may use it, employees never do.");
    expect(screen.getByText(/To hire employees, connect at least one CLI/)).toBeInTheDocument();
  });

  test("no model list says why, by runtime: not connected yet, its CLI not answering, or a CLI that lists none", async () => {
    const installed = connectionsView().installations.map((i) => ({ ...i, state: "installed" as const, version: "1", detail: null }));
    const none = { source: "none" as const, models: [], recommended: null, checkedAt: "2026-11-22T03:41:00.000Z" };
    fakeApi().on("GET", "/api/connections", () =>
      connectionsView({
        installations: installed,
        connections: [
          connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", auth: "connected", identity: "octo@example.com", plugins: null, catalog: none }),
          connection({ id: "c-agy", runtime: "agy", label: "Gemini", method: "cloud", auth: "disconnected", identity: null, plugins: null, catalog: none }),
          connection({ auth: "disconnected", identity: null, catalog: none }),
        ],
      }),
    );
    renderLive(<AiConnectionsSection />);
    const codex = await within(await card("OpenAI Codex")).findByRole("listitem", { name: "Connection ChatGPT" });
    expect(codex.textContent).toContain("Its CLI did not say which models this connection may use: Re-check.");
    expect(codex.textContent).not.toMatch(/once it is connected/);
    const agy = await within(await card("Google Antigravity")).findByRole("listitem", { name: "Connection Gemini" });
    expect(agy.textContent).toContain("Google Antigravity has no command that lists its models: none is read.");
    const claude = await within(await card("Claude Code")).findByRole("listitem", { name: "Connection Claude subscription" });
    expect(claude.textContent).toContain("Its models are read from its CLI once it is connected.");
  });

  test("the office's notification that connections changed reads them again", async () => {
    const api = fakeApi().on("GET", "/api/connections", () => connectionsView());
    renderLive(<AiConnectionsSection />);
    await card("Claude Code");
    await waitFor(() => expect(FakeEventSource.instances.some((s) => s.url === "/api/events" && !s.closed)).toBe(true));
    await act(async () => undefined);
    const before = api.calls.filter((c) => c.path === "/api/connections").length;
    pushApp("office.changed", { areas: ["roster"], missionId: null, version: 8 });
    pushApp("office.changed", { areas: ["connections"], missionId: null, version: 9 });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/connections").length).toBe(before + 1));
  });
});
