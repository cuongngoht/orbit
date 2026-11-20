import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../testing/fakeApi";
import { FakeEventSource } from "../testing/fakeEventSource";
import { idleFlow, signedOutClaude } from "../testing/fixtures";
import { renderUi } from "../testing/render";
import { SignInPage } from "./SignInPage";

describe("the sign-in page: Orbit Web signs in with a Claude account", () => {
  test("offers the Claude sign-in and nothing else", () => {
    fakeApi();
    renderUi(<SignInPage status={signedOutClaude()} onChanged={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Sign in to Orbit Web" })).toBeInTheDocument();
    expect(screen.getByText(/Orbit Web 0\.8\.0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Claude" })).toBeInTheDocument();
    expect(screen.queryByText(/Console/)).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Continue with Claude"]);
  });

  test("Continue with Claude starts the CLI's sign-in with no mode, shows its link and sends the pasted code", async () => {
    const api = fakeApi()
      .on("POST", "/api/claude/login", () => ({ ...idleFlow(), state: "starting" }))
      .on("POST", "/api/claude/login/code", () => ({ ...idleFlow(), state: "verifying" }));
    renderUi(<SignInPage status={signedOutClaude()} onChanged={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Claude" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/claude/login", body: undefined });
    expect(api.calls.at(-1)?.headers["x-orbit-web"]).toBe("1");
    act(() => FakeEventSource.last("/api/claude/login/events").emit({ ...idleFlow(), state: "awaiting_user", url: "https://claude.com/cai/oauth/authorize?x=1", needsCode: true, updatedAt: "2026-11-19T00:01:00.000Z" }));
    expect(await screen.findByRole("link", { name: "https://claude.com/cai/oauth/authorize?x=1" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button", { name: "Continue with Claude" })).toBeNull();
    await userEvent.type(screen.getByLabelText("2. Paste the code the page shows"), "abc#def");
    await userEvent.click(screen.getByRole("button", { name: "Submit code" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/claude/login/code", body: { code: "abc#def" } });
  });

  test("a verified sign-in has the app read the sign-in again", async () => {
    fakeApi();
    const changed = vi.fn();
    renderUi(<SignInPage status={signedOutClaude()} onChanged={changed} />);
    act(() => FakeEventSource.last("/api/claude/login/events").emit({ ...idleFlow(), state: "connected", message: "Signed in to Claude as octo@example.com.", updatedAt: "2026-11-19T00:02:00.000Z" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  test("says why a sign-in does not count, and that the container's credential variables are ignored", () => {
    fakeApi();
    const detail = "The Claude CLI is signed in with api_key, which is not a Claude account. Sign in with your Claude account. This container was started with ANTHROPIC_API_KEY; Orbit Web ignores it: it signs in with a Claude account only.";
    renderUi(<SignInPage status={signedOutClaude({ method: "api_key", detail })} onChanged={() => undefined} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  test("a Claude CLI that does not answer is said as such, and the sign-in is still offered", () => {
    fakeApi();
    renderUi(<SignInPage status={signedOutClaude({ state: "unavailable", detail: "claude auth status timed out" })} onChanged={() => undefined} />);
    expect(screen.getByText(/The Claude CLI did not answer: claude auth status timed out/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Claude" })).toBeInTheDocument();
  });
});
