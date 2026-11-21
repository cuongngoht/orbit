import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { pushApp } from "../../testing/events";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { authAccount, authSession } from "../../testing/fixtures";
import { DEPT_ACCOUNTING, DEPT_LEGAL, EMP_ANA, busyBao, connectionsView, department, employeeCard, notSetUp, roster } from "../../testing/officeFixtures";
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
  test("an account with no office is offered one -- example departments it may skip -- and setting it up needs no AI connection", async () => {
    let setUp = false;
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => (setUp ? roster({ employees: [] }) : notSetUp()))
      .on("GET", "/api/connections", () => connectionsView({ connections: [], canHire: false }))
      .on("POST", "/api/office/setup", () => ((setUp = true), { id: "0ff1ce00-0000-4000-8000-000000000001", name: "Octo & Co", version: 1, createdAt: "2026-11-21T00:00:00.000Z" }));
    show();
    const form = await screen.findByRole("form", { name: "Set up the office" });
    expect(within(form).getByRole("textbox", { name: "Office name" })).toHaveValue("Octo & Co");
    for (const d of ["Accounting", "Legal", "Sales"]) expect(within(form).getByRole("checkbox", { name: d })).toBeChecked();
    await userEvent.click(within(form).getByRole("checkbox", { name: "Legal" }));
    await userEvent.click(within(form).getByRole("button", { name: "Set up the office" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/office/setup")?.body).toEqual({ name: "Octo & Co", departments: ["Accounting", "Sales"] }));
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
