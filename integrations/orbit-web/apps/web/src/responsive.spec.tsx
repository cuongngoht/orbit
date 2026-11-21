import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Customizations, RevisionSummary } from "@orbit-web/contracts";
import { defaultAccountPolicy } from "@orbit-web/governance-core";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { ChatScreen } from "./features/chat/ChatScreen";
import { Composer } from "./features/composer/Composer";
import { GovernanceView } from "./features/governance/GovernanceView";
import { PolicyPage } from "./features/governance/PolicyPage";
import { PolicyTable } from "./features/governance/PolicyTable";
import { NewSession } from "./features/newSession/NewSession";
import { NewResearchSession } from "./features/research/NewResearchSession";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import type { SettingsSection } from "./hooks/useHashRoute";
import { AccessPage } from "./pages/AccessPage";
import { OfficeView } from "./features/office/OfficeView";
import { fakeApi } from "./testing/fakeApi";
import { EMP_ANA, connectionsView, employeeDetail, roster } from "./testing/officeFixtures";
import { ACCOUNT_ID, SESSION_ID, authAccount, authStatus, authUser, governanceOverview, inventory, revisionSummary, sessionDetail, sessionSummary, sessionViews, settings, setupStatus, sources } from "./testing/fixtures";
import { researchDetail, workspaceSummary, WORKSPACE_ID } from "./testing/researchFixtures";
import { renderLive, renderUi } from "./testing/render";

const originalMatchMedia = window.matchMedia;
const originalVisualViewport = window.visualViewport;
const originalInnerHeight = window.innerHeight;

function mockViewport(queries: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: Boolean(queries[query]),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const mobileViewport = () =>
  mockViewport({
    "(max-width: 639px)": true,
    "(max-width: 1023px)": true,
    "(max-width: 1279px)": true,
    "(pointer: coarse)": true,
  });

const tabletViewport = () =>
  mockViewport({
    "(max-width: 639px)": false,
    "(max-width: 1023px)": true,
    "(max-width: 1279px)": true,
    "(pointer: coarse)": false,
  });

function signedInApi() {
  return fakeApi()
    .on("GET", "/api/auth/status", () => authStatus())
    .on("GET", "/api/settings", () => settings())
    .on("GET", "/api/sessions", () => [sessionSummary()])
    .on("GET", "/api/sources", () => sources())
    .on("GET", "/api/setup/status", () => setupStatus())
    .on("GET", `/api/sessions/${SESSION_ID}`, () => sessionDetail());
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: originalMatchMedia });
  Object.defineProperty(window, "visualViewport", { configurable: true, writable: true, value: originalVisualViewport });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: originalInnerHeight });
  document.documentElement.style.removeProperty("--orbit-app-height");
  document.documentElement.style.removeProperty("--orbit-app-top");
  document.documentElement.style.removeProperty("--orbit-safe-bottom");
  delete document.documentElement.dataset.orbitShell;
  window.location.hash = "";
  window.localStorage.clear();
});

describe("responsive mobile-first layout", () => {
  test("mobile hides the inline sidebar, opens an OverlayDrawer via navigation button, and closes it when opening a chat", async () => {
    mobileViewport();
    signedInApi();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Orbit" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const nav = await screen.findByRole("navigation", { name: "Orbit" });
    await userEvent.click(within(nav).getByRole("button", { name: /^Fix sum/ }));
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${SESSION_ID}`));
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Orbit" })).toBeNull());
  });

  test("mobile composer: slash shortcut opens commands, Return adds newline on touch, and Model & Effort opens one flat sheet", async () => {
    mobileViewport();
    const api = fakeApi()
      .on("GET", "/api/commands", () => ({
        commands: [{ name: "orbit:orbit-help", description: "Orbit's navigator", argumentHint: null, kind: "skill", origin: "orbit" }],
        note: null,
      }))
      .on("POST", "/api/sessions", () => sessionSummary({ status: "preparing" }));
    const onCreated = vi.fn();
    renderUi(<NewSession settings={settings()} sources={sources()} onCreated={onCreated} onConnect={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Skills and commands" }));
    expect(await screen.findByRole("option", { name: /orbit:orbit-help/ })).toBeInTheDocument();

    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.clear(box);
    await userEvent.type(box, "Line 1{Enter}Line 2");
    expect(box).toHaveValue("Line 1\nLine 2");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Model Sonnet 5.5, effort Medium" }));
    expect(await screen.findByText("Model · this session")).toBeInTheDocument();
    expect(await screen.findByRole("menuitemradio", { name: "Max" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Opus 5.5" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Model Opus 5.5, effort Max" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ model: "opus", effort: "max", prompt: "Line 1\nLine 2" });
  });

  test("mobile ChatScreen uses icon buttons, bottom-sheet Inspector, and 2-step Files -> Diff flow with Wrap lines", async () => {
    mobileViewport();
    fakeApi()
      .on("GET", `/api/sessions/${SESSION_ID}`, () => sessionDetail())
      .on("GET", `/api/sessions/${SESSION_ID}/changes`, () => ({
        sessionId: SESSION_ID,
        repository: "octo/sum-fixture",
        baseBranch: "main",
        workBranch: "orbit-web/0b6c2f5e",
        currentBranch: "orbit-web/0b6c2f5e",
        baseCommit: "a".repeat(40),
        headCommit: "a".repeat(40),
        upstream: null,
        files: [{ path: "sum.mjs", oldPath: null, kind: "modified", additions: 1, deletions: 1, binary: false }],
        totals: { files: 1, additions: 1, deletions: 1 },
        checkedAt: "2026-11-20T00:00:00.000Z",
      }))
      .on("GET", `/api/sessions/${SESSION_ID}/changes/file`, () => ({
        path: "sum.mjs",
        kind: "modified",
        binary: false,
        tooLarge: false,
        language: "javascript",
        diff: "@@ -1 +1 @@\n-export const sum = (a, b) => a - b;\n+export const sum = (a, b) => a + b;\n",
      }));

    renderUi(<ChatScreen sessionId={SESSION_ID} onUpdated={() => undefined} onOpenNav={() => undefined} />);
    await screen.findByText("Fix sum");
    await userEvent.click(screen.getByRole("button", { name: "Changes" }));
    const inspector = await screen.findByRole("complementary", { name: "Changes and Orbit" });
    await userEvent.click(await within(inspector).findByText("sum.mjs"));

    expect(await within(inspector).findByRole("table", { name: "Diff" })).toBeInTheDocument();
    expect(within(inspector).queryByText("1 file changed")).toBeNull();
    const wrapBtn = within(inspector).getByRole("button", { name: "Wrap lines" });
    await userEvent.click(wrapBtn);
    expect(wrapBtn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(inspector).getByRole("button", { name: "Files" }));
    expect(await within(inspector).findByText(/1 file changed/)).toBeInTheDocument();
  });

  test("mobile Settings uses 2-level push navigation and card layouts for Connectors and Skills", async () => {
    mobileViewport();
    const customizations: Customizations = {
      orbit: { version: "0.6.0", skills: [{ name: "orbit-help", description: "Navigator", path: "skills/orbit-help/SKILL.md" }], agents: [] },
      projects: [{ sessionId: SESSION_ID, title: "Fix sum", inventory: inventory() }],
    };
    fakeApi()
      .on("GET", "/api/setup/status", () => setupStatus({}, { state: "connected", account: { login: "octo", name: "Octo" } }))
      .on("GET", "/api/customizations", () => customizations)
      .on("GET", "/api/auth/sessions", () => sessionViews());

    const onSection = vi.fn();
    const signOut = { signOut: vi.fn(async () => undefined), signOutEverywhere: vi.fn(async () => undefined), busy: false, error: null, clear: vi.fn() };
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("account");
      return (
        <SettingsDialog
          section={section}
          connector={null}
          auth={{ ...authStatus(), user: authUser() }}
          onAuth={() => undefined}
          signOut={signOut}
          settings={settings()}
          onSettings={() => undefined}
          onSection={(next) => {
            onSection(next);
            setSection(next);
          }}
          onClose={() => undefined}
        />
      );
    }
    renderLive(<Harness />);

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const nav = within(dialog).getByRole("navigation", { name: "Settings sections" });
    await userEvent.click(within(nav).getByRole("button", { name: /Connectors/ }));
    expect(onSection).toHaveBeenCalledWith("connectors");

    expect(await within(dialog).findByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("table", { name: "Connectors" })).toBeNull();
    expect(await within(dialog).findByRole("listitem", { name: "GitHub" })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Settings" }));
    const navAgain = await within(dialog).findByRole("navigation", { name: "Settings sections" });
    await userEvent.click(within(navAgain).getByRole("button", { name: /Skills/ }));
    expect(within(dialog).queryByRole("table", { name: "Skills of Fix sum" })).toBeNull();
    expect(await within(dialog).findByRole("list", { name: "Skills of Fix sum" })).toBeInTheDocument();
  });

  test("tablet uses overlay navigation drawer and overlay inspector without crushing chat", async () => {
    tabletViewport();
    signedInApi();
    window.location.hash = `#/chat/${SESSION_ID}`;
    render(<App />);
    expect(await screen.findByText("Fix sum")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Orbit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Orbit" }));
    expect(await screen.findByRole("complementary", { name: "Changes and Orbit" })).toBeInTheDocument();
  });

  test("governance overview KPI cards jump straight to the right page and use pill navigation on mobile", async () => {
    mobileViewport();
    const overview = governanceOverview({ counts: { workspaces: 2, researchWorkspaces: 1, runningRuns: 1, pendingApprovals: 3, openFindings: 0, draftRevisions: 1, overrides: 0 } });
    fakeApi().on("GET", "/api/governance/overview", () => overview);

    const go = vi.fn();
    renderLive(<GovernanceView page="overview" item={null} go={go} account={{ displayName: "", email: "octo@example.com" }} onOpenNav={() => undefined} />);

    const kpi = await screen.findByRole("button", { name: /Approvals waiting/ });
    expect(kpi.textContent).toContain("3");
    await userEvent.click(kpi);
    expect(go).toHaveBeenCalledWith("approvals");

    const nav = screen.getByRole("navigation", { name: "Governance" });
    expect(within(nav).getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    // On a phone the account governed is said under the title.
    expect(screen.getByText("octo@example.com")).toBeInTheDocument();
  });

  test("mobile PolicyTable uses stacked cards while keeping action checkboxes intact", async () => {
    mobileViewport();
    const onChange = vi.fn();
    renderUi(<PolicyTable document={defaultAccountPolicy(ACCOUNT_ID, "governed")} editable onChange={onChange} />);

    expect(screen.queryByRole("table", { name: "What may happen" })).toBeNull();
    const webAllowed = screen.getByRole("checkbox", { name: "Allowed: tool.web" }) as HTMLInputElement;
    expect(webAllowed.checked).toBe(false);
    expect(screen.getByRole("checkbox", { name: "You approve first: repository.push" })).toBeInTheDocument();

    await userEvent.click(webAllowed);
    expect(onChange).toHaveBeenCalled();
  });

  test("mobile PolicyPage uses stacked Revisions cards and routes to selected revision", async () => {
    mobileViewport();
    const revisions: RevisionSummary[] = [
      revisionSummary({ id: "rev-2", revision: null, state: "VALIDATED", digest: "e".repeat(64), name: "next", risk: "high", source: "copy", basedOn: "rev-1", createdBy: `owner:${ACCOUNT_ID}`, updatedAt: "2026-11-20T10:05:00.000Z", publishedAt: null, publishedBy: null }),
      revisionSummary(),
    ];
    fakeApi().on("GET", "/api/governance/policy", () => ({ effective: null, revisions }));

    const go = vi.fn();
    renderLive(<PolicyPage item={null} go={go} />);

    expect(await screen.findByText("validated")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Revisions" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "next" }));
    expect(go).toHaveBeenCalledWith("policy", "rev-2");
  });

  test("mobile Workspace syncs visualViewport CSS vars across keyboard open, pinch-zoom, and unmount", async () => {
    mobileViewport();
    signedInApi();
    const listeners = new Map<string, Set<() => void>>();
    const vv = {
      height: 874,
      offsetTop: 0,
      scale: 1,
      addEventListener: (type: string, fn: () => void) => {
        const set = listeners.get(type) ?? new Set<() => void>();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.get(type)?.delete(fn);
      },
    };
    const emit = (type: string) => {
      act(() => {
        for (const fn of listeners.get(type) ?? []) fn();
      });
    };
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 874 });
    Object.defineProperty(window, "visualViewport", { configurable: true, writable: true, value: vv });

    const view = render(<App />);
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    const rootStyle = document.documentElement.style;
    expect(document.documentElement.dataset.orbitShell).toBe("fixed");
    expect(rootStyle.getPropertyValue("--orbit-app-height")).toBe("874px");
    expect(rootStyle.getPropertyValue("--orbit-app-top")).toBe("0px");
    expect(rootStyle.getPropertyValue("--orbit-safe-bottom")).toBe("");

    vv.height = 520;
    vv.offsetTop = 24;
    emit("resize");
    expect(rootStyle.getPropertyValue("--orbit-app-height")).toBe("520px");
    expect(rootStyle.getPropertyValue("--orbit-app-top")).toBe("24px");
    expect(rootStyle.getPropertyValue("--orbit-safe-bottom")).toBe("0px");

    vv.scale = 1.15;
    emit("resize");
    expect(rootStyle.getPropertyValue("--orbit-app-height")).toBe("");
    expect(rootStyle.getPropertyValue("--orbit-app-top")).toBe("");
    expect(rootStyle.getPropertyValue("--orbit-safe-bottom")).toBe("");

    view.unmount();
    expect(document.documentElement.dataset.orbitShell).toBeUndefined();
    expect(rootStyle.getPropertyValue("--orbit-app-height")).toBe("");
  });

  test("mobile NewResearchSession and AccessPage avoid autoFocus keyboard pop and submit cleanly", async () => {
    mobileViewport();
    const onGranted = vi.fn();
    const accessView = renderUi(<AccessPage onGranted={onGranted} />);
    expect(screen.getByLabelText(/Access token/)).not.toHaveFocus();
    accessView.unmount();

    const api = fakeApi()
      .on("GET", "/api/research/workspaces", () => [])
      .on("POST", "/api/research/workspaces", () => workspaceSummary())
      .on("POST", `/api/research/workspaces/${WORKSPACE_ID}/sessions`, () => researchDetail());
    const onCreated = vi.fn();
    renderUi(<NewResearchSession settings={settings()} onCreated={onCreated} />);

    const nameInput = screen.getByRole("textbox", { name: /Workspace name/ });
    expect(nameInput).not.toHaveFocus();
    await userEvent.type(nameInput, "Coffee Research");
    await userEvent.click(screen.getByRole("button", { name: "Start research" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "POST" && c.path === "/api/research/workspaces")?.body).toEqual({ name: "Coffee Research", description: "" });
  });

  test("coarse landscape keeps touch input sizing and global.css enforces 16px on Fluent inputs", async () => {
    mockViewport({ "(max-width: 639px)": false, "(max-width: 1023px)": true, "(max-width: 1279px)": true, "(pointer: coarse)": true });
    const onSend = vi.fn();
    renderUi(<Composer placeholder="Reply" canSend running={false} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "Line 1{Enter}Line 2");
    expect(box).toHaveValue("Line 1\nLine 2");
    expect(onSend).not.toHaveBeenCalled();

    const cssPath = [
      resolve(process.cwd(), "src/themes/global.css"),
      resolve(process.cwd(), "apps/web/src/themes/global.css"),
      resolve(process.cwd(), "integrations/orbit-web/apps/web/src/themes/global.css"),
    ].find((p) => existsSync(p));
    expect(cssPath).toBeDefined();
    const css = readFileSync(cssPath as string, "utf8");
    expect(css).toContain("@media (max-width: 639px), (pointer: coarse)");
    expect(css).toContain(".fui-Input__input");
    expect(css).toContain(".fui-Textarea__textarea");
    expect(css).toContain("font-size: 16px !important;");
  });

  test("the office on a phone: the filters in a menu, and an employee or a mission as its own screen with Back", async () => {
    mobileViewport();
    fakeApi()
      .on("GET", "/api/office/roster", () => roster())
      .on("GET", "/api/connections", () => connectionsView())
      .on("GET", `/api/employees/${EMP_ANA}`, () => employeeDetail());
    const go = vi.fn();
    const view = renderLive(<OfficeView page="overview" item={null} tab={null} go={go} account={authAccount()} />);
    expect(await screen.findByRole("region", { name: "Accounting" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Office" })).toBeInTheDocument();
    // The pickers wait in a sheet behind one button, beside the search.
    expect(screen.queryByRole("combobox", { name: "Department" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search employees" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(await screen.findByRole("combobox", { name: "Department" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    view.unmount();
    renderLive(<OfficeView page="employee" item={EMP_ANA} tab={null} go={go} account={authAccount()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(go).toHaveBeenCalledWith("overview");
    // On a phone a detail screen gives the office's tabs' room to the record.
    expect(screen.queryByRole("navigation", { name: "Office" })).toBeNull();
    expect(screen.getByRole("tablist", { name: "Employee" })).toBeInTheDocument();
  });
});
