import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClaudeStatus, readClaudeLogin } from "./claude-auth.service.js";

test("claude auth status (JSON) says whether it is signed in and how", () => {
  assert.deepEqual(parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'), { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" });
  assert.deepEqual(parseClaudeStatus('{"loggedIn":false}'), { loggedIn: false, authMethod: null, apiProvider: null });
  assert.equal(parseClaudeStatus("Not logged in"), null);
});

test("claude auth login: the URL after visit:, and the prompt for the code (no newline after it)", () => {
  const url = "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz";
  assert.deepEqual(readClaudeLogin(`Opening browser to sign in…\nIf the browser didn't open, visit: ${url}\n`), { url, needsCode: false });
  assert.deepEqual(readClaudeLogin(`If the browser didn't open, visit: ${url}\nPaste code here if prompted > `), { url, needsCode: true });
});
