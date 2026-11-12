// The egress proxy's one rule: CONNECT to an allowed host on 443, nothing else.
import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTarget } from "../lib/container/egress.mjs";

test("only an allowed host on 443 gets through", () => {
  const hosts = ["api.anthropic.com"];
  assert.equal(allowedTarget("api.anthropic.com:443", hosts).ok, true);
  assert.equal(allowedTarget("API.Anthropic.com.:443", hosts).ok, true);
  assert.equal(allowedTarget("api.anthropic.com:80", hosts).ok, false);
  assert.equal(allowedTarget("example.com:443", hosts).ok, false);
  assert.equal(allowedTarget("api.anthropic.com.evil.com:443", hosts).ok, false);
  assert.equal(allowedTarget("1.2.3.4:443", hosts).ok, false);
  assert.equal(allowedTarget("api.anthropic.com:443/x", hosts).ok, false);
  assert.equal(allowedTarget("", hosts).ok, false);
});
