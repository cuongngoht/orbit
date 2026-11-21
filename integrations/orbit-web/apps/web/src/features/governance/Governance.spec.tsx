import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountPolicy, Impact, Rule } from "@orbit-web/governance-core";
import type { RevisionView } from "@orbit-web/contracts";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import {
  ACCOUNT_ID,
  approval,
  browserSession,
  CSRF,
  DRAFT_DIGEST,
  draftView,
  FINGERPRINT,
  governanceOverview,
  overrideView,
  RESEARCH_WORKSPACE_ID,
  resourceSummary,
  resourceView,
  revisionSummary,
  revisionView,
  WORKSPACE_ID,
} from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { GovernanceView } from "./GovernanceView";

const ACCOUNT = { displayName: "Octo & Co", email: "octo@example.com" };

const HIGH: Impact = { risk: "high", widened: [], narrowed: [], obligations: [{ field: "isolation", before: "required", after: "optional", weakened: true }], rules: [], reasons: ["It weakens isolation from required to optional."] };

const LOW: Impact = {
  risk: "low",
  widened: [],
  narrowed: [{ action: "tool.web", principalType: "agent", resource: "*", environments: ["local", "test", "development", "staging", "production", "unknown"], before: "allow", after: "deny", sensitive: true }],
  obligations: [],
  rules: [{ id: "web-tools", change: "changed", before: { id: "web-tools", action: "tool.web", effect: "allow" }, after: { id: "web-tools", action: "tool.web", effect: "deny" } }],
  reasons: [],
};

// The account's policy: the default in effect (revision 1) and the draft `rev-2` beside it.
const policyOverview = (draft: RevisionView) => ({ effective: revisionView(), revisions: [revisionSummary({ ...draft, revision: null }), revisionSummary()] });

const nonGets = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);

beforeEach(() => rememberSession(browserSession()));
afterEach(() => rememberSession(null));

describe("the account's governance", () => {
  test("opens with the sign-in itself: no second sign-in, the account in the header, and the deployment's isolation said as it is", async () => {
    const api = fakeApi().on("GET", "/api/governance/overview", () => governanceOverview({ account: { id: ACCOUNT_ID, ...ACCOUNT } }));
    renderLive(<GovernanceView page="overview" item={null} go={vi.fn()} account={ACCOUNT} />);
    expect(await screen.findByText("Policy in effect")).toBeInTheDocument();
    expect(screen.getByText("Octo & Co")).toBeInTheDocument();
    expect(screen.getByText(/Revision 1, published/)).toBeInTheDocument();
    expect(screen.getByText(/Single-container deployment/)).toBeInTheDocument();
    expect(screen.getByText("not proven")).toBeInTheDocument();
    // One sign-in: nothing here asks for a password, names an operator, or calls a single word "isolated".
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/operator/i);
    expect(document.body.textContent).not.toMatch(/\bisolated\b/i);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/governance/overview"]);
  });

  test("its pages are the account's own: policy, workspaces, research, approvals, decisions, audit, findings, reports", async () => {
    fakeApi().on("GET", "/api/governance/overview", () => governanceOverview());
    const go = vi.fn();
    renderLive(<GovernanceView page="overview" item={null} go={go} account={ACCOUNT} />);
    const nav = screen.getByRole("navigation", { name: "Governance" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Overview", "Policy", "Workspaces", "Research", "Approvals", "Decisions", "Audit timeline", "Security findings", "Daily reports"]);
    await userEvent.click(await screen.findByRole("button", { name: /Research workspaces/ }));
    expect(go).toHaveBeenCalledWith("research");
  });

  test("a policy is published by validate, review and confirm: the confirmation names the digest read, the base compared with and the risk acknowledged", async () => {
    let current = draftView();
    const api = fakeApi()
      .on("GET", "/api/governance/policy", () => policyOverview(current))
      .on("GET", "/api/governance/revisions/rev-2", () => current)
      .on("POST", "/api/governance/revisions/rev-2/validate", () => (current = draftView({ state: "VALIDATED", risk: "high", impact: HIGH })))
      .on("POST", "/api/governance/revisions/rev-2/publish", () => (current = draftView({ state: "PUBLISHED", revision: 2, risk: "high", impact: null, base: null, publishedAt: "2026-11-20T12:00:00.000Z", publishedBy: `owner:${ACCOUNT_ID}` })));
    renderLive(<GovernanceView page="policy" item="rev-2" go={vi.fn()} account={ACCOUNT} />);
    await userEvent.click(await screen.findByRole("button", { name: "Validate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Review changes…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("It weakens isolation from required to optional.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Compared with: revision 1, published/)).toBeInTheDocument();
    expect(within(dialog).getByText(DRAFT_DIGEST)).toBeInTheDocument();
    // The owner confirms: nobody else approves, and a high risk is confirmed only once it is acknowledged.
    expect(within(dialog).queryByRole("button", { name: /Approve/ })).toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "Confirm and publish" });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "I have read what it changes and accept its high risk" }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(nonGets(api)).toEqual(["POST /api/governance/revisions/rev-2/validate", "POST /api/governance/revisions/rev-2/publish"]));
    const publish = api.calls.find((c) => c.path === "/api/governance/revisions/rev-2/publish");
    expect(publish?.body).toEqual({ digest: DRAFT_DIGEST, base: "rev-1", acknowledgedRisk: "high" });
    expect(publish?.headers["x-orbit-csrf"]).toBe(CSRF);
    expect(await screen.findByText("revision 2")).toBeInTheDocument();
  });

  test("a low-risk change is confirmed at its own risk, with nothing to acknowledge", async () => {
    const validated = draftView({ state: "VALIDATED", risk: "low", impact: LOW });
    const api = fakeApi()
      .on("GET", "/api/governance/policy", () => policyOverview(validated))
      .on("GET", "/api/governance/revisions/rev-2", () => validated)
      .on("POST", "/api/governance/revisions/rev-2/publish", () => draftView({ state: "PUBLISHED", revision: 2 }));
    renderLive(<GovernanceView page="policy" item="rev-2" go={vi.fn()} account={ACCOUNT} />);
    await userEvent.click(await screen.findByRole("button", { name: "Review changes…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("table", { name: "What it narrows" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm and publish" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ digest: DRAFT_DIGEST, base: "rev-1", acknowledgedRisk: "low" }));
  });

  test("the policy is a table: a tick changes that action's own rule, a host is added to the list, and Save draft sends it against the digest read", async () => {
    const draft = draftView();
    const api = fakeApi()
      .on("GET", "/api/governance/policy", () => policyOverview(draft))
      .on("GET", "/api/governance/revisions/rev-2", () => draft)
      .on("PUT", "/api/governance/revisions/rev-2", () => draft);
    renderLive(<GovernanceView page="policy" item="rev-2" go={vi.fn()} account={ACCOUNT} />);
    const webTools = await screen.findByRole("checkbox", { name: "Allowed: tool.web" });
    expect(webTools).not.toBeChecked();
    // What nobody may ever be granted cannot be ticked.
    expect(screen.getByRole("checkbox", { name: "Allowed: credential.read_raw" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Allowed: deployment.production" })).toBeDisabled();
    // Git is one row the policy decides for an agent too: its boxes can be ticked, and it says what Allowed means.
    expect(screen.getByRole("checkbox", { name: "You approve first: repository.push" })).toBeEnabled();
    expect(screen.getByText(/Allowed alone: the agent pushes the chat's own branch itself, at once/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await userEvent.click(webTools);
    await userEvent.click(screen.getByRole("checkbox", { name: "You approve first: tool.connector" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Host to allow" }), "Registry.npmjs.org:443");
    await userEvent.click(screen.getByRole("button", { name: "Add host" }));
    expect(within(screen.getByLabelText("Hosts the agent may reach")).getByText("registry.npmjs.org:443")).toBeInTheDocument();
    // What was not saved is not validated.
    expect(screen.getByRole("button", { name: "Validate" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: AccountPolicy; expectedDigest: string };
    expect(sent.expectedDigest).toBe(DRAFT_DIGEST);
    const rules = sent.document.rules;
    expect(rules.find((r) => r.id === "web-tools")).toEqual({ id: "web-tools", action: "tool.web", effect: "allow" });
    expect(rules.find((r) => r.id === "connectors")).toEqual({ id: "connectors", action: "tool.connector", effect: "require_approval" });
    expect(rules.find((r) => r.resource === "registry.npmjs.org:443")).toEqual({ id: "egress-registry-npmjs-org-443", action: "network.egress", resource: "registry.npmjs.org:443", effect: "allow" });
    // The rest is kept as it was: the rules the table does not show, and Claude Code's own hosts.
    expect(rules.filter((r) => r.id === "privileged-settings" || r.id === "modify-governance")).toHaveLength(2);
    expect(rules.filter((r) => r.action === "network.egress").map((r) => r.resource)).toEqual(["api.anthropic.com:443", "platform.claude.com:443", "claude.ai:443", "registry.npmjs.org:443"]);
    expect(sent.document.metadata.accountId).toBe(ACCOUNT_ID);
  });

  test("the policy in effect is read only and offers no step of the lifecycle", async () => {
    fakeApi().on("GET", "/api/governance/policy", () => ({ effective: revisionView(), revisions: [revisionSummary()] }));
    renderLive(<GovernanceView page="policy" item={null} go={vi.fn()} account={ACCOUNT} />);
    const execute = await screen.findByRole("checkbox", { name: "Allowed: workspace.execute" });
    expect(execute).toBeChecked();
    expect(execute).toBeDisabled();
    expect(screen.getByText(/Read only: a published revision never changes/)).toBeInTheDocument();
    for (const name of ["Add host", "Save draft", "Validate", "Review changes…", "Discard"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  test("a draft an agent handed in waits for the owner like any other, and one the table cannot show offers nothing to save", async () => {
    const proposal = draftView({ source: "agent", authors: ["agent:agt-1"], document: { apiVersion: "orbit.governance/v2" } });
    fakeApi()
      .on("GET", "/api/governance/policy", () => policyOverview(proposal))
      .on("GET", "/api/governance/revisions/rev-2", () => proposal);
    renderLive(<GovernanceView page="policy" item="rev-2" go={vi.fn()} account={ACCOUNT} />);
    expect(await screen.findByText(/An agent handed in this draft. Nothing in it is in effect/)).toBeInTheDocument();
    expect(screen.getByText(/This revision cannot be shown/)).toBeInTheDocument();
    expect(screen.queryByText(/as JSON/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Document/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  test("Workspaces and Research list the account's own -- a deleted one stays listed as deleted -- and a row opens its governance", async () => {
    fakeApi()
      .on("GET", "/api/governance/workspaces", () => ({ resources: [resourceSummary("workspace", { overridden: true, runningRuns: 1, pendingApprovals: 1 }), resourceSummary("workspace", { id: "ws-old", title: "Old chat", deletedAt: "2026-11-20T00:00:00.000Z" })] }))
      .on("GET", "/api/governance/research", () => ({ resources: [resourceSummary("research_workspace")] }));
    const go = vi.fn();
    const { unmount } = renderLive(<GovernanceView page="workspaces" item={null} go={go} account={ACCOUNT} />);
    const list = await screen.findByRole("list", { name: "Workspaces" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("overridden")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("1 running · 1 waiting for you")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("deleted")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Fix sum" }));
    expect(go).toHaveBeenCalledWith("workspaces", WORKSPACE_ID);
    unmount();
    renderLive(<GovernanceView page="research" item={null} go={go} account={ACCOUNT} />);
    await userEvent.click(await screen.findByRole("button", { name: "Market study" }));
    expect(go).toHaveBeenCalledWith("research", RESEARCH_WORKSPACE_ID);
  });

  test("an override narrows one chat and never widens it: it sends rules that only narrow, says an allow in it changes nothing, and can be removed", async () => {
    let current = resourceView("workspace", { overridden: true, override: overrideView([{ id: "web-allow", action: "tool.web", effect: "allow" }]) });
    const api = fakeApi()
      .on("GET", `/api/governance/workspaces/${WORKSPACE_ID}`, () => current)
      .on("PUT", `/api/governance/workspaces/${WORKSPACE_ID}/override`, (body) => (current = resourceView("workspace", { overridden: true, override: overrideView((body as { rules: Rule[] }).rules, { digest: "c2".repeat(32) }) })))
      .on("DELETE", `/api/governance/workspaces/${WORKSPACE_ID}/override`, () => {
        current = resourceView("workspace");
        return undefined;
      });
    renderLive(<GovernanceView page="workspaces" item={WORKSPACE_ID} go={vi.fn()} account={ACCOUNT} />);
    expect(await screen.findByText(/Revision 1 of your policy/)).toBeInTheDocument();
    expect(screen.getByText(/An override only narrows: an allow rule in it changes nothing/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Rules these rows do not show" })).getByText(/changes nothing/)).toBeInTheDocument();
    const web = screen.getByRole("combobox", { name: "In this chat: tool.web" });
    // There is nothing to allow here: an override only narrows.
    expect(within(web).getAllByRole("option").map((o) => o.textContent)).toEqual(["As your policy says", "You approve first", "Denied"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "In this chat: repository.write" }), "deny");
    await userEvent.selectOptions(web, "require_approval");
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = api.calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({
      rules: [
        { id: "web-allow", action: "tool.web", effect: "allow" },
        { id: "repository-write", action: "repository.write", effect: "deny" },
        { id: "tool-web", action: "tool.web", effect: "require_approval" },
      ],
    });
    expect(put?.headers["x-orbit-csrf"]).toBe(CSRF);
    await userEvent.click(await screen.findByRole("button", { name: "Remove override" }));
    await waitFor(() => expect(nonGets(api)).toEqual([`PUT /api/governance/workspaces/${WORKSPACE_ID}/override`, `DELETE /api/governance/workspaces/${WORKSPACE_ID}/override`]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove override" })).toBeNull());
  });

  test("a deleted research workspace's governance stays readable, and its override cannot change", async () => {
    const gone = resourceView("research_workspace", { deletedAt: "2026-11-20T00:00:00.000Z", overridden: true, override: overrideView([{ id: "deny-web", action: "tool.web", effect: "deny" }], { kind: "research_workspace", resourceId: RESEARCH_WORKSPACE_ID }) });
    fakeApi().on("GET", `/api/governance/research/${RESEARCH_WORKSPACE_ID}`, () => gone);
    renderLive(<GovernanceView page="research" item={RESEARCH_WORKSPACE_ID} go={vi.fn()} account={ACCOUNT} />);
    expect(await screen.findByText(/It was deleted: nothing runs there to narrow/)).toBeInTheDocument();
    const web = screen.getByRole("combobox", { name: "In this research workspace: tool.web" });
    expect(web).toHaveValue("deny");
    expect(web).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save override" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove override" })).toBeNull();
  });

  test("the owner approves a protected action: approving binds the fingerprint shown, with this browser session's CSRF token", async () => {
    const api = fakeApi()
      .on("GET", "/api/governance/approvals", () => ({ approvals: [approval()] }))
      .on("POST", "/api/governance/approvals/apr-1/grant", () => approval({ state: "consumed", outcome: "pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e" }));
    renderLive(<GovernanceView page="approvals" item={null} go={vi.fn()} account={ACCOUNT} />);
    expect(await screen.findByText(FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText(/by an agent \(agt-1\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 commit\(s\) · 1 file\(s\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(new RegExp(FINGERPRINT)).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and push" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/governance/approvals/apr-1/grant")).toBe(true));
    const grant = api.calls.find((c) => c.path === "/api/governance/approvals/apr-1/grant");
    expect(grant?.body).toEqual({ fingerprint: FINGERPRINT });
    expect(grant?.headers["x-orbit-csrf"]).toBe(CSRF);
    expect(grant?.headers["x-orbit-web"]).toBe("1");
  });

  test("a refusal from the API is said as it is", async () => {
    fakeApi().on("GET", "/api/governance/overview", () => withStatus(401, { error: { code: "claude_sign_in_required", message: "Sign in with Claude to continue." } }));
    renderLive(<GovernanceView page="overview" item={null} go={vi.fn()} account={ACCOUNT} />);
    expect(await screen.findByText("Sign in with Claude to continue.")).toBeInTheDocument();
  });
});
