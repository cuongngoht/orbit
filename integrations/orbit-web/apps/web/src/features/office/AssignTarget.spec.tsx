import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import { APPOINTMENT_ID, ASSIGNMENT_ID, DEPT_ACCOUNTING, DEPT_LEGAL, EMP_ANA, EMP_BAO, MISSION_ID, connectionsView, roster, targetPreview } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const CEO_APPOINTMENT = "ab000000-0000-4000-8000-000000000003";
const NEW_APPOINTMENT = "ab000000-0000-4000-8000-000000000004";

const accepted = (employeeId: string) => ({ missionId: MISSION_ID, assignmentId: ASSIGNMENT_ID, state: "ASSIGNED", employeeId, resourceVersion: 12, href: `#/office/mission/${MISSION_ID}`, correlationId: "cor-1" });

// The office with its roster, and the Assign dialog opened from its "Assign work" button.
async function openAssign() {
  renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Assign work" }));
  return screen.findByRole("dialog", { name: "Assign work" });
}

const posts = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.method === "POST" && c.path === "/api/missions");

describe("giving work to a department or to the CEO", () => {
  test("a department: who is responsible is said before sending, and the request names the target and the person seen", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/missions/target", (_, url) =>
        url.searchParams.get("departmentId") === DEPT_LEGAL
          ? targetPreview({ target: { kind: "department", departmentId: DEPT_LEGAL }, responsible: { employeeId: EMP_BAO, appointmentId: NEW_APPOINTMENT, appointmentRevision: 1, employeeName: "Bao", role: "manager", departmentName: "Legal" } })
          : targetPreview(),
      )
      .on("POST", "/api/missions", () => withStatus(201, accepted(EMP_ANA)));
    const dialog = await openAssign();
    await userEvent.click(within(dialog).getByRole("radio", { name: "A department" }));
    // Departments in the office's order; the first is chosen and asked about at once.
    const department = await within(dialog).findByRole("combobox", { name: /^Department/ });
    expect(within(department).getAllByRole("option").map((o) => o.textContent)).toEqual(["Accounting", "Legal"]);
    expect(await within(dialog).findByText("Responsible: Ana (manager of Accounting)")).toBeInTheDocument();
    await userEvent.selectOptions(department, DEPT_LEGAL);
    expect(await within(dialog).findByText("Responsible: Bao (manager of Legal)")).toBeInTheDocument();
    await userEvent.selectOptions(department, DEPT_ACCOUNTING);
    expect(await within(dialog).findByText("Responsible: Ana (manager of Accounting)")).toBeInTheDocument();
    expect(api.calls.map((c) => c.path)).toContain(`/api/missions/target?kind=department&departmentId=${DEPT_ACCOUNTING}`);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Close the books");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    expect(screen.getByText(/Ana holds it now\. State: Assigned\./)).toBeInTheDocument();
    expect(posts(api)).toHaveLength(1);
    const body = posts(api)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ goal: "Close the books", target: { kind: "department", departmentId: DEPT_ACCOUNTING }, expectedAssignee: { employeeId: EMP_ANA, appointmentId: APPOINTMENT_ID, appointmentRevision: 3 }, whenBusy: "reject" });
    expect(body.targetEmployeeId).toBeUndefined();
  });

  test("the CEO: asked for by its kind, and sent with the CEO the person saw", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/missions/target", () => targetPreview({ target: { kind: "ceo" }, responsible: { employeeId: EMP_BAO, appointmentId: CEO_APPOINTMENT, appointmentRevision: 2, employeeName: "Bao", role: "ceo", departmentName: null } }))
      .on("POST", "/api/missions", () => withStatus(201, accepted(EMP_BAO)));
    const dialog = await openAssign();
    await userEvent.click(within(dialog).getByRole("radio", { name: "The CEO" }));
    expect(await within(dialog).findByText("Responsible: Bao (CEO)")).toBeInTheDocument();
    expect(api.calls.map((c) => c.path)).toContain("/api/missions/target?kind=ceo");
    // Nobody to choose by name: the employee picker is not offered.
    expect(within(dialog).queryByRole("combobox", { name: /Employee/ })).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Set the quarter's budget");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    expect(posts(api)[0]?.body).toMatchObject({ target: { kind: "ceo" }, expectedAssignee: { employeeId: EMP_BAO, appointmentId: CEO_APPOINTMENT, appointmentRevision: 2 } });
  });

  test.each([
    ["a department with no manager", "A department", targetPreview({ target: { kind: "department", departmentId: DEPT_ACCOUNTING }, responsible: null, code: "no_manager", reason: "Accounting has no manager: appoint one, or give the work to an employee of it." })],
    ["no CEO", "The CEO", targetPreview({ target: { kind: "ceo" }, responsible: null, code: "no_ceo", reason: "The company has no CEO: appoint one (Office → Leadership), or give the work to an employee." })],
    [
      "a suspended appointment",
      "A department",
      targetPreview({ responsible: null, code: "appointment_suspended", reason: "Ana's appointment as Accounting's manager is suspended: reinstate it, appoint someone else, or give the work to an employee." }),
    ],
  ])("%s: the reason is said as the API said it, and nothing can be sent", async (_, kind, preview) => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/missions/target", () => preview);
    const dialog = await openAssign();
    await userEvent.click(within(dialog).getByRole("radio", { name: kind }));
    expect(await within(dialog).findByText(preview.reason as string)).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Responsible:/)).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Close the books");
    expect(within(dialog).getByRole("button", { name: "Start now" })).toBeDisabled();
    // Back to an employee: work can be sent again.
    await userEvent.click(within(dialog).getByRole("radio", { name: "An employee" }));
    expect(within(dialog).getByRole("button", { name: "Start now" })).toBeEnabled();
    expect(posts(api)).toHaveLength(0);
  });

  test("target_changed: nothing was created, who is responsible now is said, and sending again is a NEW request naming them", async () => {
    let n = 0;
    const now = { employeeId: EMP_BAO, appointmentId: NEW_APPOINTMENT, appointmentRevision: 4, employeeName: "Bao", role: "manager" as const, departmentName: "Accounting" };
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/missions/target", () => targetPreview())
      .on("POST", "/api/missions", () =>
        ++n === 1 ? withStatus(409, { error: { code: "target_changed", message: "Who is responsible for this target changed since you looked: check, then send it again.", details: { current: now } } }) : withStatus(201, accepted(EMP_BAO)),
      );
    const dialog = await openAssign();
    await userEvent.click(within(dialog).getByRole("radio", { name: "A department" }));
    expect(await within(dialog).findByText("Responsible: Ana (manager of Accounting)")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Close the books");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await within(dialog).findByText("Who is responsible changed since you looked, so nothing was created. It is Bao (manager of Accounting) now: send it again to give it to them.")).toBeInTheDocument();
    expect(within(dialog).getByText("Responsible: Bao (manager of Accounting)")).toBeInTheDocument();
    // Everything typed stays.
    expect(within(dialog).getByRole("textbox", { name: /^Goal/ })).toHaveValue("Close the books");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    const [first, second] = posts(api);
    expect(posts(api)).toHaveLength(2);
    expect(first?.body).toMatchObject({ expectedAssignee: { employeeId: EMP_ANA, appointmentId: APPOINTMENT_ID, appointmentRevision: 3 } });
    expect(second?.body).toMatchObject({ target: { kind: "department", departmentId: DEPT_ACCOUNTING }, expectedAssignee: { employeeId: EMP_BAO, appointmentId: NEW_APPOINTMENT, appointmentRevision: 4 } });
    // The refusal is kept under the first key: the second request is a new one.
    expect(first?.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(second?.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(second?.headers["idempotency-key"]).not.toBe(first?.headers["idempotency-key"]);
  });

  test("a slot emptied between the look and the send: the refusal is said, the target is asked about again, and nothing can be sent", async () => {
    let previews = 0;
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/missions/target", () => (++previews === 1 ? targetPreview() : targetPreview({ responsible: null, code: "no_manager", reason: "Accounting has no manager: appoint one, or give the work to an employee of it." })))
      .on("POST", "/api/missions", () => withStatus(409, { error: { code: "no_manager", message: "Accounting has no manager: appoint one, or give the work to an employee of it.", details: { target: { kind: "department", departmentId: DEPT_ACCOUNTING } } } }));
    const dialog = await openAssign();
    await userEvent.click(within(dialog).getByRole("radio", { name: "A department" }));
    expect(await within(dialog).findByText("Responsible: Ana (manager of Accounting)")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Close the books");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    await waitFor(() => expect(within(dialog).getAllByText("Accounting has no manager: appoint one, or give the work to an employee of it.")).toHaveLength(2));
    expect(within(dialog).getByRole("button", { name: "Start now" })).toBeDisabled();
    expect(posts(api)).toHaveLength(1);
  });
});
