import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Customizations } from "@orbit-web/contracts";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { ChatScreen } from "./features/chat/ChatScreen";
import { NewSession } from "./features/newSession/NewSession";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import type { SettingsSection } from "./hooks/useHashRoute";
import { fakeApi } from "./testing/fakeApi";
import { SESSION_ID, claudeStatus, inventory, sessionDetail, sessionSummary, settings, setupStatus, sources } from "./testing/fixtures";
import { renderLive, renderUi } from "./testing/render";

const originalMatchMedia = window.matchMedia;

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
    .on("GET", "/api/claude/status", () => claudeStatus())
    .on("GET", "/api/settings", () => settings())
    .on("GET", "/api/sessions", () => [sessionSummary()])
    .on("GET", "/api/sources", () => sources())
    .on("GET", "/api/setup/status", () => setupStatus())
    .on("GET", `/api/sessions/${SESSION_ID}`, () => sessionDetail());
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: originalMatchMedia });
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
      .on("GET", "/api/customizations", () => customizations);

    const onSection = vi.fn();
    const signOut = { signOut: vi.fn(async () => undefined), busy: false, error: null, clear: vi.fn() };
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("account");
      return (
        <SettingsDialog
          section={section}
          connector={null}
          claude={claudeStatus()}
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
});
