import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnyAppEvent } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { useSessionStream } from "../../hooks/useSessionStream";
import { fakeApi } from "../../testing/fakeApi";
import { FakeEventSource } from "../../testing/fakeEventSource";
import { SESSION_ID, sessionDetail } from "../../testing/fixtures";
import { renderUi } from "../../testing/render";
import { ChatView } from "./ChatView";

function Live({ onChanged = () => undefined }: { onChanged?: () => void }) {
  const { state, connected } = useSessionStream(SESSION_ID);
  return <ChatView session={sessionDetail({ status: state.status ?? "ready" })} chat={state} connected={connected} onChanged={onChanged} />;
}

let seq = 0;
const push = (type: string, data: unknown, durable = true) =>
  act(() => FakeEventSource.last(`/api/sessions/${SESSION_ID}/events`).emit({ type, sessionId: SESSION_ID, seq: durable ? ++seq : null, runId: "r1", at: "t", data } as AnyAppEvent));

describe("an open chat", () => {
  test("shows the repository, branch and model in its header", () => {
    fakeApi();
    renderUi(<Live />);
    expect(screen.getByText("octo/sum-fixture")).toBeInTheDocument();
    expect(screen.getByText("main → orbit-web/0b6c2f5e")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude model")).toHaveValue("sonnet");
  });

  test("Enter sends, Shift+Enter makes a new line", async () => {
    const api = fakeApi().on("POST", `/api/sessions/${SESSION_ID}/messages`, () => ({ sessionId: SESSION_ID, runId: "r1" }));
    renderUi(<Live />);
    await userEvent.type(screen.getByLabelText("Message"), "line one{Shift>}{Enter}{/Shift}line two");
    expect(screen.getByLabelText("Message")).toHaveValue("line one\nline two");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("Message"), "{Enter}");
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ text: "line one\nline two" }));
  });

  test("streams Claude's text as it arrives, shows tool activity with its real output, and the run's end", async () => {
    seq = 0;
    fakeApi();
    renderUi(<Live />);
    push("session.status", { status: "running", reason: null });
    push("session.started", { claudeSessionId: "c", claudeCodeVersion: "2.1.328", model: "claude-sonnet-5-5", requestedModel: "sonnet", permissionMode: "dontAsk", plugins: [{ name: "orbit", version: "0.6.0" }], orbitLoaded: true, orbitVersion: "0.6.0", resumed: false });
    expect(await screen.findByText("Orbit 0.6.0 loaded")).toBeInTheDocument();
    push("message.started", { messageId: "m1", role: "assistant", parentToolUseId: null });
    push("message.delta", { messageId: "m1", offset: 0, text: "Looking at " }, false);
    expect(await screen.findByText(/Looking at/)).toBeInTheDocument();
    push("message.delta", { messageId: "m1", offset: 11, text: "**sum.mjs** now. " }, false);
    expect(await screen.findByText("sum.mjs")).toBeInTheDocument();
    push("tool.started", { toolUseId: "t1", name: "Bash", title: "$ node --test", input: '{"command":"node --test"}', inputTruncated: false, parentToolUseId: null, agent: null });
    expect(screen.getByTestId("tool")).toHaveAttribute("data-state", "running");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    push("tool.completed", { toolUseId: "t1", output: "ℹ pass 1", truncated: false, isError: false, interrupted: false, parentToolUseId: null });
    expect(screen.getByTestId("tool")).toHaveAttribute("data-state", "done");
    await userEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("ℹ pass 1")).toBeInTheDocument();
    push("permission.denied", { toolName: "Bash", toolUseId: "t9", input: '{"command":"git push"}' });
    push("session.completed", { subtype: "success", result: "Done", permissionDenials: 1, costUsd: 0.05, turns: 3, durationMs: 1000 });
    push("session.status", { status: "completed", reason: null });
    expect(await screen.findByText(/Claude Code finished \(3 turns/)).toBeInTheDocument();
    expect(screen.getByText(/Whether the change is verified is Orbit's to say/)).toBeInTheDocument();
    expect(screen.getByText(/Permission denied: Bash/)).toBeInTheDocument();
  });

  test("Stop asks the API to stop the run, and an interrupted run says so", async () => {
    seq = 0;
    const onChanged = vi.fn();
    const api = fakeApi().on("POST", `/api/sessions/${SESSION_ID}/stop`, () => ({ stopping: true }));
    renderUi(<Live onChanged={onChanged} />);
    push("session.status", { status: "running", reason: null });
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: `/api/sessions/${SESSION_ID}/stop` });
    push("session.interrupted", { reason: "user_stop", exitCode: null, signal: "SIGINT" });
    push("session.status", { status: "interrupted", reason: "user_stop" });
    expect(await screen.findByText(/it did not complete/)).toBeInTheDocument();
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
  });

  test("a failed run shows the CLI's own error", async () => {
    seq = 0;
    fakeApi();
    renderUi(<Live />);
    push("session.failed", { reason: "cli_error", subtype: "error_during_execution", message: "There's an issue with the selected model (haiku). It may not exist or you may not have access to it.", exitCode: 1, signal: null, permissionDenials: 0, costUsd: null, turns: null, durationMs: null });
    expect(await screen.findByText(/issue with the selected model/)).toBeInTheDocument();
  });
});
