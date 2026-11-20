// The HTTP surface's guards: host allow-list (DNS rebinding), the CSRF header and origin, JSON bodies of a bounded
// size, input validation, and the access token mode.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import { startHarness, type Harness } from "../../src/testing/harness.js";

// fetch() will not send a Host header of our choosing; node:http will.
function rawGet(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the default, loopback-only surface", () => {
  let h: Harness;
  before(async () => (h = await startHarness()));
  after(() => h.close());

  test("a page that re-binds its own name to this address is refused by Host", async () => {
    assert.equal(await rawGet(`${h.url}/api/health`, "attacker.example:3000"), 421);
    assert.equal(await rawGet(`${h.url}/api/health`, "localhost:3000"), 200);
    assert.equal(await rawGet(`${h.url}/api/health`, "[::1]:3000"), 200);
  });

  test("a change needs the Orbit Web header, this origin and a JSON body", async () => {
    const naked = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"theme":"dark"}' });
    assert.equal(naked.status, 403);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" }, { origin: "https://attacker.example" })).status, 403);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" }, { "sec-fetch-site": "cross-site" })).status, 403);
    const form = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "x-orbit-web": "1", "content-type": "text/plain" }, body: "theme=dark" });
    assert.equal(form.status, 415);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" }, { origin: h.url })).status, 200);
  });

  test("bodies are bounded and validated; unknown fields are refused", async () => {
    assert.equal((await h.send("POST", "/api/sessions", { repository: { source: "github", id: "o/r" }, branch: "main", model: "sonnet", prompt: "x".repeat(300_000) })).status, 413);
    const bad = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "x-orbit-web": "1", "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 400);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark", shell: "rm -rf /" })).status, 400);
    assert.equal((await h.get("/api/sessions/not-a-uuid")).status, 404);
    assert.equal((await h.get("/api/sessions/00000000-0000-4000-8000-000000000000/changes")).status, 404);
  });

  test("every response carries the content security policy and no framework banner", async () => {
    const r = await h.get("/api/health");
    assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'self'; script-src 'self'/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-powered-by"), null);
  });

  test("the health check names no path, variable or account", async () => {
    const text = JSON.stringify((await h.get("/api/health")).body);
    assert.doesNotMatch(text, /\/data|\/tmp|HOME|token|octo/i);
  });
});

describe("token mode, for a host name beyond loopback", () => {
  let h: Harness;
  const token = "a-long-and-random-access-token";
  before(async () => (h = await startHarness({ env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: token } })));
  after(() => h.close());

  test("the API needs the token; health stays open for the container's health check", async () => {
    assert.equal((await h.get("/api/setup/status")).status, 401);
    assert.equal((await h.get("/api/health")).status, 200);
    assert.equal((await h.get("/api/setup/status", { authorization: `Bearer ${token}` })).status, 200);
  });

  test("the token is traded for an HttpOnly, SameSite=Strict cookie", async () => {
    assert.equal((await h.send("POST", "/api/access", { token: "wrong-token-of-enough-length" })).status, 401);
    const ok = await h.send("POST", "/api/access", { token });
    assert.equal(ok.status, 204);
    const cookie = ok.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await h.get("/api/settings", { cookie: cookie.split(";")[0] as string })).status, 200);
  });
});
