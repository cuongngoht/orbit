import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HireEmployeeRequest } from "@orbit-web/contracts";
import { DEFAULT_PRESETS } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus, type FakeApi } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import { CONN_CLAUDE, CONN_CODEX, DEPT_LEGAL, connection, connectionsView, employeeDetail, presets, resourceSummary, roster } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { NETWORK_DISCLOSURE } from "./parts";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const HIRED = "e1000000-0000-4000-8000-000000000042";

function api(hire: (body: unknown) => unknown = () => withStatus(201, employeeDetail({ id: HIRED, name: "Cam" }))): FakeApi {
  return fakeApi()
    .on("GET", "/api/office/roster", () => roster())
    .on("GET", "/api/connections", () => connectionsView({ connections: [connection(), connection({ id: CONN_CODEX, runtime: "codex", label: "Codex", method: "api_key", terminalCommand: null, plugins: null, isDefault: true, catalog: { ...connection().catalog, source: "fallback" } })] }))
    .on("GET", "/api/office/resources", () => resourceSummary())
    .on("GET", "/api/office/resource-presets", () => presets())
    .on("GET", "/api/office/templates", () => [])
    .on("POST", "/api/employees", hire);
}

async function open() {
  const go = vi.fn();
  renderLive(<OfficeView page="overview" item={null} tab={null} go={go} account={authAccount()} />);
  const hire = await screen.findByRole("button", { name: "Hire employee" });
  await waitFor(() => expect(hire).toBeEnabled());
  await userEvent.click(hire);
  const dialog = await screen.findByRole("dialog", { name: "Hire an employee" });
  // The dialog is in the touch scope (44 px targets on a coarse pointer): a plain class kept through mergeClasses.
  expect(dialog.className.split(" ")).toContain("orbit-touch");
  return { go, dialog };
}

const next = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
const posted = (a: FakeApi) => a.calls.find((c) => c.method === "POST" && c.path === "/api/employees")?.body as HireEmployeeRequest | undefined;

// Steps 1-3: Cam, a researcher in Legal, on the Claude subscription with Opus at high effort, search and the plugin on.
async function throughRuntime(dialog: HTMLElement) {
  expect(within(dialog).getByRole("list", { name: "Steps" }).textContent).toContain("1Identity2Department & role3AI runtime, model & effort4Personal sandbox & resources5Review & hire");
  expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
  await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Cam");
  await next(dialog);
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Department" }), DEPT_LEGAL);
  await userEvent.type(within(dialog).getByRole("textbox", { name: /Role title/ }), "Researcher");
  await userEvent.type(within(dialog).getByRole("textbox", { name: /Duties/ }), "Reads sources");
  await next(dialog);
  // Only a connection that is connected, with its models read from the account, can run an employee.
  expect(await within(dialog).findByRole("radio", { name: "Claude Code — Claude subscription" })).toBeChecked();
  expect(within(dialog).getByRole("radio", { name: /OpenAI Codex — Codex: its models were not read from the account/ })).toBeDisabled();
  const model = within(dialog).getByRole("combobox", { name: /^Model/ });
  expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sonnet 5.5 (recommended)", "Opus 5.5", "Haiku 5.5"]);
  await userEvent.selectOptions(model, "opus");
  const effort = within(dialog).getByRole("combobox", { name: /^Effort/ });
  expect(within(effort).getAllByRole("option").map((o) => o.textContent)).toEqual(["Low", "Medium", "High", "Max"]);
  await userEvent.selectOptions(effort, "high");
  await userEvent.click(within(dialog).getByRole("switch", { name: /Web search/ }));
  await userEvent.click(within(dialog).getByRole("switch", { name: /Orbit plugin/ }));
  await next(dialog);
}

describe("hiring an employee, in five steps", () => {
  test("with a preset: the body names the connection, model, effort, search, plugin and the preset's resources, and the review says the disclosure and the plan note", async () => {
    const a = api();
    const { go, dialog } = await open();
    await throughRuntime(dialog);
    // Step 4: the sandbox, with the account's budget beside it.
    const budget = within(dialog).getByRole("complementary", { name: "Account budget" });
    expect(budget.textContent).toContain("CPU: 6 vCPU in all · 2.5 vCPU reserved now · 3.5 vCPU available");
    expect(budget.textContent).toContain("Storage: 100 GiB budget · 30 GiB committed · 4 GiB actually used");
    expect(budget.textContent).toContain("An idle employee reserves no CPU or memory; when the account is busy, work waits — hiring is never refused for that.");
    await userEvent.click(within(dialog).getByRole("radio", { name: /^Developer/ }));
    expect(within(dialog).getByRole("spinbutton", { name: "CPU (vCPU)" })).toHaveValue(2);
    await next(dialog);
    // Step 5: everything once more.
    const choices = within(dialog).getByLabelText("Your choices");
    expect(choices.textContent).toContain("NameCam");
    expect(choices.textContent).toContain("DepartmentLegal");
    expect(choices.textContent).toContain("RuntimeClaude Code — Claude subscription");
    expect(choices.textContent).toContain("ModelOpus 5.5");
    expect(choices.textContent).toContain("EffortHigh");
    expect(choices.textContent).toContain("Developer preset: 2 vCPU · 4 GiB memory · 20 GiB desk");
    expect(dialog.textContent).toContain(NETWORK_DISCLOSURE);
    expect(dialog.textContent).toContain("“Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK.”");
    expect(dialog.textContent).toMatch(/Its work could start at once/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hire" }));
    await waitFor(() => expect(posted(a)).toBeDefined());
    const developer = DEFAULT_PRESETS.find((p) => p.id === "developer")?.profile;
    expect(posted(a)).toEqual({
      name: "Cam",
      departmentId: DEPT_LEGAL,
      managerId: null,
      templateId: null,
      profile: {
        title: "Researcher",
        duties: "Reads sources",
        instructions: "",
        skills: [],
        languages: [],
        knowledge: [],
        execution: { runtime: "claude", connectionId: CONN_CLAUDE, model: "opus", effort: "high", webSearch: true, orbitPlugin: true },
        handoffStandard: "",
        reportingRule: "",
        canDelegate: false,
        maxAssistants: 0,
        canHirePermanent: false,
      },
      resources: { ...developer, presetId: "developer" },
    });
    await waitFor(() => expect(go).toHaveBeenCalledWith("employee", HIRED));
  });

  test("with custom values: a changed number makes the profile custom, and a value above the per-employee limit stops the step", async () => {
    const a = api();
    const { dialog } = await open();
    await throughRuntime(dialog);
    const cpu = within(dialog).getByRole("spinbutton", { name: "CPU (vCPU)" });
    await userEvent.clear(cpu);
    await userEvent.type(cpu, "8");
    expect(await within(dialog).findByText("CPU 8 vCPU is above the per-employee limit of 4 vCPU")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.clear(cpu);
    await userEvent.type(cpu, "1.5");
    const memory = within(dialog).getByRole("spinbutton", { name: "Memory (GiB)" });
    await userEvent.clear(memory);
    await userEvent.type(memory, "3");
    expect(within(dialog).getByRole("radio", { name: /^Custom/ })).toHaveAttribute("aria-checked", "true");
    await next(dialog);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hire" }));
    await waitFor(() => expect(posted(a)).toBeDefined());
    const lightweight = DEFAULT_PRESETS[0]?.profile;
    expect(posted(a)?.resources).toEqual({ ...lightweight, presetId: null, cpuMillis: 1500, memoryMiB: 3072 });
  });

  test("skipping the trial needs a reason, recorded with the hire", async () => {
    const a = api();
    const { dialog } = await open();
    await throughRuntime(dialog);
    await next(dialog);
    const hire = within(dialog).getByRole("button", { name: "Hire" });
    expect(hire).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Skip the trial/ }));
    expect(hire).toBeDisabled();
    expect(within(dialog).getByText(/Say why the trial is skipped/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why the trial is skipped/ }), "Proven on the old team");
    expect(hire).toBeEnabled();
    await userEvent.click(hire);
    await waitFor(() => expect(posted(a)).toBeDefined());
    expect(posted(a)).toMatchObject({ skipProbation: true, skipReason: "Proven on the old team" });
  });

  test("a refusal says why: a per-employee limit, with the API's reasons", async () => {
    api(() => withStatus(422, { error: { code: "resource_limit_exceeded", message: "The profile is above the account's per-employee limit.", details: { reasons: ["memory 8192 MiB is above the per-employee limit of 4096 MiB"] } } }));
    const { dialog } = await open();
    await throughRuntime(dialog);
    await next(dialog);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hire" }));
    expect(await within(dialog).findByText(/The profile is above the account's per-employee limit\./)).toBeInTheDocument();
    expect(within(dialog).getByText("memory 8192 MiB is above the per-employee limit of 4096 MiB")).toBeInTheDocument();
  });

  test("the Orbit plugin is offered only where the employee grant is approved, and never on another runtime", async () => {
    fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView({ connections: [connection({ plugins: { ...(connection().plugins as NonNullable<ReturnType<typeof connection>["plugins"]>), useCases: { chat: { approved: true, needsConfirmation: false, decidedAt: null }, employee: { approved: false, needsConfirmation: false, decidedAt: null } } }, capabilities: { ...connection().capabilities, webSearch: "unknown" } })] }))
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("GET", "/api/office/resource-presets", () => presets())
      .on("GET", "/api/office/templates", () => []);
    const { dialog } = await open();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Cam");
    await next(dialog);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Role title/ }), "Researcher");
    await next(dialog);
    await within(dialog).findByRole("radio", { name: "Claude Code — Claude subscription" });
    expect(within(dialog).queryByRole("switch")).toBeNull();
    expect(dialog.textContent).toContain("Orbit plugin: not approved for employees on this connection.");
    expect(dialog.textContent).toContain("Web search: not offered");
  });
});
