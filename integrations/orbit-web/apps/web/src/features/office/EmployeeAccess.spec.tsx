// ONE EMPLOYEE'S ACCESS: the account's connectors (GitHub's and Azure DevOps' sign-ins of Settings → Connectors) it may
// use -- each off until a person turns it on, for every repository or the ones chosen; one not signed in says where to
// sign it in, and cannot be turned on.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EmployeeAccess } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { AZURE_REPOSITORY_ID, authAccount, authSession, azureRepository, sources } from "../../testing/fixtures";
import { EMP_ANA, employeeDetail } from "../../testing/officeFixtures";
import { renderLive } from "../../testing/render";
import { OfficeView } from "./OfficeView";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const KB_ID = "0b5e2a7c-4d1f-4b8e-9c3a-6f7d8e9a0b1c";
const off: EmployeeAccess = { employeeId: EMP_ANA, connectors: [{ connector: "github", enabled: false, repositories: null, grantedAt: null }, { connector: "azure", enabled: false, repositories: null, grantedAt: null }], knowledge: [] };

describe("one employee's access to the account's connectors", () => {
  test("off until a person lets it -- for the repositories chosen; a connector not signed in says where to sign it in", async () => {
    const api = fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => off)
      .on("GET", "/api/sources", () => sources("not_connected", "connected"))
      .on("GET", "/api/repositories", (_, url) => ({ source: url.searchParams.get("source"), repositories: [azureRepository()], fetchedAt: "2026-11-22T00:00:00.000Z", partial: false }))
      .on("PUT", `/api/employees/${EMP_ANA}/access`, (body) => ({ ...off, connectors: [off.connectors[0], { connector: "azure", enabled: true, repositories: [{ id: AZURE_REPOSITORY_ID, fullName: "contoso/Platform/api", owner: "contoso", project: "Platform", name: "api" }], grantedAt: "2026-11-22T00:00:00.000Z" }], _sent: body }));
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
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ connectors: [{ connector: "azure", enabled: true, repositories: [AZURE_REPOSITORY_ID] }] }));
    expect(await within(azure).findByText(/Saved/)).toBeInTheDocument();
  });

  test("on for every repository, it says so", async () => {
    fakeApi()
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail())
      .on("GET", `/api/employees/${EMP_ANA}/access`, () => ({ ...off, connectors: [{ connector: "github", enabled: true, repositories: null, grantedAt: "2026-11-22T00:00:00.000Z" }, off.connectors[1]] }))
      .on("GET", "/api/sources", () => sources("connected", "not_connected"));
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab="access" go={vi.fn()} account={authAccount()} />);
    const github = await screen.findByRole("region", { name: "GitHub" });
    expect(within(github).getByRole("switch")).toBeChecked();
    expect(within(github).getByRole("radio", { name: "Every repository this sign-in reaches" })).toBeChecked();
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
