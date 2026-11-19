import assert from "node:assert/strict";
import { test } from "node:test";
import { cookieValue, hostnameOf } from "./guards.js";

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
