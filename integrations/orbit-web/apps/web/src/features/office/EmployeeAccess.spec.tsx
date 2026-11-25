// ONE EMPLOYEE'S ACCESS: the account's connectors (GitHub's and Azure DevOps' sign-ins of Settings → Connectors) it may
// use -- each off until a person turns it on, for every repository or the ones chosen; one not signed in says where to
// sign it in, and cannot be turned on.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeeAccess } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi, withStatus } from "../../testing/fakeApi";
import { AZURE_REPOSITORY_ID, authAccount, authSession, azureRepository, sources } from "../../testing/fixtures";
import { DEPT_ACCOUNTING, EMP_ANA, EMP_BAO, GRANT_ID, delegationGrant, employeeDetail, roster } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const KB_ID = "0b5e2a7c-4d1f-4b8e-9c3a-6f7d8e9a0b1c";
const off: EmployeeAccess = { employeeId: EMP_ANA, connectors: [{ connector: "github", enabled: false, repositories: null, write: false, grantedAt: null }, { connector: "azure", enabled: false, repositories: null, write: false, grantedAt: null }], knowledge: [] };

describe("one employee's access to the account's connectors", () => {
  test("off until a person lets it -- for the repositories chosen; a connector not signed in says where to sign it in", async () => {
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => off)
      .on("GET", "/api/sources", () => sources("not_connected", "connected"))
      .on("GET", "/api/repositories", (_, url) => ({ source: url.searchParams.get("source"), repositories: [azureRepository()], fetchedAt: "2026-11-22T00:00:00.000Z", partial: false }))
      .on("PUT", `/api/employees/${EMP_ANA}/access`, (body) => ({ ...off, connectors: [off.connectors[0], { connector: "azure", enabled: true, repositories: [{ id: AZURE_REPOSITORY_ID, fullName: "contoso/Platform/api", owner: "contoso", project: "Platform", name: "api" }], write: false, grantedAt: "2026-11-22T00:00:00.000Z" }], _sent: body }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const github = await screen.findByRole("region", { name: "GitHub" });
    expect(within(github).getByText(/not connected/i)).toBeInTheDocument();
    expect(within(github).getByRole("link", { name: /Settings → Connectors/ })).toHaveAttribute("href", expect.stringContaining("settings=connectors"));
    expect(within(github).getByRole("switch")).toBeDisabled();
    const azure = screen.getByRole("region", { name: "Azure DevOps" });
    expect(within(azure).getByText(/dev@contoso\.com/)).toBeInTheDocument();
    expect(screen.getByText(/never enters (its|the employee's) sandbox/i)).toBeInTheDocument();
    await userEvent.click(within(azure).getByRole("switch"));
    await userEvent.click(within(azure).getByRole("radio", { name: "Only the repositories chosen" }));
    await userEvent.click(await within(azure).findByRole("checkbox", { name: "contoso/Platform/api" }));
    await userEvent.click(within(azure).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY_ID], write: false }] }));
    expect(await within(azure).findByText(/Saved/)).toBeInTheDocument();
  });

  test("on for every repository, it says so", async () => {
    fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => ({ ...off, connectors: [{ connector: "github", enabled: true, repositories: null, write: false, grantedAt: "2026-11-22T00:00:00.000Z" }, off.connectors[1]] }))
      .on("GET", "/api/sources", () => sources("connected", "not_connected"));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const github = await screen.findByRole("region", { name: "GitHub" });
    expect(within(github).getByRole("switch")).toBeChecked();
    expect(within(github).getByRole("radio", { name: "Every repository this sign-in reaches" })).toBeChecked();
  });

  test("reading only, until a person also lets it write -- each write still waiting for the account's approval", async () => {
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => ({ ...off, connectors: [{ connector: "github", enabled: true, repositories: null, write: false, grantedAt: "2026-11-22T00:00:00.000Z" }, off.connectors[1]] }))
      .on("GET", "/api/sources", () => sources("connected", "not_connected"))
      .on("PUT", `/api/employees/${EMP_ANA}/access`, () => ({ ...off, connectors: [{ connector: "github", enabled: true, repositories: null, write: true, grantedAt: "2026-11-22T00:00:00.000Z" }, off.connectors[1]] }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const github = await screen.findByRole("region", { name: "GitHub" });
    const write = within(github).getByRole("checkbox", { name: /Also write/ });
    expect(write).not.toBeChecked();
    await userEvent.click(write);
    await userEvent.click(within(github).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ connectors: [{ connector: "github", enabled: true, repositories: null, write: true }] }));
  });

  test("knowledge bases: each of the account's MCP servers off until a person turns it on, saved at once", async () => {
    const withKb: EmployeeAccess = { ...off, knowledge: [{ serverId: KB_ID, name: "Team KB", enabled: false, grantedAt: null, tools: 2 }] };
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => withKb)
      .on("GET", "/api/sources", () => sources("connected", "connected"))
      .on("PUT", `/api/employees/${EMP_ANA}/access`, () => ({ ...withKb, knowledge: [{ ...withKb.knowledge[0], enabled: true, grantedAt: "2026-11-22T00:00:00.000Z" }] }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const knowledge = await screen.findByRole("region", { name: "Knowledge bases (MCP)" });
    expect(knowledge.textContent).toContain("2 tools");
    const toggle = within(knowledge).getByRole("switch", { name: /Team KB/ });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ knowledge: [{ serverId: KB_ID, enabled: true }] }));
    await waitFor(() => expect(within(knowledge).getByRole("switch", { name: /Team KB/ })).toBeChecked());
  });

  test("an account with no MCP server says where to add one", async () => {
    fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => off)
      .on("GET", "/api/sources", () => sources());
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const knowledge = await screen.findByRole("region", { name: "Knowledge bases (MCP)" });
    expect(within(knowledge).getByRole("link", { name: /Settings → MCP servers/ })).toHaveAttribute("href", expect.stringContaining("settings=mcp-servers"));
  });
});

describe("whom one employee may give work to without an appointment", () => {
  test("each delegation grant said with its kind and state; one revoked against its version, one granted to a colleague -- and the list read again", async () => {
    let grants = [delegationGrant()];
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail({ delegationGrants: grants }))
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => off)
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", `/api/delegation-grants/${GRANT_ID}/revoke`, () => {
        grants = [delegationGrant({ state: "revoked", revokedBy: "Ann Owner", revokedAt: "2026-11-21T09:00:00.000Z", version: 3 })];
        return { ok: true };
      })
      .on("POST", `/api/employees/${EMP_ANA}/delegation-grants`, () => {
        const made = delegationGrant({ id: "6a000000-0000-4000-8000-000000000002", target: { kind: "employee", employeeId: EMP_BAO, name: "Bao" }, note: "For the audit", version: 1 });
        grants = [...grants, made];
        return withStatus(201, made);
      });
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const card = await screen.findByRole("region", { name: "May give work to (without an appointment)" });
    expect(card.textContent).toContain("A title or the team-lead switch grants none.");
    const legal = within(card).getByRole("listitem", { name: "Legal" });
    expect(within(legal).getByText("Department")).toBeInTheDocument();
    expect(within(legal).getByText("Active")).toBeInTheDocument();
    await userEvent.click(within(legal).getByRole("button", { name: "Revoke the grant to Legal" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/api/delegation-grants/${GRANT_ID}/revoke`)).toBe(true));
    expect(api.calls.find((c) => c.path === `/api/delegation-grants/${GRANT_ID}/revoke`)?.headers["if-match"]).toBe('"2"');
    await waitFor(() => expect(within(within(card).getByRole("listitem", { name: "Legal" })).getByText("Revoked")).toBeInTheDocument());
    expect(within(within(card).getByRole("listitem", { name: "Legal" })).queryByRole("button", { name: /Revoke/ })).toBeNull();
    // A colleague now: anybody of the office but itself.
    await userEvent.click(within(card).getByRole("button", { name: "Let it give work to…" }));
    const form = await within(card).findByRole("form", { name: "New delegation grant" });
    const colleague = await within(form).findByRole("combobox", { name: /^Colleague/ });
    expect(within(colleague).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Bao"]);
    await userEvent.selectOptions(colleague, EMP_BAO);
    await userEvent.type(within(form).getByRole("textbox", { name: /Note/ }), "For the audit");
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST" && c.path === `/api/employees/${EMP_ANA}/delegation-grants`)?.body).toEqual({ target: { kind: "employee", employeeId: EMP_BAO }, note: "For the audit" }));
    const bao = await within(card).findByRole("listitem", { name: "Bao" });
    expect(bao).toHaveTextContent("Colleague");
    expect(bao).toHaveTextContent("For the audit");
  });

  test("a department's members, too; a refusal is said as the API said it", async () => {
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => off)
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/office/roster", () => roster())
      .on("POST", `/api/employees/${EMP_ANA}/delegation-grants`, () => withStatus(409, { error: { code: "delegation_exists", message: "Ana may give work to Accounting already." } }));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const card = await screen.findByRole("region", { name: "May give work to (without an appointment)" });
    expect(card).toHaveTextContent("No grant: without an appointment it gives work to nobody.");
    await userEvent.click(within(card).getByRole("button", { name: "Let it give work to…" }));
    const form = await within(card).findByRole("form", { name: "New delegation grant" });
    await userEvent.click(within(form).getByRole("radio", { name: "A department's members" }));
    const department = await within(form).findByRole("combobox", { name: /^Department/ });
    expect(within(department).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Accounting", "Legal"]);
    await userEvent.selectOptions(department, DEPT_ACCOUNTING);
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    expect(await within(card).findByText("Ana may give work to Accounting already.")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ target: { kind: "department", departmentId: DEPT_ACCOUNTING } });
  });
});
