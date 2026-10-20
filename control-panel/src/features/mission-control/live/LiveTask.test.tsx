// Orbit Live through the whole app: the task page paints its journal, opens ONE stream from that cursor,
// appends what arrives, keeps every card on the view it was sent, says what its connection is (pulsing
// only while LIVE), and falls back to reading on a timer -- out loud -- when no stream can be kept open.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEventSource } from "../../../testing/fakeEventSource";
import { TASK_API, TASK_PAGE, fakeMission, pbi482View } from "../../../testing/fakeMission";
import { fakeServer } from "../../../testing/fakeServer";
import { renderApp } from "../../../testing/renderApp";
import { required } from "../../../testing/required";
import type { TaskView } from "../mission.types";
import { MAX_FAILURES, POLL_MS, WATCHDOG_MS } from "./useTaskStream";

let mission: ReturnType<typeof fakeMission>;
let server: ReturnType<typeof fakeServer>;

function serve(over: Parameters<typeof fakeMission>[0] = {}) {
  mission = fakeMission(over);
  server = fakeServer(undefined, mission.handle);
  vi.stubGlobal("fetch", server.fetch);
}

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal("EventSource", FakeEventSource);
  serve();
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
});

afterEach(() => {
  vi.useRealTimers();
});

const INV = "inv-20261006-211300-aaaa";
const at = (minute: number, second = 0) => `2026-10-06T21:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;
const badge = () => required(document.querySelector<HTMLElement>("[data-connection]"), "the connection badge");
const timelineItems = () => within(screen.getByRole("list", { name: "Timeline" })).getAllByRole("listitem");
const gets = (path: string) => server.calls.filter((c) => c.method === "GET" && c.path === path).length;
const working = (over: Partial<TaskView> = {}): TaskView => ({ ...pbi482View(), approvals: [], lifecycle: "VERIFYING", stopReason: null, ...over });

async function opened() {
  renderApp(TASK_PAGE);
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  const stream = FakeEventSource.last();
  act(() => stream.open());
  await waitFor(() => expect(badge().dataset.connection).toBe("live"));
  return stream;
}

const send = (stream: FakeEventSource, name: string, data: unknown, id?: string) => act(() => stream.emit(name, data, id));

describe("Orbit Live", () => {
  it("paints the journal once, then opens one stream from its cursor: CONNECTING, then a pulsing LIVE", async () => {
    renderApp(TASK_PAGE);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(badge().dataset.connection).toBe("connecting");
    expect(badge().dataset.pulses).toBe("false");
    expect(mission.state.activityReads).toEqual(["t=0"]);
    expect(FakeEventSource.last().url).toBe(`${TASK_API}/events/stream?since=${encodeURIComponent("t=18")}`);
    expect(timelineItems()).toHaveLength(18);
    act(() => FakeEventSource.last().open());
    await waitFor(() => expect(badge().dataset.connection).toBe("live"));
    expect(badge().dataset.pulses).toBe("true");
    expect(badge().textContent).toContain("LIVE");
  });

  it("a new line is appended without redrawing the lines before it, and the newest is marked", async () => {
    const stream = await opened();
    const before = timelineItems();
    const kept = before[3];
    send(stream, "task-event", { source: "task", n: 18, at: at(13), kind: "stage", stage: "FIXING" }, "t=19");
    await waitFor(() => expect(timelineItems()).toHaveLength(before.length + 1));
    expect(timelineItems()[3]).toBe(kept);
    expect(timelineItems().at(-1)?.dataset.new).toBe("true");
    expect(timelineItems().at(-1)?.textContent).toContain("FIXING");
  });

  it("the same line arriving again after a reconnect is shown once", async () => {
    const stream = await opened();
    const line = { source: "task", n: 18, at: at(13), kind: "decision", observed: "refund API returns 500", nextAction: "inspect-refund-service" };
    send(stream, "task-event", line, "t=19");
    send(stream, "task-event", line, "t=19");
    await waitFor(() => expect(timelineItems()).toHaveLength(19));
    await new Promise((r) => setTimeout(r, 150));
    expect(timelineItems()).toHaveLength(19);
  });

  it("a view the stream sends moves the stage, the state and the revision a person's decision names", async () => {
    const stream = await opened();
    send(stream, "task-view", { source: "task", revision: 31, view: { ...pbi482View(), revision: 31, stage: "FIXING" } }, "t=19");
    await waitFor(() => expect(within(screen.getByLabelText("Current state")).getByText("Fixing")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(await within(await screen.findByRole("alertdialog", { hidden: true })).findByRole("button", { name: "Pause", hidden: true }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(server.calls.filter((c) => c.method === "POST")[0].body).toEqual({ human: true, expectedRevision: 31 });
  });

  it("an approval asked for appears in the feed at once, with Approve once and Reject", async () => {
    serve({ view: working() });
    const stream = await opened();
    expect(screen.queryByRole("region", { name: "Human approval required" })).toBeNull();
    send(stream, "task-event", { source: "task", n: 18, at: at(13), kind: "approval-requested", id: "apr-1", action: "database.migrate", environment: "dev" }, "t=19");
    send(stream, "task-view", { source: "task", revision: 31, view: { ...pbi482View(), revision: 31 } }, "t=19");
    const asked = await screen.findByRole("region", { name: "Human approval required" });
    expect(within(asked).getByRole("button", { name: /^Approve once apr-1/ })).toBeTruthy();
    expect(within(asked).getByRole("button", { name: /^Reject apr-1/ })).toBeTruthy();
    expect(within(screen.getByLabelText("Current activity")).getByText(/WAITING FOR A PERSON/)).toBeTruthy();
  });

  it("running, then done, then failed: each its own line and glyph, and the current activity follows", async () => {
    serve({ view: working() });
    const stream = await opened();
    expect(within(screen.getByLabelText("Current activity")).getByText("Regression (test)")).toBeTruthy();
    send(stream, "task-event", { source: "task", n: 18, at: at(13), kind: "action-started", id: "act-6", type: "build", label: "dotnet build" }, "t=19");
    send(stream, "task-event", { source: "task", n: 19, at: at(13, 5), kind: "action-completed", id: "act-6", outcome: "succeeded" }, "t=20");
    send(stream, "task-event", { source: "task", n: 20, at: at(13, 9), kind: "action-failed", id: "act-7", type: "test", reason: "the runner crashed" }, "t=21");
    await waitFor(() => expect(timelineItems()).toHaveLength(21));
    const glyphs = timelineItems().slice(-3).map((li) => within(li).getByRole("img").getAttribute("aria-label"));
    expect(glyphs).toEqual(["started", "succeeded", "failed"]);
    expect(timelineItems().at(-1)?.textContent).toMatch(/could not run: the runner crashed \(failed\)$/);
  });

  it("QA lines show the browser's steps and what failed under them, and the Playwright panel says only what is known", async () => {
    serve({ view: working({ actions: pbi482View().actions.filter((a) => a.state !== "running") }) });
    const stream = await opened();
    const qa = (n: number, kind: string, fields: Record<string, unknown>) => send(stream, "qa-event", { source: INV, n, at: at(14, n), kind, ...fields }, `t=18;${INV}=${n + 1}`);
    qa(0, "qa.started", { mode: "observe", origin: "http://127.0.0.1:42017" });
    qa(1, "qa.step", { do: "click", on: "Confirm refund", url: "/orders/821", state: "done", ms: 133, screenshot: true });
    qa(2, "qa.network", { action: "act-2", requests: [{ method: "POST", endpoint: "/api/refund", status: 500, failed: false }] });
    qa(3, "qa.console", { errors: 1, messages: ["TypeError: Cannot read properties of undefined"] });
    await waitFor(() => expect(timelineItems()).toHaveLength(22));
    const text = timelineItems().slice(-4).map((li) => li.textContent ?? "");
    expect(text[1]).toMatch(/click Confirm refund.*\/orders\/821 · 133ms · 📸 screenshot/);
    expect(text[2]).toMatch(/POST \/api\/refund → 500.*\(failed\)/);
    const panel = await screen.findByRole("region", { name: "Playwright" });
    expect(within(panel).getByText(/click Confirm refund/)).toBeTruthy();
    expect(within(panel).getByText("POST /api/refund → 500")).toBeTruthy();
    expect(within(panel).getByText("1 error(s)")).toBeTruthy();
    expect(panel.textContent ?? "").not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it("the task ending says FINISHED, stops pulsing and closes the stream", async () => {
    const stream = await opened();
    const done: TaskView = { ...pbi482View(), revision: 32, lifecycle: "COMPLETED", terminal: true, approvals: [], stopReason: null, ended: { kind: "completed", at: at(20), stop: null, summary: "verified", because: null, by: null } };
    send(stream, "task-event", { source: "task", n: 18, at: at(20), kind: "completed", summary: "verified" }, "t=19");
    send(stream, "task-view", { source: "task", revision: 32, view: done }, "t=19");
    send(stream, "end", { source: "task", reason: "terminal" }, "t=19");
    await waitFor(() => expect(badge().dataset.connection).toBe("finished"));
    expect(badge().dataset.pulses).toBe("false");
    expect(stream.closed).toBe(true);
    expect(within(screen.getByLabelText("Current activity")).getByText(/COMPLETED/)).toBeTruthy();
  });

  it("a task that had ended is a REPLAY: read once, and no stream is opened", async () => {
    serve({ view: { ...pbi482View(), lifecycle: "COMPLETED", terminal: true, approvals: [], ended: { kind: "completed", at: at(20), stop: null, summary: null, because: null, by: null } } });
    renderApp(TASK_PAGE);
    await waitFor(() => expect(badge().dataset.connection).toBe("replay"));
    expect(timelineItems()).toHaveLength(18);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(mission.state.activityReads).toHaveLength(1);
  });

  it("an error says RECONNECTING; three in a row say DEGRADED LIVE and the page reads from its cursor every 5 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stream = await opened();
    act(() => stream.error());
    await waitFor(() => expect(badge().dataset.connection).toBe("reconnecting"));
    for (let i = 1; i < MAX_FAILURES; i += 1) act(() => stream.error());
    await waitFor(() => expect(badge().dataset.connection).toBe("degraded"));
    expect(badge().textContent).toContain("DEGRADED LIVE");
    expect(stream.closed).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 10));
    await waitFor(() => expect(mission.state.activityReads.at(-1)).toBe("t=18"));
  });

  it("a stream that goes silent past the watchdog is opened again from the cursor it reached", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stream = await opened();
    send(stream, "task-event", { source: "task", n: 18, at: at(13), kind: "stage", stage: "FIXING" }, "t=19");
    await act(() => vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(stream.closed).toBe(true);
    expect(FakeEventSource.last().url).toBe(`${TASK_API}/events/stream?since=${encodeURIComponent("t=19")}`);
    expect(badge().dataset.connection).toBe("reconnecting");
  });

  it("while LIVE the task is not read on a timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await opened();
    const reads = gets(TASK_API);
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(gets(TASK_API)).toBe(reads);
  });

  it("a browser with no EventSource reads every 5 seconds, shows every line, and says DEGRADED LIVE", async () => {
    vi.stubGlobal("EventSource", undefined);
    renderApp(TASK_PAGE);
    await waitFor(() => expect(badge().dataset.connection).toBe("degraded"));
    expect(timelineItems()).toHaveLength(18);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("each filter shows only its lines", async () => {
    await opened();
    fireEvent.click(screen.getByRole("tab", { name: "Decisions" }));
    await waitFor(() => expect(timelineItems()).toHaveLength(1));
    expect(timelineItems()[0].textContent).toMatch(/Decision recorded/);
    fireEvent.click(screen.getByRole("tab", { name: "Approvals" }));
    await waitFor(() => expect(timelineItems().map((li) => li.textContent)).toEqual([expect.stringMatching(/Approval apr-1 asked/)]));
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(timelineItems()).toHaveLength(18));
  });
});

// 1.8.5: what a running check's runner reported reaches the page as the terminal sees it -- the counts, why it runs,
// the first failure -- and the verdict is said to be the receipt's, never the observation's.
describe("Orbit Live: a check's observation", () => {
  it("shows what the runner of the running check reported, and that its verdict is not yet written", async () => {
    const stream = await opened();
    send(stream, "activity-view", { source: "activity", task: pbi482View().task.id, action: "act-5", revision: 3, view: { action: "act-5", state: "running", seq: 3, resets: 0, why: "required: the change reaches node:api (modified)", command: { component: "node:api", declaredAs: "test" }, adapter: { id: "tap", runner: "TAP", capabilities: { cases: "reported", total: "at-end" } }, counts: { passed: 12, failed: 1, skipped: 0, todo: 0, cancelled: 0 }, reported: 13, total: null, recent: [{ key: "1", name: "RefundRejectsOverpay", state: "failed" }], failures: [{ name: "RefundRejectsOverpay", category: "assertion", message: "expected 400", location: "refund.test.js:9", stack: [] }], output: { lines: 80, lastAt: at(11) }, gaps: [], complete: false } }, "t=19");
    const card = await screen.findByRole("region", { name: "Check progress" });
    expect(within(card).getByText("12 passed · 1 failed")).toBeTruthy();
    expect(within(card).getByText("13 reported · total unknown")).toBeTruthy();
    expect(within(card).getByText("required: the change reaches node:api (modified)")).toBeTruthy();
    expect(within(card).getByText(/not yet: the check's receipt is written when it ends/)).toBeTruthy();
    expect(within(card).getByText(/✗ RefundRejectsOverpay — assertion: expected 400 \(refund\.test\.js:9\)/)).toBeTruthy();
  });
});
