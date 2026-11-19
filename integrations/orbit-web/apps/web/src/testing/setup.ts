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

beforeEach(() => FakeEventSource.reset());
afterEach(() => cleanup());
