// The HTTP surface's guards: host allow-list (DNS rebinding), the CSRF header, the session's CSRF token and the origin,
// JSON bodies of a bounded size, input validation, and the access token mode -- where the token opens the door and a
// browser's own Claude sign-in is still what makes it somebody.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import { SIGN_IN_REQUIRED, CSRF_HEADER } from "@orbit-web/contracts";
import { isAgentPath } from "../../src/infra/security/guards.js";
import { browserAt, signInBrowser, startHarness, TEST_PASSWORD, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { routesOf } from "../../src/testing/routes.js";

const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

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

// What an employee's tool bridge sends from its model plane: Orbit Web's name on the attempt's network as Host, the
// Orbit Web header and a JSON body -- and here no run token, so the answer says which gate stopped it.
function bridgePost(url: string, host: string): Promise<{ status: number; code: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { host, "x-orbit-web": "1", "content-type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString()));
      res.on("end", () => {
        let code: string | undefined;
        try {
          code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
        } catch {
          code = undefined;
        }
        resolve({ status: res.statusCode ?? 0, code });
      });
    });
    req.on("error", reject);
    req.end("{}");
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

  test("a change also needs this browser session's own CSRF token: a signed-in cookie alone changes nothing", async () => {
    const wrong = await h.send("PATCH", "/api/settings", { theme: "light" }, { [CSRF_HEADER]: "0".repeat(64) });
    assert.equal(wrong.status, 403);
    assert.equal(errorCode(wrong), "csrf_invalid");
    const none = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "x-orbit-web": "1", "content-type": "application/json", cookie: h.cookie }, body: '{"theme":"light"}' });
    assert.equal(none.status, 403);
    assert.equal((await h.get("/api/settings")).status, 200, "reading needs no CSRF token");
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

  test("on this machine alone there is no access link: nothing to give", async () => {
    assert.deepEqual((await h.get("/api/access/link")).body, { token: null });
  });

  test("the health check names no path, variable or account", async () => {
    const text = JSON.stringify((await h.get("/api/health")).body);
    assert.doesNotMatch(text, /\/data|\/tmp|HOME|token|octo/i);
  });

  // An employee's bridge reaches its tools by Orbit Web's name on the attempt's network (`orbit-web`), never a loopback
  // name: refused by Host there, the bridge lists no tool, and the employee runs with nothing to work or hand in with.
  test("an employee's tool bridge reaches its door by Orbit Web's name on the attempt network: its run token decides, not Host", async () => {
    for (const path of ["/api/runtime/tools/list", "/api/runtime/tools/call"]) {
      const r = await bridgePost(`${h.url}${path}`, "orbit-web:3000");
      assert.equal(r.status, 401, path);
      assert.equal(r.code, "run_token_required", path);
    }
  });

  test("every agent door -- every route declared @AgentGateway -- is one the HTTP guards pass to its run token", () => {
    const doors = routesOf(h).filter((r) => r.agent);
    assert.ok(doors.some((r) => r.path.startsWith("/api/runtime/tools/")), "the employees' tool endpoint is an agent door");
    assert.ok(doors.some((r) => r.path.startsWith("/api/agent/")), "the chats' agent gateway is one");
    for (const r of doors) assert.equal(isAgentPath({ path: r.path }), true, `${r.method} ${r.path}`);
  });
});

describe("token mode, for a host name beyond loopback", () => {
  let h: Harness;
  // A browser that traded the token for its cookie, then finished its own Claude sign-in.
  let owner: Browser;
  const token = "a-long-and-random-access-token";
  before(async () => {
    h = await startHarness({ env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: token } });
    const jar: Record<string, string> = {};
    assert.equal((await browserAt(h.url, jar).send("POST", "/api/access", { token })).status, 204);
    owner = await signInBrowser(h.url, "octo", TEST_PASSWORD, jar);
  });
  after(() => h.close());

  test("an employee's tool bridge holds no access token: its door still answers its run token alone", async () => {
    const r = await bridgePost(`${h.url}/api/runtime/tools/list`, "orbit-web:3000");
    assert.equal(r.status, 401);
    assert.equal(r.code, "run_token_required");
  });

  test("the API needs the token, then a browser's own sign-in; health stays open for the container's health check", async () => {
    assert.equal(errorCode(await h.anonymous.get("/api/setup/status")), "access_token_required");
    assert.equal((await h.anonymous.get("/api/health")).status, 200);
    const tokenOnly = await h.anonymous.get("/api/setup/status", { authorization: `Bearer ${token}` });
    assert.equal(tokenOnly.status, 401, "the token opens the door; it is nobody's sign-in");
    assert.equal(errorCode(tokenOnly), SIGN_IN_REQUIRED);
    assert.equal((await owner.get("/api/setup/status")).status, 200);
  });

  test("the token is traded for an HttpOnly, SameSite=Strict cookie kept 30 days, so a browser is asked for it once", async () => {
    assert.equal((await h.anonymous.send("POST", "/api/access", { token: "wrong-token-of-enough-length" })).status, 401);
    const ok = await h.anonymous.send("POST", "/api/access", { token });
    assert.equal(ok.status, 204);
    const cookie = ok.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=2592000/, "not a session cookie: a browser restart or a redeploy asks for nothing again");
    const cookieOnly = await fetch(`${h.url}/api/settings`, { headers: { cookie: cookie.split(";")[0] as string } });
    assert.equal(cookieOnly.status, 401, "past the token, the browser signs in with Claude");
    assert.equal(((await cookieOnly.json()) as { error: { code: string } }).error.code, SIGN_IN_REQUIRED);
    assert.equal((await owner.get("/api/settings")).status, 200);
  });

  test("the API is /api/ and nothing else: no other spelling of it -- case, repeated slashes -- gets past the token", async () => {
    for (const path of ["/API/sessions", "/Api/settings", "/API/access/link", "/api/ACCESS/link", "//api/sessions", "/aPi/setup/status"]) {
      const r = await h.anonymous.get(path);
      assert.notEqual(r.status, 200, path);
      assert.equal(JSON.stringify(r.body).includes(token), false, path);
    }
    const write = await fetch(`${h.url}/API/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"theme":"dark"}' });
    assert.notEqual(write.status, 200, "a change spelled otherwise needs the token and the header too");
  });

  test("the access link is given only to whoever is already in, never cached", async () => {
    assert.equal((await h.anonymous.get("/api/access/link")).status, 401);
    assert.equal((await h.anonymous.get("/api/access/link", { authorization: `Bearer ${token}` })).status, 401, "in means signed in, not only past the token");
    const r = await owner.get("/api/access/link");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { token });
    assert.equal(r.headers.get("cache-control"), "no-store");
  });
});
