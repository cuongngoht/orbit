// The console reads a sandbox log from byte 0, then follows it from the offset the server last named: a
// line is never sent twice, it keeps the newest lines, and it has no input of any kind.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEventSource } from "../../../testing/fakeEventSource";
import { SANDBOX_SESSION, TASK_API, TASK_PAGE, fakeMission, logPage } from "../../../testing/fakeMission";
import { fakeServer } from "../../../testing/fakeServer";
import { renderApp } from "../../../testing/renderApp";

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal("EventSource", FakeEventSource);
  server = fakeServer(undefined, fakeMission().handle);
  vi.stubGlobal("fetch", server.fetch);
});

const logReads = () => server.calls.filter((c) => c.method === "GET" && c.path.startsWith(`${TASK_API}/sandbox/logs/`)).map((c) => c.path);
const output = () => screen.getByRole("log", { name: "Console stdout" });

async function openConsole() {
  renderApp(TASK_PAGE);
  fireEvent.click(await screen.findByRole("button", { name: "▸ Console" }));
  await waitFor(() => expect(output().textContent).toContain("listening on 42017"));
  await waitFor(() => expect(FakeEventSource.instances.some((s) => s.url.includes("/sandbox/logs/"))).toBe(true));
  return FakeEventSource.instances.filter((s) => s.url.includes("/sandbox/logs/")).at(-1);
}

describe("the live console", () => {
  it("is closed until a person opens it, and reads the log from byte 0 first", async () => {
    renderApp(TASK_PAGE);
    expect(await screen.findByRole("button", { name: "▸ Console" })).toBeTruthy();
    expect(logReads()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "▸ Console" }));
    await waitFor(() => expect(logReads()).toEqual([`${TASK_API}/sandbox/logs/${SANDBOX_SESSION}?stream=out&from=0`]));
  });

  it("then follows the log from the offset it reached, appending only what is new", async () => {
    const stream = await openConsole();
    const next = logPage(SANDBOX_SESSION, "out", 0).next;
    expect(stream?.url).toBe(`${TASK_API}/sandbox/logs/${SANDBOX_SESSION}/stream?stream=out&from=${next}`);
    act(() => stream?.open());
    act(() => stream?.emit("log", { source: "log", session: SANDBOX_SESSION, stream: "out", from: next, next: next + 22, lines: ["POST /api/refund 500"], truncated: false }, `o=${next + 22}`));
    await waitFor(() => expect(output().textContent).toBe("listening on 42017\nGET /health 200\nPOST /api/refund 500"));
  });

  it("when the stream fails for good, it reads from the offset it reached every few seconds, and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stream = await openConsole();
    act(() => stream?.error(true));
    await waitFor(() => expect(screen.getByText(/DEGRADED LIVE/)).toBeTruthy());
    await act(() => vi.advanceTimersByTimeAsync(5_010));
    const next = logPage(SANDBOX_SESSION, "out", 0).next;
    await waitFor(() => expect(logReads().at(-1)).toBe(`${TASK_API}/sandbox/logs/${SANDBOX_SESSION}?stream=out&from=${next}`));
    vi.useRealTimers();
  });

  it("has no input: nothing typed on this page can run", async () => {
    await openConsole();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(document.querySelectorAll("input[type=text], textarea")).toHaveLength(0);
  });
});
