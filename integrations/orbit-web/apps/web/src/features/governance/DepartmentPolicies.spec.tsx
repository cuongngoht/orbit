import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ACTION_KINDS, type AccountPolicy, type DepartmentPolicy, type Impact } from "@orbit-web/governance-core";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import {
  CSRF,
  DEPARTMENT_DRAFT_DIGEST,
  DEPARTMENT_ID,
  DRAFT_DIGEST,
  OWNER,
  authSession,
  delegatingPolicy,
  departmentDocument,
  departmentDraftView,
  departmentPolicyOverview,
  departmentRevisionView,
  draftView,
  revisionSummary,
  revisionView,
} from "../../testing/fixtures";
import { DEPT_ACCOUNTING, DEPT_LEGAL, EMP_ANA, department, roster } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { mobileViewport, mockViewport } from "../../testing/viewport";
import { GovernanceView } from "./GovernanceView";

const ACCOUNT = { displayName: "Octo & Co", email: "octo@example.com" };
const POLICY = `/api/governance/departments/${DEPARTMENT_ID}/policy`;

const ELEVATED: Impact = { risk: "elevated", widened: [], narrowed: [], obligations: [], rules: [], reasons: ["It lets the department's employees use the web tools."] };
const LOW: Impact = { risk: "low", widened: [], narrowed: [], obligations: [], rules: [], reasons: [] };

const nonGets = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);

// The department's page with its draft `dpr-2` listed beside its revision in effect, `dpr-1`.
const withDraft = (draft: ReturnType<typeof departmentDraftView>) => departmentPolicyOverview(departmentRevisionView(), [revisionSummary(draft), revisionSummary(departmentRevisionView())]);

const openDepartment = () => renderLive(<GovernanceView page="departments" item={DEPARTMENT_ID} go={vi.fn()} account={ACCOUNT} />);

beforeEach(() => rememberSession(authSession()));
afterEach(() => {
  rememberSession(null);
  mockViewport({});
});

describe("Governance → Departments: a department's policy, under the company's", () => {
  test("Departments lists the office's live departments, each a link to its policy", async () => {
    fakeApi().on("GET", "/api/office/roster", () =>
      roster({ departments: [department(), department({ id: DEPT_LEGAL, name: "Legal", position: 1, members: 3 }), department({ id: "d1000000-0000-4000-8000-000000000003", name: "Old", archived: true })] }),
    );
    const go = vi.fn();
    renderLive(<GovernanceView page="departments" item={null} go={go} account={ACCOUNT} />);
    const list = await screen.findByRole("list", { name: "Departments" });
    expect(within(list).getAllByRole("listitem").map((li) => within(li).getByRole("button").textContent)).toEqual(["Accounting", "Legal"]);
    expect(within(list).getByText("3 members")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Legal" }));
    expect(go).toHaveBeenCalledWith("departments", DEPT_LEGAL);
  });

  test("its page says what is in effect for its employees, row by row against the company's: what it inherits, what it says, and what locks or caps a row", async () => {
    // The department says tool.web is allowed (delegated up to allowed), narrows tool.connector, and still says allowed of
    // repository.push -- which the company now delegates only up to "you approve first".
    const effective = departmentRevisionView({
      document: departmentDocument({
        rules: [
          { id: "web", action: "tool.web", effect: "allow" },
          { id: "push", action: "repository.push", effect: "allow" },
          { id: "no-connectors", action: "tool.connector", effect: "deny" },
        ],
      }),
    });
    const api = fakeApi().on("GET", POLICY, () => departmentPolicyOverview(effective));
    openDepartment();
    const header = await screen.findByRole("region", { name: "Accounting" });
    expect(within(header).getByText("Worked out under your policy's revision 1.")).toBeInTheDocument();
    expect(within(header).getByText(/^Its own policy in effect: revision 1, published/)).toBeInTheDocument();
    expect(within(header).getByText("Applies to this department's employees' work only — never to Chat, Research or people. Agents can only propose drafts; only you publish.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "What its employees may do" });
    // Delegated, the company's rule a default: the department's own answer is in effect.
    const web = within(table).getByRole("row", { name: /tool\.web/ });
    expect(within(web).getByText("default")).toBeInTheDocument();
    expect(within(web).getAllByText("allow")).toHaveLength(3);
    // Its answer above what the company delegates now is held to the delegation, and the company's rule binds it.
    const push = within(table).getByRole("row", { name: /repository\.push/ });
    expect(within(push).getByText("mandatory")).toBeInTheDocument();
    expect(within(push).getByText("Mandatory: your rule binds the department.")).toBeInTheDocument();
    expect(within(push).getByText("Capped by the delegation")).toBeInTheDocument();
    expect(within(push).getAllByText("requires approval")).toHaveLength(3);
    // Not delegated: it may only narrow.
    const connector = within(table).getByRole("row", { name: /tool\.connector/ });
    expect(within(connector).getByText("Not delegated")).toBeInTheDocument();
    expect(within(connector).getByText("Not delegated: the department may only narrow it.")).toBeInTheDocument();
    // What it says nothing of, it inherits; what no employee may ever do is the deployment's.
    expect(within(within(table).getByRole("row", { name: /repository\.read/ })).getByText("Inherits")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /credential\.read_raw/ })).getByText("Never more for an employee: the deployment's ceiling.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Models its employees may run on" })).getByText("Any model the connection offers")).toBeInTheDocument();
    // Reading changes nothing.
    expect(nonGets(api)).toEqual([]);
  });

  test("a department with no policy of its own inherits the company's, and a draft starts from nothing of its own", async () => {
    const draft = departmentDraftView({ name: "Accounting policy", source: "default", basedOn: null, base: null });
    const api = fakeApi()
      .on("GET", POLICY, () => departmentPolicyOverview(null))
      .on("POST", `${POLICY}/revisions`, () => withStatus(201, draft))
      .on("GET", `${POLICY}/revisions/dpr-2`, () => draft);
    openDepartment();
    expect(await screen.findByText(/^Inherits the company's policy/)).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "What its employees may do" })).getAllByText("Inherits")).toHaveLength(ACTION_KINDS.length);
    expect(screen.getByText("No revision yet: the department inherits your policy.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start a draft" }));
    await waitFor(() => expect(nonGets(api)).toEqual([`POST ${POLICY}/revisions`]));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({});
    expect(await screen.findByRole("combobox", { name: "Department: tool.web" })).toBeEnabled();
  });

  test("its employees' network access and models are the company's with what the department sets, said where each comes from", async () => {
    const effective = departmentRevisionView({ document: departmentDocument({ employeeNetwork: { mode: "RESTRICTED", allow: ["docs.example.com"], limits: { bandwidthMbpsPerRun: 50 } }, employeeModels: { allow: [] } }) });
    fakeApi().on("GET", POLICY, () => departmentPolicyOverview(effective));
    openDepartment();
    const network = await screen.findByRole("region", { name: "Network access for its employees" });
    expect(within(network).getByText("restricted")).toBeInTheDocument();
    expect(within(network).getAllByText("set by the department")).toHaveLength(2);
    expect(within(network).getByText("docs.example.com")).toBeInTheDocument();
    expect(within(network).getByText("Bandwidth per run (Mbit/s): 50 (set by the department)")).toBeInTheDocument();
    // An empty list of models is none at all.
    expect(within(screen.getByRole("region", { name: "Models its employees may run on" })).getByText("None")).toBeInTheDocument();
  });

  test("a draft is edited as rows -- an answer within the delegation, its own network access and models -- and saved against the digest read", async () => {
    const draft = departmentDraftView();
    const api = fakeApi()
      .on("GET", POLICY, () => withDraft(draft))
      .on("GET", `${POLICY}/revisions/dpr-2`, () => draft)
      .on("PUT", `${POLICY}/revisions/dpr-2`, () => draft);
    openDepartment();
    await userEvent.click(await screen.findByRole("button", { name: "Accounting next" }));
    const web = await screen.findByRole("combobox", { name: "Department: tool.web" });
    // Delegated up to allowed: every answer. Not delegated: only narrower. Never an employee's: nothing to choose.
    expect(within(web).getAllByRole("option").map((o) => o.textContent)).toEqual(["Inherits yours: denied", "Allowed", "You approve first", "Denied"]);
    expect(within(screen.getByRole("combobox", { name: "Department: repository.read" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Inherits yours: allowed", "You approve first", "Denied"]);
    expect(screen.getByRole("combobox", { name: "Department: credential.read_raw" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await userEvent.selectOptions(web, "allow");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "RESTRICTED");
    await userEvent.click(screen.getByRole("checkbox", { name: /Its own list of hosts/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Host or domain to allow/ }), "docs.example.com{Enter}");
    await userEvent.type(screen.getByRole("spinbutton", { name: /Bandwidth per run/ }), "20");
    await userEvent.click(screen.getByRole("checkbox", { name: /Its own list of models/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Model \(runtime:model\)/ }), "claude:sonnet{Enter}");
    // What was not saved is not validated.
    expect(screen.getByRole("button", { name: "Validate" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(nonGets(api)).toEqual([`PUT ${POLICY}/revisions/dpr-2`]));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: DepartmentPolicy; expectedDigest: string };
    expect(sent.expectedDigest).toBe(DEPARTMENT_DRAFT_DIGEST);
    expect(sent.document).toEqual({
      ...departmentDocument(),
      rules: [{ id: "tool-web", action: "tool.web", effect: "allow" }],
      employeeNetwork: { mode: "RESTRICTED", allow: ["docs.example.com"], limits: { bandwidthMbpsPerRun: 20 } },
      employeeModels: { allow: ["claude:sonnet"] },
    });
  });

  test("runtime security: what holds its employees is said with where it comes from, and a draft may only raise it", async () => {
    const draft = departmentDraftView();
    const company = { mode: "observe" as const, controls: ["exec.shared-areas" as const] };
    const api = fakeApi()
      .on("GET", POLICY, () => ({ ...withDraft(draft), runtimeSecurity: { company, effective: { ...company, floor: "disabled" as const, from: { mode: "company" as const } } } }))
      .on("GET", `${POLICY}/revisions/dpr-2`, () => draft)
      .on("PUT", `${POLICY}/revisions/dpr-2`, () => draft);
    openDepartment();
    expect(await screen.findByText("observe, from your policy")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Accounting next" }));
    const mode = await screen.findByRole("combobox", { name: "Department: runtime security" });
    // Only higher than yours: inheriting yours, or enforce.
    expect(within(mode).getAllByRole("option").map((o) => o.textContent)).toEqual(["Inherits yours: observe", "enforce"]);
    const control = screen.getByRole("checkbox", { name: /No program runs from a shared area -- required by your policy/ });
    expect(control).toBeChecked();
    expect(control).toBeDisabled();
    await userEvent.selectOptions(mode, "enforce");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(nonGets(api)).toEqual([`PUT ${POLICY}/revisions/dpr-2`]));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: DepartmentPolicy };
    expect(sent.document).toEqual({ ...departmentDocument(), runtimeSecurity: { mode: "enforce" } });
  });

  test("validating a draft the company's delegation does not allow shows the API's own words and each problem it found", async () => {
    const problems = ['rules.web: the company lets a department give tool.web at most "require_approval"', "employeeNetwork.mode: the company lets a department choose at most RESTRICTED"];
    const draft = departmentDraftView();
    fakeApi()
      .on("GET", POLICY, () => withDraft(draft))
      .on("GET", `${POLICY}/revisions/dpr-2`, () => draft)
      .on("POST", `${POLICY}/revisions/dpr-2/validate`, () =>
        withStatus(422, { error: { code: "exceeds_delegation", message: `This draft goes beyond what the company lets the department decide: ${problems.join("; ")}`, details: { errors: problems } } }),
      );
    openDepartment();
    await userEvent.click(await screen.findByRole("button", { name: "Accounting next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Validate" }));
    expect(await screen.findByText("This draft goes beyond what the company lets the department decide:")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "What the API found" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(problems);
  });

  test("publishing confirms the digest read against the department's revision in effect AND the company's, at the risk acknowledged", async () => {
    const validated = departmentDraftView({ state: "VALIDATED", risk: "elevated", impact: ELEVATED });
    const api = fakeApi()
      .on("GET", POLICY, () => withDraft(validated))
      .on("GET", `${POLICY}/revisions/dpr-2`, () => validated)
      .on("POST", `${POLICY}/revisions/dpr-2/publish`, () => departmentDraftView({ state: "PUBLISHED", revision: 2, risk: "elevated", impact: null, base: null, publishedAt: "2026-11-21T11:00:00.000Z", publishedBy: OWNER }));
    openDepartment();
    await userEvent.click(await screen.findByRole("button", { name: "Accounting next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Review changes…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/^Publishing makes exactly this content Accounting's policy in effect at once, for its employees' work/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Compared with: revision 1, published/)).toBeInTheDocument();
    expect(within(dialog).getByText("Your policy read: revision 1")).toBeInTheDocument();
    expect(within(dialog).getByText(DEPARTMENT_DRAFT_DIGEST)).toBeInTheDocument();
    expect(within(dialog).getByText("It lets the department's employees use the web tools.")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Confirm and publish" });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "I have read what it changes and accept its elevated risk" }));
    await userEvent.click(confirm);
    await waitFor(() => expect(nonGets(api)).toEqual([`POST ${POLICY}/revisions/dpr-2/publish`]));
    const publish = api.calls.find((c) => c.method === "POST");
    expect(publish?.body).toEqual({ digest: DEPARTMENT_DRAFT_DIGEST, base: "dpr-1", companyBase: "rev-1", acknowledgedRisk: "elevated" });
    expect(publish?.headers["x-orbit-csrf"]).toBe(CSRF);
    expect(await screen.findByText("revision 2")).toBeInTheDocument();
  });

  test("a publication refused because the company's policy moved since says so, and offers to read everything again", async () => {
    const stale = "The company's policy changed since you read this: what the department may say may have changed too. Read it again.";
    const validated = departmentDraftView({ state: "VALIDATED", risk: "low", impact: LOW });
    const api = fakeApi()
      .on("GET", POLICY, () => withDraft(validated))
      .on("GET", `${POLICY}/revisions/dpr-2`, () => validated)
      .on("POST", `${POLICY}/revisions/dpr-2/publish`, () => withStatus(409, { error: { code: "stale_company_policy", message: stale, details: { risk: "low", base: "dpr-1", companyBase: "rev-2" } } }));
    openDepartment();
    await userEvent.click(await screen.findByRole("button", { name: "Accounting next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Review changes…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm and publish" }));
    expect(await within(dialog).findByText(stale)).toBeInTheDocument();
    const reads = () => api.calls.filter((c) => c.method === "GET" && (c.path === POLICY || c.path === `${POLICY}/revisions/dpr-2`)).length;
    const before = reads();
    await userEvent.click(within(dialog).getByRole("button", { name: "Read it again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(reads()).toBe(before + 2));
    expect(nonGets(api)).toEqual([`POST ${POLICY}/revisions/dpr-2/publish`]);
  });

  test("a rollback is a new draft copied from an earlier revision, taken through the lifecycle again", async () => {
    const current = departmentRevisionView({ revision: 2 });
    const older = departmentRevisionView({ id: "dpr-0", revision: 1, state: "SUPERSEDED", name: "Accounting first" });
    const copy = departmentDraftView({ id: "dpr-3", name: "Accounting first", basedOn: "dpr-0" });
    const api = fakeApi()
      .on("GET", POLICY, () => departmentPolicyOverview(current, [revisionSummary(current), revisionSummary(older)]))
      .on("POST", `${POLICY}/revisions`, () => withStatus(201, copy))
      .on("GET", `${POLICY}/revisions/dpr-3`, () => copy);
    openDepartment();
    await userEvent.click(await screen.findByRole("button", { name: "Roll back to this" }));
    await waitFor(() => expect(nonGets(api)).toEqual([`POST ${POLICY}/revisions`]));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ from: "dpr-0" });
    // The copy opens as a draft, to be validated and published like any other.
    expect(await screen.findByRole("button", { name: "Validate" })).toBeEnabled();
  });

  test("simulating asks as one of the department's employees, of its policy in effect: the same evaluate() every decision uses", async () => {
    const api = fakeApi()
      .on("GET", POLICY, () => departmentPolicyOverview(departmentRevisionView()))
      .on("POST", `${POLICY}/simulate`, () => ({ revisionId: "dpr-1", revision: 1, evaluation: { verdict: "allow", matchedRules: [`department:${DEPARTMENT_ID}:web`], reasonCodes: ["DEPARTMENT_DECIDED"], enforcement: "runtime" } }));
    openDepartment();
    expect(await screen.findByText(/the same evaluate\(\) every decision is made by/)).toBeInTheDocument();
    // Who asks is not a choice: one of its employees.
    expect(screen.queryByRole("combobox", { name: "Who" })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Action" }), "tool.web");
    await userEvent.type(screen.getByRole("textbox", { name: "Resource" }), "docs.example.com");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "staging");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(nonGets(api)).toEqual([`POST ${POLICY}/simulate`]));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ request: { principalType: "agent", action: "tool.web", resource: "docs.example.com", environment: "staging", workspaceId: null, researchWorkspaceId: null } });
    const result = await screen.findByLabelText("Simulated decision");
    expect(within(result).getByText("allow")).toBeInTheDocument();
    expect(within(result).getByText(`DEPARTMENT_DECIDED · department:${DEPARTMENT_ID}:web`)).toBeInTheDocument();
  });

  test("on a phone its rows are cards: nothing on the page is a table", async () => {
    mobileViewport();
    fakeApi().on("GET", POLICY, () => departmentPolicyOverview(departmentRevisionView({ document: departmentDocument({ rules: [{ id: "web", action: "tool.web", effect: "allow" }] }) })));
    openDepartment();
    const list = await screen.findByRole("list", { name: "What its employees may do" });
    expect(screen.queryByRole("table")).toBeNull();
    const web = within(list)
      .getAllByRole("listitem")
      .find((li) => within(li).queryByText("tool.web") !== null) as HTMLElement;
    expect(within(web).getAllByText("allow")).toHaveLength(3);
    expect(within(web).getByText("default")).toBeInTheDocument();
  });
});

describe("Governance → Policy: what the company delegates to its departments", () => {
  const companyDraft = (document: unknown) => {
    const draft = draftView({ document });
    const api = fakeApi()
      .on("GET", "/api/governance/policy", () => ({ effective: revisionView(), revisions: [revisionSummary({ ...draft, revision: null }), revisionSummary()] }))
      .on("GET", "/api/governance/revisions/rev-2", () => draft)
      .on("PUT", "/api/governance/revisions/rev-2", () => draft);
    renderLive(<GovernanceView page="policy" item="rev-2" go={vi.fn()} account={ACCOUNT} />);
    return { api, draft };
  };

  test("each rule of the table binds every department or is the company's default for an action it delegates", async () => {
    const { api } = companyDraft(delegatingPolicy());
    const web = await screen.findByRole("combobox", { name: "Binding: tool.web" });
    expect(web).toHaveValue("default");
    const push = screen.getByRole("combobox", { name: "Binding: repository.push" });
    expect(push).toHaveValue("mandatory");
    await userEvent.selectOptions(push, "default");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: AccountPolicy; expectedDigest: string };
    expect(sent.expectedDigest).toBe(DRAFT_DIGEST);
    expect(sent.document.rules.find((r) => r.id === "git-push")).toEqual({ id: "git-push", action: "repository.push", effect: "require_approval", binding: "default" });
    expect(sent.document.rules.find((r) => r.id === "web-tools")).toEqual({ id: "web-tools", action: "tool.web", effect: "deny", binding: "default" });
  });

  test("a published policy says each rule's binding in words, and nothing of it can be chosen", async () => {
    fakeApi().on("GET", "/api/governance/policy", () => ({ effective: revisionView({ document: delegatingPolicy() }), revisions: [revisionSummary()] }));
    renderLive(<GovernanceView page="policy" item={null} go={vi.fn()} account={ACCOUNT} />);
    const table = await screen.findByRole("table", { name: "What may happen" });
    expect(within(table).getByRole("columnheader", { name: "Binding" })).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /tool\.web/ })).getByText("default")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /repository\.push/ })).getByText("mandatory")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Binding:/ })).toBeNull();
    const delegation = screen.getByRole("region", { name: "Delegation to departments" });
    expect(within(delegation).getByText("tool.web")).toBeInTheDocument();
    expect(within(delegation).getByText("Up to allowed")).toBeInTheDocument();
    expect(within(delegation).queryByRole("button", { name: "Delegate" })).toBeNull();
  });

  test("a draft delegates an action up to an answer, network access within hosts and limits, and models -- and keeps the rest of its document as it was", async () => {
    const { api, draft } = companyDraft(revisionView().document);
    const section = await screen.findByRole("region", { name: "Delegation to departments" });
    expect(within(section).getByText("Nothing is delegated: a department may only narrow what your policy says.")).toBeInTheDocument();
    await userEvent.selectOptions(within(section).getByRole("combobox", { name: "Delegate another action" }), "tool.web");
    await userEvent.click(within(section).getByRole("button", { name: "Delegate" }));
    const cap = within(section).getByRole("combobox", { name: "Loosest a department may give: tool.web" });
    expect(cap).toHaveValue("allow");
    await userEvent.selectOptions(cap, "require_approval");
    await userEvent.selectOptions(within(section).getByRole("combobox", { name: "The loosest mode a department may choose" }), "RESTRICTED");
    await userEvent.click(within(section).getByRole("checkbox", { name: "A department may list any public host" }));
    await userEvent.type(within(section).getByRole("textbox", { name: /Host or domain to allow/ }), "*.example.com{Enter}");
    await userEvent.type(within(section).getByRole("spinbutton", { name: /Bandwidth per run/ }), "100");
    await userEvent.click(within(section).getByRole("checkbox", { name: "A department may choose any model your policy allows" }));
    await userEvent.type(within(section).getByRole("textbox", { name: /Model \(runtime:model\)/ }), "claude:sonnet{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: AccountPolicy; expectedDigest: string };
    expect(sent.document.delegation).toEqual({
      departments: {
        actions: { "tool.web": "require_approval" },
        employeeNetwork: { mode: "RESTRICTED", allowWithin: ["*.example.com"], limits: { bandwidthMbpsPerRun: 100 } },
        models: { allow: ["claude:sonnet"] },
      },
    });
    const { delegation: _delegation, ...rest } = sent.document;
    expect(rest).toEqual(draft.document);
  });

  test("the company's simulation may ask as one of its employees: the department and the employee go in the request, as an assignment's", async () => {
    const api = fakeApi()
      .on("GET", "/api/governance/policy", () => ({ effective: revisionView(), revisions: [revisionSummary()] }))
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", "/api/governance/simulate", () => ({ revisionId: "rev-1", revision: 1, evaluation: { verdict: "require_approval", matchedRules: ["account:git-push"], reasonCodes: ["RULE_MATCHED"], enforcement: "boundary" } }));
    renderLive(<GovernanceView page="policy" item={null} go={vi.fn()} account={ACCOUNT} />);
    const employee = await screen.findByRole("combobox", { name: "As the employee (optional)" });
    const departmentSelect = screen.getByRole("combobox", { name: "As an employee of (optional)" });
    await userEvent.selectOptions(employee, EMP_ANA);
    // An employee's work is asked in its own department, and as an agent.
    expect(departmentSelect).toHaveValue(DEPT_ACCOUNTING);
    expect(screen.getByRole("combobox", { name: "Who" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    const base = { principalType: "agent", action: "repository.push", resource: "", environment: "development", workspaceId: null, researchWorkspaceId: null };
    expect(api.calls.filter((c) => c.method === "POST")[0]?.body).toEqual({ request: { ...base, runKind: "assignment", departmentId: DEPT_ACCOUNTING, employeeId: EMP_ANA } });
    // A department alone asks as any of its employees.
    await userEvent.selectOptions(employee, "");
    await userEvent.selectOptions(departmentSelect, DEPT_LEGAL);
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(api.calls.filter((c) => c.method === "POST")[1]?.body).toEqual({ request: { ...base, runKind: "assignment", departmentId: DEPT_LEGAL, employeeId: null } });
  });
});
