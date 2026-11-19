// jsdom lacks matchMedia, ResizeObserver and EventSource; Fluent UI asks for the first two, the app for the third.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { FakeEventSource } from "./fakeEventSource";

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { writable: true, value: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
});
Object.defineProperty(window, "EventSource", { writable: true, value: FakeEventSource });
Object.defineProperty(globalThis, "EventSource", { writable: true, value: FakeEventSource });
Element.prototype.scrollIntoView = () => {};

// jsdom has no layout: offsetParent is always null and every rectangle is empty. Fluent UI's focus manager (tabster)
// reads both to decide what is visible, so under jsdom nothing is focusable: a dialog then focuses its own surface, a
// path no browser takes, tabster never activates that dialog's modal, and one opened while an earlier dialog's
// aria-hidden update is pending is left hidden from the accessibility tree. Answer as a browser does for what is rendered.
const unrendered = (el: Element) => {
  for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).display === "none") return true;
  return !el.isConnected;
};
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get(this: HTMLElement): Element | null {
    if (this === document.body || this === document.documentElement || unrendered(this) || getComputedStyle(this).position === "fixed") return null;
    return this.parentElement;
  },
});
HTMLBodyElement.prototype.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 800 });

beforeEach(() => FakeEventSource.reset());
afterEach(() => cleanup());
