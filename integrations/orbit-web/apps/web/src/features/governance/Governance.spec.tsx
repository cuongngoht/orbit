import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { GovernanceOverview, RevisionView } from "@orbit-web/contracts";
import { defaultConstitution, type Constitution } from "@orbit-web/governance-core";
import { resetOperatorStore } from "../../services/operator";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { approval, CSRF, FINGERPRINT, governanceState, ORG } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { GovernanceView } from "./GovernanceView";

const overview = (): GovernanceOverview => ({
  organization: ORG,
  effective: { id: "rev-1", revision: 1, digest: "d".repeat(64), publishedAt: "2026-11-20T10:00:00.000Z" },
  counts: { operators: 2, agents: 1, governedWorkspaces: 1, pendingApprovals: 1, openFindings: 0, revisionsInReview: 0 },
  isolation: { deployment: "single", state: "not_proven", checkedAt: null, checks: [], detail: "Claude Code runs in this container as this container's user." },
  audit: { count: 12, head: "h".repeat(64), lastVerification: null },
});

const revision = (over: Partial<RevisionView> = {}): RevisionView => ({
  id: "rev-2",
  revision: null,
  state: "APPROVED",
  digest: "e".repeat(64),
  name: "default",
  risk: "high",
  source: "copy",
  basedOn: "rev-1",
  createdAt: "2026-11-20T10:00:00.000Z",
  createdBy: "op-2",
  updatedAt: "2026-11-20T10:05:00.000Z",
  publishedAt: null,
  document: { apiVersion: "orbit.governance/v1", kind: "CompanyConstitution", metadata: { organizationId: ORG.id, name: "default" }, defaults: { decision: "deny" }, obligations: { auditDecisions: "all", dailyReport: true, isolation: "optional" }, rules: [] },
  errors: [],
  warnings: [],
  impact: { risk: "high", widened: [], narrowed: [], obligations: [{ field: "isolation", before: "required", after: "optional", weakened: true }], rules: [], reasons: ["It weakens isolation from required to optional."] },
  authors: ["op-2"],
  history: [],
  ...over,
});

beforeEach(() => resetOperatorStore());

describe("the Governance console", () => {
  test("before an owner exists it enrols one with the code from Orbit Web's log -- and shows nothing else", async () => {
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("uninitialized"))
      .on("POST", "/api/operator/bootstrap", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/overview", overview);
    renderLive(<GovernanceView page="overview" item={null} go={vi.fn()} />);
    const form = await screen.findByRole("form", { name: "Enrol the first owner" });
    // Where the code is, said as a command that works from any folder.
    expect(within(form).getByText("docker logs orbit-web")).toBeTruthy();
    await userEvent.type(within(form).getByLabelText(/One-time code/), "abcd-ef01");
    await userEvent.type(within(form).getByLabelText(/Organization/), "Acme");
    await userEvent.type(within(form).getByLabelText(/Your username/), "owner");
    await userEvent.type(within(form).getByLabelText(/^Password/), "correct horse battery");
    await userEvent.click(within(form).getByRole("button", { name: "Enrol as owner" }));
    await screen.findByText("Constitution in effect");
    expect(api.calls.find((c) => c.path === "/api/operator/bootstrap")?.body).toEqual({ code: "abcd-ef01", organizationName: "Acme", username: "owner", displayName: "owner", password: "correct horse battery" });
  });

  test("an operator signs in with their own credential: the Claude account is not one", async () => {
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("none"))
      .on("POST", "/api/operator/login", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/overview", overview);
    renderLive(<GovernanceView page="overview" item={null} go={vi.fn()} />);
    const form = await screen.findByRole("form", { name: "Operator sign-in" });
    expect(within(form).getByText(/the Claude account this Orbit Web uses is not one/)).toBeTruthy();
    await userEvent.type(within(form).getByLabelText(/Username/), "owner");
    await userEvent.type(within(form).getByLabelText(/Password/), "correct horse battery");
    await userEvent.click(within(form).getByRole("button", { name: "Sign in" }));
    await screen.findByText(/isolation/i);
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/api/operator/login"]);
    expect(screen.getByText(/not proven/)).toBeTruthy();
  });

  test("every change an operator makes carries the session's CSRF token; approving binds the fingerprint shown", async () => {
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/approvals", () => ({ approvals: [approval()] }))
      .on("POST", "/api/governance/approvals/apr-1/grant", () => approval({ state: "consumed", outcome: "pushed aaaaaaaaaaaa to orbit-web/0b6c2f5e" }));
    renderLive(<GovernanceView page="approvals" item={null} go={vi.fn()} />);
    expect(await screen.findByText(FINGERPRINT)).toBeTruthy();
    expect(screen.getByText(/1 commit\(s\) · 1 file\(s\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(new RegExp(FINGERPRINT)).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and push" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/governance/approvals/apr-1/grant")).toBe(true));
    const grant = api.calls.find((c) => c.path === "/api/governance/approvals/apr-1/grant");
    expect(grant?.body).toEqual({ fingerprint: FINGERPRINT });
    expect(grant?.headers["x-orbit-operator-csrf"]).toBe(CSRF);
  });

  test("an auditor reads the evidence and is offered nothing that changes it", async () => {
    fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("auditor"))
      .on("GET", "/api/governance/approvals", () => ({ approvals: [approval()] }))
      .on("GET", "/api/governance/constitution", () => ({ effective: revision({ id: "rev-1", state: "PUBLISHED", revision: 1 }), revisions: [revision({ id: "rev-1", state: "PUBLISHED", revision: 1 })] }));
    const { unmount } = renderLive(<GovernanceView page="approvals" item={null} go={vi.fn()} />);
    expect(await screen.findByText(FINGERPRINT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    unmount();
    renderLive(<GovernanceView page="constitution" item={null} go={vi.fn()} />);
    await screen.findByText("Revisions");
    expect(screen.queryByRole("button", { name: /New draft|Start from/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish|Save draft|Validate/ })).toBeNull();
  });

  test("publishing shows what it changes, and names the digest that was read", async () => {
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/constitution", () => ({ effective: null, revisions: [revision()] }))
      .on("GET", "/api/governance/revisions/rev-2", () => revision())
      .on("POST", "/api/governance/revisions/rev-2/publish", () => revision({ state: "PUBLISHED", revision: 2 }));
    renderLive(<GovernanceView page="constitution" item="rev-2" go={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Publish…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/It weakens isolation from required to optional/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/governance/revisions/rev-2/publish")?.body).toEqual({ digest: "e".repeat(64) }));
  });

  test("the Constitution is a table: a tick changes that action's own rule, a host is added to the list, and Save draft sends it", async () => {
    const draft = revision({ state: "DRAFT", risk: null, impact: null, document: defaultConstitution(ORG.id) });
    const api = fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/constitution", () => ({ effective: null, revisions: [draft] }))
      .on("GET", "/api/governance/revisions/rev-2", () => draft)
      .on("PUT", "/api/governance/revisions/rev-2", () => draft);
    renderLive(<GovernanceView page="constitution" item="rev-2" go={vi.fn()} />);
    const webTools = await screen.findByRole("checkbox", { name: "Allowed: tool.web" });
    expect((webTools as HTMLInputElement).checked).toBe(false);
    // What nobody may ever be granted cannot be ticked.
    expect((screen.getByRole("checkbox", { name: "Allowed: credential.read_raw" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Allowed: deployment.production" }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(webTools);
    await userEvent.click(screen.getByRole("checkbox", { name: "A person approves first: governance.role.grant" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Host to allow" }), "Registry.npmjs.org:443");
    await userEvent.click(screen.getByRole("button", { name: "Add host" }));
    expect(within(screen.getByLabelText("Hosts the agent may reach")).getByText("registry.npmjs.org:443")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const sent = api.calls.find((c) => c.method === "PUT")?.body as { document: Constitution; expectedDigest: string };
    expect(sent.expectedDigest).toBe("e".repeat(64));
    const rules = sent.document.rules;
    expect(rules.find((r) => r.id === "web-tools")).toEqual({ id: "web-tools", action: "tool.web", effect: "allow" });
    expect(rules.find((r) => r.action === "governance.role.grant" && r.principalType === undefined)).toEqual({ id: "governance-role-grant", action: "governance.role.grant", effect: "require_approval" });
    expect(rules.find((r) => r.resource === "registry.npmjs.org:443")).toEqual({ id: "egress-registry-npmjs-org-443", action: "network.egress", resource: "registry.npmjs.org:443", effect: "allow" });
    // The rest is kept as it was: the rules the table does not show, and Claude Code's own hosts.
    expect(rules.filter((r) => r.id === "privileged-settings" || r.id === "modify-governance")).toHaveLength(2);
    expect(rules.filter((r) => r.action === "network.egress").map((r) => r.resource)).toEqual(["api.anthropic.com:443", "platform.claude.com:443", "claude.ai:443", "registry.npmjs.org:443"]);
  });

  test("a published revision's table is read only", async () => {
    const published = revision({ id: "rev-1", state: "PUBLISHED", revision: 1, document: defaultConstitution(ORG.id) });
    fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/constitution", () => ({ effective: published, revisions: [published] }))
      .on("GET", "/api/governance/revisions/rev-1", () => published);
    renderLive(<GovernanceView page="constitution" item="rev-1" go={vi.fn()} />);
    expect(((await screen.findByRole("checkbox", { name: "Allowed: workspace.execute" })) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Allowed: workspace.execute" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Add host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  test("the table is the whole Constitution: no JSON view, and a revision it cannot show offers nothing to save", async () => {
    const broken = revision({ state: "DRAFT", risk: null, impact: null, document: { apiVersion: "orbit.governance/v1" } as unknown as Constitution });
    fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/constitution", () => ({ effective: null, revisions: [broken] }))
      .on("GET", "/api/governance/revisions/rev-2", () => broken);
    renderLive(<GovernanceView page="constitution" item="rev-2" go={vi.fn()} />);
    expect(await screen.findByText(/This revision cannot be shown/)).toBeTruthy();
    expect(screen.queryByText(/as JSON/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Document/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  test("a refusal from the API is said as it is", async () => {
    fakeApi()
      .on("GET", "/api/operator/state", () => governanceState("organization_owner"))
      .on("GET", "/api/governance/overview", () => withStatus(403, { error: { code: "permission_required", message: "This needs the governance.read permission." } }));
    renderLive(<GovernanceView page="overview" item={null} go={vi.fn()} />);
    expect(await screen.findByText("This needs the governance.read permission.")).toBeTruthy();
  });
});
