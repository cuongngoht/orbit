// The feed follows the newest line while the person is at the bottom, stops the moment they scroll up to
// read, and a button says how many lines arrived and takes them back. Every glyph carries its word.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { required } from "../../../testing/required";
import { LiveTimeline, NEAR_BOTTOM_PX, type TimelineProps } from "./LiveTimeline";
import type { LiveEvent } from "./live.types";
import { rowOf } from "./liveWords";

const labels = new Map<string, string>();
const rowsOf = (count: number) => Array.from({ length: count }, (_, n): LiveEvent => ({ source: "task", n, at: `2026-10-08T09:00:${String(n % 60).padStart(2, "0")}.000Z`, kind: n % 2 ? "action-failed" : "stage", stage: "TESTING", id: `act-${n}` })).map((e) => rowOf(e, labels));

function shown(over: Partial<TimelineProps> = {}) {
  const props: TimelineProps = { rows: rowsOf(6), hidden: 0, filter: "all", following: true, newSinceFollow: 0, onFollow: vi.fn(), onUnfollow: vi.fn(), onLoadEarlier: vi.fn(), ...over };
  const view = render(<LiveTimeline {...props} />);
  return { props, view, scroller: required(within(view.container).getByTestId("live-scroll"), "the scroll box") };
}

// jsdom has no layout: give the box the sizes a browser would.
function sized(el: HTMLElement, height: number, client: number, top: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: client });
  el.scrollTop = top;
}

describe("the live timeline", () => {
  it("follows the newest line while the person is at the bottom", () => {
    const { props, view, scroller } = shown();
    sized(scroller, 1000, 300, 0);
    view.rerender(<LiveTimeline {...props} rows={rowsOf(7)} />);
    expect(scroller.scrollTop).toBe(1000);
  });

  it("scrolling up pauses following; scrolling back near the bottom resumes it", () => {
    const { props, scroller } = shown();
    sized(scroller, 1000, 300, 100);
    fireEvent.scroll(scroller);
    expect(props.onUnfollow).toHaveBeenCalledTimes(1);
    const again = shown({ following: false });
    sized(again.scroller, 1000, 300, 1000 - 300 - NEAR_BOTTOM_PX + 1);
    fireEvent.scroll(again.scroller);
    expect(again.props.onFollow).toHaveBeenCalledTimes(1);
  });

  it("while paused, a button says how many lines arrived and takes the person back to them", () => {
    const { props, scroller } = shown({ following: false, newSinceFollow: 12 });
    sized(scroller, 2000, 300, 10);
    fireEvent.click(screen.getByRole("button", { name: "↓ 12 new events" }));
    expect(scroller.scrollTop).toBe(2000);
    expect(props.onFollow).toHaveBeenCalledTimes(1);
  });

  it("marks only the newest line as new, says which lines failed in words, and every glyph has a word for a screen reader", () => {
    shown();
    const items = within(screen.getByRole("list", { name: "Timeline" })).getAllByRole("listitem");
    expect(items.filter((li) => li.dataset.new === "true")).toEqual([items.at(-1)]);
    expect(items[1].textContent).toMatch(/\(failed\)$/);
    for (const img of screen.getAllByRole("img")) expect(img.getAttribute("aria-label")).toBeTruthy();
  });

  it("rows beyond the window are offered back, and a filter with nothing in it says so", () => {
    const { props } = shown({ hidden: 25 });
    fireEvent.click(screen.getByRole("button", { name: "Load earlier (25 not shown)" }));
    expect(props.onLoadEarlier).toHaveBeenCalledTimes(1);
    render(<LiveTimeline {...props} hidden={0} filter="files" />);
    expect(screen.getByText("No line matches this filter.")).toBeTruthy();
  });
});
