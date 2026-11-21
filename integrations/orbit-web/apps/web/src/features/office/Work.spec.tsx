import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { CSRF, authAccount, authSession } from "../../testing/fixtures";
import { ASSIGNMENT_ID, EMP_BAO, HANDOFF_DIGEST, MISSION_ID, assignmentView, busyBao, connectionsView, missionDetail, missionList, missionSummary, roster, runView } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { NETWORK_DISCLOSURE } from "./parts";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const accepted = (state: "ASSIGNED" | "QUEUED") => ({ missionId: MISSION_ID, assignmentId: ASSIGNMENT_ID, state, employeeId: EMP_BAO, resourceVersion: 12, href: `/office/mission/${MISSION_ID}`, correlationId: "cor-1" });

describe("assigning work", () => {
  test("Start now refuses a busy employee and creates nothing: everything typed stays, the held work is said, and Queue it sends a new request with a new key", async () => {
    let n = 0;
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("POST", "/api/missions", () =>
        ++n === 1 ? withStatus(409, { error: { code: "employee_busy", message: "Bao holds other work.", details: { employeeId: EMP_BAO, holding: busyBao().holding, correlationId: "cor-0" } } }) : withStatus(202, accepted("QUEUED")),
      );
    const go = vi.fn();
    renderLive(<OfficeView page="overview" item={null} tab={null} go={go} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Assign work to Bao" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign work" });
    expect(within(dialog).getByRole("combobox", { name: /Employee/ })).toHaveValue(EMP_BAO);
    expect(within(dialog).getByRole("radio", { name: /^Start now/ })).toBeChecked();
    expect(dialog.textContent).toContain(NETWORK_DISCLOSURE);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Review the NDA");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Deliverable file name" }), "nda-review.md");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await within(dialog).findByText(/Bao is busy, so nothing was created\. It is working on “Quarterly contracts review” \(Working\)/)).toBeInTheDocument();
    // Everything typed stays.
    expect(within(dialog).getByRole("textbox", { name: /^Goal/ })).toHaveValue("Review the NDA");
    expect(within(within(dialog).getByRole("list", { name: "Deliverables to hand in" })).getByText("nda-review.md")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Choose another employee" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Queue it" }));
    expect(await screen.findByRole("dialog", { name: "Queued" })).toBeInTheDocument();
    expect(screen.getByText(/It waits behind Bao's current work\. State: Queued\./)).toBeInTheDocument();
    const posts = api.calls.filter((c) => c.method === "POST" && c.path === "/api/missions");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toMatchObject({ goal: "Review the NDA", targetEmployeeId: EMP_BAO, whenBusy: "reject", deliverables: [{ name: "nda-review.md", required: true }] });
    expect(posts[1]?.body).toMatchObject({ goal: "Review the NDA", targetEmployeeId: EMP_BAO, whenBusy: "enqueue" });
    const k1 = posts[0]?.headers["idempotency-key"];
    const k2 = posts[1]?.headers["idempotency-key"];
    expect(k1).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(k2).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(k2).not.toBe(k1);
    expect(posts[1]?.headers["x-orbit-csrf"]).toBe(CSRF);
    await userEvent.click(screen.getByRole("button", { name: "Open the work" }));
    expect(go).toHaveBeenCalledWith("mission", MISSION_ID);
  });

  test("a free employee starts at once, and the page says the state the API returned", async () => {
    fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("POST", "/api/missions", () => withStatus(201, accepted("ASSIGNED")));
    renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Assign work to Ana" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign work" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Close the books");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    expect(screen.getByText(/holds it now\. State: Assigned\./)).toBeInTheDocument();
  });
});

describe("the work and one mission", () => {
  test("the work: open missions, a queued one marked as queued, and Load more", async () => {
    const queued = missionSummary({ id: "a1000000-0000-4000-8000-000000000009", title: "NDA review", assignment: { ...missionSummary().assignment, state: "QUEUED", employeeName: "Bao" } });
    const api = fakeApi()
      .on("GET", "/api/missions", (_, url) => (url.searchParams.get("cursor") === "p2" ? missionList([queued]) : missionList([missionSummary()], { nextCursor: "p2" })));
    renderLive(<OfficeView page="work" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    const list = await screen.findByRole("list", { name: "Open work" });
    expect(within(list).getByText("Awaiting acceptance")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await within(list).findByText("NDA review")).toBeInTheDocument();
    expect(within(list).getByText("Queued")).toBeInTheDocument();
    expect(list.textContent).toContain("Queued for Bao");
    expect(api.calls.map((c) => c.path)).toContain("/api/missions?state=open&cursor=p2");
    await userEvent.click(screen.getByRole("tab", { name: "Closed" }));
    await waitFor(() => expect(api.calls.map((c) => c.path)).toContain("/api/missions?state=closed"));
  });

  test("a handoff's revisions, artifacts, claims supported or not and what it misses; Request revision names the digest viewed and the version read", async () => {
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail())
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/request-revision`, () => ({ assignmentId: ASSIGNMENT_ID, state: "RUNNING", version: 10, resourceVersion: 13, correlationId: "c" }));
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="handoffs" go={vi.fn()} account={authAccount()} />);
    const r2 = await screen.findByRole("article", { name: "Revision 2" });
    expect(screen.getByRole("article", { name: "Revision 1" }).textContent).toContain("Revision requested");
    expect(within(r2).getByText("Submitted")).toBeInTheDocument();
    expect(r2.textContent).toContain(HANDOFF_DIGEST.slice(0, 12));
    expect(within(r2).getByRole("link", { name: /q3-report\.pdf/ })).toHaveAttribute("href", "/api/artifacts/a7000000-0000-4000-8000-000000000001/content");
    const claims = within(r2).getByRole("list", { name: "Claims of revision 2" });
    expect(within(claims).getByText("Supported by a source")).toBeInTheDocument();
    expect(within(claims).getByText("Not supported")).toBeInTheDocument();
    expect(r2.textContent).toContain("Missing deliverables: summary.xlsx");
    await userEvent.click(within(r2).getByRole("button", { name: "Request revision" }));
    await userEvent.type(within(r2).getByRole("textbox", { name: /What must change/ }), "Add the summary sheet");
    await userEvent.click(within(r2).getByRole("button", { name: "Send the request" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/request-revision"))).toBe(true));
    const call = api.calls.find((c) => c.path.endsWith("/request-revision"));
    expect(call?.body).toEqual({ handoffDigest: HANDOFF_DIGEST, criteria: "Add the summary sheet" });
    expect(call?.headers["if-match"]).toBe('"9"');
  });

  test("Accept asks first, naming the revision and its short digest, and sends the digest viewed against the version read", async () => {
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail())
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/accept`, () => ({ assignmentId: ASSIGNMENT_ID, state: "COMPLETED", version: 10, resourceVersion: 13, correlationId: "c" }));
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="handoffs" go={vi.fn()} account={authAccount()} />);
    const r2 = await screen.findByRole("article", { name: "Revision 2" });
    await userEvent.click(within(r2).getByRole("button", { name: "Accept…" }));
    const dialog = await screen.findByRole("dialog", { name: "Accept revision 2?" });
    expect(dialog.textContent).toContain(`You accept exactly revision 2 (digest ${HANDOFF_DIGEST.slice(0, 12)})`);
    expect(dialog.textContent).toContain("It is missing required deliverables: summary.xlsx.");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Good enough for now");
    await userEvent.click(within(dialog).getByRole("button", { name: "Accept revision 2" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/accept"))).toBe(true));
    const call = api.calls.find((c) => c.path.endsWith("/accept"));
    expect(call?.body).toEqual({ handoffDigest: HANDOFF_DIGEST, note: "Good enough for now" });
    expect(call?.headers["if-match"]).toBe('"9"');
  });

  test.each([
    ["412 stale_version", withStatus(412, { error: { code: "stale_version", message: "stale" } })],
    ["409 stale_handoff", withStatus(409, { error: { code: "stale_handoff", message: "A newer handoff was submitted." } })],
  ])("a review answered %s does nothing, says so, and offers the latest -- never a silent retry", async (_, reply) => {
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail())
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/accept`, () => reply);
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="handoffs" go={vi.fn()} account={authAccount()} />);
    const r2 = await screen.findByRole("article", { name: "Revision 2" });
    await userEvent.click(within(r2).getByRole("button", { name: "Accept…" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Accept revision 2" }));
    expect(await within(r2).findByText("This changed since the page read it: nothing was done.")).toBeInTheDocument();
    const reads = api.calls.filter((c) => c.path === `/api/missions/${MISSION_ID}`).length;
    await userEvent.click(within(r2).getByRole("button", { name: "Load the latest" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === `/api/missions/${MISSION_ID}`).length).toBeGreaterThan(reads));
    expect(api.calls.filter((c) => c.path.endsWith("/accept"))).toHaveLength(1);
  });

  test("the last run keeps requested, resolved and observed apart, says unknown as unknown, and says why it waits", async () => {
    const waiting = runView({ state: "waiting_for_resources", waitingReason: "It needs 2.5 vCPU; 1 vCPU is free now.", usage: { modelPlane: null, toolPlane: null } });
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ assignments: [assignmentView({ lastRun: waiting, state: "ASSIGNED" })] }));
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="run" go={vi.fn()} account={authAccount()} />);
    const run = await screen.findByRole("region", { name: "Last run" });
    const table = within(run).getByRole("table", { name: "Model and effort" });
    const model = within(table).getAllByRole("row").find((r) => r.textContent?.startsWith("Model")) as HTMLElement;
    expect(within(model).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Model", "opus", "opus", "claude-opus-5-5"]);
    const effort = within(table).getAllByRole("row").find((r) => r.textContent?.startsWith("Effort")) as HTMLElement;
    expect(within(effort).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Effort", "High", "High", "unknown"]);
    expect(run.textContent).toContain("It waits for resources: It needs 2.5 vCPU; 1 vCPU is free now.");
    const resources = within(run).getByRole("table", { name: "Resources" });
    const memory = within(resources).getAllByRole("row").find((r) => r.textContent?.startsWith("Memory")) as HTMLElement;
    expect(within(memory).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Memory", "2 GiB", "2 GiB", "not reported"]);
  });
});
