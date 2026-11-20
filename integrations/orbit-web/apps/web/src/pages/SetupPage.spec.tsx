import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { fakeApi } from "../testing/fakeApi";
import { FakeEventSource } from "../testing/fakeEventSource";
import { idleFlow, setupStatus } from "../testing/fixtures";
import { renderUi } from "../testing/render";
import { SetupPage } from "./SetupPage";

describe("the setup page, after the Claude sign-in", () => {
  test("says who is signed in to Claude, asks for GitHub, and keeps the workspace closed until it is connected", () => {
    fakeApi();
    renderUi(<SetupPage status={setupStatus()} reload={() => undefined} onContinue={() => undefined} />);
    expect(screen.getByText(/Signed in with Claude as/).textContent).toContain("octo@example.com");
    expect(screen.queryByLabelText("Claude Account")).toBeNull();
    expect(screen.getByLabelText("GitHub Connection").textContent).toContain("Not connected");
    expect(screen.getByRole("button", { name: "Open the chat workspace" })).toBeDisabled();
    expect(screen.getByText(/Connect GitHub to continue/)).toBeInTheDocument();
    expect(screen.getByLabelText("System Status").textContent).toContain("0.6.0");
  });

  test("Connect GitHub shows the URL and the one-time code GitHub CLI printed, then the connection", async () => {
    const api = fakeApi().on("POST", "/api/github/login", () => ({ ...idleFlow(), state: "starting" }));
    const reload = vi.fn();
    renderUi(<SetupPage status={setupStatus()} reload={reload} onContinue={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/github/login" });
    expect(api.calls.at(-1)?.headers["x-orbit-web"]).toBe("1");
    act(() => FakeEventSource.last("/api/github/login/events").emit({ ...idleFlow(), state: "awaiting_user", url: "https://github.com/login/device", code: "WXYZ-1234", updatedAt: "2026-11-19T00:01:00.000Z" }));
    expect(await screen.findByLabelText("one-time code")).toHaveTextContent("WXYZ-1234");
    expect(screen.getByRole("link", { name: "https://github.com/login/device" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Waiting for authorization…")).toBeInTheDocument();
    act(() => FakeEventSource.last("/api/github/login/events").emit({ ...idleFlow(), state: "connected", message: "Connected as octo.", updatedAt: "2026-11-19T00:02:00.000Z" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  test("a failed sign-in says what the CLI said", async () => {
    fakeApi();
    renderUi(<SetupPage status={setupStatus()} reload={() => undefined} />);
    act(() => FakeEventSource.last("/api/github/login/events").emit({ ...idleFlow(), state: "failed", message: "failed to authenticate via web browser: HTTP 415", updatedAt: "2026-11-19T00:02:00.000Z" }));
    expect(await screen.findByText(/HTTP 415/)).toBeInTheDocument();
  });

  test("with GitHub connected the workspace opens, and GitHub shows who is connected", async () => {
    fakeApi();
    const open = vi.fn();
    renderUi(<SetupPage status={setupStatus({}, { state: "connected", account: { login: "octo", name: "Octo Cat" } })} reload={() => undefined} onContinue={open} />);
    expect(screen.getByLabelText("GitHub Connection").textContent).toContain("@octo");
    await userEvent.click(screen.getByRole("button", { name: "Open the chat workspace" }));
    expect(open).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  test("an expired GitHub sign-in keeps the chats and offers to connect again", () => {
    fakeApi();
    renderUi(<SetupPage status={setupStatus({}, { state: "expired", detail: "gh says the sign-in is error." })} reload={() => undefined} />);
    expect(screen.getByLabelText("GitHub Connection").textContent).toContain("Expired");
    expect(screen.getByText(/Your chats are kept/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
  });
});
