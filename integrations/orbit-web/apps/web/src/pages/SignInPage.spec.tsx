import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../testing/fakeApi";
import { FakeEventSource } from "../testing/fakeEventSource";
import { claudeStatus, idleFlow, signedOutClaude } from "../testing/fixtures";
import { renderUi } from "../testing/render";
import { SignInPage } from "./SignInPage";

describe("the sign-in page: Orbit Web signs in with a Claude account", () => {
  test("opens the Claude sign-in by itself: the CLI's sign-in is started once, with no mode and no click", async () => {
    const api = fakeApi().on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting", updatedAt: "2026-11-19T00:00:30.000Z" }));
    renderUi(<SignInPage status={signedOutClaude()} onChanged={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.getByText(/Orbit Web 0\.8\.0/)).toBeInTheDocument();
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/claude/login")).toHaveLength(1));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/claude/login", body: undefined });
    expect(api.calls.at(-1)?.headers["x-orbit-web"]).toBe("1");
    expect(await screen.findByText("Starting the Claude CLI's sign-in…")).toBeInTheDocument();
    expect(screen.queryByText(/Console/)).toBeNull();
  });

  test("shows the whole authorize link to open or copy, and sends the pasted code", async () => {
    const URL_ = "https://claude.com/cai/oauth/authorize?x=1";
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const api = fakeApi()
      .on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }))
      .on("POST", "/api/claude/login/code", () => ({ ...idleFlow(), state: "verifying" }));
    renderUi(<SignInPage status={signedOutClaude()} onChanged={() => undefined} />);
    act(() => FakeEventSource.last("/api/claude/login/events").emit({ ...idleFlow(), state: "awaiting_user", url: URL_, needsCode: true, updatedAt: "2026-11-19T00:01:00.000Z" }));
    expect(await screen.findByRole("link", { name: URL_ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button", { name: "Continue with Claude" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("2. Paste the code the page shows"), "abc#def");
    await userEvent.click(screen.getByRole("button", { name: "Submit code" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/claude/login/code", body: { code: "abc#def" } });
  });

  test("a sign-in a person cancelled, or one that failed, is not started again by itself: Continue with Claude is", async () => {
    for (const state of ["cancelled", "failed", "timed_out"] as const) {
      const api = fakeApi().on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }));
      const view = renderUi(<SignInPage status={signedOutClaude({ flow: { ...idleFlow(), state } })} onChanged={() => undefined} />);
      expect(screen.getByRole("button", { name: "Continue with Claude" })).toBeEnabled();
      expect(api.calls.filter((c) => c.path === "/api/claude/login")).toEqual([]);
      await userEvent.click(screen.getByRole("button", { name: "Continue with Claude" }));
      expect(api.calls.filter((c) => c.path === "/api/claude/login")).toHaveLength(1);
      view.unmount();
    }
  });

  test("a verified sign-in is exchanged, once, for this browser's session, and the app reads the sign-in again", async () => {
    const api = fakeApi().on("POST", "/api/claude/session", () => claudeStatus());
    const changed = vi.fn();
    renderUi(<SignInPage status={signedOutClaude()} onChanged={changed} />);
    act(() => FakeEventSource.last("/api/claude/login/events").emit({ ...idleFlow(), state: "connected", message: "Signed in to Claude as octo@example.com.", updatedAt: "2026-11-19T00:02:00.000Z" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.calls.filter((c) => c.method === "POST" && c.path === "/api/claude/session")).toHaveLength(1);
  });

  test("a browser with no session runs the sign-in itself even when the Claude CLI is signed in already", async () => {
    const api = fakeApi().on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }));
    renderUi(<SignInPage status={signedOutClaude({ runtime: "connected" })} onChanged={() => undefined} />);
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/claude/login")).toHaveLength(1));
    expect(screen.getByText(/no password of its own/)).toBeInTheDocument();
  });

  test("says why a sign-in does not count, and that the container's credential variables are ignored", () => {
    fakeApi();
    const detail = "The Claude CLI is signed in with api_key, which is not a Claude account. Sign in with your Claude account. This container was started with ANTHROPIC_API_KEY; Orbit Web ignores it: it signs in with a Claude account only.";
    renderUi(<SignInPage status={signedOutClaude({ method: "api_key", detail })} onChanged={() => undefined} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  test("a Claude CLI that does not answer is said as such, and the sign-in is still offered, not started", () => {
    const api = fakeApi();
    renderUi(<SignInPage status={signedOutClaude({ state: "unavailable", detail: "claude auth status timed out" })} onChanged={() => undefined} />);
    expect(screen.getByText(/The Claude CLI did not answer: claude auth status timed out/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Claude" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === "/api/claude/login")).toEqual([]);
  });
});
