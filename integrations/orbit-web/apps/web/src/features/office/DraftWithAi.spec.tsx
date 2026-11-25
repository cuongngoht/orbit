import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExecutiveCapability, ExecutiveState, ExecutiveTurn, ProfileDraftAccepted, ProfileDraftView } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus, type FakeApi } from "../../testing/fakeApi";
import { authAccount, authSession } from "../../testing/fixtures";
import { APPOINTMENT_ID, AS_OF, CONN_CLAUDE, DEPT_LEGAL, EMP_ANA, connection, connectionsView, employeeDetail, presets, resourceSummary, roster } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { filled } from "./DraftWithAi";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const DRAFT_ID = "df000000-0000-4000-8000-000000000001";
const CONV = "c0000000-0000-4000-8000-0000000000d1";
const OK: ExecutiveCapability = { ok: true, code: null, reason: null };
const state = (converse: ExecutiveCapability = OK): ExecutiveState => ({
  company: { id: "o1", name: "Octo office" },
  state: converse.ok ? "available" : "unavailable",
  ceo: { employeeId: EMP_ANA, name: "Ana", title: "Chief executive", employment: "active", appointment: { id: APPOINTMENT_ID, revision: 1, state: "active", since: AS_OF }, execution: { runtime: "claude", connectionId: CONN_CLAUDE, connectionName: "Claude subscription", model: "sonnet", effort: "medium", sources: { connection: "employee", model: "employee", effort: "employee" } }, holding: null },
  converse,
  assign: OK,
  recruit: OK,
});
const turn: ExecutiveTurn = { id: "t1", conversationId: CONV, kind: "profile", state: "running", requestMessageId: "m1", responseMessageId: null, employeeId: EMP_ANA, authorName: "Ana", appointmentId: APPOINTMENT_ID, appointmentRevision: 1, waitingReason: null, code: null, detail: null, records: [], createdAt: AS_OF, startedAt: AS_OF, endedAt: null };
const DRAFT = { title: "Recruiter", duties: "Finds and screens applicants.", instructions: "Read the job description first; ask the manager when unsure.", skills: ["interviewing", "screening"], languages: ["en"], handoffStandard: "A shortlist with notes." };

function api(converse: ExecutiveCapability = OK): { api: FakeApi; ready: () => void } {
  let done = false;
  const view = (): ProfileDraftView => ({ id: DRAFT_ID, state: done ? "ready" : "drafting", description: "A recruiter.", conversationId: CONV, turnId: "t1", draft: done ? DRAFT : null, problems: [], createdAt: AS_OF, endedAt: done ? AS_OF : null });
  const accepted = { draftId: DRAFT_ID, conversationId: CONV, message: { id: "m1" }, turn } as unknown as ProfileDraftAccepted;
  const a = fakeApi()
    .on("GET", "/api/office/roster", () => roster())
    .on("GET", "/api/connections", () => connectionsView({ connections: [connection()] }))
    .on("GET", "/api/office/resources", () => resourceSummary())
    .on("GET", "/api/office/resource-presets", () => presets())
    .on("GET", "/api/office/templates", () => [])
    .on("GET", "/api/executive", () => state(converse))
    .on("POST", "/api/executive/drafts", () => withStatus(202, accepted))
    .on("GET", `/api/executive/drafts/${DRAFT_ID}`, view)
    .on("GET", `/api/executive/conversations/${CONV}`, () => ({ conversation: { id: CONV, title: "Profile: Recruiter", createdAt: AS_OF, lastMessageAt: AS_OF, messages: 1 }, messages: [], hasOlder: false, turns: [turn], links: [], lastSeq: 1 }))
    .on("POST", `/api/executive/conversations/${CONV}/turns/t1/stop`, () => withStatus(202, { turn }));
  return { api: a, ready: () => (done = true) };
}

// The hire form at its "Department & role" step, a role already titled.
async function roleStep(title = "Recruiter") {
  renderLive(<OfficeView page="overview" item={null} tab={null} go={vi.fn()} account={authAccount()} />);
  const hire = await screen.findByRole("button", { name: "Hire employee" });
  await waitFor(() => expect(hire).toBeEnabled());
  await userEvent.click(hire);
  const dialog = await screen.findByRole("dialog", { name: "Hire an employee" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Cam");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Department" }), DEPT_LEGAL);
  await userEvent.type(within(dialog).getByRole("textbox", { name: /Role title/ }), title);
  return dialog;
}

describe("draft with AI: the CEO drafts a profile, which only fills the form", () => {
  test("pure: empty fields are filled, written ones only when the owner says replace -- a written title is always kept", () => {
    const form = { title: "Recruiter", duties: "Mine.", instructions: "", skills: "", languages: "", handoffStandard: "" };
    const draft = { title: "Talent partner", duties: "Theirs.", instructions: "How.", skills: "a, b", languages: "vi", handoffStandard: "List." };
    expect(filled(form, draft, false)).toEqual({ ...draft, title: "Recruiter", duties: "Mine." });
    expect(filled(form, draft, true)).toEqual({ ...draft, title: "Recruiter" });
    expect(filled({ ...form, title: "" }, draft, false).title).toBe("Talent partner");
  });

  test("in the hire form: described, drafted by the CEO, the empty fields filled at once -- and Undo puts them back", async () => {
    const { api: a, ready } = api();
    const dialog = await roleStep();
    const group = within(dialog).getByRole("group", { name: "Draft with AI" });
    const button = within(group).getByRole("button", { name: "Draft with AI" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const describe = within(group).getByRole("textbox", { name: /Describe the job/ });
    expect(describe).toHaveValue("Recruiter — Legal");
    await userEvent.clear(describe);
    await userEvent.type(describe, "A recruiter for every department.");
    await userEvent.click(within(group).getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(a.calls.some((c) => c.method === "POST" && c.path === "/api/executive/drafts")).toBe(true));
    const posted = a.calls.find((c) => c.method === "POST" && c.path === "/api/executive/drafts");
    expect(posted?.body).toEqual({ description: "A recruiter for every department.", title: "Recruiter", departmentId: DEPT_LEGAL });
    expect(posted?.headers["idempotency-key"]).toMatch(/.{8,}/);
    expect(await within(group).findByText("Ana is drafting…")).toBeInTheDocument();
    ready();
    expect(await within(group).findByText("Drafted by Ana: read it before you go on.", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Duties/ })).toHaveValue("Finds and screens applicants.");
    expect(within(dialog).getByRole("textbox", { name: /Role title/ })).toHaveValue("Recruiter");
    expect(within(dialog).getByRole("textbox", { name: /Skills/ })).toHaveValue("interviewing, screening");
    await userEvent.click(within(group).getByRole("button", { name: "Undo" }));
    expect(within(dialog).getByRole("textbox", { name: /Duties/ })).toHaveValue("");
  });

  test("what the owner already wrote is replaced only when the owner says so", async () => {
    const { ready } = api();
    const dialog = await roleStep();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Duties/ }), "My own duties.");
    const group = within(dialog).getByRole("group", { name: "Draft with AI" });
    await waitFor(() => expect(within(group).getByRole("button", { name: "Draft with AI" })).toBeEnabled());
    await userEvent.click(within(group).getByRole("button", { name: "Draft with AI" }));
    await userEvent.click(within(group).getByRole("button", { name: "Generate" }));
    ready();
    expect(await within(group).findByText("Ana's draft is in. Replace what you wrote?", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Duties/ })).toHaveValue("My own duties.");
    await userEvent.click(within(group).getByRole("button", { name: "Fill empty fields only" }));
    expect(within(dialog).getByRole("textbox", { name: /Duties/ })).toHaveValue("My own duties.");
    expect(within(dialog).getByRole("textbox", { name: /Skills/ })).toHaveValue("interviewing, screening");
  });

  test("with no CEO to ask, the button is off and says why", async () => {
    api({ ok: false, code: "no_ceo", reason: "The company has no CEO yet." });
    const dialog = await roleStep();
    const button = within(within(dialog).getByRole("group", { name: "Draft with AI" })).getByRole("button", { name: "Draft with AI" });
    await waitFor(() => expect(button).toHaveAttribute("title", "The company has no CEO yet."));
    expect(button).toBeDisabled();
  });

  test("in an employee's profile: the draft fills the editor's fields, and saving sends them", async () => {
    const { api: a, ready } = api();
    const e = employeeDetail();
    a.on("GET", `/api/employees/${e.id}`, () => e).on("PATCH", `/api/employees/${e.id}`, () => e);
    renderLive(<OfficeView page="employee" item={e.id} tab="profile" go={vi.fn()} account={authAccount()} />);
    const group = await screen.findByRole("group", { name: "Draft with AI" });
    await waitFor(() => expect(within(group).getByRole("button", { name: "Draft with AI" })).toBeEnabled());
    await userEvent.click(within(group).getByRole("button", { name: "Draft with AI" }));
    await userEvent.type(within(group).getByRole("textbox", { name: /Describe the job/ }), "A recruiter.");
    await userEvent.click(within(group).getByRole("button", { name: "Generate" }));
    ready();
    expect(await within(group).findByText(/Replace what you wrote\?|Drafted by Ana/, undefined, { timeout: 5000 })).toBeInTheDocument();
    const replace = within(group).queryByRole("button", { name: "Replace" });
    if (replace !== null) await userEvent.click(replace);
    expect(screen.getByRole("textbox", { name: /Handoff standard/ })).toHaveValue("A shortlist with notes.");
    await userEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(a.calls.some((c) => c.method === "PATCH" && c.path === `/api/employees/${e.id}`)).toBe(true));
    const body = a.calls.find((c) => c.method === "PATCH" && c.path === `/api/employees/${e.id}`)?.body as { profile: { skills: string[]; handoffStandard: string; execution: unknown } };
    expect(body.profile.skills).toEqual(["interviewing", "screening"]);
    expect(body.profile.handoffStandard).toBe("A shortlist with notes.");
    expect(body.profile.execution).toEqual(e.profile.execution);
  });
});
