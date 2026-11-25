import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_PRESETS, type ExecutiveCapability, type ExecutiveState, type ExecutiveTurn, type HiringRequest, type StaffingAccepted, type StaffingView } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus, type FakeApi } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import { APPOINTMENT_ID, AS_OF, CONN_CLAUDE, DEPT_LEGAL, EMP_ANA, connection, connectionsView, presets, resourceSummary, roster } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const STAFFING = "5a000000-0000-4000-8000-000000000001";
const CONV = "c0000000-0000-4000-8000-0000000000c1";
const HIRED = ["e2000000-0000-4000-8000-000000000001", "e2000000-0000-4000-8000-000000000002"];
const OK: ExecutiveCapability = { ok: true, code: null, reason: null };

const state = (recruit: ExecutiveCapability = OK): ExecutiveState => ({
  company: { id: "o1", name: "Octo office" },
  state: "available",
  ceo: { employeeId: EMP_ANA, name: "Ana", title: "Chief executive", employment: "active", appointment: { id: APPOINTMENT_ID, revision: 1, state: "active", since: AS_OF }, execution: { runtime: "claude", connectionId: CONN_CLAUDE, connectionName: "Claude subscription", model: "sonnet", effort: "medium", sources: { connection: "employee", model: "employee", effort: "employee" } }, holding: null },
  converse: OK,
  assign: OK,
  recruit,
});
const turn = (over: Partial<ExecutiveTurn> = {}): ExecutiveTurn => ({ id: "t1", conversationId: CONV, kind: "staffing", state: "waiting", requestMessageId: "m1", responseMessageId: null, employeeId: EMP_ANA, authorName: "Ana", appointmentId: APPOINTMENT_ID, appointmentRevision: 1, waitingReason: "Ana is working on a mission run now: the answer starts once that run ends.", code: null, detail: null, records: [], createdAt: AS_OF, startedAt: null, endedAt: null, ...over });
const view = (over: Partial<StaffingView> = {}): StaffingView => ({ id: STAFFING, state: "planning", requirement: "Two analysts for Legal.", departmentId: DEPT_LEGAL, departmentName: "Legal", execution: { runtime: "claude", connectionId: CONN_CLAUDE, model: "opus", effort: "high", webSearch: false, orbitPlugin: false }, resources: DEFAULT_PRESETS[0]?.profile as StaffingView["resources"], maxHires: 10, conversationId: CONV, turnId: "t1", plan: null, outcome: null, createdAt: AS_OF, endedAt: null, ...over });

function api(recruit: ExecutiveCapability = OK, staffing: () => StaffingView = () => view()): FakeApi {
  const accepted: StaffingAccepted = { staffingId: STAFFING, conversationId: CONV, message: { id: "m1", conversationId: CONV, position: 1, role: "owner", author: { name: "Octo Cat", userId: "u1", employeeId: null, appointmentId: null, appointmentRevision: null, current: false }, text: "Two analysts for Legal.", partial: false, model: null, report: null, proposal: null, proposalNote: null, missionId: null, turnId: null, createdAt: AS_OF } as StaffingAccepted["message"], turn: turn() };
  return fakeApi()
    .on("GET", "/api/office/roster", () => roster())
    .on("GET", "/api/connections", () => connectionsView({ connections: [connection()] }))
    .on("GET", "/api/office/resources", () => resourceSummary())
    .on("GET", "/api/office/resource-presets", () => presets())
    .on("GET", "/api/executive", () => state(recruit))
    .on("POST", "/api/executive/staffing", () => withStatus(202, accepted))
    .on("GET", `/api/executive/staffing/${STAFFING}`, () => staffing())
    .on("GET", `/api/executive/conversations/${CONV}`, () => ({ conversation: { id: CONV, title: "Hiring: Two analysts for Legal.", createdAt: AS_OF, lastMessageAt: AS_OF, messages: 1 }, messages: [], hasOlder: false, turns: [turn()], links: [], lastSeq: 1 }));
}

function show(go = vi.fn()) {
  renderLive(<OfficeView page="overview" item={null} tab={null} go={go} account={authAccount()} />);
  return go;
}

describe("recruit: the owner's hiring request, planned by the CEO", () => {
  test("the request names what the company needs, its scope, and what every hire runs on and holds; the dialog follows it to who was hired", async () => {
    let planned = false;
    const a = api(OK, () => (planned ? view({ state: "hired", endedAt: AS_OF, outcome: { hired: [{ employeeId: HIRED[0] as string, name: "Lan", departmentId: DEPT_LEGAL, departmentName: "Legal", role: "member" }, { employeeId: HIRED[1] as string, name: "Hoa", departmentId: DEPT_LEGAL, departmentName: "Legal", role: "member" }], departmentsCreated: [], appointed: [], problems: [] } }) : view()));
    const go = show();
    const recruit = await screen.findByRole("button", { name: "Recruit" });
    await waitFor(() => expect(recruit).toBeEnabled());
    await userEvent.click(recruit);
    const dialog = await screen.findByRole("dialog", { name: "Recruit with the CEO" });
    expect(dialog.textContent).toContain("Ana plans who to hire");
    const send = within(dialog).getByRole("button", { name: "Send to Ana" });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What does the company need/ }), "Two analysts for Legal.");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /^For/ }), DEPT_LEGAL);
    expect(dialog.textContent).toContain("Everyone is hired into Legal; no department is made.");
    await userEvent.selectOptions(await within(dialog).findByRole("combobox", { name: /^Model/ }), "opus");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /^Effort/ }), "high");
    expect(dialog.textContent).toContain("The storage budget holds up to 10 new employees now.");
    await userEvent.click(send);
    await waitFor(() => expect(a.calls.some((c) => c.method === "POST" && c.path === "/api/executive/staffing")).toBe(true));
    const posted = a.calls.find((c) => c.method === "POST" && c.path === "/api/executive/staffing");
    expect(posted?.body as HiringRequest).toEqual({ requirement: "Two analysts for Legal.", departmentId: DEPT_LEGAL, execution: { runtime: "claude", connectionId: CONN_CLAUDE, model: "opus", effort: "high", webSearch: false, orbitPlugin: false }, resources: DEFAULT_PRESETS[0]?.profile });
    expect(posted?.headers["idempotency-key"]).toMatch(/.{8,}/);
    // Followed: the CEO is busy, and the dialog says why; then who was hired.
    expect(await within(dialog).findByText("Ana will plan this as soon as it can answer.")).toBeInTheDocument();
    expect(dialog.textContent).toContain("Ana is working on a mission run now");
    expect(within(dialog).getByRole("link", { name: "Open in CEO Chat" })).toHaveAttribute("href", `#/ceo/${CONV}`);
    planned = true;
    expect(await within(dialog).findByText("Hired 2, each on probation.", undefined, { timeout: 5000 })).toBeInTheDocument();
    const list = within(dialog).getByRole("list", { name: "Hired" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Lan member of Legal", "Hoa member of Legal"]);
    await userEvent.click(within(list).getByRole("button", { name: "Lan" }));
    expect(go).toHaveBeenCalledWith("employee", HIRED[0]);
  });

  test("a request that could not be carried out says why, and nothing more", async () => {
    api(OK, () => view({ state: "refused", endedAt: AS_OF, outcome: { hired: [], departmentsCreated: [], appointed: [], problems: ["Legal has a manager in office (Bao): the plan appoints no other (Lan)."] } }));
    show();
    const recruit = await screen.findByRole("button", { name: "Recruit" });
    await waitFor(() => expect(recruit).toBeEnabled());
    await userEvent.click(recruit);
    const dialog = await screen.findByRole("dialog", { name: "Recruit with the CEO" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What does the company need/ }), "A manager for Legal.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to Ana" }));
    expect(await within(dialog).findByText("Nothing was hired: the plan could not be carried out.")).toBeInTheDocument();
    expect(within(within(dialog).getByRole("list", { name: "Why nothing was hired" })).getByText(/Legal has a manager in office/)).toBeInTheDocument();
  });

  test("offered only when the CEO can plan one, saying why not; a department's menu asks for that department", async () => {
    api({ ok: false, code: "no_ceo", reason: "The company has no CEO yet." });
    show();
    const off = await screen.findByRole("button", { name: "Recruit" });
    await waitFor(() => expect(off).toHaveAttribute("title", "The company has no CEO yet."));
    expect(off).toBeDisabled();
  });

  test("a department's menu offers a request for that department alone", async () => {
    api();
    show();
    const legal = await screen.findByRole("region", { name: "Legal" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Recruit" })).toBeEnabled());
    await userEvent.click(within(legal).getByRole("button", { name: "Actions for Legal" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Recruit for this department" }));
    const dialog = await screen.findByRole("dialog", { name: "Recruit with the CEO" });
    expect(within(dialog).getByRole("combobox", { name: /^For/ })).toHaveValue(DEPT_LEGAL);
  });
});
