// The MCP pages through the whole app: four tabs, and a server is in exactly
// one of the first three -- what Orbit MANAGES (the only ones the resolver may
// choose), what the HOST has (observed only), and the catalog (known only).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { fakeServer } from "../../testing/fakeServer";
import { fakeManaged, fakeResources } from "../../testing/fakeResources";
import { renderApp } from "../../testing/renderApp";
import { elementOf, required } from "../../testing/required";

let resources: ReturnType<typeof fakeResources>;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resources = fakeResources();
  server = fakeServer(undefined, resources.handle);
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

const card = (title: string) => required(screen.getByRole("heading", { name: title }).closest("section"), `the "${title}" card`);
const fact = (label: string) => required(screen.getByText(label).closest("div"), `the "${label}" fact`).textContent;
const calls = (method: string, path: string) => server.calls.filter((c) => c.method === method && c.path === path);

describe("MCP tabs", () => {
  it("has Managed, External, Catalog and Policies -- and each is a page of its own", async () => {
    const router = renderApp("/mcp");
    const tabs = await screen.findByRole("tablist", { name: "MCP" });
    for (const label of ["Managed", "External", "Catalog", "Policies"]) expect(within(tabs).getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: /External/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/mcp/external"));
    fireEvent.click(within(tabs).getByRole("tab", { name: /Catalog/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/mcp/catalog"));
  });

  it("Managed: a server Orbit owns, with its machine state and whether the resolver may choose it", async () => {
    renderApp("/mcp");
    const managed = await waitFor(() => card("Managed by Orbit"));
    expect(within(managed).getByText("Local docs")).toBeTruthy();
    expect(within(managed).getByText("From Orbit's catalog · Managed locally · Automatic")).toBeTruthy();
    expect(within(managed).getByText("Ready")).toBeTruthy();
    expect(within(managed).getByText("Resolver eligible")).toBeTruthy();
  });

  it("External: the host's servers are OBSERVE ONLY and never eligible", async () => {
    renderApp("/mcp/external");
    const external = await waitFor(() => card("External — observed in claude"));
    expect(within(external).getByText("GitHub")).toBeTruthy();
    expect(within(external).getByText("Observe only")).toBeTruthy();
    expect(within(external).getByText("Not eligible")).toBeTruthy();
  });

  it("Catalog: Add to Orbit creates a managed resource -- with the token, and nothing sent to a host", async () => {
    renderApp("/mcp/catalog");
    fireEvent.click(await screen.findByRole("button", { name: "Add Microsoft Learn to Orbit" }));
    expect(await screen.findByText(/Added Microsoft Learn to Orbit\. It is managed in the machine store/)).toBeTruthy();
    const [post] = calls("POST", "/api/v1/mcp/managed");
    expect(post.body).toEqual({ catalog: "microsoft-learn" });
    expect(post.headers[TOKEN_HEADER]).toBe("tok-123");
    expect(server.calls.some((c) => c.method !== "GET" && c.path.includes("/external"))).toBe(false);
    await waitFor(() => expect(within(card("Catalog")).getAllByText("In Orbit").length).toBeGreaterThan(0));
  });
});

describe("Managed server", () => {
  it("a remote HTTP server: Orbit Managed, Remote HTTP, Ready, Automatic, and what it provides -- no binary anywhere", async () => {
    resources.managed.set("microsoft-learn", fakeManaged("microsoft-learn", { name: "Microsoft Learn", origin: "catalog", catalog: "microsoft-learn", provides: ["documentation.search", "documentation.microsoft"] }));
    renderApp("/mcp/managed/microsoft-learn");
    expect(await screen.findByRole("heading", { level: 1, name: "Microsoft Learn" })).toBeTruthy();
    for (const [k, v] of [["Ownership", "Orbit Managed"], ["Runtime", "Remote HTTP"], ["Runtime location", "Remote"], ["Machine state", "Ready"], ["Enabled", "Yes"]]) expect(fact(k)).toContain(v);
    expect(screen.getByText("documentation.microsoft")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install runtime/ })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Potential consumers" })).getByText("orbit-develop")).toBeTruthy();
  });

  it("a local runtime: Managed locally, in the Orbit Machine Store, its version and a VERIFIED receipt", async () => {
    renderApp("/mcp/managed/local-docs");
    expect(await screen.findByRole("heading", { level: 1, name: "Local docs" })).toBeTruthy();
    for (const [k, v] of [["Runtime", "Managed locally"], ["Runtime location", "Orbit Machine Store"], ["Version", "1.2.0"], ["Receipt", "Verified"]]) expect(fact(k)).toContain(v);
    expect(required(screen.getByText("DOCS_TOKEN").closest("li"), "the DOCS_TOKEN secret").textContent).toContain("Set");
    expect(screen.getByRole("button", { name: /Reinstall/ })).toBeTruthy();
  });

  it("Disable and Enable, and a selection mode chosen from Automatic, Approval, Disabled", async () => {
    renderApp("/mcp/managed/local-docs");
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    await waitFor(() => expect(calls("POST", "/api/v1/mcp/managed/local-docs/disable")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Enable" })).toBeTruthy();
    const select = elementOf(screen.getByRole("combobox", { name: "Selection mode" }), HTMLSelectElement, "the selection mode");
    expect([...select.options].map((o) => o.text)).toEqual(["Automatic", "Approval", "Disabled"]);
    fireEvent.change(select, { target: { value: "approval" } });
    await waitFor(() => expect(calls("PUT", "/api/v1/mcp/managed/local-docs/selection")[0]?.body).toEqual({ selection: "approval" }));
    expect(await screen.findByText("Needs a person's approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve for 1 hour" }));
    await waitFor(() => expect(calls("POST", "/api/v1/mcp/managed/local-docs/approve")[0]?.body).toEqual({ minutes: 60 }));
  });

  it("Test Connection keeps the verdict and learns its tools", async () => {
    renderApp("/mcp/managed/local-docs");
    fireEvent.click(await screen.findByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText("Connected — 2 tools offered.")).toBeTruthy();
    expect(await screen.findByText("search")).toBeTruthy();
  });
});

describe("External server", () => {
  it("says Observe only, External / Claude, Orbit Managed No, Resolver eligible No -- and Add to Orbit copies no secret", async () => {
    const router = renderApp("/mcp/external/github");
    expect(await screen.findByRole("heading", { level: 1, name: "GitHub" })).toBeTruthy();
    for (const [k, v] of [["Ownership", "External / claude"], ["Observed", "Yes"], ["Orbit Managed", "No"], ["Resolver eligible", "No"], ["Status", "Observe only"]]) expect(fact(k)).toContain(v);
    fireEvent.click(screen.getByRole("button", { name: "Add to Orbit" }));
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe("/mcp/new?from=github"));
    expect(elementOf(await screen.findByRole("textbox", { name: "Header name" }), HTMLInputElement, "the header name").value).toBe("Authorization");
    expect(elementOf(screen.getByRole("textbox", { name: "Environment variable for Authorization" }), HTMLInputElement, "the header variable").value).toBe("GITHUB_AUTHORIZATION");
  });
});

describe("Add custom", () => {
  it("names a header's secret by its environment variable, picks capabilities from Fluent's multi-select combobox, and sets the chosen policy", async () => {
    const router = renderApp("/mcp/new");
    expect(await screen.findByRole("heading", { level: 1, name: "Add a Orbit-managed MCP server" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /Id/ }), { target: { value: "corp-docs" } });
    fireEvent.change(screen.getByRole("textbox", { name: /URL/ }), { target: { value: "https://docs.corp.example/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Header name" }), { target: { value: "Authorization" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Environment variable for Authorization" }), { target: { value: "CORP_DOCS_AUTH" } });
    expect(screen.getByText(/Where the value goes/).closest("div")?.textContent).toContain('export CORP_DOCS_AUTH="…"');
    const picker = screen.getByRole("combobox", { name: /Capabilities provided/ });
    fireEvent.click(picker);
    const option = await screen.findByRole("menuitemcheckbox", { name: /documentation\.microsoft/ });
    expect(option.textContent).toContain("orbit-develop can use it");
    fireEvent.click(option);
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /documentation\.search/ }));
    expect(await screen.findByRole("button", { name: "documentation.search remove" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: /Policy/ }), { target: { value: "approval" } });
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/Needs credentials: CORP_DOCS_AUTH is not set/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to Orbit" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/mcp/managed/corp-docs"));
    expect(calls("POST", "/api/v1/mcp/managed")[0].body).toEqual({ definition: { id: "corp-docs", transport: "http", provides: ["documentation.microsoft", "documentation.search"], selection: "automatic", url: "https://docs.corp.example/mcp", requiredHeaders: [{ name: "Authorization", env: "CORP_DOCS_AUTH" }] } });
    expect(calls("PUT", "/api/v1/mcp/managed/corp-docs/policy")[0].body).toEqual({ policy: { default: "approval" } });
  });

  it("a new capability can be typed and added, and a chosen one removed from its tag", async () => {
    renderApp("/mcp/new");
    const picker = await screen.findByRole("combobox", { name: /Capabilities provided/ });
    fireEvent.click(picker);
    fireEvent.change(picker, { target: { value: "documentation.company" } });
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Add “documentation.company”" }));
    const tag = await screen.findByRole("button", { name: "documentation.company remove" });
    fireEvent.click(tag);
    await waitFor(() => expect(screen.queryByRole("button", { name: "documentation.company remove" })).toBeNull());
  });

  it("an id with spaces or accents is caught in the box, and a usable one is offered from it", async () => {
    renderApp("/mcp/new");
    fireEvent.change(await screen.findByRole("textbox", { name: /Display name/ }), { target: { value: "AcmeDocs MCP" } });
    fireEvent.click(screen.getByRole("button", { name: "Use acmedocs-mcp" }));
    expect(elementOf(screen.getByRole("textbox", { name: /^Id/ }), HTMLInputElement, "the id").value).toBe("acmedocs-mcp");
    fireEvent.change(screen.getByRole("textbox", { name: /^Id/ }), { target: { value: "Café Đata Gateway" } });
    expect(screen.getByText(/An id is letters, digits and \. _ - only/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use cafe-data-gateway" }));
    expect(screen.queryByText(/An id is letters, digits and \. _ - only/)).toBeNull();
  });

  it("a header in quotes and a TOKEN pasted where the variable's name belongs are caught in the box -- masked, never sent -- and fixed in one click each", async () => {
    const router = renderApp("/mcp/new");
    fireEvent.change(await screen.findByRole("textbox", { name: /Id/ }), { target: { value: "Test" } });
    fireEvent.change(screen.getByRole("textbox", { name: /URL/ }), { target: { value: "https://gateway.example/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Header name" }), { target: { value: '"Authorization"' } });
    const env = elementOf(screen.getByLabelText("Environment variable for Authorization"), HTMLInputElement, "the header's variable");
    fireEvent.change(env, { target: { value: '"Bearer acme_mcp__FAKE-token-4242"' } });
    expect(screen.getByText("Without quotes or a colon: Authorization")).toBeTruthy();
    expect(screen.getByText(/That looks like the secret itself/)).toBeTruthy();
    expect(env.type).toBe("password");
    expect(elementOf(screen.getByRole("button", { name: "Add to Orbit" }), HTMLButtonElement, "Add to Orbit").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Use Authorization" }));
    fireEvent.click(screen.getByRole("button", { name: "Use TEST_AUTHORIZATION" }));
    expect(elementOf(screen.getByLabelText("Environment variable for Authorization"), HTMLInputElement, "the header's variable").value).toBe("TEST_AUTHORIZATION");
    fireEvent.click(screen.getByRole("button", { name: "Add to Orbit" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/mcp/managed/Test"));
    expect(calls("POST", "/api/v1/mcp/managed")[0].body).toMatchObject({ definition: { requiredHeaders: [{ name: "Authorization", env: "TEST_AUTHORIZATION" }] } });
    expect(server.calls.some((c) => JSON.stringify(c.body ?? "").includes("acme_mcp"))).toBe(false);
  });
});

describe("Policies", () => {
  it("sets allow · approval · deny per capability and for write tools, and keeps workflow exceptions", async () => {
    renderApp("/mcp/policies");
    const cap = await screen.findByRole("combobox", { name: "Local docs documentation.search" });
    fireEvent.change(cap, { target: { value: "deny" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Local docs write tools" }), { target: { value: "approval" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the policy for Local docs" }));
    await waitFor(() => expect(calls("PUT", "/api/v1/mcp/managed/local-docs/policy")[0]?.body).toEqual({ policy: { default: "allow", capabilities: { "documentation.search": "deny" }, operations: { write: "approval" } } }));
    fireEvent.click(screen.getByRole("button", { name: "Add exception" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Exception skill" }), { target: { value: "orbit-code-review" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Exception capability" }), { target: { value: "repository.write" } });
    fireEvent.click(screen.getByRole("button", { name: "Save exceptions" }));
    await waitFor(() => expect(calls("PUT", "/api/v1/mcp/policies/workflows")[0]?.body).toEqual({ workflows: { "orbit-code-review": { "repository.write": "deny" } } }));
  });
});
