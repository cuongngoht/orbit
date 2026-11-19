import assert from "node:assert/strict";
import { test } from "node:test";
import { DeltaRedactor } from "./delta-redactor.js";

const feed = (pieces: string[]): string => {
  const r = new DeltaRedactor();
  return pieces.map((p) => r.push(p)).join("");
};

test("text streams as soon as a word is complete", () => {
  const r = new DeltaRedactor();
  assert.equal(r.push("Hello wor"), "Hello ");
  assert.equal(r.push("ld, and "), "world, and ");
  assert.equal(r.push("more\nnext"), "more\n");
});

test("a token split across pieces is never sent", () => {
  const token = `ghp_${"Z9".repeat(20)}`;
  const sent = feed(["The token is ", token.slice(0, 10), token.slice(10), " done\n"]);
  assert.doesNotMatch(sent, /ghp_/);
  assert.match(sent, /\[redacted-github-token\] done\n$/);
});

test("an assignment split across pieces is masked before it is sent", () => {
  const sent = feed(["export GH_TO", "KEN=abc", "def123 next\n"]);
  assert.equal(sent, "export GH_TOKEN=[redacted] next\n");
});

test("a private key block is held back whole", () => {
  const sent = feed(["-----BEGIN RSA PRIVATE KEY-----\n", "MIIEsecretline\n", "-----END RSA PRIVATE KEY-----\n", "after\n"]);
  assert.doesNotMatch(sent, /MIIEsecret/);
  assert.match(sent, /after\n$/);
});
