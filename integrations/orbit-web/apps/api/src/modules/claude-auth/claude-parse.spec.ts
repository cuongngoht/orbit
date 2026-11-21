import assert from "node:assert/strict";
import { test } from "node:test";
import { identityOf, parseClaudeStatus, readClaudeLogin, signInOf, type CliStatus } from "./claude-auth.service.js";

const cli = (over: Partial<CliStatus>): CliStatus => ({ loggedIn: false, authMethod: null, apiProvider: null, email: null, orgId: null, orgName: null, subscriptionType: null, ...over });

test("claude auth status (JSON) says whether it is signed in, how, and to which account", () => {
  // The shape claude 2.1.x prints for a Claude account sign-in (paths and ids left out: nothing reads them).
  const signedIn = '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","loginExpiresAt":"2026-12-19T11:19:26.532Z","email":"octo@example.com","orgId":"org-1","orgName":"Octo Org","subscriptionType":"team","storedClaudeAiLogin":true}';
  assert.deepEqual(parseClaudeStatus(signedIn), cli({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "octo@example.com", orgId: "org-1", orgName: "Octo Org", subscriptionType: "team" }));
  assert.deepEqual(parseClaudeStatus('{"loggedIn":false,"authMethod":"none"}'), cli({ authMethod: "none" }));
  assert.deepEqual(parseClaudeStatus('{"loggedIn":false,"email":"  ","orgName":7}'), cli({}));
  assert.equal(parseClaudeStatus("Not logged in"), null);
  assert.equal(parseClaudeStatus('{"authMethod":"claude.ai"}'), null);
});

test("only a Claude account signs Orbit Web in, and the account is who it is", () => {
  const account = signInOf(cli({ loggedIn: true, authMethod: "claude.ai", email: "octo@example.com", orgName: "Octo Org", subscriptionType: "max" }), []);
  assert.deepEqual(account, { state: "connected", method: "claude.ai", account: { email: "octo@example.com", organization: "Octo Org", plan: "max" }, detail: null });
  for (const method of ["api_key", "oauth_token", "console", null]) {
    const other = signInOf(cli({ loggedIn: true, authMethod: method, email: "octo@example.com" }), []);
    assert.equal(other.state, "not_connected", String(method));
    assert.equal(other.account, null, "no identity is shown for what is not a Claude account");
    assert.match(other.detail ?? "", /not a Claude account/);
  }
  assert.deepEqual(signInOf(cli({ authMethod: "none" }), []), { state: "not_connected", method: null, account: null, detail: null });
});

test("a credential variable the container was started with is named as ignored -- by name, never by value", () => {
  const signedOut = signInOf(cli({}), ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);
  assert.equal(signedOut.state, "not_connected");
  assert.equal(signedOut.detail, "This container was started with CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY; Orbit Web ignores them: it signs in with a Claude account only.");
  const signedIn = signInOf(cli({ loggedIn: true, authMethod: "claude.ai" }), ["ANTHROPIC_API_KEY"]);
  assert.equal(signedIn.state, "connected");
  assert.match(signedIn.detail ?? "", /ANTHROPIC_API_KEY; Orbit Web ignores it/);
});

test("claude auth login: the URL after visit:, and the prompt for the code (no newline after it)", () => {
  const url = "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz";
  assert.deepEqual(readClaudeLogin(`Opening browser to sign in…\nIf the browser didn't open, visit: ${url}\n`), { url, needsCode: false });
  assert.deepEqual(readClaudeLogin(`If the browser didn't open, visit: ${url}\nPaste code here if prompted > `), { url, needsCode: true });
});

test("an identity is the account's email in the organization the CLI names by id -- never by a display name -- and nothing at all without a Claude account's email", () => {
  assert.deepEqual(identityOf(cli({ loggedIn: true, authMethod: "claude.ai", email: "Octo@Example.com", orgId: "org-1", orgName: "Octo Org", subscriptionType: "team" })), {
    email: "octo@example.com",
    orgKey: "org-1",
    orgName: "Octo Org",
    plan: "team",
    key: "octo@example.com|org-1",
  });
  const renamed = identityOf(cli({ loggedIn: true, authMethod: "claude.ai", email: "octo@example.com", orgId: "org-1", orgName: "Octo Org (renamed)" }));
  assert.equal(renamed?.key, "octo@example.com|org-1", "renaming the organization changes nobody's identity");
  const other = identityOf(cli({ loggedIn: true, authMethod: "claude.ai", email: "octo@example.com", orgId: "org-2", orgName: "Octo Org" }));
  assert.notEqual(other?.key, "octo@example.com|org-1", "the same email in another organization is another identity, even under the same name");
  assert.equal(identityOf(cli({ loggedIn: true, authMethod: "claude.ai", email: "octo@example.com", orgName: "Octo Org" }))?.orgKey, "", "a CLI that names no organization id: the email alone, never the organization's name");
  assert.equal(identityOf(cli({ loggedIn: true, authMethod: "claude.ai" })), null, "no email: no identity, so nothing is anybody's");
  assert.equal(identityOf(cli({ loggedIn: true, authMethod: "api_key", email: "octo@example.com" })), null, "an API key owns nothing");
  assert.equal(identityOf(cli({ email: "octo@example.com" })), null, "signed out");
});
