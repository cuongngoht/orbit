import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssignmentView, MissionDetail } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import {
  APPOINTMENT_ID,
  ASSIGNMENT_ID,
  DEPT_ACCOUNTING,
  EMP_ANA,
  EMP_BAO,
  HANDOFF_DIGEST,
  MISSION_ID,
  PART_ID,
  SHARE_ID,
  SOURCE_REVISION_ID,
  assignmentView,
  clarificationView,
  dataShareView,
  handoff,
  missionDetail,
  partView,
  roster,
  runView,
} from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const PART_DIGEST = "ef".repeat(32);
const PART_DIGEST_1 = "12".repeat(32);
const done = (assignmentId: string) => ({ assignmentId, state: "RUNNING", version: 10, resourceVersion: 13, correlationId: "c" });

// A mission given to Accounting, held by its manager Ana, who gave a part of it to Bao.
function teamMission(over: { root?: Partial<AssignmentView>; part?: Partial<AssignmentView>; mission?: Partial<MissionDetail> } = {}): MissionDetail {
  const target = { kind: "department" as const, departmentId: DEPT_ACCOUNTING, departmentName: "Accounting", appointmentId: APPOINTMENT_ID, appointmentRevision: 3 };
  const root = assignmentView({ title: "Q3 team report", state: "ANSWERING", target, planCount: 1, actions: ["pause", "cancel"], lastRun: runView({ wakeReason: "its team asked a question" }), ...over.root });
  const part = partView(over.part);
  return missionDetail({
    title: "Q3 team report",
    target,
    assignments: [root, part],
    responsibleNow: [
      { assignmentId: root.id, employeeId: EMP_ANA, name: "Ana", what: "answers its team's questions", why: "its team asked a question" },
      { assignmentId: part.id, employeeId: null, name: "You", what: "answer Bao", why: "Which contracts count as renewed?" },
    ],
    ...over.mission,
  });
}

function show(tab: string, go = vi.fn()) {
  renderLive(<OfficeView page="mission" item={MISSION_ID} tab={tab} go={go} account={authAccount()} />);
  return go;
}

const missionReads = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.path === `/api/missions/${MISSION_ID}`).length;

describe("a team's mission", () => {
  test("who it was given to, who has to act now and why, and the plan as a tree: who reviews each part, what it asked, and why each attempt started", async () => {
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () => teamMission({ part: { questionCount: 2, planCount: 0 } }));
    const go = show("overview");
    const wanted = await screen.findByRole("region", { name: "What is wanted" });
    expect(wanted.textContent).toContain("Given toThe manager of Accounting (appointment revision 3)");
    const now = within(screen.getByRole("region", { name: "Responsible now" })).getAllByRole("listitem");
    expect(now.map((r) => r.textContent)).toEqual(["Ana answers its team's questionsWhy: its team asked a question", "You answer BaoWhy: Which contracts count as renewed?"]);
    await userEvent.click(within(now[0] as HTMLElement).getByRole("button", { name: "Ana" }));
    expect(go).toHaveBeenCalledWith("employee", EMP_ANA);
    const plan = screen.getByRole("list", { name: "Assignments" });
    const rootRow = within(plan).getAllByRole("listitem")[0] as HTMLElement;
    expect(rootRow.textContent).toContain("Answering its team");
    expect(rootRow.textContent).toContain("Reviewed by you · 1 plan(s) given");
    expect(rootRow.textContent).toContain("Given to Accounting through its manager (appointment revision 3)");
    expect(rootRow.textContent).toContain("Attempt 1 started: its team asked a question");
    // The part, under its lead.
    const parts = within(plan).getByRole("list", { name: "Parts of “Q3 team report”" });
    const part = within(parts).getByRole("listitem");
    expect(part.textContent).toContain("Research the contracts");
    expect(part.textContent).toContain("Held by Bao (Legal when claimed)");
    expect(part.textContent).toContain("Reviewed by its lead Ana · 2 question(s) asked");
    expect(part.textContent).toContain("Part “research” of its manager's plan");
    expect(part.textContent).toContain("Attempt 1 started: a part its lead gave it came up");
    expect(part.textContent).not.toContain("Given to");
  });

  test("an employee named by the person is said as such, and nobody to act is said too", async () => {
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ responsibleNow: [] }));
    show("overview");
    expect((await screen.findByRole("region", { name: "What is wanted" })).textContent).toContain("Given toAn employee, by name");
    expect(screen.getByRole("region", { name: "Responsible now" }).textContent).toContain("Nobody has to act on it now.");
  });

  test("a question: who asked whom, where it went and why -- its words plain text, never markup -- and one moved up to the person is answered against the asker's version", async () => {
    const question = "Which contracts count as **renewed**? <b>Q3</b> only?\nOr the year?";
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () =>
        teamMission({
          part: { state: "BLOCKED", waitingOn: "information", actions: ["answer", "pause", "hand_over", "repin", "cancel"] },
          mission: {
            clarifications: [
              clarificationView({ question }),
              clarificationView({
                id: "c2000000-0000-4000-8000-000000000002",
                askerAssignmentId: ASSIGNMENT_ID,
                askerName: "Cam",
                question: "Which ledger?",
                addressee: "lead",
                addresseeAssignmentId: ASSIGNMENT_ID,
                addresseeName: "Ana",
                kind: "information",
                state: "answered",
                answer: "The 2026 ledger.",
                answeredBy: "Ana",
                answeredAt: "2026-11-21T08:35:00.000Z",
                route: [{ addressee: "lead", addresseeName: "Ana", why: "asked of its lead", at: "2026-11-21T08:31:00.000Z" }],
              }),
            ],
          },
        }),
      )
      .on("POST", `/api/assignments/${PART_ID}/answer`, () => done(PART_ID));
    show("overview");
    const questions = await screen.findByRole("region", { name: "Questions" });
    const asked = within(questions).getByRole("listitem", { name: "Question from Bao" });
    expect(asked.textContent).toContain("Bao → You");
    expect(within(asked).getByText("Open")).toBeInTheDocument();
    expect(asked.textContent).toContain("A person's decision");
    expect(within(asked).getByText(question, { normalizer: (s) => s })).toBeInTheDocument();
    expect(asked.querySelector("b, strong, em")).toBeNull();
    const route = within(asked).getAllByRole("listitem").map((r) => r.textContent ?? "");
    expect(route).toHaveLength(2);
    expect(route[0]).toMatch(/^To Ana: asked of its lead · /);
    expect(route[1]).toMatch(/^To you: the budget is the owner's to decide · /);
    // Answered by its lead: the answer, and who gave it; nothing for the person to do.
    const answered = within(questions).getByRole("listitem", { name: "Question from Cam" });
    expect(answered.textContent).toContain("Cam → Ana");
    expect(within(answered).getByText("Answered")).toBeInTheDocument();
    expect(answered.textContent).toContain("Answered by Ana on ");
    expect(answered.textContent).toContain("The 2026 ledger.");
    expect(within(answered).queryByRole("textbox")).toBeNull();
    // The one form for it: here, never a second one under the plan.
    expect(screen.getAllByRole("textbox", { name: /Your answer/ })).toHaveLength(1);
    await userEvent.type(within(asked).getByRole("textbox", { name: /Your answer/ }), "Only the ones signed this year");
    await userEvent.click(within(asked).getByRole("button", { name: "Send the answer" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/assignments/${PART_ID}/answer`)).toBe(true));
    const call = api.calls.find((c) => c.path === `/api/assignments/${PART_ID}/answer`);
    expect(call?.body).toEqual({ answer: "Only the ones signed this year" });
    expect(call?.headers["if-match"]).toBe('"4"');
  });

  test("what each lead shared with which part, revoked or not; Revoke asks first, takes it back and reads the mission again", async () => {
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () =>
        teamMission({
          mission: { dataShares: [dataShareView(), dataShareView({ id: "5a000000-0000-4000-8000-000000000002", kind: "source", sourceRevisionId: SOURCE_REVISION_ID, fromUnit: null, mode: "full", revokedBy: "Ann Owner", revokedAt: "2026-11-21T08:45:00.000Z" })] },
        }),
      )
      .on("POST", `/api/data-shares/${SHARE_ID}/revoke`, () => ({ id: SHARE_ID, revokedAt: "2026-11-21T09:00:00.000Z" }));
    show("overview");
    const shares = await screen.findByRole("region", { name: "Shared within the team" });
    const [holding, revoked] = within(shares).getAllByRole("listitem") as HTMLElement[];
    expect(holding?.textContent).toContain("Ana shared with Bao (part “research”)");
    expect(holding?.textContent).toContain("The hand-in of part “intake”: its summary");
    expect(within(holding as HTMLElement).getByText("Shared")).toBeInTheDocument();
    expect(revoked?.textContent).toContain(`Source revision ${SOURCE_REVISION_ID.slice(0, 8)}`);
    expect(within(revoked as HTMLElement).getByText("Revoked")).toBeInTheDocument();
    expect(revoked?.textContent).toContain("revoked ");
    expect(revoked?.textContent).toContain(" by Ann Owner");
    expect(within(revoked as HTMLElement).queryByRole("button", { name: "Revoke…" })).toBeNull();
    const reads = missionReads(api);
    await userEvent.click(within(holding as HTMLElement).getByRole("button", { name: "Revoke…" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke this share?" });
    expect(dialog.textContent).toContain("Bao (part “research”) can no longer read it");
    expect(api.calls.some((c) => c.path.endsWith("/revoke"))).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === `/api/data-shares/${SHARE_ID}/revoke`)).toBe(true));
    expect(api.calls.find((c) => c.path === `/api/data-shares/${SHARE_ID}/revoke`)?.body).toEqual({});
    await waitFor(() => expect(missionReads(api)).toBeGreaterThan(reads));
  });

  test("hand-ins grouped by who handed them in: the root's revision offers the review, a part's never -- its lead reviews it -- and each revision keeps its own feedback", async () => {
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () =>
      teamMission({
        root: { state: "AWAITING_ACCEPTANCE", actions: ["accept", "request_revision", "pause", "cancel"] },
        part: { state: "AWAITING_ACCEPTANCE", handoffRevision: 2, actions: ["pause", "cancel"] },
        mission: {
          handoffs: [
            handoff(),
            handoff({ id: "4a000000-0000-4000-8000-000000000011", assignmentId: PART_ID, revision: 1, digest: PART_DIGEST_1, status: "revision_requested", summary: "The research, first go.", submittedBy: "Bao", missing: [], review: { by: "Ana", at: "2026-11-21T08:25:00.000Z", note: "Add the renewal dates" } }),
            handoff({ id: "4a000000-0000-4000-8000-000000000012", assignmentId: PART_ID, revision: 2, digest: PART_DIGEST, summary: "The research.", submittedBy: "Bao", missing: [] }),
          ],
        },
      }),
    );
    show("handoffs");
    const rootGroup = await screen.findByRole("region", { name: "Hand-ins of “Q3 team report”" });
    expect(rootGroup.textContent).toContain("Ana · Reviewed by you");
    const r2 = within(rootGroup).getByRole("article", { name: "Revision 2" });
    expect(r2.textContent).toContain(HANDOFF_DIGEST.slice(0, 12));
    expect(within(r2).getByRole("button", { name: "Accept…" })).toBeInTheDocument();
    expect(within(r2).getByRole("button", { name: "Request revision" })).toBeInTheDocument();
    const partGroup = screen.getByRole("region", { name: "Hand-ins of “Research the contracts”" });
    expect(partGroup.textContent).toContain("Bao · Reviewed by its lead Ana");
    // Newest first.
    expect(within(partGroup).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Revision 2", "Revision 1"]);
    const p2 = within(partGroup).getByRole("article", { name: "Revision 2" });
    expect(within(p2).getByText("Submitted")).toBeInTheDocument();
    expect(p2.textContent).toContain(PART_DIGEST.slice(0, 12));
    expect(p2.textContent).toContain("Its lead Ana reviews it, not you.");
    expect(within(p2).queryByRole("button", { name: "Accept…" })).toBeNull();
    expect(within(p2).queryByRole("button", { name: "Request revision" })).toBeNull();
    const p1 = within(partGroup).getByRole("article", { name: "Revision 1" });
    expect(within(p1).getByText("Revision requested")).toBeInTheDocument();
    expect(p1.textContent).toContain(PART_DIGEST_1.slice(0, 12));
    expect(p1.textContent).toMatch(/Reviewed by Ana on .*: Add the renewal dates/);
    expect(r2.textContent).not.toContain("Add the renewal dates");
  });

  test("hand over: an employee chosen from the roster, sent against the version read; a refusal is said as the API said it", async () => {
    let n = 0;
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ assignments: [assignmentView({ state: "PAUSED", actions: ["resume", "hand_over", "repin", "cancel"] })] }))
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/hand-over`, () => (++n === 1 ? withStatus(409, { error: { code: "attempt_live", message: "An attempt of this work is running: pause it first, then hand it over." } }) : done(ASSIGNMENT_ID)));
    show("overview");
    const plan = await screen.findByRole("region", { name: "Plan" });
    await userEvent.click(within(plan).getByRole("button", { name: "Hand over…" }));
    const dialog = await screen.findByRole("dialog", { name: "Hand over “Q3 report”" });
    expect(dialog.textContent).toContain("Ana holds it now.");
    const who = await within(dialog).findByRole("combobox", { name: /^Hand it over to/ });
    // Never the one who holds it now.
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an employee", "Bao — Legal analyst (Working)"]);
    expect(within(dialog).getByRole("button", { name: "Hand over" })).toBeDisabled();
    await userEvent.selectOptions(who, EMP_BAO);
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Reason/ }), "Ana moved to Legal");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hand over" }));
    expect(await within(dialog).findByText("An attempt of this work is running: pause it first, then hand it over.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Hand over" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const calls = api.calls.filter((c) => c.path === `/api/assignments/${ASSIGNMENT_ID}/hand-over`);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual({ employeeId: EMP_BAO, reason: "Ana moved to Legal" });
    expect(calls[1]?.headers["if-match"]).toBe('"9"');
  });

  test("repin asks first, then continues the work on its employee's profile in effect now, against the version read", async () => {
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ assignments: [assignmentView({ state: "BLOCKED", actions: ["retry", "pause", "hand_over", "repin", "cancel"] })] }))
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/repin`, () => done(ASSIGNMENT_ID));
    show("overview");
    const plan = await screen.findByRole("region", { name: "Plan" });
    await userEvent.click(within(plan).getByRole("button", { name: "Repin…" }));
    const dialog = await screen.findByRole("dialog", { name: "Repin “Q3 report”?" });
    expect(dialog.textContent).toContain("Its next attempt runs on Ana's profile as it is now");
    expect(api.calls.some((c) => c.path.endsWith("/repin"))).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Repin" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/assignments/${ASSIGNMENT_ID}/repin`)).toBe(true));
    const call = api.calls.find((c) => c.path === `/api/assignments/${ASSIGNMENT_ID}/repin`);
    expect(call?.body).toEqual({});
    expect(call?.headers["if-match"]).toBe('"9"');
  });

  test("a part's own commands are in its row's menu, and its handover names the part's version", async () => {
    const api = fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => teamMission({ part: { state: "PAUSED", actions: ["resume", "hand_over", "repin", "cancel"] } }))
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", `/api/assignments/${PART_ID}/hand-over`, () => done(PART_ID));
    show("overview");
    await userEvent.click(await screen.findByRole("button", { name: "Actions for “Research the contracts”" }));
    expect((await screen.findAllByRole("menuitem")).map((m) => m.textContent)).toEqual(["Resume", "Cancel the work", "Hand over…", "Repin…"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Hand over…" }));
    const dialog = await screen.findByRole("dialog", { name: "Hand over “Research the contracts”" });
    const who = await within(dialog).findByRole("combobox", { name: /^Hand it over to/ });
    expect(within(who).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an employee", "Ana — Accountant (Ready)"]);
    await userEvent.selectOptions(who, EMP_ANA);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hand over" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/assignments/${PART_ID}/hand-over`)).toBe(true));
    const call = api.calls.find((c) => c.path === `/api/assignments/${PART_ID}/hand-over`);
    expect(call?.body).toEqual({ employeeId: EMP_ANA });
    expect(call?.headers["if-match"]).toBe('"4"');
  });

  test("the last run says why its attempt started", async () => {
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ assignments: [assignmentView({ lastRun: runView({ attemptNo: 3, wakeReason: "the person who gave the work asked for a revision" }) })] }));
    show("run");
    const run = await screen.findByRole("region", { name: "Last run" });
    expect(within(run).getByText("Why it started: the person who gave the work asked for a revision")).toBeInTheDocument();
  });

  test("a blocked nested lead shows its run detail and can be inspected on the Last run tab with tool calls and exit status", async () => {
    const failedRun = runView({
      attemptNo: 3,
      state: "failed",
      wakeReason: "retried by a person",
      detail: "It ran past its limit of 60 minutes and was stopped.",
      observed: { model: "claude-sonnet", effort: "unknown", plugins: [], runtimeVersion: "2.1.330", nativeSession: null, toolCalls: 7, exit: { code: 1, signal: null } },
    });
    const data = () =>
      teamMission({
        root: { state: "WAITING_FOR_SUBORDINATES", lastRun: runView({ attemptNo: 1, state: "succeeded", detail: "Ended by design: it gave its work to its team." }) },
        part: {
          employeeName: "Khoa",
          title: "Soạn AI Security Policy hoàn chỉnh",
          state: "BLOCKED",
          reason: "The lead ended its review without deciding on ngoc-data-supply.",
          waitingOn: "owner",
          lastRun: failedRun,
        },
      });
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, data);
    const go = show("overview");
    const parts = await screen.findByRole("list", { name: "Parts of “Q3 team report”" });
    expect(parts.textContent).toContain("Last attempt detail: It ran past its limit of 60 minutes and was stopped.");
    await userEvent.click(within(parts).getByRole("button", { name: "Inspect last run" }));
    expect(go).toHaveBeenCalledWith("mission", MISSION_ID, "run");

    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="run" go={go} account={authAccount()} />);
    const runTab = await screen.findByRole("region", { name: "Last run" });
    const selector = within(runTab).getByRole("combobox", { name: "Choose whose last run to inspect" });
    await userEvent.selectOptions(selector, PART_ID);
    expect(within(runTab).getByText("It ran past its limit of 60 minutes and was stopped.")).toBeInTheDocument();
    expect(runTab.textContent).toContain("tool calls 7");
    expect(runTab.textContent).toContain("exit 1");
  });
});

// The thread's own messages (a message's files are a list of their own inside it).
const mailsOf = (list: HTMLElement): HTMLElement[] => within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);

describe("how the mission's people talk", () => {
  const bao = { kind: "employee" as const, name: "Bao", employeeId: EMP_BAO, departmentName: "Accounting" };
  const ana = { kind: "employee" as const, name: "Ana", employeeId: EMP_ANA, departmentName: "Accounting" };
  const thread = {
    missionId: MISSION_ID,
    messages: [
      { id: "given:p", at: "2026-11-24T13:18:44.000Z", kind: "given", from: ana, to: bao, assignmentId: PART_ID, subject: "Renewals", body: "Count the renewed contracts.\n\nDeliverables:\n- renewals.csv", attachments: [] },
      { id: "asked:q", at: "2026-11-24T13:19:00.000Z", kind: "asked", from: bao, to: ana, assignmentId: PART_ID, subject: "Question", body: "Which contracts count as renewed?", attachments: [] },
      { id: "handed_in:h", at: "2026-11-24T13:30:40.000Z", kind: "handed_in", from: bao, to: ana, assignmentId: PART_ID, subject: "Hand-in, revision 1", body: "Kế hoạch, bản 1.", attachments: [{ artifactId: "f-md", name: "ke-hoach.md", mediaType: "text/markdown", size: 120 }, { artifactId: "f-zip", name: "data.zip", mediaType: "application/zip", size: 4096 }] },
      { id: "revision:h", at: "2026-11-24T13:31:17.000Z", kind: "revision", from: ana, to: bao, assignmentId: PART_ID, subject: "Revision 1 sent back", body: "Thêm phần ngân sách.", attachments: [] },
      { id: "notice:9", at: "2026-11-24T13:40:00.000Z", kind: "notice", from: { kind: "orbit" as const, name: "Orbit", employeeId: null, departmentName: null }, to: null, assignmentId: ASSIGNMENT_ID, subject: "Cancelled: no longer needed", body: "", attachments: [] },
    ],
  };

  test("the pipeline says who holds what and where it stands; the thread shows each exchange from someone to someone, in its own words", async () => {
    fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => teamMission({ part: { state: "AWAITING_ACCEPTANCE" } }))
      .on("GET", `/api/missions/${MISSION_ID}/messages`, () => thread);
    show("communication");
    const pipeline = await screen.findByRole("group", { name: "Who holds what, and where it stands" });
    expect(within(pipeline).getByText("Holds the mission")).toBeInTheDocument();
    expect(within(pipeline).getByText("Handed in")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "What was said in this mission" });
    const mails = mailsOf(list);
    expect(mails.map((m) => m.getAttribute("aria-label"))).toEqual(["Work given: Renewals", "Question: Question", "Hand-in: Hand-in, revision 1", "Sent back: Revision 1 sent back", "Notice: Cancelled: no longer needed"]);
    expect(within(mails[0] as HTMLElement).getByText("Ana (Accounting)")).toBeInTheDocument();
    expect(within(mails[0] as HTMLElement).getByText("Count the renewed contracts.")).toBeInTheDocument();
    expect(within(mails[3] as HTMLElement).getByText("Thêm phần ngân sách.")).toBeInTheDocument();
    // A file the browser shows is opened, not downloaded; another is downloaded.
    const md = within(mails[2] as HTMLElement).getByRole("link", { name: /ke-hoach\.md/ });
    expect(md).toHaveAttribute("href", "/api/artifacts/f-md/content");
    expect(md).not.toHaveAttribute("download");
    expect(within(mails[2] as HTMLElement).getByRole("link", { name: /data\.zip/ })).toHaveAttribute("download", "data.zip");
  });

  test("choosing a part in the pipeline narrows the thread to it, and everything comes back", async () => {
    fakeApi()
      .on("GET", `/api/missions/${MISSION_ID}`, () => teamMission())
      .on("GET", `/api/missions/${MISSION_ID}/messages`, () => thread);
    show("communication");
    const pipeline = await screen.findByRole("group", { name: "Who holds what, and where it stands" });
    await userEvent.click(within(pipeline).getAllByRole("button")[1] as HTMLElement);
    expect(await screen.findByText("Only what concerns Bao.")).toBeInTheDocument();
    expect(mailsOf(screen.getByRole("list", { name: "What was said in this mission" }))).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "Show everything" }));
    await waitFor(() => expect(mailsOf(screen.getByRole("list", { name: "What was said in this mission" }))).toHaveLength(5));
  });

  test("dependency-ordered plan, criteria checklist, humanized actors, claims explanation, and timeline grouping", async () => {
    const PART_DOC = "a2000000-0000-4000-8000-000000000010";
    const PART_FX = "a2000000-0000-4000-8000-000000000011";
    const root = assignmentView({ title: "Coffee forecast", state: "REVIEWING", planCount: 1 });
    const doc = partView({ id: PART_DOC, unitKey: "document", title: "Compile report", state: "QUEUED", brief: { ...partView().brief, dependsOn: ["fx"] } });
    const fx = partView({ id: PART_FX, unitKey: "fx", title: "Verify USD/BRL", state: "AWAITING_ACCEPTANCE", employeeId: EMP_BAO, employeeName: "Bao" });
    fakeApi().on("GET", `/api/missions/${MISSION_ID}`, () =>
      missionDetail({
        title: "Coffee forecast",
        createdBy: "owner:71cfde0b-0295-4414-aaaf-d1d76a2aaa00",
        acceptanceCriteria: ["Include chart", "Cite ICE US"],
        assignments: [root, doc, fx],
        handoffs: [
          handoff({
            assignmentId: PART_FX,
            submittedBy: `agent:employee:${EMP_BAO}`,
            claims: [{ text: "USD/BRL fell 1.9%", supported: false, sources: [] }],
            missing: [],
          }),
        ],
        timeline: [
          { seq: 1, at: "2026-11-25T08:59:00.000Z", type: "mission.created", actor: "owner:71cfde0b-0295-4414-aaaf-d1d76a2aaa00", summary: "Mission created.", assignmentId: ASSIGNMENT_ID },
          { seq: 2, at: "2026-11-25T08:59:01.000Z", type: "assignment.queued", actor: "system:scheduler", summary: "Queued: the employee was busy.", assignmentId: PART_FX },
          { seq: 3, at: "2026-11-25T08:59:02.000Z", type: "assignment.queued", actor: "system:scheduler", summary: "Queued: the employee was busy.", assignmentId: PART_FX },
        ],
      }),
    );
    const go = show("overview");
    const wanted = await screen.findByRole("region", { name: "What is wanted" });
    expect(within(wanted).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Include chart", "Cite ICE US"]);
    expect(wanted.textContent).toContain("Account owner");
    const partsList = within(screen.getByRole("list", { name: "Assignments" })).getByRole("list", { name: "Parts of “Coffee forecast”" });
    const partItems = within(partsList).getAllByRole("listitem");
    expect(partItems[0]?.textContent).toContain("Verify USD/BRL");
    expect(partItems[1]?.textContent).toContain("Compile report");

    await userEvent.click(screen.getByRole("tab", { name: /Handoffs/ }));
    expect(go).toHaveBeenCalledWith("mission", MISSION_ID, "handoffs");
    go.mockClear();

    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="handoffs" go={go} account={authAccount()} />);
    const r2 = await screen.findByRole("article", { name: "Revision 2" });
    expect(r2.textContent).toContain("handed in");
    expect(r2.textContent).toContain("by Bao");
    expect(r2.textContent).toContain("Claims (1) · 0 verified · 1 unverified");

    renderLive(<OfficeView page="mission" item={MISSION_ID} tab="timeline" go={go} account={authAccount()} />);
    const timeline = await screen.findByRole("region", { name: "Timeline" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    expect(timeline.textContent).toContain("×2");
    expect(timeline.textContent).toContain("Account owner");
    expect(timeline.textContent).toContain("Scheduler");
    await userEvent.click(within(timeline).getByRole("button", { name: "All events" }));
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(3);
  });
});
