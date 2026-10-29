// .test.tsx, not .test.ts: see SkillsPage.test.tsx for why.
import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptTokenFromUrl, api, ApiError, mutationToken, TOKEN_HEADER } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the API client", () => {
  it("takes the token from the #fragment into this tab's storage and wipes it from the address bar", () => {
    window.history.replaceState(null, "", "/?x=1#token=abc-123");
    adoptTokenFromUrl();
    expect(mutationToken()).toBe("abc-123");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?x=1");
  });

  it("sends the token on a change and never on a read", async () => {
    window.sessionStorage.setItem("orbit.control.token", "tok");
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await api.get("/api/v1/skills");
    await api.delete("/api/v1/skills/x");
    const headers = fetch.mock.calls.map((c) => ((c as unknown[])[1] as RequestInit).headers as Record<string, string>);
    expect(headers[0][TOKEN_HEADER]).toBeUndefined();
    expect(headers[1][TOKEN_HEADER]).toBe("tok");
  });

  it("turns the server's error shape, a non-JSON answer and a dead server into one ApiError", async () => {
    const answers = [
      new Response(JSON.stringify({ error: { code: "INVALID_SKILL", message: "no", details: ["a", "b"] } }), { status: 400 }),
      new Response("<html>proxy error</html>", { status: 502 }),
      new Response(JSON.stringify({ error: { code: "AUTH_LOGIN_FAILED", message: "the sign-in failed", next: "sign in again" } }), { status: 503 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 400, code: "INVALID_SKILL", message: "no", details: ["a", "b"] });
    await expect(api.get("/x")).rejects.toMatchObject({ status: 502, code: "HTTP_502" });
    await expect(api.get("/x")).rejects.toMatchObject({ status: 503, code: "AUTH_LOGIN_FAILED", next: "sign in again" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
  });
});
