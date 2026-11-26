import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { CSRF, authAccount, authSession } from "../../testing/fixtures";
import { ASSIGNMENT_ID, EMP_ANA, EMP_BAO, HANDOFF_DIGEST, MISSION_ID, SOURCE_REVISION_ID, assignmentView, busyBao, connectionsView, handoff, missionDetail, missionList, missionSummary, roster, runView } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { REVISION_A, SOURCE_B, WORKSPACE_ID, source, workspaceSummary } from "../../testing/researchFixtures";
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
    expect(posts[0]?.body).toMatchObject({ goal: "Review the NDA", target: { kind: "employee", employeeId: EMP_BAO }, whenBusy: "reject", deliverables: [{ name: "nda-review.md", required: true }] });
    expect(posts[1]?.body).toMatchObject({ goal: "Review the NDA", target: { kind: "employee", employeeId: EMP_BAO }, whenBusy: "enqueue" });
    // An employee named by the person: no legacy field beside it, and nobody "expected" to check against.
    expect(posts[0]?.body).not.toHaveProperty("targetEmployeeId");
    expect(posts[0]?.body).not.toHaveProperty("expectedAssignee");
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

describe("a mission with research sources", () => {
  test("a workspace's sources are pinned at the revision they are at; one not read yet cannot be; the request names them", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/research/workspaces", () => [workspaceSummary()])
      .on("GET", `/api/research/workspaces/${WORKSPACE_ID}/sources`, () => [source(), source({ id: SOURCE_B, title: "Draft memo", state: "queued", revision: null })])
      .on("POST", "/api/missions", () => withStatus(201, accepted("ASSIGNED")));
    renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Assign work to Ana" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign work" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Summarise the policy");
    const group = within(dialog).getByRole("group", { name: "Research sources" });
    await userEvent.selectOptions(await within(group).findByRole("combobox", { name: "Research workspace" }), WORKSPACE_ID);
    const pinned = await within(group).findByRole("checkbox", { name: "NIST policy — revision 1" });
    expect(within(group).getByRole("checkbox", { name: "Draft memo — not read yet" })).toBeDisabled();
    await userEvent.click(pinned);
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/missions");
    expect(post?.body).toMatchObject({ goal: "Summarise the policy", workspaceId: WORKSPACE_ID, sourceRevisionIds: [REVISION_A] });
  });

  test("with no source chosen, the request names none", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", "/api/research/workspaces", () => [workspaceSummary()])
      .on("POST", "/api/missions", () => withStatus(201, accepted("ASSIGNED")));
    renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Assign work to Ana" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign work" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Close the books");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    const body = api.calls.find((c) => c.method === "POST" && c.path === "/api/missions")?.body as Record<string, unknown>;
    expect(body.workspaceId).toBeUndefined();
    expect(body.sourceRevisionIds).toBeUndefined();
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
    await userEvent.click(within(r2).getByRole("button", { name: "Technical details" }));
    expect(r2.textContent).toContain(HANDOFF_DIGEST.slice(0, 12));
    expect(within(r2).getByRole("link", { name: /q3-report\.pdf/ })).toHaveAttribute("href", "/api/artifacts/a7000000-0000-4000-8000-000000000001/content");
    const claims = within(r2).getByRole("list", { name: "Claims of revision 2" });
    expect(within(claims).getByText("Verified by pinned source")).toBeInTheDocument();
    expect(within(claims).getByText("No pinned source match")).toBeInTheDocument();
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

  test("a team's mission: each part says its key and what it waits for, and the team room says who changed what", async () => {
    const PART_A = "a2000000-0000-4000-8000-000000000001";
    const PART_B = "a2000000-0000-4000-8000-000000000002";
    const root = assignmentView({ title: "Q3 team report", state: "REVIEWING" });
    const research = assignmentView({ id: PART_A, title: "Research", parentId: ASSIGNMENT_ID, unitKey: "research", employeeId: EMP_BAO, employeeName: "Bao", state: "COMPLETED" });
    const summary = assignmentView({ id: PART_B, title: "Summary", parentId: ASSIGNMENT_ID, unitKey: "summary", state: "QUEUED", brief: { ...research.brief, dependsOn: ["research"] } });
    fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ assignments: [root, research, summary], sourceRevisionIds: [] }))
      .on("GET", `/api/missions/${MISSION_ID}/team-room`, () => [
        { path: "brief.md", sha256: "b".repeat(64), size: 24, employeeId: EMP_ANA, employeeName: "Ana", assignmentId: ASSIGNMENT_ID, at: "2026-11-21T09:00:00.000Z" },
        { path: "data.csv", sha256: "c".repeat(64), size: 2048, employeeId: EMP_BAO, employeeName: "Bao", assignmentId: PART_A, at: "2026-11-21T09:05:00.000Z" },
        { path: "old.txt", sha256: null, size: null, employeeId: EMP_BAO, employeeName: "Bao", assignmentId: PART_A, at: "2026-11-21T09:06:00.000Z" },
      ]);
    const go = vi.fn();
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="overview" go={go} account={authAccount()} />);
    const plan = await screen.findByRole("tree", { name: "Assignments" });
    expect(plan.textContent).toContain("Waits for: Research");
    await userEvent.click(within(plan).getByRole("button", { name: "Technical details for “Research”" }));
    await userEvent.click(within(plan).getByRole("button", { name: "Technical details for “Summary”" }));
    expect(plan.textContent).toContain("Part “research” of its manager's plan");
    expect(plan.textContent).toContain("Part “summary” of its manager's plan · waits for “research”");
    const wanted = screen.getByRole("region", { name: "What is wanted" });
    await userEvent.click(within(wanted).getByRole("button", { name: "Advanced details" }));
    expect(wanted.textContent).toContain("Research sourcesNone pinned");
    await userEvent.click(screen.getByRole("button", { name: "Advanced mission views" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Team room/ }));
    expect(go).toHaveBeenCalledWith("mission", MISSION_ID, "team");
  });

  test("the team room tab lists each change in order, a removal as removed, and names whose attempt made it", async () => {
    fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail())
      .on("GET", `/api/missions/${MISSION_ID}/team-room`, () => [
        { path: "brief.md", sha256: "b".repeat(64), size: 24, employeeId: EMP_ANA, employeeName: "Ana", assignmentId: ASSIGNMENT_ID, at: "2026-11-21T09:00:00.000Z" },
        { path: "data.csv", sha256: "c".repeat(64), size: 2048, employeeId: EMP_BAO, employeeName: "Bao", assignmentId: ASSIGNMENT_ID, at: "2026-11-21T09:05:00.000Z" },
        { path: "old.txt", sha256: null, size: null, employeeId: EMP_BAO, employeeName: "Bao", assignmentId: ASSIGNMENT_ID, at: "2026-11-21T09:06:00.000Z" },
      ]);
    const go = vi.fn();
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="team" go={go} account={authAccount()} />);
    const changes = await screen.findByRole("list", { name: "Team room changes" });
    const items = within(changes).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toMatch(/^brief\.md/);
    expect(items[1]?.textContent).toMatch(/^data\.csv/);
    expect(items[2]?.textContent).toMatch(/^old\.txt/);
    expect(items[0]?.textContent).toContain("24 bytes");
    expect(items[1]?.textContent).toContain("2 KiB");
    expect(items[2]?.textContent).toContain("removed");
    await userEvent.click(within(items[1] as HTMLElement).getByRole("button", { name: "Bao" }));
    expect(go).toHaveBeenCalledWith("employee", EMP_BAO);
  });

  test("a mission with nothing in a team room says so", async () => {
    fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail())
      .on("GET", `/api/missions/${MISSION_ID}/team-room`, () => []);
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="team" go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText(/Nothing was written in a team room for this mission\./)).toBeInTheDocument();
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

describe("a mission with repositories", () => {
  const AZURE_REPO = { id: "contoso/3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b", fullName: "contoso/Platform/api", owner: "contoso", project: "Platform", name: "api" };

  test("only a repository the employee may use is offered; the request names the ones checked", async () => {
    const api = fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => ({ employeeId: EMP_ANA, connectors: [{ connector: "github", enabled: false, repositories: null, write: false, grantedAt: null }, { connector: "azure", enabled: true, repositories: [AZURE_REPO], write: false, grantedAt: "2026-11-22T00:00:00.000Z" }], knowledge: [] }))
      .on("POST", "/api/missions", () => withStatus(201, accepted("ASSIGNED")));
    renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Assign work to Ana" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign work" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Goal/ }), "Fix the export");
    const group = within(dialog).getByRole("group", { name: "Repositories" });
    await userEvent.click(await within(group).findByRole("checkbox", { name: "contoso/Platform/api (Azure DevOps)" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("dialog", { name: "Started" })).toBeInTheDocument();
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/api/missions");
    expect(post?.body).toMatchObject({ goal: "Fix the export", repositories: [{ source: "azure", id: AZURE_REPO.id, branch: null }] });
  });

  test("an employee that may use no repository says where to let it", async () => {
    fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => ({ employeeId: EMP_ANA, connectors: [{ connector: "github", enabled: false, repositories: null, write: false, grantedAt: null }, { connector: "azure", enabled: false, repositories: null, write: false, grantedAt: null }], knowledge: [] }));
    renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Assign work to Ana" }));
    const group = within(await screen.findByRole("dialog", { name: "Assign work" })).getByRole("group", { name: "Repositories" });
    expect(await within(group).findByRole("link", { name: /Access/ })).toHaveAttribute("href", `#/office/employee/${EMP_ANA}/access`);
  });
});

describe("queued mission blocker visibility and access boundaries (Issue #5)", () => {
  const BLOCKING_MISSION_ID = "a1000000-0000-4000-8000-000000000051";
  const BLOCKING_ASSIGNMENT_ID = "b1000000-0000-4000-8000-000000000051";
  const QUEUED_MISSION_ID = "a1000000-0000-4000-8000-000000000052";

  test("queued mission shows the blocking assignment and links directly to its clarification action (not an unrelated review)", async () => {
    const queued = missionSummary({
      id: QUEUED_MISSION_ID,
      title: "Follow-up audit",
      assignment: { ...missionSummary().assignment, state: "QUEUED", employeeId: EMP_ANA, employeeName: "Ana" },
      nextAction: "Waits for Ana — blocked on your clarification for “Collect vendor quotes”.",
      queuedBehind: {
        accessible: true,
        assignmentId: BLOCKING_ASSIGNMENT_ID,
        missionId: BLOCKING_MISSION_ID,
        title: "Collect vendor quotes",
        state: "BLOCKED",
        waitingOn: "information",
        ownerAction: {
          decisionId: "1b000000-0000-4000-8000-000000000051",
          kind: "information",
          title: "Question about vendor currency",
          missionId: BLOCKING_MISSION_ID,
          assignmentId: BLOCKING_ASSIGNMENT_ID,
          tab: "overview",
        },
      },
    });
    fakeApi().on("GET", "/api/missions", () => missionList([queued]));
    const go = vi.fn();
    renderLive(<OfficeView page="work" item={null} tab={null} go={go} account={authAccount()} />);
    expect(await screen.findByText(/Slot held by “Collect vendor quotes” \(Blocked\) — waiting for your clarification/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Answer clarification" }));
    expect(go).toHaveBeenCalledWith("mission", BLOCKING_MISSION_ID, "overview");
  });

  test("queued mission with a restricted blocking assignment reveals no title, state, or action link", async () => {
    const restrictedDetail = missionDetail({
      id: QUEUED_MISSION_ID,
      title: "Follow-up audit",
      assignment: { ...missionDetail().assignment, state: "QUEUED", employeeId: EMP_ANA, employeeName: "Ana" },
      assignments: [assignmentView({ state: "QUEUED", employeeId: EMP_ANA, employeeName: "Ana", actions: ["hand_over", "cancel"] })],
      queuedBehind: {
        accessible: false,
        assignmentId: null,
        missionId: null,
        title: null,
        state: null,
        waitingOn: null,
        ownerAction: null,
      },
    });
    fakeApi().on("GET", `/api/missions/${QUEUED_MISSION_ID}`, () => restrictedDetail);
    renderLive(<OfficeView page="mission" item={QUEUED_MISSION_ID} tab="overview" go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText("Ana is currently holding another assignment you do not have access to view.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer clarification" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open blocking mission" })).toBeNull();
  });
});

describe("pinned research source verification vs brief context (Issue #6)", () => {
  test("no pinned sources: displays No pinned research sources next to the claims summary and separates brief context from external claims without awarding verification badges", async () => {
    const noSourceDetail = missionDetail({
      sourceRevisionIds: [],
      handoffs: [
        handoff({
          claims: [
            {
              text: "Pilot launch target is 15 December 2026 with 12 beta customers.",
              sources: [],
              supported: false,
              basis: "brief",
              briefExcerpt: "Pilot launch target is 15 December 2026 with 12 beta customers",
            },
            {
              text: "Competitor pricing rose 18% last quarter.",
              sources: [],
              supported: false,
              basis: "external",
            },
          ],
        }),
      ],
    });
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () => noSourceDetail);
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="handoffs" go={vi.fn()} account={authAccount()} />);
    const r2 = await screen.findByRole("article", { name: "Revision 2" });
    expect(within(r2).getByText(/Pinned research source check \(2\) · 0 verified · 1 from mission brief · 1 without pinned source/)).toBeInTheDocument();
    expect(within(r2).getByText("No pinned research sources")).toBeInTheDocument();
    expect(within(r2).getByText(/No research sources are pinned to this mission/)).toBeInTheDocument();

    const claims = within(r2).getByRole("list", { name: "Claims of revision 2" });
    expect(within(claims).getByText("From mission brief (not source-verified)")).toBeInTheDocument();
    expect(within(claims).getByText(/Mission brief: “Pilot launch target is 15 December 2026 with 12 beta customers”/)).toBeInTheDocument();
    expect(within(claims).getByText("No pinned source match")).toBeInTheDocument();
    expect(within(claims).queryByText("Verified by pinned source")).toBeNull();
  });

  test("with pinned sources: verifies pinned claims separately from brief context and external claims", async () => {
    const withSourceDetail = missionDetail({
      sourceRevisionIds: [SOURCE_REVISION_ID],
      handoffs: [
        handoff({
          claims: [
            {
              text: "Revenue was 2,000,000 VND.",
              sources: [{ label: "S1", sourceId: "s", revisionId: SOURCE_REVISION_ID, locator: "page 3", excerpt: "Total: 2,000,000" }],
              supported: true,
              basis: "pinned_source",
            },
            {
              text: "Scope covers Q3 subsidiaries only.",
              sources: [],
              supported: false,
              basis: "brief",
              briefExcerpt: "Scope covers Q3 subsidiaries only",
            },
            {
              text: "Industry benchmark margin is 22%.",
              sources: [],
              supported: false,
              basis: "external",
            },
          ],
        }),
      ],
    });
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () => withSourceDetail);
    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="handoffs" go={vi.fn()} account={authAccount()} />);
    const r2 = await screen.findByRole("article", { name: "Revision 2" });
    expect(within(r2).getByText("1 pinned research source(s)")).toBeInTheDocument();
    expect(within(r2).getByText(/Pinned research source check \(3\) · 1 verified · 1 from mission brief · 1 without pinned source/)).toBeInTheDocument();
    const claims = within(r2).getByRole("list", { name: "Claims of revision 2" });
    expect(within(claims).getByText("Verified by pinned source")).toBeInTheDocument();
    expect(within(claims).getByText("From mission brief (not source-verified)")).toBeInTheDocument();
    expect(within(claims).getByText("No pinned source match")).toBeInTheDocument();
  });
});
