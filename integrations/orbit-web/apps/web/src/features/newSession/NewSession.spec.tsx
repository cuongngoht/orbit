import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepositoryList, Settings, SourcesStatus } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { fakeApi, withStatus, type FakeApi } from "../../testing/fakeApi";
import { AZURE_REPOSITORY_ID, SESSION_ID, azureRepository, githubRepository, sessionSummary, settings, sources } from "../../testing/fixtures";
import { CONN_CODEX, capabilities, connection, connectionsView } from "../../testing/officeFixtures";
import { renderUi } from "../../testing/render";
import { NewSession } from "./NewSession";

const GITHUB: RepositoryList = {
  source: "github",
  repositories: [githubRepository(), githubRepository({ id: "acme/tools", fullName: "acme/tools", owner: "acme", name: "tools", private: false, defaultBranch: "trunk" })],
  fetchedAt: "2026-11-20T00:00:00.000Z",
  partial: false,
};

const AZURE: RepositoryList = { source: "azure", repositories: [azureRepository()], fetchedAt: "2026-11-20T00:00:00.000Z", partial: false };

const branches = (source: "github" | "azure", repository: string, names: string[]) => ({ source, repository, branches: names.map((name, i) => ({ name, protected: false, commit: null, isDefault: i === 0 })) });

function api(): FakeApi {
  return fakeApi()
    .on("GET", "/api/repositories", (_, url) => (url.searchParams.get("source") === "azure" ? AZURE : GITHUB))
    .on("GET", "/api/repositories/branches", (_, url) => (url.searchParams.get("source") === "azure" ? branches("azure", AZURE_REPOSITORY_ID, ["develop", "main"]) : branches("github", "octo/sum-fixture", ["main", "dev"])))
    .on("POST", "/api/sessions", () => sessionSummary({ status: "preparing" }));
}

function show(o: { settings?: Settings | null; sources?: SourcesStatus | null } = {}) {
  const created = vi.fn();
  const connect = vi.fn();
  renderUi(<NewSession settings={o.settings === undefined ? settings() : o.settings} sources={o.sources === undefined ? sources("connected", "connected") : o.sources} onCreated={created} onConnect={connect} />);
  return { created, connect };
}

const created = (a: FakeApi) => a.calls.find((c) => c.method === "POST" && c.path === "/api/sessions")?.body;

async function chooseRepository(name: string) {
  await userEvent.click(screen.getByRole("button", { name: "Repository: none" }));
  const list = await screen.findByRole("listbox", { name: "Repositories" });
  await userEvent.click(within(await within(list).findByRole("option", { name })).getByRole("button"));
}

describe("a new session: the composer always at the bottom, and the draft in its toolbar", () => {
  test("starts with no repository: Enter creates the chat with Settings' model, effort and mode", async () => {
    const a = api();
    const { created: onCreated } = show();
    expect(screen.getByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Explain how the CLI parses flags{Enter}");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION_ID })));
    expect(created(a)).toEqual({ repository: null, branch: null, model: "sonnet", effort: "medium", mode: "autonomous", prompt: "Explain how the CLI parses flags" });
  });

  test("a chat may run on the account's OpenAI Codex connection: its own models, and the chat names it", async () => {
    const codex = connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", method: "subscription", plugins: null, isDefault: true, catalog: { source: "account", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", description: null, efforts: ["low", "medium", "high"], autoMode: true }, { id: "gpt-5.5", label: "GPT-5.5", description: null, efforts: ["low", "medium"], autoMode: true }], recommended: "gpt-6.1-sol", checkedAt: null }, capabilities: capabilities({ toolPlaneSplit: "unknown" }) });
    const a = api().on("GET", "/api/connections", () => connectionsView({ connections: [connection(), codex] }));
    show();
    const runsOn = await screen.findByRole("combobox", { name: "AI connection" });
    expect(within(runsOn).getAllByRole("option").map((o) => o.textContent)).toEqual(["Claude Code — Claude subscription", "OpenAI Codex — ChatGPT"]);
    await userEvent.selectOptions(runsOn, CONN_CODEX);
    await userEvent.click(await screen.findByRole("button", { name: "Model GPT-6.1-Sol, effort Medium" }));
    const models = (await screen.findAllByRole("menuitemradio")).map((m) => (m.textContent ?? "").replace(/\d$/, ""));
    expect(models).toEqual(["GPT-6.1-Sol", "GPT-5.5"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Hello Codex{Enter}");
    await waitFor(() => expect(created(a)).toEqual({ repository: null, branch: null, connectionId: CONN_CODEX, model: "gpt-6.1-sol", effort: "medium", mode: "autonomous", prompt: "Hello Codex" }));
  });

  test("on the default Claude Code connection the chat names none: what it sends is as it was", async () => {
    const a = api().on("GET", "/api/connections", () => connectionsView({ connections: [connection()] }));
    show();
    expect(screen.queryByRole("combobox", { name: "AI connection" })).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Hi{Enter}");
    await waitFor(() => expect(created(a)).toEqual({ repository: null, branch: null, model: "sonnet", effort: "medium", mode: "autonomous", prompt: "Hi" }));
  });

  test("typing / lists Orbit's skills, and the chosen repository's as an earlier chat read them", async () => {
    const a = api().on("GET", "/api/commands", (_, url) =>
      url.searchParams.get("repository") === "octo/sum-fixture"
        ? { commands: [{ name: "sum-fixture:deploy", description: "Deploys the app", argumentHint: null, kind: "skill", origin: "project" }, { name: "orbit:orbit-help", description: "Navigator", argumentHint: null, kind: "skill", origin: "orbit" }], note: "This repository's own skills as the chat “Fix sum” read them; a new chat reads them again." }
        : { commands: [{ name: "orbit:orbit-help", description: "Navigator", argumentHint: null, kind: "skill", origin: "orbit" }], note: null },
    );
    show();
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "/");
    expect(await screen.findByRole("option", { name: /orbit:orbit-help/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /sum-fixture:deploy/ })).toBeNull();
    await userEvent.clear(box);
    await chooseRepository("octo/sum-fixture");
    await userEvent.type(box, "/");
    expect(await screen.findByRole("option", { name: /sum-fixture:deploy/ })).toBeInTheDocument();
    expect(screen.getByText(/as the chat “Fix sum” read them/)).toBeInTheDocument();
    expect(a.calls.map((c) => c.path).filter((p) => p.startsWith("/api/commands"))).toEqual(["/api/commands", "/api/commands?source=github&repository=octo%2Fsum-fixture"]);
  });

  test("Shift+Enter makes a new line; an empty message cannot be sent", async () => {
    const a = api();
    show();
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("line one\nline two");
    expect(a.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("Settings' defaults are what a new chat starts with", async () => {
    const a = api();
    show({ settings: settings({ defaultModel: "opus", defaultEffort: "high", defaultMode: "plan" }) });
    expect(screen.getByRole("button", { name: "Model Opus 5.5, effort High" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mode Plan" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Plan the migration{Enter}");
    await waitFor(() => expect(created(a)).toMatchObject({ model: "opus", effort: "high", mode: "plan" }));
  });

  test("the model · effort menu lists every model and effort, the effort with its note and Medium recommended", async () => {
    const a = api();
    show();
    await userEvent.click(screen.getByRole("button", { name: "Model Sonnet 5.5, effort Medium" }));
    expect(await screen.findByText("Model · this session")).toBeInTheDocument();
    const models = screen.getAllByRole("menuitemradio").map((m) => m.textContent ?? "");
    expect(models.map((m) => m.replace(/\d$/, ""))).toEqual(["Opus 5.5", "Fable 5.2", "Sonnet 5.5", "Haiku 5.5"]);
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Opus 5\.5/ }));
    expect(await screen.findByRole("button", { name: "Model Opus 5.5, effort Medium" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Model Opus 5.5, effort Medium" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Effort/ }));
    expect(await screen.findByText(/Higher effort means more thorough responses/)).toBeInTheDocument();
    const efforts = (await screen.findAllByRole("menuitemradio")).filter((m) => m.getAttribute("name") === "effort" || /^(Low|Medium|High|Extra|Max)/.test(m.textContent ?? ""));
    expect(efforts.map((m) => m.textContent)).toEqual(["Low", "MediumRecommended", "High", "Extra", "Max"]);
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));
    expect(await screen.findByRole("button", { name: "Model Opus 5.5, effort Max" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mode Autonomous" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Plan/ }));
    expect(await screen.findByRole("button", { name: "Mode Plan" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Go{Enter}");
    await waitFor(() => expect(created(a)).toMatchObject({ model: "opus", effort: "max", mode: "plan" }));
  });

  test("a GitHub repository: search, choose, then a branch -- the default first -- and the chat starts from it", async () => {
    const a = api();
    show();
    await userEvent.click(screen.getByRole("button", { name: "Repository: none" }));
    const list = await screen.findByRole("listbox", { name: "Repositories" });
    expect(await within(list).findAllByRole("option")).toHaveLength(2);
    expect(a.calls.some((c) => c.path === "/api/repositories?source=github")).toBe(true);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search repositories" }), "sum");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    expect(within(list).getByRole("option", { name: "octo/sum-fixture" })).toContainElement(within(list).getByLabelText("Private"));
    await userEvent.click(within(within(list).getByRole("option", { name: "octo/sum-fixture" })).getByRole("button"));
    expect(await screen.findByRole("button", { name: "Repository octo/sum-fixture" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Branch main" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "dev" }));
    expect(await screen.findByRole("button", { name: "Branch dev" })).toBeInTheDocument();
    expect(a.calls.some((c) => c.path === "/api/repositories/branches?source=github&id=octo%2Fsum-fixture")).toBe(true);
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Fix the addition{Enter}");
    await waitFor(() => expect(created(a)).toEqual({ repository: { source: "github", id: "octo/sum-fixture" }, branch: "dev", model: "sonnet", effort: "medium", mode: "autonomous", prompt: "Fix the addition" }));
  });

  test("an Azure DevOps repository is chosen in its own tab and named back by its id", async () => {
    const a = api();
    show();
    await userEvent.click(screen.getByRole("button", { name: "Repository: none" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Azure DevOps" }));
    const list = await screen.findByRole("listbox", { name: "Repositories" });
    const option = await within(list).findByRole("option", { name: "contoso/Platform/api" });
    expect(option.textContent).toContain("contoso / Platform");
    await userEvent.click(within(option).getByRole("button"));
    expect(await screen.findByRole("button", { name: "Repository contoso/Platform/api" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Branch develop" })).toBeInTheDocument();
    await waitFor(() => expect(a.calls.some((c) => c.path === `/api/repositories/branches?source=azure&id=${encodeURIComponent(AZURE_REPOSITORY_ID)}`)).toBe(true));
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Add a health endpoint{Enter}");
    await waitFor(() => expect(created(a)).toMatchObject({ repository: { source: "azure", id: AZURE_REPOSITORY_ID }, branch: "develop" }));
  });

  test("a source that is not connected offers to connect it, and lists nothing", async () => {
    const a = api();
    const { connect } = show({ sources: sources("connected", "not_connected") });
    await userEvent.click(screen.getByRole("button", { name: "Repository: none" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Azure DevOps" }));
    expect(await screen.findByText("Connect Azure DevOps to choose one of its repositories.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect Azure DevOps" }));
    expect(connect).toHaveBeenCalledWith("azure");
    expect(a.calls.some((c) => c.path.includes("source=azure"))).toBe(false);
  });

  test("No repository takes a chosen repository back", async () => {
    const a = api();
    show();
    await chooseRepository("octo/sum-fixture");
    await userEvent.click(await screen.findByRole("button", { name: "Repository octo/sum-fixture" }));
    await userEvent.click(await screen.findByRole("button", { name: /No repository/ }));
    expect(await screen.findByRole("button", { name: "Repository: none" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Branch / })).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Hi{Enter}");
    await waitFor(() => expect(created(a)).toMatchObject({ repository: null, branch: null }));
  });

  test("the repository list is read again on request, and a source's own error is said as it was said", async () => {
    let fail = false;
    const a = api().on("GET", "/api/repositories", () => (fail ? withStatus(502, { error: { code: "source_unavailable", message: "GitHub CLI could not list repositories: exited with code 1" } }) : GITHUB));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Repository: none" }));
    await screen.findByRole("listbox", { name: "Repositories" });
    fail = true;
    await userEvent.click(screen.getByRole("button", { name: "Read the repositories again" }));
    await waitFor(() => expect(a.calls.some((c) => c.path === "/api/repositories?source=github&refresh=1")).toBe(true));
    expect(await screen.findByText(/GitHub CLI could not list repositories/)).toBeInTheDocument();
  });

  test("a refused creation is said above the composer, and the message can be sent again", async () => {
    api().on("POST", "/api/sessions", () => withStatus(409, { error: { code: "source_not_connected", message: "Connect GitHub first." } }));
    show();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Go{Enter}");
    expect(await screen.findByText("Connect GitHub first.")).toBeInTheDocument();
  });
});
