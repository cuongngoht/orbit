import assert from "node:assert/strict";
import { test } from "node:test";
import { cookieValue, hostnameOf, isSharedRead } from "./guards.js";

test("the host name of a Host header", () => {
  assert.equal(hostnameOf("localhost:3000"), "localhost");
  assert.equal(hostnameOf("[::1]:3000"), "::1");
  assert.equal(hostnameOf("127.0.0.1"), "127.0.0.1");
  assert.equal(hostnameOf("Evil.Example:80"), "evil.example");
  assert.equal(hostnameOf(undefined), null);
});

test("a cookie value by name", () => {
  assert.equal(cookieValue("a=1; orbit_web_access=tok%3Dx; b=2", "orbit_web_access"), "tok=x");
  assert.equal(cookieValue(undefined, "x"), null);
});

test("a link's token opens one thing before the access token: reading that shared chat", () => {
  assert.equal(isSharedRead({ method: "GET", path: "/api/shared/abc" }), true);
  assert.equal(isSharedRead({ method: "HEAD", path: "/api/shared/abc" }), true);
  for (const r of [
    { method: "POST", path: "/api/shared/abc" },
    { method: "DELETE", path: "/api/shared/abc" },
    { method: "GET", path: "/api/shared/abc/more" },
    { method: "GET", path: "/api/shared/" },
    { method: "GET", path: "/api/sharedabc" },
    { method: "GET", path: "/api/sessions/abc/share" },
  ]) assert.equal(isSharedRead(r), false, `${r.method} ${r.path}`);
});
