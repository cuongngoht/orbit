import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelta } from "./events.js";
import {
  checkClaudeLogin,
  checkCreateSession,
  checkLoginCode,
  checkSendMessage,
  checkUpdateSession,
  checkUpdateSettings,
  isBranchName,
  splitFullName,
} from "./validate.js";

test("a repository is owner/name and nothing that could be a path or an option", () => {
  assert.deepEqual(splitFullName("cuongngoht/orbit"), { owner: "cuongngoht", name: "orbit" });
  assert.deepEqual(splitFullName("a-b/c.d_e"), { owner: "a-b", name: "c.d_e" });
  for (const bad of ["orbit", "a/b/c", "../x", "a/..", "-a/b", "a/ b", "a/b;rm", "", 7, null]) assert.equal(splitFullName(bad), null, String(bad));
});

test("a branch name follows git's rules and never starts like an option", () => {
  for (const ok of ["main", "feature/x-1", "release-0.7.0", "v1.2"]) assert.equal(isBranchName(ok), true, ok);
  for (const bad of ["", "-rf", "a..b", "a b", "a~1", "a^", "a:b", "x.lock", "x/", "/x", "@", "a@{1}", ".hidden", "a//b", "a\u0000"]) assert.equal(isBranchName(bad), false, bad);
});

test("a new session needs a repository, a branch and a model, and refuses fields it does not know", () => {
  const ok = checkCreateSession({ repository: "o/r", branch: "main", model: "sonnet", title: "  Fix it  ", prompt: "hello" });
  assert.deepEqual(ok, { ok: true, value: { repository: "o/r", branch: "main", model: "sonnet", title: "Fix it", prompt: "hello" } });
  const bad = checkCreateSession({ repository: "o", branch: "-x", model: "gpt", extra: 1 });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok ? 0 : bad.errors.length, 4);
  assert.equal(checkCreateSession([]).ok, false);
});

test("a message is non-empty text of a bounded length", () => {
  assert.equal(checkSendMessage({ text: "go" }).ok, true);
  assert.equal(checkSendMessage({ text: "   " }).ok, false);
  assert.equal(checkSendMessage({ text: "x".repeat(100_001) }).ok, false);
  assert.equal(checkSendMessage({ text: "go", command: "rm" }).ok, false);
});

test("an update names something to change", () => {
  assert.equal(checkUpdateSession({}).ok, false);
  assert.deepEqual(checkUpdateSession({ model: "opus" }), { ok: true, value: { model: "opus" } });
  assert.equal(checkUpdateSettings({ webTools: "yes" }).ok, false);
  assert.deepEqual(checkUpdateSettings({ theme: "dark" }), { ok: true, value: { theme: "dark" } });
});

test("a sign-in code is printable and has no whitespace", () => {
  assert.deepEqual(checkLoginCode({ code: " abc#DEF-123 " }), { ok: true, value: { code: "abc#DEF-123" } });
  assert.equal(checkLoginCode({ code: "a b" }).ok, false);
  assert.equal(checkLoginCode({ code: "" }).ok, false);
});

test("a delta never doubles text a client already holds, and a gap waits", () => {
  assert.equal(applyDelta("", { messageId: "m", offset: 0, text: "Hel" }), "Hel");
  assert.equal(applyDelta("Hel", { messageId: "m", offset: 3, text: "lo" }), "Hello");
  assert.equal(applyDelta("Hello", { messageId: "m", offset: 0, text: "Hello, world" }), "Hello, world");
  assert.equal(applyDelta("Hello", { messageId: "m", offset: 2, text: "llo" }), "Hello");
  assert.equal(applyDelta("He", { messageId: "m", offset: 5, text: "!" }), "He");
});

test("an Azure tenant is a GUID or a domain, never an option", async () => {
  const { checkAzureLogin } = await import("./validate.js");
  assert.deepEqual(checkAzureLogin(undefined), { ok: true, value: {} });
  assert.deepEqual(checkAzureLogin({ tenant: " contoso.onmicrosoft.com " }), { ok: true, value: { tenant: "contoso.onmicrosoft.com" } });
  assert.deepEqual(checkAzureLogin({ tenant: "72f988bf-86f1-41af-91ab-2d7cd011db47" }), { ok: true, value: { tenant: "72f988bf-86f1-41af-91ab-2d7cd011db47" } });
  assert.deepEqual(checkAzureLogin({ tenant: "" }), { ok: true, value: {} });
  for (const bad of ["--allow-no-subscriptions", "a b.com", "x", "contoso", { a: 1 }]) assert.equal(checkAzureLogin({ tenant: bad }).ok, false, String(bad));
  assert.equal(checkAzureLogin({ tenant: "contoso.com", extra: 1 }).ok, false);
});

test("the Claude sign-in takes no mode: a Claude account is the only sign-in", () => {
  assert.deepEqual(checkClaudeLogin(undefined), { ok: true, value: null });
  assert.deepEqual(checkClaudeLogin(null), { ok: true, value: null });
  assert.deepEqual(checkClaudeLogin({}), { ok: true, value: null });
  assert.equal(checkClaudeLogin({ mode: "console" }).ok, false);
  assert.equal(checkClaudeLogin({ mode: "claudeai" }).ok, false);
  assert.equal(checkClaudeLogin("claudeai").ok, false);
});
