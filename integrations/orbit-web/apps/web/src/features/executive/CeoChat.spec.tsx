import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ExecutiveConversationDetail, ExecutiveMessage, ExecutiveState, ExecutiveTurn } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import type { Resource } from "../../hooks/useResource";
import { fakeApi } from "../../testing/fakeApi";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { pushApp } from "../../testing/events";
import { renderLive } from "../../testing/render";
import { MissionProposalCard } from "./cards";
import { CeoChatView } from "./CeoChatView";
import { EMPTY, executiveReducer } from "./executiveReducer";

const CONV = "c1000000-0000-4000-8000-000000000001";
const AN = "e1000000-0000-4000-8000-000000000001";
const APPT = "a1000000-0000-4000-8000-000000000001";

const resource = (data: ExecutiveState): Resource<ExecutiveState> => ({ data, error: null, errorCode: null, loading: false, loadedAt: null, reload: async () => undefined, set: () => undefined });

const ceo = (over: Partial<NonNullable<ExecutiveState["ceo"]>> = {}): NonNullable<ExecutiveState["ceo"]> => ({
  employeeId: AN,
  name: "An",
  title: "Chief executive",
  employment: "active",
  appointment: { id: APPT, revision: 1, state: "active", since: "2026-11-20T00:00:00.000Z" },
  execution: { runtime: "claude", connectionId: "k1", connectionName: "Claude (team)", model: "claude-sonnet-5-5", effort: "medium", sources: { connection: "employee", model: "employee", effort: "company" } },
  holding: null,
  ...over,
});
const available: ExecutiveState = { company: { id: "o1", name: "Chat Co" }, state: "available", ceo: ceo(), converse: { ok: true, code: null, reason: null }, assign: { ok: true, code: null, reason: null }, recruit: { ok: true, code: null, reason: null } };

const message = (over: Partial<ExecutiveMessage>): ExecutiveMessage => ({
  id: "m1",
  conversationId: CONV,
  position: 1,
  role: "owner",
  author: { name: "Octo Cat", userId: "u1", employeeId: null, appointmentId: null, appointmentRevision: null, current: false },
  text: "How are we doing?",
  partial: false,
  model: null,
  report: null,
  proposal: null,
  proposalState: null,
  proposalNote: null,
  missionId: null,
  turnId: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  ...over,
});
const turn = (over: Partial<ExecutiveTurn>): ExecutiveTurn => ({ id: "t1", conversationId: CONV, kind: "answer", state: "completed", requestMessageId: "m1", responseMessageId: "m2", employeeId: AN, authorName: "An", appointmentId: APPT, appointmentRevision: 1, waitingReason: null, code: null, detail: null, records: ["Company: Chat Co"], createdAt: "2026-11-20T00:00:00.000Z", startedAt: null, endedAt: null, ...over });
const ceoSaid = (over: Partial<ExecutiveMessage> = {}) => message({ id: "m2", position: 2, role: "ceo", author: { name: "An", userId: null, employeeId: AN, appointmentId: APPT, appointmentRevision: 1, current: true }, text: "We are **fine**.", model: "claude-sonnet-5-5", turnId: "t1", ...over });

const show = (state: ExecutiveState, conversationId: string | null = null, go = vi.fn()) => renderLive(<CeoChatView state={resource(state)} conversationId={conversationId} go={go} />);

let seq = 10;
const push = (type: string, data: unknown, durable = true) =>
  act(() => FakeEventSource.last(`/api/executive/conversations/${CONV}/events`).emit({ id: `e${seq}`, type, stream: "executive", sessionId: CONV, seq: durable ? ++seq : null, runId: "t2", at: "2026-11-20T00:00:00.000Z", data }));

describe("CEO Chat", () => {
  test("home: who the CEO is, the question, the composer; a message starts a conversation, sent under an Idempotency-Key", async () => {
    const api = fakeApi().on("GET", "/api/executive/conversations", () => ({ conversations: [], nextCursor: null })).on("POST", "/api/executive/conversations", () => ({ conversationId: CONV, message: message({}), turn: turn({ state: "waiting" }) }));
    const go = vi.fn();
    show(available, null, go);
    expect(screen.getByText("What should we work on today?")).toBeTruthy();
    expect(screen.getByText("An")).toBeTruthy();
    expect(screen.getByText("CEO of Chat Co")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    const box = screen.getByPlaceholderText("Talk to your CEO, ask about your company, or assign work...");
    fireEvent.change(box, { target: { value: "How are we doing?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(go).toHaveBeenCalledWith(CONV));
    const sent = api.calls.find((c) => c.method === "POST" && c.path === "/api/executive/conversations");
    expect(sent?.body).toEqual({ text: "How are we doing?" });
    expect(Object.keys(sent?.headers ?? {}).map((k) => k.toLowerCase())).toContain("idempotency-key");
  });

  test("a company without a CEO: said so, with the Office's own hire and appoint; Orbit's records still answer", async () => {
    const api = fakeApi().on("POST", "/api/executive/conversations", () => ({ conversationId: CONV, message: message({ role: "system" }), turn: null }));
    const go = vi.fn();
    show({ ...available, state: "no_ceo", ceo: null, converse: { ok: false, code: "no_ceo", reason: "The company has no CEO yet." }, assign: { ok: false, code: "no_ceo", reason: "No CEO." } }, null, go);
    expect(screen.getByText("Your company has no CEO yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hire an AI employee/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Appoint the CEO/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Company status/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(CONV));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ report: "status" });
  });

  test("a CEO who cannot answer: the composer is closed, and why is said", () => {
    fakeApi().on("GET", "/api/executive/conversations", () => ({ conversations: [], nextCursor: null }));
    show({ ...available, state: "unavailable", converse: { ok: false, code: "ceo_unavailable", reason: "An's AI connection cannot run work now." } });
    expect(screen.getByText(/The CEO cannot answer now: An's AI connection cannot run work now\./)).toBeTruthy();
    expect(screen.getByText("Cannot answer now")).toBeTruthy();
  });

  test("a conversation: what was said, the answer as it is written, then whole; a proposal given to the CEO as the owner saw it", async () => {
    const detail: ExecutiveConversationDetail = {
      conversation: { id: CONV, title: "How are we doing?", messages: 2, createdAt: "2026-11-20T00:00:00.000Z", lastMessageAt: null },
      messages: [message({}), ceoSaid()],
      hasOlder: false,
      turns: [turn({})],
      links: [],
      lastSeq: 10,
    };
    const api = fakeApi()
      .on("GET", `/api/executive/conversations/${CONV}`, () => detail)
      .on("GET", "/api/missions/target", () => ({ target: { kind: "ceo" }, responsible: { employeeId: AN, appointmentId: APPT, appointmentRevision: 1, employeeName: "An", role: "ceo", departmentName: null }, code: null, reason: null }))
      .on("POST", `/api/executive/conversations/${CONV}/missions`, () => ({ missionId: "x1", assignmentId: "y1", state: "QUEUED", employeeId: AN, resourceVersion: 1, href: "#/office/mission/x1", correlationId: "c" }));
    show(available, CONV);
    expect(await screen.findByText("fine")).toBeTruthy();
    expect(screen.getByText("An · CEO")).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.last(`/api/executive/conversations/${CONV}/events`).url).toContain("after=10"));
    const t2 = turn({ id: "t2", state: "running", responseMessageId: null, requestMessageId: "m3" });
    push("executive.message.created", { message: message({ id: "m3", position: 3, text: "Research the AI agent market." }) });
    push("executive.response.started", { turn: t2, messageId: "m4", authorName: "An", model: "claude-sonnet-5-5" });
    push("executive.response.delta", { messageId: "m4", offset: 0, text: "I propose we " }, false);
    expect(await screen.findByText("I propose we")).toBeTruthy();
    const proposal = { title: "AI agent market", goal: "Size the market.", deliverables: [{ name: "market.md", required: true }], acceptanceCriteria: ["Three segments"], deadline: null, priority: 6 };
    push("executive.response.completed", { turn: { ...t2, state: "completed", responseMessageId: "m4" }, message: ceoSaid({ id: "m4", position: 4, text: "I propose we size it first.", turnId: "t2", proposal, proposalState: "open" }) });
    expect(await screen.findByText("I propose we size it first.")).toBeTruthy();
    expect(screen.getByText("Proposed mission")).toBeTruthy();
    await screen.findByText(/Goes to An, who gives it to the departments\./);
    fireEvent.click(screen.getByRole("button", { name: "Give it to the CEO" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/missions"))).toBe(true));
    const given = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/missions"));
    expect(given?.body).toEqual({ proposalMessageId: "m4", mission: proposal, expectedAssignee: { employeeId: AN, appointmentId: APPT, appointmentRevision: 1 } });
    expect(Object.keys(given?.headers ?? {}).map((k) => k.toLowerCase())).toContain("idempotency-key");
  });

  test("Orbit's records are Orbit's: a report shows as one, never as the CEO's words; a former CEO's answer stays theirs", async () => {
    const report = { kind: "status" as const, title: "Chat Co today", at: "2026-11-20T00:00:00.000Z", facts: [{ label: "CEO", value: "An — Ready" }], items: [] };
    fakeApi().on("GET", `/api/executive/conversations/${CONV}`, () => ({
      conversation: { id: CONV, title: "Status", messages: 2, createdAt: "2026-11-20T00:00:00.000Z", lastMessageAt: null },
      messages: [message({ id: "m1", role: "system", author: { name: "Orbit", userId: null, employeeId: null, appointmentId: null, appointmentRevision: null, current: false }, text: "Chat Co today", report }), ceoSaid({ author: { name: "Eve", userId: null, employeeId: "e9", appointmentId: "a9", appointmentRevision: 1, current: false } })],
      hasOlder: false,
      turns: [],
      links: [],
      lastSeq: 2,
    }));
    show(available, CONV);
    expect(await screen.findByText("Chat Co today")).toBeTruthy();
    expect(screen.getByText(/From Orbit's records/)).toBeTruthy();
    expect(screen.getByText("Eve · former CEO")).toBeTruthy();
  });
});

describe("a proposal the CEO cannot be given yet", () => {
  test("it says why and where to fix it, and is checked again when the office changes: a manager appointed lets it be given", async () => {
    const proposal = { title: "FX hiring", goal: "Assess FX hiring needs.", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [], deadline: null, priority: 5 };
    const refused = { target: { kind: "ceo" }, responsible: null, code: "ceo_needs_departments", reason: "The CEO gives work only to departments, and none has a manager yet: create a department and appoint its manager, or give the work to an employee." };
    const given = { target: { kind: "ceo" }, responsible: { employeeId: AN, appointmentId: APPT, appointmentRevision: 1, employeeName: "An", role: "ceo", departmentName: null }, code: null, reason: null };
    let preview: unknown = refused;
    fakeApi().on("GET", "/api/missions/target", () => preview);
    renderLive(<MissionProposalCard conversationId={CONV} message={ceoSaid({ id: "m4", proposal, proposalState: "open" })} canAssign />);
    expect(await screen.findByText(/none has a manager yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the Office" }).getAttribute("href")).toBe("#/office");
    expect((screen.getByRole("button", { name: "Give it to the CEO" }) as HTMLButtonElement).disabled).toBe(true);
    preview = given;
    pushApp("office.changed", { areas: ["roster"], missionId: null, version: 2 });
    await screen.findByText(/Goes to An, who gives it to the departments\./);
    expect((screen.getByRole("button", { name: "Give it to the CEO" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a conversation, folded", () => {
  test("a durable event applies once (by its number); a delta grows the answer; the completed answer replaces it", () => {
    const loaded = executiveReducer(EMPTY, { type: "loaded", detail: { conversation: { id: CONV, title: "x", messages: 0, createdAt: "", lastMessageAt: null }, messages: [], hasOlder: false, turns: [], links: [], lastSeq: 5 } });
    const ev = (type: string, data: unknown, seq: number | null) => ({ type: "event" as const, event: { id: `x${seq}`, type, stream: "executive", sessionId: CONV, seq, runId: "t1", at: "", data } as never });
    const old = executiveReducer(loaded, ev("executive.message.created", { message: message({}) }, 5));
    expect(old.messages).toEqual([]);
    const started = executiveReducer(loaded, ev("executive.response.started", { turn: turn({ state: "running" }), messageId: "m2", authorName: "An", model: null }, 6));
    const grown = executiveReducer(executiveReducer(started, ev("executive.response.delta", { messageId: "m2", offset: 0, text: "Hel" }, null)), ev("executive.response.delta", { messageId: "m2", offset: 0, text: "Hello" }, null));
    expect(grown.live?.text).toBe("Hello");
    const done = executiveReducer(grown, ev("executive.response.completed", { turn: turn({}), message: ceoSaid({ text: "Hello there." }) }, 7));
    expect([done.live, done.messages.map((m) => m.text), done.lastSeq]).toEqual([null, ["Hello there."], 7]);
    expect(executiveReducer(done, ev("executive.response.completed", { turn: turn({}), message: ceoSaid({ text: "again" }) }, 7)).messages.map((m) => m.text)).toEqual(["Hello there."]);
  });
});
