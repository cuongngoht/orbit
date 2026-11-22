import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeeDesk, EmployeeDeskList } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
  usedMiB: 300,
  version: 4,
  ...over,
});
const list = (desks: EmployeeDesk[]): EmployeeDeskList => ({ desks, storage: { budgetMiB: 18371, committedMiB: 13312 }, asOf: "2026-11-22T03:10:00.000Z" });

describe("Governance → Employee desks: who left with a desk, and deleting it", () => {
  test("each one who left: what it holds of the account's storage, and Delete the desk behind a confirmation that says what goes", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/desks", () => list([desk()]))
      .on("POST", "/api/employees/e1000000-0000-4000-8000-000000000001/employment", () => ({}));
    renderLive(<EmployeeDesksPage />);
    expect(await screen.findByText(/13 GiB of the account's 17.9 GiB is committed now/)).toBeInTheDocument();
    const card = (await screen.findByText(/Holds 5 GiB of the account's storage/)).closest("section, div") as HTMLElement;
    expect(card.textContent).toContain("300 MiB measured in use");
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
    const { unmount } = renderLive(<EmployeeDesksPage />);
    expect(await screen.findByText(/still exist/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete the desk…" })).toBeNull();
    unmount();
    fakeApi().on("GET", "/api/office/desks", () => list([]));
    renderLive(<EmployeeDesksPage />);
    expect(await screen.findByText(/No desk is held/)).toBeInTheDocument();
  });
});
