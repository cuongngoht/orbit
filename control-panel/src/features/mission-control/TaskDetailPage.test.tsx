// One task through the whole app: the PBI-482 scenario as its journal says it, and a person's
// decisions -- shown in full before anything is asked, sent only after a confirmation, exactly as
// the server expects them, and never shown as done before the server says so.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TOKEN_HEADER } from "../../shared/api/client";
import { TASK_API, TASK_PAGE, fakeMission } from "../../testing/fakeMission";
import { fakeServer } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

let mission: ReturnType<typeof fakeMission>;
let server: ReturnType<typeof fakeServer>;

function serve(over: Parameters<typeof fakeMission>[0] = {}) {
  mission = fakeMission(over);
  server = fakeServer(undefined, mission.handle);
  vi.stubGlobal("fetch", server.fetch);
}

beforeEach(() => {
  serve();
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

// Fluent marks a dialog aria-hidden while it settles which layer is modal: read it with hidden: true.
const modal = () => screen.findByRole("alertdialog", { hidden: true });
const inModal = async (name: string) => within(await modal()).getByRole("button", { name, hidden: true });
const posts = () => server.calls.filter((c) => c.method !== "GET");
const gets = (path: string) => server.calls.filter((c) => c.method === "GET" && c.path === path).length;
// The value a description list gives a term: what a person reads next to the label.
function fact(scope: HTMLElement, term: string): string {
  const dt = within(scope).getByText(term, { selector: "dt" });
  return dt.nextElementSibling?.textContent ?? "";
}

const card = (title: string) => {
  const heading = screen.getByRole("heading", { name: title });
  const root = heading.closest<HTMLElement>("section");
  if (!root) throw new Error(`no card ${title}`);
  return root;
};

describe("Task detail", () => {
  it("shows where PBI-482 stands: state, stage, attempt 3 of 8, why it waits, and what is ready", async () => {
    renderApp(TASK_PAGE);
    expect(await screen.findByRole("heading", { level: 1, name: "PBI-482 — Refund validation" })).toBeTruthy();
    const state = card("Current state");
    expect([fact(state, "State"), fact(state, "Stage"), fact(state, "Attempt"), fact(state, "Still running")]).toEqual(["WAITING_APPROVAL", "Regression", "3 / 8", "Regression"]);
    expect(fact(state, "Why it stopped")).toBe("HUMAN_APPROVAL_REQUIRED — it waits for a person to approve one action");
    const ready = card("Readiness");
    expect(within(ready).getAllByText("READY")).toHaveLength(3);
    expect(fact(ready, "Agent")).toBe("claude-code · Regression");
    expect(fact(ready, "Requirement")).toMatch(/READY.*rs-0123456789ab/);
  });

  it("shows the current decision as the task recorded it -- observed, hypothesis, evidence, next action -- and no reasoning", async () => {
    renderApp(TASK_PAGE);
    const decision = await screen.findByLabelText("Current decision");
    expect([fact(decision, "Observed"), fact(decision, "Hypothesis"), fact(decision, "Evidence"), fact(decision, "Next action")]).toEqual(["2 refund boundary tests failed", "validation occurs after rounding", "test:test-receipt-28", "inspect-refund-validation"]);
    expect(screen.getByRole("heading", { name: "Current decision" })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/thinking|chain of thought|reasoning:/i);
  });

  it("lists the three attempts as they ended, and the journal line by line as the timeline", async () => {
    renderApp(TASK_PAGE);
    const attempts = await screen.findByRole("table", { name: "Attempts" });
    const rows = within(attempts).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows[0]).toMatch(/Attempt 1.*fresh.*Build ✓ succeeded · RefundTests ✗ failed \(2 failed\).*failed · a1b2c3d4e5f6/);
    expect(rows[1]).toMatch(/Attempt 2.*fix.*RefundTests ✗ failed \(1 failed\).*failed/);
    expect(rows[2]).toMatch(/Attempt 3 \(current\).*RefundTests ✓ succeeded · Regression running.*still open/);
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    const lines = within(timeline).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(lines.some((l) => /RefundTests\s+✗ 2 failed \(failed\)$/.test(l))).toBe(true);
    expect(lines.some((l) => /Decision recorded: 2 refund boundary tests failed → inspect-refund-validation/.test(l))).toBe(true);
    expect(lines.some((l) => /Regression started/.test(l))).toBe(true);
    expect(lines.at(-1)).toMatch(/Approval apr-1 asked: database\.migrate on dev/);
  });

  it("says what has been verified, only with a receipt, and what has not", async () => {
    renderApp(TASK_PAGE);
    const table = await screen.findByRole("table", { name: "Verification" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows).toEqual(["Refund <= paid amounttest:test-receipt-31satisfied", "Persisted correctly—not verified"]);
    expect(within(card("Changes")).getByText("src/RefundService.cs")).toBeTruthy();
    expect(screen.getByText("1 file(s) changed +61 −18")).toBeTruthy();
  });

  it("shows an approval in full before asking, sends nothing until the dialog's button, then exactly one human decision on the revision read", async () => {
    renderApp(TASK_PAGE);
    const approval = await screen.findByLabelText("Approval apr-1");
    expect([fact(approval, "Action"), fact(approval, "Environment"), fact(approval, "Reason"), fact(approval, "Risk"), fact(approval, "Task"), fact(approval, "Attempt")]).toEqual(["database.migrate", "dev", "Integration verification needs schema v82.", "DEV database state will be changed.", "PBI-482 — Refund validation (tsk-0123456789ab)", "att-3"]);
    expect(fact(approval, "Requested at")).not.toBe("");
    fireEvent.click(screen.getByRole("button", { name: /^Approve once apr-1/ }));
    expect(await modal()).toBeTruthy();
    expect(posts()).toEqual([]);
    const before = { task: gets(TASK_API) };
    fireEvent.click(await inModal("Approve once"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [sent] = posts();
    expect([sent.method, sent.path, sent.body, sent.headers[TOKEN_HEADER]]).toEqual(["POST", `${TASK_API}/approvals/apr-1/approve`, { human: true, expectedRevision: 30 }, "tok-123"]);
    await waitFor(() => expect(within(card("Approvals decided")).getByText("approved once")).toBeTruthy());
    await waitFor(() => expect(gets(TASK_API)).toBeGreaterThan(before.task));
  });

  it("Reject sends one human decision too, and nothing is shown as rejected before the server says so", async () => {
    renderApp(TASK_PAGE);
    fireEvent.click(await screen.findByRole("button", { name: /^Reject apr-1/ }));
    fireEvent.click(await inModal("Reject"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect([posts()[0].path, posts()[0].body]).toEqual([`${TASK_API}/approvals/apr-1/reject`, { human: true, expectedRevision: 30 }]);
    expect(await screen.findByText("rejected")).toBeTruthy();
  });

  it("without the token from the address Control printed, nothing can be decided", async () => {
    window.sessionStorage.clear();
    renderApp(TASK_PAGE);
    const approve = await screen.findByRole("button", { name: /^Approve once apr-1/ });
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /^Reject apr-1/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Pause" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel task" }).hasAttribute("disabled")).toBe(true);
  });

  it("a decision on a task that moved is refused and said so; nothing is retried, and the latest can be loaded", async () => {
    serve({ movedSince: true });
    renderApp(TASK_PAGE);
    fireEvent.click(await screen.findByRole("button", { name: /^Approve once apr-1/ }));
    fireEvent.click(await inModal("Approve once"));
    expect(await screen.findByText("The task moved before your decision reached it")).toBeTruthy();
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Load the latest" })).toBeTruthy();
    expect(screen.queryByText("approved once")).toBeNull();
  });

  it("pause and cancel are a person's, confirmed first, and each names the revision it was decided on", async () => {
    renderApp(TASK_PAGE);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(within(await modal()).getByText(/An action already running is not interrupted/)).toBeTruthy();
    fireEvent.click(await inModal("Pause"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect([posts()[0].path, posts()[0].body]).toEqual([`${TASK_API}/pause`, { human: true, expectedRevision: 30 }]);
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull(), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    fireEvent.click(await inModal("Cancel the task"));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect([posts()[1].path, posts()[1].body]).toEqual([`${TASK_API}/cancel`, { human: true, expectedRevision: 31 }]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel task" })).toBeNull());
  });

  it("deciding from the machine's queue reads the task, the machine and the queue again", async () => {
    const router = renderApp("/mission-control");
    await screen.findByText("PBI-482 — Refund validation");
    fireEvent.click(screen.getByRole("link", { name: /^Waiting approval/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/mission-control/approvals"));
    const before = { machine: gets("/api/v1/mission-control"), queue: gets("/api/v1/mission-control/approvals") };
    fireEvent.click(await screen.findByRole("button", { name: /^Approve once apr-1/ }));
    fireEvent.click(await inModal("Approve once"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(gets("/api/v1/mission-control/approvals")).toBeGreaterThan(before.queue));
    await waitFor(() => expect(gets("/api/v1/mission-control")).toBeGreaterThan(before.machine));
    expect(await screen.findByText("Nothing waits for a person on this machine.")).toBeTruthy();
  });

  it("puts the sandbox right after readiness, names its receipt among the task's, and offers nothing that starts one", async () => {
    renderApp(TASK_PAGE);
    const ready = await screen.findByRole("heading", { name: "Readiness" });
    const sandbox = await screen.findByRole("heading", { name: "Sandbox" });
    expect(ready.compareDocumentPosition(sandbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sandbox.compareDocumentPosition(screen.getByRole("heading", { name: "Current state" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fact(card("References"), "Receipts")).toMatch(/sandbox:env-0123456789ab \(READY\)/);
    expect(screen.queryAllByRole("button", { name: /start|restart|rebuild/i })).toEqual([]);
  });

  it("a sandbox that cannot be read is a card's error: the task, its decision and its decisions are still shown", async () => {
    serve({ sandboxRefused: true });
    renderApp(TASK_PAGE);
    expect(await screen.findByText(/belongs to another task/)).toBeTruthy();
    expect(card("Current state")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "PBI-482 — Refund validation" })).toBeTruthy();
  });
});

