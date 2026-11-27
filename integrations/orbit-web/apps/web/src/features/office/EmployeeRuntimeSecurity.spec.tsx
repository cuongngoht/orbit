// AN EMPLOYEE'S RUNTIME SECURITY TAB (ADR 0063): an employee with no running attempt shows no process -- its desk is storage
// -- and one that runs shows what holds its attempt now, what was reported, and its incidents.
import { screen } from "@testing-library/react";
import type { EmployeeRuntimeSecurityView } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { authSession } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { EmployeeRuntimeSecurityTab } from "./EmployeeRuntimeSecurityTab";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const ID = "e1000000-0000-4000-8000-000000000001";
const view = (over: Partial<EmployeeRuntimeSecurityView> = {}): EmployeeRuntimeSecurityView => ({ employeeId: ID, current: null, recent: [], events: [], incidents: [], effective: { mode: "observe", controls: ["exec.shared-areas"], from: "company" }, ...over });

describe("Employee → Runtime security", () => {
  test("no running attempt: an inactive state -- the desk is never shown as a process", async () => {
    fakeApi().on("GET", `/api/office/employees/${ID}/runtime-security`, () => view());
    renderLive(<EmployeeRuntimeSecurityTab employeeId={ID} />);
    expect(await screen.findByText(/No attempt runs now/)).toBeTruthy();
    expect(screen.getByText(/observe \(company\)/)).toBeTruthy();
  });

  test("a running attempt shows what holds it now, with its planes' identities", async () => {
    fakeApi().on("GET", `/api/office/employees/${ID}/runtime-security`, () =>
      view({
        current: { runId: "r1000000-0000-4000-8000-000000000001", assignmentId: "a1", missionId: null, employeeId: ID, employeeName: "Lan", departmentId: null, attempt: 2, runState: "running", state: "OBSERVING", mode: "observe", controls: ["exec.shared-areas"], detail: "Observed", verifiedAt: null, freshUntil: "2999-01-01T00:00:00.000Z", planes: [{ plane: "tool-plane", containerId: "abcdef0123456789", startedAt: "s", mntNs: "4026533001", sensorMntNs: "4026533001" }], checks: [{ name: "canary_observed", ok: true, detail: null }], updatedAt: "2026-11-26T10:00:00.000Z" },
      }),
    );
    renderLive(<EmployeeRuntimeSecurityTab employeeId={ID} />);
    expect(await screen.findByText("observing")).toBeTruthy();
    expect(screen.getByText(/tool-plane abcdef012345 · mnt 4026533001/)).toBeTruthy();
    expect(screen.queryByText(/No attempt runs now/)).toBeNull();
  });
});
