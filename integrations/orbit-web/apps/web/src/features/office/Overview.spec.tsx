import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { pushApp } from "../../testing/events";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { authAccount, authSession } from "../../testing/fixtures";
import { APPOINTMENT_ID, CONN_CLAUDE, CONN_CODEX, DEPT_ACCOUNTING, DEPT_LEGAL, EMP_ANA, EMP_BAO, appointmentSummary, appointmentView, busyBao, capabilities, connection, connectionsView, department, employeeCard, notSetUp, officeRecord, roster } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

function show(go = vi.fn()) {
  renderLive(<OfficeView page="overview" item={null} tab={null} go={go} account={authAccount()} />);
  return go;
}

const rosterReads = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.path.startsWith("/api/office/roster"));

async function streamOpen() {
  await waitFor(() => expect(FakeEventSource.instances.some((s) => s.url === "/api/events" && !s.closed)).toBe(true));
  await act(async () => undefined);
}

describe("the office: its overview", () => {
  test("an account with no company and no AI connection: the company waits, saying why and where to connect -- nothing is preselected", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => notSetUp())
      .on("GET", "/api/connections", () => connectionsView({ connections: [], canHire: false }));
    show();
    const form = await screen.findByRole("form", { name: "Activate your company" });
    expect(within(form).getByRole("textbox", { name: /Company name/ })).toHaveValue("Octo & Co");
    expect(await within(form).findByText("No AI connection yet. Connect Claude Code or OpenAI Codex first.")).toBeInTheDocument();
    expect(within(form).getByRole("link", { name: "Open Settings → AI Connections" })).toHaveAttribute("href", "#/?settings=ai-connections");
    expect(within(form).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(form).getByRole("status")).toHaveTextContent(/Connect an AI CLI first/);
    expect(within(form).getByRole("button", { name: "Activate the company" })).toBeDisabled();
    expect(api.calls.some((c) => c.path === "/api/office/setup")).toBe(false);
  });

  test("with a usable connection the company is activated EMPTY, by name -- what each connection can be used for is said, and an unsupported use is left out", async () => {
    let active = false;
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => (active ? roster({ employees: [], departments: [] }) : notSetUp()))
      .on("GET", "/api/connections", () =>
        connectionsView({
          connections: [
            connection(),
            connection({ id: "c0de0000-0000-4000-8000-000000000002", runtime: "codex", label: "ChatGPT", isDefault: true, capabilities: capabilities({ toolPlaneSplit: "no" }) }),
            connection({ id: "c0de0000-0000-4000-8000-000000000003", runtime: "agy", label: "Gemini", isDefault: true }),
          ],
        }),
      )
      .on("POST", "/api/office/setup", () => ((active = true), { id: "0ff1ce00-0000-4000-8000-000000000001", name: "Octo & Co", version: 1, createdAt: "2026-11-21T00:00:00.000Z" }));
    show();
    const form = await screen.findByRole("form", { name: "Activate your company" });
    const claude = await within(form).findByRole("listitem", { name: "Claude subscription" });
    expect(within(claude).getByText("Chat: usable")).toBeInTheDocument();
    expect(within(claude).getByText("Research: usable")).toBeInTheDocument();
    expect(within(claude).getByText("AI employees: usable")).toBeInTheDocument();
    const codex = within(form).getByRole("listitem", { name: "ChatGPT" });
    expect(within(codex).getByText("Chat: usable")).toBeInTheDocument();
    expect(within(codex).queryByText(/^Research/)).toBeNull();
    expect(within(codex).getByText(/^AI employees: not usable — its model plane is not held/)).toBeInTheDocument();
    expect(within(within(form).getByRole("listitem", { name: "Gemini" })).getByText("Orbit Web runs nothing on Google Antigravity yet.")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Activate the company" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/office/setup")?.body).toEqual({ name: "Octo & Co" }));
    expect(await screen.findByRole("heading", { name: "Octo office" })).toBeInTheDocument();
  });

  test("cards grouped by department, each with its work label in words, what it holds, what is queued, why it is not ready and its connection's warning", async () => {
    fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/office/roster", () =>
        roster({
          employees: [
            employeeCard(),
            busyBao(),
            employeeCard({ id: "e1000000-0000-4000-8000-000000000003", name: "Cam", title: "Researcher", departmentId: null, workLabel: "waiting_resources", connectionWarning: "The connection's login expired." }),
            employeeCard({ id: "e1000000-0000-4000-8000-000000000004", name: "Dee", title: "Clerk", departmentId: null, workLabel: "not_ready", availability: "ineligible", notReadyReason: "connection disconnected" }),
          ],
        }),
      );
    const go = show();
    const accounting = await screen.findByRole("region", { name: "Accounting" });
    const ana = within(accounting).getByRole("article", { name: "Ana" });
    expect(within(ana).getByText("Ready")).toBeInTheDocument();
    const legal = screen.getByRole("region", { name: "Legal" });
    const bao = within(legal).getByRole("article", { name: "Bao" });
    expect(within(bao).getByText("Working")).toBeInTheDocument();
    expect(bao.textContent).toContain("Quarterly contracts review");
    expect(bao.textContent).toContain("1 queued behind it");
    const unassigned = screen.getByRole("region", { name: "Unassigned" });
    const cam = within(unassigned).getByRole("article", { name: "Cam" });
    expect(within(cam).getByText("Waiting for resources")).toBeInTheDocument();
    expect(cam.textContent).toContain("Connection: The connection's login expired.");
    const dee = within(unassigned).getByRole("article", { name: "Dee" });
    expect(within(dee).getByText("Not ready")).toBeInTheDocument();
    expect(dee.textContent).toContain("Not ready: connection disconnected");
    expect(screen.getByText(/2 employees · 1 ready · 1 busy · 0 not ready · 1 queued/)).toBeInTheDocument();
    expect(screen.getByText(/^Data as of /)).toBeInTheDocument();
    await userEvent.click(within(bao).getByRole("button", { name: "Quarterly contracts review" }));
    expect(go).toHaveBeenCalledWith("mission", "a1000000-0000-4000-8000-000000000002");
    await userEvent.click(within(ana).getByRole("button", { name: "Ana" }));
    expect(go).toHaveBeenCalledWith("employee", EMP_ANA);
    await userEvent.click(within(ana).getByRole("button", { name: "Open Ana's profile" }));
    expect(go).toHaveBeenCalledTimes(3);
    expect(go).toHaveBeenLastCalledWith("employee", EMP_ANA);
    await userEvent.click(within(ana).getByRole("button", { name: "Assign work to Ana" }));
    expect(await screen.findByRole("dialog", { name: "Assign work" })).toBeInTheDocument();
  });

  test("hiring needs one connected AI CLI: without one, Hire is disabled and says where to connect one; departments still work", async () => {
    fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView({ connections: [], canHire: false }));
    show();
    const hire = await screen.findByRole("button", { name: "Hire employee" });
    await waitFor(() => expect(screen.getByText(/Connect an AI CLI first/)).toBeInTheDocument());
    expect(hire).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open Settings → AI Connections" })).toHaveAttribute("href", "#/?settings=ai-connections");
    expect(screen.getByRole("button", { name: "New department" })).toBeEnabled();
  });

  test("the department picker (with Unassigned), the search and the status filter ask the roster again", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView());
    show();
    await screen.findByRole("region", { name: "Accounting" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Department" }), "none");
    await waitFor(() => expect(rosterReads(api).some((c) => c.path.includes("department=none"))).toBe(true));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "waiting_resources");
    await waitFor(() => expect(rosterReads(api).some((c) => c.path.includes("status=waiting_resources") && c.path.includes("department=none"))).toBe(true));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search employees" }), "ana");
    await waitFor(() => expect(rosterReads(api).some((c) => c.path.includes("q=ana"))).toBe(true));
    expect(within(screen.getByRole("combobox", { name: "Status" })).getByRole("option", { name: "Waiting for resources" })).toBeInTheDocument();
  });

  test("a new department; a rename and an archive name the version read, and an archive with members asks where they go", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("POST", "/api/office/departments", () => withStatus(201, department({ id: "d1000000-0000-4000-8000-000000000003", name: "Sales" })))
      .on("POST", `/api/office/departments/${DEPT_ACCOUNTING}/archive`, () => department({ archived: true }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "New department" }));
    let dialog = await screen.findByRole("dialog", { name: "New department" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Sales");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/office/departments")?.body).toEqual({ name: "Sales" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Actions for Accounting" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    dialog = await screen.findByRole("dialog", { name: "Archive Accounting?" });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /Move its member to/ }), DEPT_LEGAL);
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/office/departments/${DEPT_ACCOUNTING}/archive`)).toBe(true));
    const archive = api.calls.find((c) => c.path === `/api/office/departments/${DEPT_ACCOUNTING}/archive`);
    expect(archive?.body).toEqual({ moveTo: DEPT_LEGAL });
    expect(archive?.headers["if-match"]).toBe('"1"');
  });

  test("office.changed is an invalidation: the roster is read again, and a lost stream says the data may be behind", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView());
    show();
    await screen.findByRole("region", { name: "Accounting" });
    await streamOpen();
    const before = rosterReads(api).length;
    pushApp("office.changed", { areas: ["schedules"], missionId: null, version: 8 });
    pushApp("office.changed", { areas: ["roster"], missionId: null, version: 9 });
    await waitFor(() => expect(rosterReads(api).length).toBe(before + 1));
    expect(screen.getByText(/^Data as of /)).toBeInTheDocument();
    act(() => FakeEventSource.last("/api/events").onerror?.());
    expect(await screen.findByText("Connection lost — reconnecting…")).toBeInTheDocument();
  });
});

describe("the office: who leads it, and what its employees run on by default", () => {
  const CAM = "e1000000-0000-4000-8000-000000000003";
  const DEE = "e1000000-0000-4000-8000-000000000004";
  const EVE = "e1000000-0000-4000-8000-000000000005";
  const LEGAL_APPOINTMENT = "ab000000-0000-4000-8000-000000000002";
  const appointment = (path: string) => (api: ReturnType<typeof fakeApi>) => api.calls.find((c) => c.method === "POST" && c.path === path);

  test("Leadership: no CEO yet -- a company works without one -- and each department's manager, or none, a suspended one said so; a CEO is appointed among the employees on trial or active", async () => {
    let appointed = false;
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/office/roster", () =>
        roster({
          ceo: appointed ? appointmentSummary() : null,
          employees: [employeeCard(), busyBao({ role: "manager" }), employeeCard({ id: CAM, name: "Cam", title: "Clerk", departmentId: DEPT_LEGAL, employment: "candidate" })],
          departments: [department(), department({ id: DEPT_LEGAL, name: "Legal", position: 1, manager: appointmentSummary({ appointmentId: LEGAL_APPOINTMENT, employeeId: EMP_BAO, name: "Bao", state: "suspended", slotRevision: 2, version: 5 }) })],
        }),
      )
      .on("POST", "/api/office/appointments", () => ((appointed = true), withStatus(201, appointmentView({ role: "ceo", departmentId: null, departmentName: null }))));
    show();
    const leadership = await screen.findByRole("region", { name: "Leadership" });
    const ceo = within(leadership).getByRole("listitem", { name: "CEO" });
    expect(ceo).toHaveTextContent("No CEO yet — a company works without one");
    expect(within(leadership).getByRole("listitem", { name: "Accounting" })).toHaveTextContent("No manager");
    const legal = within(leadership).getByRole("listitem", { name: "Legal" });
    expect(legal).toHaveTextContent("Manager: Bao");
    expect(within(legal).getByText("Suspended")).toBeInTheDocument();
    // A suspended manager is reinstated, never suspended again.
    await userEvent.click(within(legal).getByRole("button", { name: "Leadership actions for Legal" }));
    expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Replace", "Reinstate", "Revoke", "Execution defaults"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(ceo).getByRole("button", { name: "CEO appointment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Appoint" }));
    const dialog = await screen.findByRole("dialog", { name: "Appoint the CEO" });
    const who = await within(dialog).findByRole("combobox", { name: /^Employee/ });
    // On trial or active only (Cam is a candidate); one who holds another appointment is shown, and cannot be chosen.
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an employee", "Ana — Accountant", "Bao — holds an appointment"]);
    expect(within(who).getByRole("option", { name: "Bao — holds an appointment" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Appoint" })).toBeDisabled();
    await userEvent.selectOptions(who, EMP_ANA);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Founder");
    await userEvent.click(within(dialog).getByRole("button", { name: "Appoint" }));
    await waitFor(() => expect(appointment("/api/office/appointments")(api)?.body).toEqual({ role: "ceo", employeeId: EMP_ANA, reason: "Founder" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The roster is read again: the CEO now, with how the appointment stands.
    const now = await within(screen.getByRole("region", { name: "Leadership" })).findByRole("listitem", { name: "CEO" });
    await waitFor(() => expect(within(now).getByRole("button", { name: "Ana" })).toBeInTheDocument());
    expect(within(now).getByText("Active")).toBeInTheDocument();
  });

  test("a manager is chosen among its department's own working members; a replace and a revoke name the version read; a refusal is said as the API said it", async () => {
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/office/roster", () =>
        roster({
          ceo: appointmentSummary({ employeeId: EVE, name: "Eve", version: 3 }),
          employees: [
            employeeCard(),
            employeeCard({ id: DEE, name: "Dee", title: "Clerk", employment: "candidate" }),
            busyBao({ role: "manager" }),
            employeeCard({ id: CAM, name: "Cam", title: "Paralegal", departmentId: DEPT_LEGAL }),
            employeeCard({ id: EVE, name: "Eve", title: "Director", departmentId: null, role: "ceo" }),
          ],
          departments: [department(), department({ id: DEPT_LEGAL, name: "Legal", position: 1, manager: appointmentSummary({ appointmentId: LEGAL_APPOINTMENT, employeeId: EMP_BAO, name: "Bao", version: 5 }) })],
        }),
      )
      .on("POST", "/api/office/appointments", () => withStatus(409, { error: { code: "employee_appointed", message: "Ana holds another appointment (CEO): end it first." } }))
      .on("POST", `/api/office/appointments/${APPOINTMENT_ID}/replace`, () => appointmentView({ role: "ceo", departmentId: null, departmentName: null, employeeId: CAM, employeeName: "Cam" }))
      .on("POST", `/api/office/appointments/${LEGAL_APPOINTMENT}/revoke`, () => appointmentView({ id: LEGAL_APPOINTMENT, departmentId: DEPT_LEGAL, departmentName: "Legal", state: "revoked" }));
    show();
    const leadership = await screen.findByRole("region", { name: "Leadership" });
    // Accounting's manager: among its members on trial or active (Dee is a candidate; Bao and Cam are Legal's).
    await userEvent.click(within(leadership).getByRole("button", { name: "Leadership actions for Accounting" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Appoint" }));
    let dialog = await screen.findByRole("dialog", { name: "Appoint the manager of Accounting" });
    const who = await within(dialog).findByRole("combobox", { name: /^Employee/ });
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an employee", "Ana — Accountant"]);
    await userEvent.selectOptions(who, EMP_ANA);
    await userEvent.click(within(dialog).getByRole("button", { name: "Appoint" }));
    expect(await within(dialog).findByText("Ana holds another appointment (CEO): end it first.")).toBeInTheDocument();
    expect(appointment("/api/office/appointments")(api)?.body).toEqual({ role: "manager", departmentId: DEPT_ACCOUNTING, employeeId: EMP_ANA });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The CEO replaced: anybody on trial or active but the incumbent, against the appointment's version. (The roster is
    // read again after each change: the card is found again, never held from before.)
    await userEvent.click(await within(await screen.findByRole("region", { name: "Leadership" })).findByRole("button", { name: "CEO appointment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Replace" }));
    dialog = await screen.findByRole("dialog", { name: "Replace the CEO" });
    expect(dialog.textContent).toContain("Eve is the CEO now.");
    expect(dialog.textContent).toContain("Open work Eve holds stays with them until a person hands it over.");
    await userEvent.selectOptions(await within(dialog).findByRole("combobox", { name: /^Employee/ }), CAM);
    await userEvent.click(within(dialog).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(appointment(`/api/office/appointments/${APPOINTMENT_ID}/replace`)(api)).toBeDefined());
    expect(appointment(`/api/office/appointments/${APPOINTMENT_ID}/replace`)(api)?.body).toEqual({ employeeId: CAM });
    expect(appointment(`/api/office/appointments/${APPOINTMENT_ID}/replace`)(api)?.headers["if-match"]).toBe('"3"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Legal's manager revoked: the slot is left empty.
    await userEvent.click(await within(await screen.findByRole("region", { name: "Leadership" })).findByRole("button", { name: "Leadership actions for Legal" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Revoke" }));
    dialog = await screen.findByRole("dialog", { name: "Revoke the manager of Legal" });
    expect(dialog.textContent).toContain("The slot is left empty");
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(appointment(`/api/office/appointments/${LEGAL_APPOINTMENT}/revoke`)(api)).toBeDefined());
    expect(appointment(`/api/office/appointments/${LEGAL_APPOINTMENT}/revoke`)(api)?.body).toEqual({});
    expect(appointment(`/api/office/appointments/${LEGAL_APPOINTMENT}/revoke`)(api)?.headers["if-match"]).toBe('"5"');
  });

  test("each department's room on the floor says who manages it; its menu changes that appointment, against the version read, beside renaming and archiving the room", async () => {
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/office/roster", () => roster({ departments: [department(), department({ id: DEPT_LEGAL, name: "Legal", position: 1, manager: appointmentSummary({ appointmentId: LEGAL_APPOINTMENT, employeeId: EMP_BAO, name: "Bao", version: 5 }) })] }))
      .on("POST", `/api/office/appointments/${LEGAL_APPOINTMENT}/suspend`, () => appointmentView({ id: LEGAL_APPOINTMENT, departmentId: DEPT_LEGAL, departmentName: "Legal", employeeId: EMP_BAO, employeeName: "Bao", state: "suspended", version: 6 }));
    const go = show();
    const legal = await screen.findByRole("region", { name: "Legal" });
    expect(legal).toHaveTextContent("Manager: Bao");
    expect(screen.getByRole("region", { name: "Accounting" })).toHaveTextContent("No manager");
    // The manager's name opens the employee (the first "Bao" of the room is its header's; its desk comes after).
    await userEvent.click(within(legal).getAllByRole("button", { name: "Bao" })[0] as HTMLElement);
    expect(go).toHaveBeenCalledWith("employee", EMP_BAO);
    await userEvent.click(within(legal).getByRole("button", { name: "Actions for Legal" }));
    expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Replace", "Suspend", "Revoke", "Rename", "Archive"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog", { name: "Suspend the manager of Legal" });
    expect(dialog.textContent).toContain("Bao is the manager of Legal now.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(appointment(`/api/office/appointments/${LEGAL_APPOINTMENT}/suspend`)(api)).toBeDefined());
    expect(appointment(`/api/office/appointments/${LEGAL_APPOINTMENT}/suspend`)(api)?.body).toEqual({});
    expect(appointment(`/api/office/appointments/${LEGAL_APPOINTMENT}/suspend`)(api)?.headers["if-match"]).toBe('"5"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // An empty slot is appointed to from the same menu.
    await userEvent.click(within(screen.getByRole("region", { name: "Accounting" })).getByRole("button", { name: "Actions for Accounting" }));
    expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Appoint", "Rename", "Archive"]);
  });

  test("execution defaults, the company's and a department's: per runtime, only what is set is sent, against the version read -- and a field a department leaves unset says what the company has", async () => {
    const codex = connection({ id: CONN_CODEX, runtime: "codex", label: "ChatGPT", isDefault: true, plugins: null, catalog: { ...connection().catalog, models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", description: null, efforts: ["low", "medium", "high"], autoMode: true }], recommended: "gpt-6.1-sol" } });
    const api = fakeApi()
      .on("GET", "/api/connections", () => connectionsView({ connections: [connection(), codex] }))
      .on("GET", "/api/office/roster", () => roster({ office: officeRecord({ defaults: { claude: { model: "sonnet" } } }) }))
      .on("PATCH", "/api/office/defaults", () => officeRecord({ version: 8 }))
      .on("PATCH", `/api/office/departments/${DEPT_ACCOUNTING}`, () => department({ version: 2 }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Company defaults" }));
    let dialog = await screen.findByRole("dialog", { name: "Company execution defaults" });
    const claude = await within(dialog).findByRole("group", { name: "Claude Code" });
    // One group a runtime an employee can run on; nothing switches an employee to another runtime.
    expect(within(dialog).getByRole("group", { name: "OpenAI Codex" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Google Antigravity" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Save the defaults" })).toBeDisabled();
    expect(within(claude).getByRole("combobox", { name: /^Model/ })).toHaveValue("sonnet");
    await userEvent.selectOptions(within(claude).getByRole("combobox", { name: /^AI connection/ }), CONN_CLAUDE);
    await userEvent.selectOptions(within(claude).getByRole("combobox", { name: /^Model/ }), "opus");
    const effort = within(claude).getByRole("combobox", { name: /^Effort/ });
    expect(within(effort).getAllByRole("option").map((o) => o.textContent)).toEqual(["Not set", "Low", "Medium", "High", "Max"]);
    await userEvent.selectOptions(effort, "max");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save the defaults" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH" && c.path === "/api/office/defaults")).toBe(true));
    const company = api.calls.find((c) => c.method === "PATCH" && c.path === "/api/office/defaults");
    expect(company?.body).toEqual({ defaults: { claude: { connectionId: CONN_CLAUDE, model: "opus", effort: "max" } } });
    expect(company?.headers["if-match"]).toBe('"7"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // A department's own: what it leaves unset falls to the company's.
    await userEvent.click(within(screen.getByRole("region", { name: "Leadership" })).getByRole("button", { name: "Leadership actions for Accounting" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Execution defaults" }));
    dialog = await screen.findByRole("dialog", { name: "Execution defaults of Accounting" });
    const model = within(await within(dialog).findByRole("group", { name: "Claude Code" })).getByRole("combobox", { name: /^Model/ });
    expect(within(model).getAllByRole("option")[0]).toHaveTextContent("Not set (the company's: Sonnet 5.5)");
    await userEvent.selectOptions(model, "haiku");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save the defaults" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH" && c.path === `/api/office/departments/${DEPT_ACCOUNTING}`)).toBe(true));
    const accounting = api.calls.find((c) => c.method === "PATCH" && c.path === `/api/office/departments/${DEPT_ACCOUNTING}`);
    expect(accounting?.body).toEqual({ defaults: { claude: { model: "haiku" } } });
    expect(accounting?.headers["if-match"]).toBe('"1"');
  });
});
