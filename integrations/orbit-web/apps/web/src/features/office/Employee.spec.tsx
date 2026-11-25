import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_PRESETS } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import { CONN_CLAUDE, CONN_CODEX, DEPT_LEGAL, EMP_ANA, EMP_BAO, appointmentView, busyBao, capabilities, connection, connectionsView, department, employeeDetail, employeeCard, officeRecord, presets, resourceSummary, roster, runView } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const rowOf = (table: HTMLElement, first: string) => within(table).getAllByRole("row").find((r) => r.textContent?.startsWith(first)) as HTMLElement;

describe("one employee", () => {
  test("Sandbox & resources: the sandbox's state, each area's quota, use and how it is enforced, the attempt running now and what its containers use, and the resource history", async () => {
    const oom = runView({ usage: { modelPlane: null, toolPlane: { cpuSeconds: 42, memoryCurrentMiB: 900, memoryPeakMiB: 1945, oomKilled: true, pidsPeak: 30, diskUsedMiB: 300, networkBytesIn: null, networkBytesOut: null, sampledAt: "2026-11-21T09:00:00.000Z" } } });
    fakeApi().on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail({ activeRun: oom }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="resources" go={vi.fn()} account={authAccount()} />);
    const sandbox = await screen.findByRole("region", { name: "Personal Sandbox" });
    expect(within(sandbox).getByText("Ready")).toBeInTheDocument();
    expect(sandbox.textContent).toContain("Resources (revision 1): 1 vCPU · 2 GiB memory · 400 MiB desk · 500 MiB scratch · 100 MiB cache · 256 processes · 60 minutes per attempt");
    const areas = within(sandbox).getByRole("table", { name: "Storage areas" });
    expect(rowOf(areas, "Desk and toolbox").textContent).toBe("Desk and toolbox5 GiB300 MiBHard limit — the kernel refuses past itover-quota write refused");
    expect(rowOf(areas, "Assignment scratch").textContent).toBe("Assignment scratch5 GiBnot measuredMeasured only — not a hard limitmeasured every 30 s");
    const now = screen.getByRole("region", { name: "Attempt now" });
    expect(now.textContent).toContain("memory 900 MiB now, 1.9 GiB at peak");
    expect(now.textContent).toContain("Out of memory: the container was stopped at its memory limit — raise the limit or retry.");
    expect(within(now).getByLabelText("Isolation attestation").textContent).toContain("Held: sibling attempt canary absent");
    expect(screen.getByRole("region", { name: "Resource history" }).textContent).toContain("Revision 1 (current)");
  });

  test("an attempt that waits for resources says why; an idle employee says it holds nothing", async () => {
    fakeApi().on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail({ activeRun: runView({ state: "waiting_for_resources", waitingReason: "It needs 3 GiB of memory; 1 GiB is free now.", usage: { modelPlane: null, toolPlane: null } }) }));
    const { unmount } = renderLive(<OfficeView page="employee" item={EMP_ANA} tab="resources" go={vi.fn()} account={authAccount()} />);
    const now = await screen.findByRole("region", { name: "Attempt now" });
    expect(now.textContent).toContain("It waits for resources: It needs 3 GiB of memory; 1 GiB is free now.");
    expect(within(now).getByText("Waiting for resources")).toBeInTheDocument();
    unmount();
    fakeApi().on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail());
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="resources" go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText("No attempt runs now: it holds no CPU or memory.")).toBeInTheDocument();
  });

  test("Edit resources makes a new revision against the version read, for future attempts", async () => {
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", "/api/office/resources", () => resourceSummary())
      .on("GET", "/api/office/resource-presets", () => presets())
      .on("PATCH", `/api/employees/${EMP_ANA}/resources`, () => employeeDetail({ version: 5 }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="resources" go={vi.fn()} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit resources" }));
    const form = await screen.findByRole("form", { name: "Edit resources" });
    expect(form.textContent).toContain("Applies to future attempts: an attempt already admitted keeps the resources it was admitted under.");
    await userEvent.click(await within(form).findByRole("radio", { name: /^Research/ }));
    await userEvent.type(within(form).getByRole("textbox", { name: /Why it changes/ }), "Bigger desk");
    await userEvent.click(within(form).getByRole("button", { name: "Save resources" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ resources: { ...DEFAULT_PRESETS[1]?.profile, presetId: "research" }, note: "Bigger desk" });
    expect(patch?.headers["if-match"]).toBe('"4"');
  });

  test("the profile's history: a revision is restored by copying it, naming the revision it came from", async () => {
    const old = employeeDetail().profile;
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/revisions/1`, () => ({ revision: 1, profile: { ...old, title: "Bookkeeper" } }))
      .on("PATCH", `/api/employees/${EMP_ANA}`, () => employeeDetail({ profileRevision: 3 }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={vi.fn()} account={authAccount()} />);
    const history = await screen.findByRole("region", { name: "Profile history" });
    expect(history.textContent).toContain("Revision 2 (current)");
    await userEvent.click(within(history).getByRole("button", { name: "Restore revision 1" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ profile: { ...old, title: "Bookkeeper" }, basedOn: 1, note: "Restored revision 1" });
    expect(patch?.headers["if-match"]).toBe('"4"');
  });

  test("how it runs is changed in place: a connection that can run employees, a model of its own catalog, an effort that model takes", async () => {
    const old = employeeDetail().profile;
    const codex = connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", method: "subscription", plugins: null, isDefault: true, catalog: { ...connection().catalog, models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", description: null, efforts: ["low", "medium", "high"], autoMode: true }, { id: "gpt-5.5", label: "GPT-5.5", description: null, efforts: [], autoMode: true }], recommended: "gpt-6.1-sol" }, capabilities: capabilities({ webSearch: "yes" }) });
    const notReady = connection({ id: "c-other", runtime: "codex", label: "Other key", method: "api_key", plugins: null, isDefault: false, capabilities: capabilities({ toolPlaneSplit: "unknown" }) });
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", "/api/connections", () => connectionsView({ connections: [connection(), codex, notReady] }))
      .on("PATCH", `/api/employees/${EMP_ANA}`, () => employeeDetail({ profileRevision: 3 }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={vi.fn()} account={authAccount()} />);
    const runs = await screen.findByRole("region", { name: "How it runs" });
    await userEvent.click(within(runs).getByRole("button", { name: "Change how it runs" }));
    const form = await screen.findByRole("form", { name: "Change how it runs" });
    const conn = within(form).getByRole("combobox", { name: /^AI connection/ });
    expect(within(conn).getAllByRole("option").map((o) => o.textContent)).toEqual(["Claude Code — Claude subscription", "OpenAI Codex — ChatGPT"]);
    await userEvent.selectOptions(conn, CONN_CODEX);
    const model = within(form).getByRole("combobox", { name: /^Model/ });
    expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["GPT-6.1-Sol (recommended)", "GPT-5.5"]);
    await userEvent.selectOptions(within(form).getByRole("combobox", { name: /^Effort/ }), "high");
    await userEvent.click(within(form).getByRole("button", { name: "Save how it runs" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ profile: { ...old, execution: { runtime: "codex", connectionId: CONN_CODEX, model: "gpt-6.1-sol", effort: "high", webSearch: false, orbitPlugin: false } }, note: "Runs on OpenAI Codex — ChatGPT, GPT-6.1-Sol" });
  });

  test("employment: each move with its reason, and a suspension says what becomes of the work held", async () => {
    const bao = { ...employeeDetail(), ...busyBao() };
    const api = fakeApi()
      .on("GET", `/api/employees/${bao.id}`, () => bao)
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", `/api/employees/${bao.id}/employment`, () => ({ ...bao, employment: "suspended" }));
    renderLive(<OfficeView page="employee" item={bao.id} tab="employment" go={vi.fn()} account={authAccount()} />);
    const section = await screen.findByRole("region", { name: "Employment" });
    // An active employee may be suspended or archived, each said with what it means.
    const moves = within(section).getByRole("radiogroup", { name: "What to do" });
    expect(within(moves).getAllByRole("radio")).toHaveLength(2);
    expect(within(moves).getByRole("radio", { name: "Archive — It leaves the office; its desk and toolbox are kept, read only, until you delete them in Governance → Employee desks." })).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("radio", { name: /^Suspend/ }));
    await userEvent.click(within(section).getByRole("radio", { name: "Cancel it" }));
    await userEvent.type(within(section).getByRole("textbox", { name: /Reason/ }), "Wrong client");
    await userEvent.click(within(section).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/employment"))).toBe(true));
    const post = api.calls.find((c) => c.path.endsWith("/employment"));
    expect(post?.body).toEqual({ command: "suspend", reason: "Wrong client", held: "cancel" });
    expect(post?.headers["if-match"]).toBe('"4"');
  });

  test("the header says its work label, its runtime, model and effort, and why it is not ready", async () => {
    fakeApi().on("GET", `/api/employees/${EMP_ANA}`, () => ({ ...employeeDetail(), ...employeeCard({ workLabel: "not_ready", notReadyReason: "connection disconnected" }) }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText("Not ready: connection disconnected")).toBeInTheDocument();
    expect(screen.getByText(/Accountant · Claude Code · sonnet · Medium/)).toBeInTheDocument();
    expect(screen.getByText(/^Data as of /)).toBeInTheDocument();
  });
});

describe("one employee's place in the company", () => {
  test("its role in the company: the appointment it holds -- since when, which slot revision, how it stands -- every one it held, and whom it reports to", async () => {
    const now = appointmentView({ slotRevision: 2, version: 3, reason: "Runs the books" });
    const before = appointmentView({ id: "ab000000-0000-4000-8000-000000000009", role: "ceo", departmentId: null, departmentName: null, state: "replaced", slotRevision: 1, appointedAt: "2026-11-20T07:30:00.000Z", endedBy: "Ann Owner", endedAt: "2026-11-21T07:00:00.000Z", endReason: "Reorganised" });
    fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail({ managerId: EMP_BAO, role: "manager", appointment: now, appointments: [before, now] }))
      .on("GET", "/api/office/roster", () => roster());
    const go = vi.fn();
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={go} account={authAccount()} />);
    const role = await screen.findByRole("region", { name: "Role in the company" });
    expect(within(role).getAllByText("Manager of Accounting")).toHaveLength(2);
    expect(role.textContent).toMatch(/Since .+ · slot revision 2/);
    expect(role.textContent).toContain("Why: Runs the books");
    const history = within(role).getByRole("list", { name: "Appointment history" });
    const [latest, earlier] = within(history).getAllByRole("listitem");
    expect(latest).toHaveTextContent(/^Manager of AccountingActiveSlot revision 2 · appointed .+ by Ann Owner$/);
    expect(earlier).toHaveTextContent(/^CEOReplacedSlot revision 1 · appointed .+ by Ann Owner · ended .+ by Ann Owner: Reorganised$/);
    await userEvent.click(await within(role).findByRole("button", { name: "Bao" }));
    expect(go).toHaveBeenCalledWith("employee", EMP_BAO);
  });

  test("an employee with no appointment says a title grants none, and with no manager names nobody it reports to", async () => {
    const api = fakeApi().on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail({ profile: { ...employeeDetail().profile, canDelegate: true } }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={vi.fn()} account={authAccount()} />);
    const role = await screen.findByRole("region", { name: "Role in the company" });
    expect(role).toHaveTextContent("No appointment: a title or a team-lead switch grants none.");
    expect(within(role).queryByText("Reports to")).toBeNull();
    expect(within(role).queryByRole("list")).toBeNull();
    expect(api.calls.some((c) => c.path.startsWith("/api/office/roster"))).toBe(false);
  });

  test("how it runs may leave its model and effort to its department's default, else the company's: which applies is said, and the change asks for them inherited", async () => {
    const old = employeeDetail().profile;
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/office/roster", () => roster({ office: officeRecord({ defaults: { claude: { effort: "high" } } }), departments: [department({ defaults: { claude: { model: "opus" } } }), department({ id: DEPT_LEGAL, name: "Legal", position: 1 })] }))
      .on("PATCH", `/api/employees/${EMP_ANA}`, () => employeeDetail({ profileRevision: 3 }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={vi.fn()} account={authAccount()} />);
    const runs = await screen.findByRole("region", { name: "How it runs" });
    await userEvent.click(within(runs).getByRole("button", { name: "Change how it runs" }));
    const form = await screen.findByRole("form", { name: "Change how it runs" });
    await userEvent.click(within(form).getByRole("checkbox", { name: "Use the department's (else the company's) default model and effort" }));
    expect(within(form).queryByRole("combobox", { name: /^Model/ })).toBeNull();
    expect(await within(form).findByText("Model: Opus 5.5 — Accounting's default")).toBeInTheDocument();
    expect(within(form).getByText("Effort: High — the company's default")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Save how it runs" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      profile: { ...old, execution: { runtime: "claude", connectionId: CONN_CLAUDE, model: "", effort: null, webSearch: false, orbitPlugin: false, inherit: ["model", "effort"] } },
      note: "Runs on Claude Code — Claude subscription, its department's (else the company's) default model",
    });
  });

  test("a profile that leaves its model to the defaults says so where its model would be", async () => {
    const inheriting = employeeCard().execution;
    const execution = { ...inheriting, model: "", effort: null, inherit: ["model" as const, "effort" as const] };
    fakeApi().on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail({ execution, profile: { ...employeeDetail().profile, execution } }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText(/^Accountant · Claude Code · Its department's, else the company's default$/)).toBeInTheDocument();
    const runs = screen.getByRole("region", { name: "How it runs" });
    expect(runs.textContent).toContain("ModelIts department's, else the company's default");
    expect(runs.textContent).toContain("EffortIts department's, else the company's default");
  });
});
