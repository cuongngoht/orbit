import assert from "node:assert/strict";
import { test } from "node:test";
import { titleFrom } from "./sessions.service.js";

test("a chat's title is its first line, masked before it is cut, so no piece of a credential is ever kept", () => {
  const token = `ghp_${"A".repeat(36)}`;
  const title = titleFrom(`Deploy it, my key is ${token} and the region is eu-west`, null);
  assert.equal(title.includes("ghp_"), false, title);
  assert.match(title, /^Deploy it, my key is \[redacted-github-token\]/);
  assert.equal(titleFrom("", "octo/sum"), "Chat on octo/sum");
  assert.equal(titleFrom("x".repeat(80), null).length, 60);
});
