import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeskEntry, DeskFile, DeskTree } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { CSRF, authSession } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { DeskBrowser } from "./DeskBrowser";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const ID = "e2000000-0000-4000-8000-000000000002";
const entry = (over: Partial<DeskEntry>): DeskEntry => ({ name: "x", path: "x", type: "file", bytes: 10, files: 1, modifiedAt: "2026-11-23T01:00:00.000Z", target: null, ...over });
const tree = (dir: string, entries: DeskEntry[], over: Partial<DeskTree> = {}): DeskTree => ({
  employee: { id: ID, name: "Lan", employment: "active" },
  dir,
  deskVersion: 3,
  entries,
  truncated: false,
  bytes: entries.reduce((n, e) => n + e.bytes, 0),
  files: entries.reduce((n, e) => n + e.files, 0),
  storage: { deskQuotaMiB: 2048, cacheQuotaMiB: 1024, deskUsedMiB: 1536, cacheUsedMiB: 700, measuredAt: "2026-11-23T01:00:00.000Z" },
  clean: { allowed: true, why: null },
  asOf: "2026-11-23T01:00:00.000Z",
  ...over,
});
const ROOT = [entry({ name: "reports", path: "reports", type: "dir", bytes: 3 * 1024 * 1024, files: 2 }), entry({ name: "toolbox", path: "toolbox", type: "dir", bytes: 900, files: 1 }), entry({ name: "data.bin", path: "data.bin", bytes: 4 }), entry({ name: "out", path: "out", type: "link", bytes: 0, files: 0, target: "/etc" })];
const REPORTS = [entry({ name: "q3.html", path: "reports/q3.html", bytes: 31 })];
const file = (over: Partial<DeskFile>): DeskFile => ({ path: "reports/q3.html", bytes: 31, text: "<script>alert(1)</script>", truncated: false, deskVersion: 3, modifiedAt: "2026-11-23T01:00:00.000Z", ...over });

function desk(over: Partial<DeskTree> = {}) {
  return fakeApi()
    .on("GET", `/api/employees/${ID}/desk`, (_b, url) => (url.searchParams.get("dir") === "reports" ? tree("reports", REPORTS, over) : tree("", ROOT, over)))
    .on("GET", `/api/employees/${ID}/desk/file`, (_b, url) => (url.searchParams.get("path") === "data.bin" ? file({ path: "data.bin", bytes: 4, text: null }) : file({})));
}

describe("an employee's desk, looked into and cleaned up", () => {
  test("a folder at a time, the biggest first, with sizes; a file opens as text -- a page's markup shown, never run; a binary file only named", async () => {
    desk();
    const { container } = renderLive(<DeskBrowser employeeId={ID} go={() => undefined} />);
    expect(await screen.findByText(/Lan's desk/)).toBeInTheDocument();
    expect(screen.getByText(/1.5 GiB of 2 GiB measured in the desk/)).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "What the desk holds" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => (within(r).getAllByRole("cell")[0]?.textContent ?? "").split(" ")[0])).toEqual(["reports", "toolbox", "data.bin", "out"]);
    expect(screen.getByText("3 MiB")).toBeInTheDocument();
    expect(screen.getByText(/→ \/etc/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "out" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "reports" }));
    await userEvent.click(await screen.findByRole("button", { name: "q3.html" }));
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toContain("<script>alert(1)</script>"));
    expect(container.querySelector("pre script")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Desk" }));
    await userEvent.click(await screen.findByRole("button", { name: "data.bin" }));
    expect(await screen.findByText(/Not text: 4 bytes/)).toBeInTheDocument();
  });

  test("Clean up…: the paths chosen are named before anything goes, and sent with the desk's version; a desk that moved since says so", async () => {
    let answer: unknown = { removed: 2, paths: ["reports"], missing: [], cacheEmptied: false, deskVersion: 3 };
    const api = desk().on("POST", `/api/employees/${ID}/desk/clean`, () => answer);
    renderLive(<DeskBrowser employeeId={ID} go={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Clean up…" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Choose reports" }));
    expect(screen.queryByRole("checkbox", { name: "Choose toolbox" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove 1…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("reports");
    expect(dialog.textContent).toContain("cannot be undone");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const post = api.calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ remove: ["reports"] });
    expect(post?.headers["if-match"]).toBe('"3"');
    expect(post?.headers["x-orbit-csrf"]).toBe(CSRF);
    expect(await screen.findByText(/Removed 2/)).toBeInTheDocument();

    answer = withStatus(412, { error: { code: "stale_version", message: "The desk is at version 4, not 3" } });
    await userEvent.click(await screen.findByRole("button", { name: "Empty the desk, keep the toolbox…" }));
    const empty = await screen.findByRole("dialog");
    expect(empty.textContent).toContain("toolbox");
    await userEvent.click(within(empty).getByRole("button", { name: "Empty the desk" }));
    expect(await screen.findByText(/changed since you opened it: nothing was removed/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST").at(-1)?.body).toEqual({ empty: true });
  });

  test("a desk that may not be cleaned now says why, and offers no clean-up; the way back goes to every desk", async () => {
    desk({ clean: { allowed: false, why: "This employee holds work: clean it once that work is done." } });
    const go = vi.fn();
    renderLive(<DeskBrowser employeeId={ID} go={go} />);
    expect(await screen.findByText(/holds work: clean it once that work is done/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clean up…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Empty the cache…" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "All desks" }));
    expect(go).toHaveBeenCalledWith("desks");
  });
});
