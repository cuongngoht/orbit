import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import { ASSIGNMENT_ID, EMP_ANA, MISSION_ID, PART_ID, SCHEDULE_ID, assignmentView, clarificationView, inbox, inboxItem, missionDetail, occurrence, partView, roster, scheduleView } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const done = { assignmentId: ASSIGNMENT_ID, state: "CANCELLED", version: 10, resourceVersion: 13, correlationId: "c" };

describe("Needs me", () => {
  test("work that can never start as configured: the numbers, the ways out -- the employee's resources, the operator's authorization, cancelling it", async () => {
    const api = fakeApi()
      .on("GET", "/api/inbox", () => inbox([inboxItem()]))
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail())
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/cancel`, () => done);
    const go = vi.fn();
    renderLive(<OfficeView page="inbox" item={null} tab={null} go={go} account={authAccount()} />);
    const item = await screen.findByRole("listitem", { name: "Q3 report cannot start" });
    expect(within(item).getByText("Work that can never start as configured")).toBeInTheDocument();
    expect(item.textContent).toContain("It needs 8 GiB of memory; the account's budget is 6 GiB.");
    expect(item.textContent).toContain("node dist/cli/governance.js budget set");
    expect(screen.getByRole("tab", { name: "Open (1)" })).toBeInTheDocument();
    await userEvent.click(within(item).getByRole("button", { name: "Edit the employee's resources" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("employee", EMP_ANA, "resources"));
    await userEvent.click(within(item).getByRole("button", { name: "Cancel the work" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/cancel"))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith("/cancel"))?.headers["if-match"]).toBe('"9"');
  });

  test("blocked work is retried against the version it was shown with; a result to review opens its handoffs; a question is answered", async () => {
    const api = fakeApi()
      .on("GET", "/api/inbox", () =>
        inbox([
          inboxItem({ id: "1b000000-0000-4000-8000-000000000002", kind: "blocked", title: "Q3 report is blocked", reason: "Out of memory — raise the limit or retry." }),
          inboxItem({ id: "1b000000-0000-4000-8000-000000000003", kind: "acceptance", title: "Review the Q3 report", reason: "Revision 2 waits for you." }),
          inboxItem({ id: "1b000000-0000-4000-8000-000000000004", kind: "information", title: "Which ledger?", reason: "Ana asks which ledger to use." }),
        ]),
      )
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/retry`, () => done)
      .on("POST", `/api/assignments/${ASSIGNMENT_ID}/answer`, () => done);
    const go = vi.fn();
    renderLive(<OfficeView page="inbox" item={null} tab={null} go={go} account={authAccount()} />);
    const blocked = await screen.findByRole("listitem", { name: "Q3 report is blocked" });
    expect(within(blocked).getByText("Work that is blocked")).toBeInTheDocument();
    await userEvent.click(within(blocked).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/retry"))?.headers["if-match"]).toBe('"9"'));
    await userEvent.click(within(screen.getByRole("listitem", { name: "Review the Q3 report" })).getByRole("button", { name: "Review the result" }));
    expect(go).toHaveBeenCalledWith("mission", MISSION_ID, "handoffs");
    const question = screen.getByRole("listitem", { name: "Which ledger?" });
    await userEvent.type(within(question).getByRole("textbox", { name: /Your answer/ }), "The 2026 ledger");
    await userEvent.click(within(question).getByRole("button", { name: "Send the answer" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/answer"))?.body).toEqual({ answer: "The 2026 ledger" }));
  });

  test("a question moved up from a team says who asked it and that its lead moved it up; the answer goes to the asker against the version shown, and asked_of_lead is said as the server said it", async () => {
    let n = 0;
    const item = inboxItem({
      id: "1b000000-0000-4000-8000-000000000005",
      kind: "information",
      assignmentId: PART_ID,
      title: "A question from the team",
      reason: "Which contracts count as renewed?\n\n(human decision: the budget is the owner's to decide)",
      waiting: `assignment:${ASSIGNMENT_ID}`,
      pin: { assignmentVersion: 4, handoffDigest: null, deliveryId: null },
    });
    const api = fakeApi()
      .on("GET", "/api/inbox", () => inbox([item]))
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail({ assignments: [assignmentView({ state: "ANSWERING" }), partView({ state: "BLOCKED", actions: ["answer", "pause", "cancel"] })], clarifications: [clarificationView()] }))
      .on("POST", `/api/assignments/${PART_ID}/answer`, () =>
        ++n === 1 ? withStatus(409, { error: { code: "asked_of_lead", message: "This question was asked of its lead, who answers it (or moves it up to you)." } }) : done,
      );
    renderLive(<OfficeView page="inbox" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    const question = await screen.findByRole("listitem", { name: "A question from the team" });
    expect(await within(question).findByText("Asked by Bao · moved up to you by Ana, its lead")).toBeInTheDocument();
    // The server's words, as plain text: the question, then why it came up.
    expect(within(question).getByText("Which contracts count as renewed? (human decision: the budget is the owner's to decide)")).toBeInTheDocument();
    // Who waits is said by name, never as a reference.
    expect(question.textContent).toContain("Waiting: Ana");
    expect(question.textContent).not.toContain("assignment:");
    await userEvent.type(within(question).getByRole("textbox", { name: /Your answer/ }), "Only the ones signed this year");
    await userEvent.click(within(question).getByRole("button", { name: "Send the answer" }));
    expect(await within(question).findByText("This question was asked of its lead, who answers it (or moves it up to you).")).toBeInTheDocument();
    await userEvent.click(within(question).getByRole("button", { name: "Send the answer" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === `/api/assignments/${PART_ID}/answer`)).toHaveLength(2));
    const call = api.calls.find((c) => c.path === `/api/assignments/${PART_ID}/answer`);
    expect(call?.body).toEqual({ answer: "Only the ones signed this year" });
    expect(call?.headers["if-match"]).toBe('"4"');
  });

  test("the history is read on its own tab", async () => {
    const api = fakeApi().on("GET", "/api/inbox", (_, url) => (url.searchParams.get("state") === "history" ? inbox([inboxItem({ state: "resolved", resolvedAt: "2026-11-21T09:00:00.000Z", resolution: "Cancelled by Ann Owner" })]) : inbox([])));
    renderLive(<OfficeView page="inbox" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText("Nothing needs you now.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText(/Resolved .*: Cancelled by Ann Owner/)).toBeInTheDocument();
    expect(api.calls.map((c) => c.path)).toContain("/api/inbox?state=history");
  });

  test("counts reviews and clarification requests separately and filters each category", async () => {
    const reviewItem = inboxItem({
      id: "1b000000-0000-4000-8000-000000000010",
      kind: "acceptance",
      missionId: "a1000000-0000-4000-8000-000000000099",
      assignmentId: "b1000000-0000-4000-8000-000000000099",
      title: "Review unrelated quarterly report",
      reason: "Revision 1 awaits your review.",
    });
    const clarificationItem = inboxItem({
      id: "1b000000-0000-4000-8000-000000000011",
      kind: "information",
      missionId: MISSION_ID,
      assignmentId: ASSIGNMENT_ID,
      title: "Clarification on vendor quotes",
      reason: "Which vendor currency should be used?",
    });
    const all = [reviewItem, clarificationItem];
    const api = fakeApi()
      .on("GET", "/api/inbox", (_, url) => {
        const cat = url.searchParams.get("category");
        const filtered = cat === "reviews" ? [reviewItem] : cat === "clarifications" ? [clarificationItem] : all;
        return inbox(filtered, { open: 2, counts: { total: 2, reviews: 1, clarifications: 1, other: 0 } });
      })
      .on("GET", `/api/missions/${MISSION_ID}`, () => missionDetail());
    renderLive(<OfficeView page="inbox" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    const group = await screen.findByRole("group", { name: "Filter by category" });
    expect(within(group).getByRole("button", { name: "All (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Reviews (1)" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Clarifications (1)" })).toBeInTheDocument();

    await userEvent.click(within(group).getByRole("button", { name: "Clarifications (1)" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/inbox?state=open&category=clarifications")).toBe(true));
    expect(await screen.findByRole("listitem", { name: "Clarification on vendor quotes" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Review unrelated quarterly report" })).toBeNull();

    await userEvent.click(within(group).getByRole("button", { name: "Reviews (1)" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/inbox?state=open&category=reviews")).toBe(true));
    expect(await screen.findByRole("listitem", { name: "Review unrelated quarterly report" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Clarification on vendor quotes" })).toBeNull();
  });
});

describe("Schedule", () => {
  test.each([
    ["an API error body", () => withStatus(404, { error: { code: "not_found", message: "no route GET /api/schedules" } })],
    ["a framework's default 404 body", () => withStatus(404, { statusCode: 404, message: "Cannot GET /api/schedules", error: "Not Found" })],
  ])("a server that does not serve schedules yet (%s) is said as such: no crash, nothing to create", async (_, reply) => {
    fakeApi().on("GET", "/api/schedules", reply);
    renderLive(<OfficeView page="schedule" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText(/Schedules are not available on this Orbit Web yet: it does not serve them\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New schedule" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Office" })).toBeInTheDocument();
  });

  test("occurrences a server does not serve yet are said as such", async () => {
    fakeApi()
      .on("GET", "/api/schedules", () => [scheduleView()])
      .on("GET", `/api/schedules/${SCHEDULE_ID}/occurrences`, () => withStatus(404, { error: { code: "not_found", message: "no route" } }));
    renderLive(<OfficeView page="schedule" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    const item = await screen.findByRole("listitem", { name: "Quarterly report" });
    await userEvent.click(within(item).getByRole("button", { name: "Occurrences" }));
    expect(await within(item).findByText("Its occurrences are not available on this Orbit Web yet.")).toBeInTheDocument();
  });

  test("each schedule says its rule, its next run in its own zone and in UTC, and a report is Sent only with a receipt", async () => {
    const api = fakeApi()
      .on("GET", "/api/schedules", () => [scheduleView()])
      .on("GET", `/api/schedules/${SCHEDULE_ID}/occurrences`, () => [occurrence(), occurrence({ id: "0c000000-0000-4000-8000-000000000002", periodKey: "2026-Q2", delivery: "SENT" }), occurrence({ id: "0c000000-0000-4000-8000-000000000003", periodKey: "2026-Q1", delivery: "none", state: "skipped", missionId: null, assignmentState: null })])
      .on("PATCH", `/api/schedules/${SCHEDULE_ID}`, () => scheduleView({ state: "paused", version: 4 }));
    renderLive(<OfficeView page="schedule" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    const item = await screen.findByRole("listitem", { name: "Quarterly report" });
    expect(item.textContent).toContain("Quarterly on day 1 of the quarter's first month at 08:00 (Asia/Ho_Chi_Minh), about the quarter that just ended");
    expect(item.textContent).toContain("2027-01-01 08:00 (Asia/Ho_Chi_Minh) · 2027-01-01 01:00 UTC · period 2026-Q4");
    expect(item.textContent).toContain("Last: period 2026-Q3 · Sending");
    expect(item.textContent).not.toContain("Sent");
    await userEvent.click(within(item).getByRole("button", { name: "Occurrences" }));
    const occurrences = await within(item).findByRole("list", { name: "Occurrences of Quarterly report" });
    const rows = within(occurrences).getAllByRole("listitem");
    expect(rows.map((r) => (r.textContent?.includes("Sent") && !r.textContent.includes("Sending") ? "Sent" : r.textContent?.includes("Sending") ? "Sending" : r.textContent?.includes("No delivery") ? "No delivery" : "?"))).toEqual(["Sending", "Sent", "No delivery"]);
    expect(rows[2]?.textContent).toContain("Skipped");
    await userEvent.click(within(item).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ state: "paused" });
    expect(patch?.headers["if-match"]).toBe('"3"');
  });

  test("a new schedule shows its next runs as it is written, worked out by the API, and is created as written", async () => {
    const api = fakeApi()
      .on("GET", "/api/schedules", () => [])
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", "/api/schedules/preview", (body) => {
        const rule = (body as { rule: { localTime: string } }).rule;
        return [{ dueAt: "2027-01-01T01:00:00.000Z", local: `2027-01-01 ${rule.localTime}`, periodKey: "2026-Q4", periodStart: "2026-10-01", periodEnd: "2026-12-31" }];
      })
      .on("POST", "/api/schedules", () => scheduleView());
    renderLive(<OfficeView page="schedule" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
    expect(await screen.findByText("No schedule yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New schedule" }));
    const form = await screen.findByRole("form", { name: "New schedule" });
    expect(within(form).getByRole("combobox", { name: "Time zone" })).toHaveValue("Asia/Ho_Chi_Minh");
    await userEvent.selectOptions(within(form).getByRole("combobox", { name: "How often" }), "quarterly");
    const runs = within(form).getByRole("region", { name: "Next runs" });
    expect(await within(runs).findByText(/2027-01-01 08:00 \(Asia\/Ho_Chi_Minh\) · 2027-01-01 01:00 UTC · period 2026-Q4/)).toBeInTheDocument();
    const preview = api.calls.filter((c) => c.path === "/api/schedules/preview").at(-1);
    expect(preview?.body).toEqual({ rule: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", dayOfMonth: 1, period: "previous" } });
    await userEvent.type(within(form).getByRole("textbox", { name: /^Name/ }), "Quarterly report");
    await userEvent.type(within(form).getByRole("textbox", { name: /What each period's work is/ }), "Report the quarter's revenue.");
    await userEvent.type(within(form).getByRole("textbox", { name: /Recipients/ }), "ann@example.com");
    await userEvent.click(within(form).getByRole("button", { name: "Create the schedule" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/schedules")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/api/schedules")?.body).toEqual({
      name: "Quarterly report",
      rule: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", dayOfMonth: 1, period: "previous" },
      employeeId: EMP_ANA,
      mission: { goal: "Report the quarter's revenue.", deliverables: [], acceptanceCriteria: [] },
      recipients: [{ address: "ann@example.com", channel: "inbox" }],
      missedPolicy: "catch_up_each",
    });
  });
});
