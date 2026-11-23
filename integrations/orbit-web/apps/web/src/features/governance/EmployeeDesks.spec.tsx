import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeeDesk, EmployeeDeskList } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { CSRF, authSession } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { EmployeeDesksPage } from "./EmployeeDesksPage";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const desk = (over: Partial<EmployeeDesk> = {}): EmployeeDesk => ({
  employeeId: "e1000000-0000-4000-8000-000000000001",
  name: "Cương",
  employment: "archived",
  reason: "the project ended",
  leftAt: "2026-11-22T03:00:00.000Z",
  sandbox: { state: "ARCHIVED", reason: "The employee was archived: the desk is kept, read-only." },
  deskMiB: 5120,
  cacheMiB: 0,
  deskUsedMiB: 300,
  cacheUsedMiB: null,
  measuredAt: "2026-11-22T03:05:00.000Z",
  deskVersion: 6,
  busy: false,
  canBrowse: true,
  canClean: false,
  version: 4,
  ...over,
});
const working = (over: Partial<EmployeeDesk> = {}): EmployeeDesk =>
  desk({ employeeId: "e2000000-0000-4000-8000-000000000002", name: "Lan", employment: "active", reason: null, leftAt: null, sandbox: { state: "READY", reason: null }, deskMiB: 2048, cacheMiB: 1024, deskUsedMiB: 1536, cacheUsedMiB: 700, canClean: true, ...over });
const list = (desks: EmployeeDesk[]): EmployeeDeskList => ({ desks, storage: { budgetMiB: 18371, committedMiB: 13312 }, asOf: "2026-11-22T03:10:00.000Z" });

describe("Governance → Employee desks: every employee's desk, looked into; who left with one, and deleting it", () => {
  test("those in the office first, then those who left; each with what it holds; any of them opened, only one who left deleted", async () => {
    fakeApi().on("GET", "/api/office/desks", () => list([working(), working({ employeeId: "e3000000-0000-4000-8000-000000000003", name: "Minh", busy: true, canClean: false }), desk()]));
    const go = vi.fn();
    renderLive(<EmployeeDesksPage item={null} go={go} />);
    const office = await screen.findByRole("region", { name: "In the office" });
    const left = screen.getByRole("region", { name: "Left the office" });
    expect(within(office).getByText(/Lan/)).toBeInTheDocument();
    expect(within(office).getAllByText(/1.5 GiB measured in the desk/).length).toBeGreaterThan(0);
    expect(within(office).getByText(/holds work now/i)).toBeInTheDocument();
    expect(within(left).getByText(/Cương/)).toBeInTheDocument();
    expect(within(office).queryByRole("button", { name: "Delete the desk…" })).toBeNull();
    expect(within(left).getByRole("button", { name: "Delete the desk…" })).toBeInTheDocument();
    await userEvent.click(within(office).getAllByRole("button", { name: "Open the desk" })[0] as HTMLElement);
    expect(go).toHaveBeenCalledWith("desks", "e2000000-0000-4000-8000-000000000002");
  });

  test("each one who left: what it holds of the account's storage, and Delete the desk behind a confirmation that says what goes", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/desks", () => list([desk()]))
      .on("POST", "/api/employees/e1000000-0000-4000-8000-000000000001/employment", () => ({}));
    renderLive(<EmployeeDesksPage item={null} go={() => undefined} />);
    expect(await screen.findByText(/13 GiB of the account's 17.9 GiB is committed now/)).toBeInTheDocument();
    const card = (await screen.findByText(/Holds 5 GiB of the account's storage/)).closest("section, div") as HTMLElement;
    expect(card.textContent).toContain("300 MiB measured in the desk");
    expect(screen.getByText(/the project ended/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete the desk…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("deleted for good");
    expect(dialog.textContent).toContain("This cannot be undone");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete the desk" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/employment"))).toBe(true));
    const post = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/employment"));
    expect((post?.body as { command: string }).command).toBe("delete");
    expect(post?.headers["if-match"]).toBe('"4"');
    expect(post?.headers["x-orbit-csrf"]).toBe(CSRF);
  });

  test("a desk being deleted says so, with no second delete; nobody left: nothing held", async () => {
    fakeApi().on("GET", "/api/office/desks", () => list([desk({ employment: "deleted", sandbox: { state: "DELETING", reason: "Being deleted: 1 container(s) of this employee's attempts still exist" } })]));
    const { unmount } = renderLive(<EmployeeDesksPage item={null} go={() => undefined} />);
    expect(await screen.findByText(/still exist/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete the desk…" })).toBeNull();
    unmount();
    fakeApi().on("GET", "/api/office/desks", () => list([]));
    renderLive(<EmployeeDesksPage item={null} go={() => undefined} />);
    expect(await screen.findByText(/No employee has a desk yet/)).toBeInTheDocument();
  });
});
