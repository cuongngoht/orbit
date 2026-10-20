// jsdom has no matchMedia and no ResizeObserver; the theme picker asks the
// first and Fluent UI's MessageBar the second.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { writable: true, value: NoResizeObserver });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
