// The Trace page through the whole app: each prompt with what the router
// decided and the path the session then took, one turn in full, a longer
// window, an empty trail and a turn the trail does not hold.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeServer } from "../../testing/fakeServer";
import { fakeTrail, fakeTurn } from "../../testing/fakeTrace";
import { renderApp } from "../../testing/renderApp";
import { elementOf, required } from "../../testing/required";

const DIVERGED = fakeTurn({
  id: "e-mfx1a2b4-0a1b2c3e",
  at: "2026-09-24T08:00:00.000Z",
  endedAt: "2026-09-24T08:00:05.000Z",
  ms: 5000,
  steps: [{ at: "2026-09-24T08:00:01.000Z", kind: "skill", label: "orbit:orbit-help", ok: true }],
  path: [{ kind: "skill", label: "orbit:orbit-help", ok: true, times: 1 }],
  followed: { verdict: "diverged", say: "the router suggested orbit-develop; the session used orbit-help instead" },
  outcome: "ok",
});

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  server = fakeServer(undefined, fakeTrail({ turns: [fakeTurn(), DIVERGED] }));
  vi.stubGlobal("fetch", server.fetch);
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  window.localStorage.clear();
});

// Each prompt is two rows: its headline, and its path across the table under it.
const rowsOf = async () => {
  const rows = within(await screen.findByRole("table", { name: "Prompts and the path each took" })).getAllByRole("row").slice(1);
  return rows.filter((_, at) => at % 2 === 0).map((head, at) => ({ head, path: rows[at * 2 + 1] }));
};

describe("Trace", () => {
  it("lists each prompt: the router's intent, whether the session followed, the path and how it ended", async () => {
    renderApp("/trace");
    const [followed, diverged] = await rowsOf();
    expect(within(followed.head).getByText("development (high)")).toBeTruthy();
    expect(within(followed.head).getByText("orbit:orbit-develop")).toBeTruthy();
    expect(within(followed.head).getByText("Followed")).toBeTruthy();
    expect(within(followed.head).getByText("A step failed")).toBeTruthy();
    expect(within(followed.head).getByText("42 s")).toBeTruthy();
    expect(followed.path.textContent).toBe("Path: orbit:orbit-develop→ cli/context→ Read→ cli/knowledge verify (failed)");
    expect(within(diverged.head).getByText("Went another way")).toBeTruthy();
  });

  it("keeps every column its width, and scrolls sideways under that instead of printing one over the next", async () => {
    renderApp("/trace");
    await rowsOf();
    const table = screen.getByRole("table", { name: "Prompts and the path each took" });
    const region = screen.getByRole("region", { name: /scrolls sideways/ });
    expect(region.contains(table)).toBe(true);
    expect(region.tabIndex).toBe(0);
    const REM = 16;
    const px = (value: string) => Number.parseFloat(value);
    const fixed = within(table).getAllByRole("columnheader").map((h) => px(getComputedStyle(h).width)).filter((w) => !Number.isNaN(w));
    expect(fixed).toHaveLength(5);
    const minWidth = px(getComputedStyle(table).minWidth);
    // "Suggested" keeps at least 6rem of its own, and the table still fits the card beside the open sidebar at 1280px (56rem).
    expect(minWidth - fixed.reduce((sum, w) => sum + w, 0)).toBeGreaterThanOrEqual(6 * REM);
    expect(minWidth).toBeLessThanOrEqual(56 * REM);
  });

  it("opens one turn: the whole decision, every step counted from the prompt, and the verdict in words", async () => {
    renderApp("/trace");
    const [followed] = await rowsOf();
    fireEvent.click(within(followed.head).getByRole("link"));
    expect(await screen.findByRole("heading", { level: 1, name: /^Prompt at / })).toBeTruthy();
    const graph = screen.getByRole("table", { name: "Requirement graph" });
    expect(within(graph).getByText("development.implementation")).toBeTruthy();
    expect(within(graph).getByText("skill:orbit:orbit-develop")).toBeTruthy();
    expect(within(graph).getByText(/pulled in by a provider/)).toBeTruthy();
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual(["+1 s · Skill orbit:orbit-develop", "+4 s · Orbit command cli/context", "+9 s · Tool Read", "+30 s · Orbit command cli/knowledge verify — failed"]);
    expect(screen.getByText("the router suggested orbit-develop, and the session used it")).toBeTruthy();
    expect(screen.getByText(/57 characters · fingerprint 3f2a9c1b7d4e \(salted — the text is never kept\)/)).toBeTruthy();
  });

  it("goes back to every prompt from the breadcrumb", async () => {
    const router = renderApp("/trace/e-mfx1a2b3-0a1b2c3d");
    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" });
    fireEvent.click(elementOf(within(trail).getByText("Trace").closest("a"), HTMLAnchorElement, "the Trace crumb"));
    expect(await screen.findByRole("heading", { level: 1, name: "Trace" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/trace");
  });

  it("reads a longer window only when asked", async () => {
    renderApp("/trace");
    await rowsOf();
    expect(server.calls.some((c) => c.path === "/api/v1/trace/turns?days=1")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Last 7 days" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/trace/turns?days=7")).toBe(true));
  });

  it("an empty trail says how it fills", async () => {
    vi.stubGlobal("fetch", fakeServer().fetch);
    renderApp("/trace");
    expect(await screen.findByRole("heading", { level: 2, name: "No prompts in this window" })).toBeTruthy();
    expect(screen.getByText(/unless its Trace option is switched off/)).toBeTruthy();
  });

  it("a turn the trail does not hold says so, in the server's words", async () => {
    renderApp("/trace/e-zz-00000000");
    expect(await screen.findByText("Could not read this turn")).toBeTruthy();
    expect(screen.getByText("no turn e-zz-00000000 in the last 90 days of the trail")).toBeTruthy();
  });

  it("a turn with no routing decision says why there is none, instead of an empty graph", async () => {
    vi.stubGlobal("fetch", fakeServer(undefined, fakeTrail({ turns: [fakeTurn({ routing: null, prompt: null, followed: { verdict: "nothing-routed", say: "no routing decision was recorded for this turn" } })] })).fetch);
    renderApp("/trace/e-mfx1a2b3-0a1b2c3d");
    expect(await screen.findByText(/No routing decision was recorded — the router was off/)).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Requirement graph" })).toBeNull();
    const description = required(screen.getByText(/no prompt was recorded for these steps/), "the prompt line");
    expect(description.textContent).not.toMatch(/fingerprint/);
  });
});
