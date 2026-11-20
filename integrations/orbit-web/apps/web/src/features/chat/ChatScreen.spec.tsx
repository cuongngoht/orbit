import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionDetail, WorkBranches } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { fakeApi, withStatus, type FakeApi } from "../../testing/fakeApi";
import { sessionStream } from "../../testing/events";
import { SESSION_ID, inventory, sessionDetail, sessionSummary } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { ChatScreen } from "./ChatScreen";

const PATH = `/api/sessions/${SESSION_ID}`;

function open(detail: SessionDetail = sessionDetail(), a: FakeApi = fakeApi()) {
  let current = detail;
  a.on("GET", PATH, () => current)
    .on("PATCH", PATH, (body) => {
      current = { ...current, ...(body as object) };
      return sessionSummary(current);
    })
    .on("POST", `${PATH}/messages`, () => ({ sessionId: SESSION_ID, runId: "r1" }))
    .on("POST", `${PATH}/stop`, () => ({ stopping: true }));
  const updated = vi.fn();
  renderUi(<ChatScreen sessionId={SESSION_ID} onUpdated={updated} />);
  return { api: a, updated, push: sessionStream(SESSION_ID) };
}

const started = (over: object = {}) => ({ claudeSessionId: "c", claudeCodeVersion: "2.1.328", model: "claude-sonnet-5-5", requestedModel: "sonnet", requestedEffort: "medium", requestedMode: "autonomous", permissionMode: "auto", plugins: [{ name: "orbit", version: "0.6.0" }], orbitLoaded: true, orbitVersion: "0.6.0", resumed: false, ...over });

describe("an open chat: the conversation, and the composer always at the bottom", () => {
  test("its title and status above; the repository and branch it started from, and how it runs, in the toolbar", async () => {
    open();
    expect(await screen.findByText("Fix sum")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    const toolbar = screen.getByRole("toolbar", { name: "How this chat runs" });
    expect(within(toolbar).getByText("octo/sum-fixture")).toBeInTheDocument();
    expect(within(toolbar).getByText("main → orbit-web/0b6c2f5e")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Model Sonnet 5.5, effort Medium" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Mode Autonomous" })).toBeInTheDocument();
  });

  test("a chat started without a repository says so, and shows the branch of its empty workspace", async () => {
    open(sessionDetail({ source: null, repository: null, branch: null, workBranch: "orbit-web/0b6c2f5e" }));
    const toolbar = await screen.findByRole("toolbar", { name: "How this chat runs" });
    expect(within(toolbar).getByText("No repository")).toBeInTheDocument();
    expect(within(toolbar).getByText("orbit-web/0b6c2f5e")).toBeInTheDocument();
  });

  test("Enter sends, Shift+Enter makes a new line", async () => {
    const { api } = open();
    const box = await screen.findByRole("textbox", { name: "Message" });
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("line one\nline two");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ text: "line one\nline two" }));
  });

  test("typing / lists what this chat's runs load, read from the chat's own commands", async () => {
    const a = fakeApi().on("GET", `${PATH}/commands`, () => ({ commands: [{ name: "sum-fixture:deploy", description: "Deploys the app", argumentHint: null, kind: "skill", origin: "project" }], note: null }));
    open(sessionDetail(), a);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message" }), "/");
    expect(await screen.findByRole("option", { name: /sum-fixture:deploy/ })).toBeInTheDocument();
    expect(a.calls.filter((c) => c.path === `${PATH}/commands`)).toHaveLength(1);
  });

  test("a changed model, effort or mode is the chat's from its next message", async () => {
    const { api, updated } = open();
    await userEvent.click(await screen.findByRole("button", { name: "Model Sonnet 5.5, effort Medium" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /Haiku 5\.5/ }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ model: "haiku" }));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ model: "haiku" }));
    expect(await screen.findByRole("button", { name: "Model Haiku 5.5, effort Medium" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mode Autonomous" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Plan/ }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ mode: "plan" }));
    expect(await screen.findByRole("button", { name: "Mode Plan" })).toBeInTheDocument();
  });

  test("streams Claude's text as it arrives, shows tool activity with its real output, and the run's end", async () => {
    const { push } = open();
    await screen.findByText("Fix sum");
    push("session.status", { status: "running", reason: null });
    push("session.started", started());
    expect(await screen.findByText("Orbit 0.6.0 loaded")).toBeInTheDocument();
    expect(screen.getByText(/Started Claude Code 2\.1\.328 · claude-sonnet-5-5 · Medium effort · Autonomous/)).toBeInTheDocument();
    push("message.started", { messageId: "m1", role: "assistant", parentToolUseId: null });
    push("message.delta", { messageId: "m1", offset: 0, text: "Looking at " }, false);
    expect(await screen.findByText(/Looking at/)).toBeInTheDocument();
    push("message.delta", { messageId: "m1", offset: 11, text: "**sum.mjs** now. " }, false);
    expect(await screen.findByText("sum.mjs")).toBeInTheDocument();
    push("tool.started", { toolUseId: "t1", name: "Bash", title: "$ node --test", input: '{"command":"node --test"}', inputTruncated: false, parentToolUseId: null, agent: null });
    expect(screen.getByTestId("tool")).toHaveAttribute("data-state", "running");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    push("tool.completed", { toolUseId: "t1", output: "ℹ pass 1", truncated: false, isError: false, interrupted: false, parentToolUseId: null });
    expect(screen.getByTestId("tool")).toHaveAttribute("data-state", "done");
    await userEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("ℹ pass 1")).toBeInTheDocument();
    push("permission.denied", { toolName: "Bash", toolUseId: "t9", input: '{"command":"git push"}' });
    push("session.completed", { subtype: "success", result: "Done", permissionDenials: 1, costUsd: 0.05, turns: 3, durationMs: 1000 });
    push("session.status", { status: "completed", reason: null });
    expect(await screen.findByText(/Claude Code finished \(3 turns/)).toBeInTheDocument();
    expect(screen.getByText(/Whether the change is verified is Orbit's to say/)).toBeInTheDocument();
    expect(screen.getByText(/Permission denied: Bash/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  test("Stop asks the API to stop the run, and an interrupted run says so", async () => {
    const { api, push } = open();
    await screen.findByText("Fix sum");
    push("session.status", { status: "running", reason: null });
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: `${PATH}/stop` });
    push("session.interrupted", { reason: "user_stop", exitCode: null, signal: "SIGINT" });
    push("session.status", { status: "interrupted", reason: "user_stop" });
    expect(await screen.findByText(/it did not complete/)).toBeInTheDocument();
    expect(screen.getAllByText("Interrupted").length).toBeGreaterThan(0);
  });

  test("a failed run shows the CLI's own error", async () => {
    const { push } = open();
    await screen.findByText("Fix sum");
    push("session.failed", { reason: "cli_error", subtype: "error_during_execution", message: "There's an issue with the selected model (haiku). It may not exist or you may not have access to it.", exitCode: 1, signal: null, permissionDenials: 0, costUsd: null, turns: null, durationMs: null });
    expect(await screen.findByText(/issue with the selected model/)).toBeInTheDocument();
  });

  test("Plan mode's plan is a card -- not the ExitPlanMode plumbing -- and Run it in Autonomous switches the mode and asks for it", async () => {
    const { api, push } = open(sessionDetail({ mode: "plan" }));
    await screen.findByText("Fix sum");
    push("session.status", { status: "running", reason: null });
    push("tool.started", { toolUseId: "p1", name: "ExitPlanMode", title: "ExitPlanMode", input: "{}", inputTruncated: false, parentToolUseId: null, agent: null });
    push("plan.proposed", { toolUseId: "p1", plan: "1. Read **sum.mjs**\n2. Fix the addition\n3. Run the tests", truncated: false });
    push("permission.denied", { toolName: "ExitPlanMode", toolUseId: "p1", input: "{}" });
    push("session.completed", { subtype: "success", result: "Plan ready", permissionDenials: 1, costUsd: 0.01, turns: 2, durationMs: 500 });
    push("session.status", { status: "completed", reason: null });
    const plan = await screen.findByLabelText("Plan");
    expect(plan.textContent).toContain("Fix the addition");
    expect(screen.queryByTestId("tool")).toBeNull();
    expect(screen.queryByText(/Permission denied: ExitPlanMode/)).toBeNull();
    await userEvent.click(within(plan).getByRole("button", { name: "Run it in Autonomous" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.path, c.body])).toEqual([
      ["PATCH", PATH, { mode: "autonomous" }],
      ["POST", `${PATH}/messages`, { text: "Carry out the plan above." }],
    ]));
    expect(await screen.findByRole("button", { name: "Mode Autonomous" })).toBeInTheDocument();
  });

  test("the workspace's first fetch says what the repository brought", async () => {
    const { push } = open();
    await screen.findByText("Fix sum");
    push("project.inventory", { inventory: inventory() });
    expect(await screen.findByText(/Loaded from this repository: 1 skill, 1 command, 0 agents · plugins: lint-kit@acme-tools \(declared\)\./)).toBeInTheDocument();
    push("project.plugin", { plugin: { ...inventory().plugins[0], state: "installed" } });
    expect(await screen.findByText(/lint-kit@acme-tools \(installed\)/)).toBeInTheDocument();
  });

  test("Changes and Orbit open beside the chat, and close", async () => {
    open();
    await screen.findByText("Fix sum");
    await userEvent.click(screen.getByRole("button", { name: "Changes" }));
    const side = await screen.findByRole("complementary", { name: "Changes and Orbit" });
    expect(within(side).getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(side).getByRole("tab", { name: "Orbit" }));
    expect(within(side).getByRole("tab", { name: "Orbit" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(side).getByRole("button", { name: "Close the panel" }));
    expect(screen.queryByRole("complementary", { name: "Changes and Orbit" })).toBeNull();
  });
});

describe("the working branch, chosen in the chat's toolbar", () => {
  const BRANCHES: WorkBranches = {
    current: "orbit-web/0b6c2f5e",
    base: "main",
    remoteError: null,
    branches: [
      { name: "main", local: true, remote: true, isDefault: true },
      { name: "dev", local: false, remote: true, isDefault: false },
      { name: "orbit-web/0b6c2f5e", local: true, remote: false, isDefault: false },
    ],
  };
  const withBranches = () => fakeApi().on("GET", `${PATH}/branches`, () => BRANCHES);

  test("lists the chat's branches and the repository's, never offers the default one, and moves the chat to the one chosen", async () => {
    const a = withBranches().on("POST", `${PATH}/branch`, () => sessionSummary({ workBranch: "dev" }));
    const { updated } = open(sessionDetail(), a);
    await userEvent.click(await screen.findByRole("button", { name: "Working branch orbit-web/0b6c2f5e" }));
    const list = await screen.findByRole("listbox", { name: "Branches" });
    expect(within(list).getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual(["main", "dev", "orbit-web/0b6c2f5e"]);
    expect(within(within(list).getByRole("option", { name: "main" })).getByRole("button")).toBeDisabled();
    expect(within(list).getByText(/default · not worked on/)).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: "orbit-web/0b6c2f5e" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(within(list).getByRole("option", { name: "dev" })).getByRole("button"));
    await waitFor(() => expect(a.calls.find((c) => c.method === "POST" && c.path === `${PATH}/branch`)?.body).toEqual({ branch: "dev" }));
    expect(await screen.findByRole("button", { name: "Working branch dev" })).toBeInTheDocument();
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ workBranch: "dev" }));
  });

  test("a new branch is made from the work as it is", async () => {
    const a = withBranches().on("POST", `${PATH}/branch`, () => sessionSummary({ workBranch: "docs/approvers" }));
    open(sessionDetail(), a);
    await userEvent.click(await screen.findByRole("button", { name: "Working branch orbit-web/0b6c2f5e" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "New branch name" }), "docs/approvers");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(a.calls.find((c) => c.method === "POST" && c.path === `${PATH}/branch`)?.body).toEqual({ branch: "docs/approvers", create: true }));
    expect(await screen.findByRole("button", { name: "Working branch docs/approvers" })).toBeInTheDocument();
  });

  test("what the workspace refuses is said, and the chat stays where it was", async () => {
    const a = withBranches().on("POST", `${PATH}/branch`, () => withStatus(409, { error: { code: "workspace_dirty", message: "The workspace has 2 uncommitted changes: commit them first." } }));
    open(sessionDetail(), a);
    await userEvent.click(await screen.findByRole("button", { name: "Working branch orbit-web/0b6c2f5e" }));
    const list = await screen.findByRole("listbox", { name: "Branches" });
    await userEvent.click(within(within(list).getByRole("option", { name: "dev" })).getByRole("button"));
    expect(await screen.findByText(/2 uncommitted changes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Working branch orbit-web/0b6c2f5e" })).toBeInTheDocument();
  });

  test("while Claude works the branch stays as it is", async () => {
    open(sessionDetail({ status: "running" }), withBranches());
    expect(await screen.findByRole("button", { name: "Working branch orbit-web/0b6c2f5e" })).toBeDisabled();
  });
});
