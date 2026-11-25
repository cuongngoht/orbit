import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import { fakeApi, withStatus } from "../testing/fakeApi";
import { authStatus, sessionViews, settings, setupStatus, signedOut, sources } from "../testing/fixtures";
import { isMobileShell, notifyMobileReady, notifyMobileSignedOut, requestMobileRefresh, takeMobileBootstrap } from "./mobileBridge";

const refused = (status: number, code: string, message: string) => withStatus(status, { error: { code, message } });

afterEach(() => {
  delete window.flutter_inappwebview;
  window.location.hash = "";
  window.localStorage.clear();
});

describe("mobileBridge", () => {
  test("outside the mobile shell every helper is a safe no-op", async () => {
    expect(isMobileShell()).toBe(false);
    expect(await takeMobileBootstrap()).toBeNull();
    expect(await requestMobileRefresh()).toBeNull();
    expect(() => notifyMobileReady()).not.toThrow();
    expect(() => notifyMobileSignedOut(false)).not.toThrow();
  });

  test("inside the mobile shell, initial bootstrap exchanges the single-use code without flashing SignInPage", async () => {
    let signedInNow = false;
    const calls: { name: string; args: unknown[] }[] = [];
    window.flutter_inappwebview = {
      callHandler: async (name: string, ...args: unknown[]) => {
        calls.push({ name, args });
        if (name === "takeBootstrap") return { exchangeCode: "c".repeat(43) };
        return null;
      },
    };
    const api = fakeApi()
      .on("GET", "/api/auth/status", () => (signedInNow ? authStatus() : signedOut()))
      .on("POST", "/api/auth/mobile/exchange", () => ((signedInNow = true), authStatus()))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sessions", () => [])
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/setup/status", () => setupStatus())
      .on("GET", "/api/auth/sessions", () => sessionViews());

    render(<App />);
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Orbit Web" })).toBeNull();
    expect(api.calls.find((c) => c.path === "/api/auth/mobile/exchange")?.body).toEqual({ code: "c".repeat(43) });
    await waitFor(() => expect(calls.some((c) => c.name === "onWebReady")).toBe(true));
  });

  test("in token mode, bootstrap trades accessToken via /api/access then exchanges the code", async () => {
    let accessGranted = false;
    let signedInNow = false;
    window.flutter_inappwebview = {
      callHandler: async (name: string) => {
        if (name === "takeBootstrap") return { accessToken: "t".repeat(32), exchangeCode: "e".repeat(43) };
        return null;
      },
    };
    const api = fakeApi()
      .on("GET", "/api/auth/status", () => (!accessGranted ? refused(401, "access_token_required", "Access token needed.") : signedInNow ? authStatus() : signedOut()))
      .on("POST", "/api/access", () => ((accessGranted = true), withStatus(204)))
      .on("POST", "/api/auth/mobile/exchange", () => ((signedInNow = true), authStatus()))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sessions", () => [])
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/setup/status", () => setupStatus());

    render(<App />);
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === "/api/access")?.body).toEqual({ token: "t".repeat(32) });
    expect(api.calls.find((c) => c.path === "/api/auth/mobile/exchange")?.body).toEqual({ code: "e".repeat(43) });
  });

  test("when session expires mid-use, bridge triggers onAuthExpired and restores the workspace seamlessly", async () => {
    let signedInNow = false;
    const calls: string[] = [];
    window.flutter_inappwebview = {
      callHandler: async (name: string) => {
        calls.push(name);
        if (name === "takeBootstrap") return null;
        if (name === "onAuthExpired") return { exchangeCode: "r".repeat(43) };
        return null;
      },
    };
    fakeApi()
      .on("GET", "/api/auth/status", () => (signedInNow ? authStatus() : signedOut()))
      .on("POST", "/api/auth/mobile/exchange", () => ((signedInNow = true), authStatus()))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sessions", () => [])
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/setup/status", () => setupStatus());

    render(<App />);
    expect(await screen.findByRole("heading", { name: "What should Orbit work on?" })).toBeInTheDocument();
    expect(calls).toContain("takeBootstrap");
    expect(calls).toContain("onAuthExpired");
  });

  test("signing out inside the web app notifies the native shell via onSignedOut", async () => {
    let signedInNow = true;
    const calls: { name: string; args: unknown[] }[] = [];
    window.flutter_inappwebview = {
      callHandler: async (name: string, ...args: unknown[]) => {
        calls.push({ name, args });
        return null;
      },
    };
    fakeApi()
      .on("GET", "/api/auth/status", () => (signedInNow ? authStatus() : signedOut()))
      .on("POST", "/api/auth/logout", () => ((signedInNow = false), withStatus(204)))
      .on("GET", "/api/settings", () => settings())
      .on("GET", "/api/sessions", () => [])
      .on("GET", "/api/sources", () => sources())
      .on("GET", "/api/setup/status", () => setupStatus());

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ann Owner" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(calls.some((c) => c.name === "onSignedOut" && JSON.stringify(c.args) === JSON.stringify([{ everywhere: false }]))).toBe(true));
  });

  test("subscribe reconnects closed EventSource when document becomes visible again", async () => {
    const prevEventSource = globalThis.EventSource;
    const created: { readyState: number; close: ReturnType<typeof vi.fn>; onmessage: unknown; onopen: unknown; onerror: unknown }[] = [];
    class MockEventSource {
      readyState = 1;
      onmessage = null;
      onopen = null;
      onerror = null;
      close = vi.fn(() => {
        this.readyState = 2;
      });
      constructor() {
        created.push(this);
      }
    }
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    try {
      const { subscribe } = await import("./sse");
      const sub = subscribe("/api/events", () => undefined);
      expect(created).toHaveLength(1);
      created[0]!.readyState = 2;
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(created).toHaveLength(2);
      sub.close();
    } finally {
      globalThis.EventSource = prevEventSource;
    }
  });
});
