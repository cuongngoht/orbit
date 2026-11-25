import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunResult } from "../../infra/process/process.port.js";
import { mayCreate, METHOD_SUPPORT, supportOf } from "./methods.js";
import { chatgptUnnamed, claudeCapabilities, CODEX_ACCOUNT_REQUEST, codexCapabilities, codexAccountOf, codexAccountReading, keyIdentity, parseClaudeStatus, readClaudeStatus, readCodexStatus, readVersion, UNKNOWN_CAPABILITIES, type ClaudeCliStatus } from "./runtimes.js";

const cli = (over: Partial<ClaudeCliStatus>): ClaudeCliStatus => ({ loggedIn: false, authMethod: null, apiProvider: null, email: null, orgId: null, orgName: null, subscriptionType: null, ...over });
const ran = (over: Partial<RunResult>): RunResult => ({ code: 0, signal: null, spawnError: null, stdout: "", stderr: "", timedOut: false, truncated: false, ...over });

test("claude auth status (JSON) says whether it is signed in, how, and to which account", () => {
  const signedIn = '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","loginExpiresAt":"2026-12-19T11:19:26.532Z","email":"octo@example.com","orgId":"org-1","orgName":"Octo Org","subscriptionType":"team","storedClaudeAiLogin":true}';
  assert.deepEqual(parseClaudeStatus(signedIn), cli({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "octo@example.com", orgId: "org-1", orgName: "Octo Org", subscriptionType: "team" }));
  assert.deepEqual(parseClaudeStatus('{"loggedIn":false,"authMethod":"none"}'), cli({ authMethod: "none" }));
  assert.equal(parseClaudeStatus("Not logged in"), null);
  assert.equal(parseClaudeStatus('{"authMethod":"claude.ai"}'), null);
});

test("a subscription is connected only when the CLI names the Claude account -- by its email, in its organization's id", () => {
  const ok = readClaudeStatus(cli({ loggedIn: true, authMethod: "claude.ai", email: "Octo@Example.com", orgId: "org-1", orgName: "Octo Org" }), "subscription", null);
  assert.deepEqual(ok, { auth: "connected", reason: null, identity: "octo@example.com (Octo Org)", identityKey: "claude.ai:octo@example.com|org-1" });
  const renamed = readClaudeStatus(cli({ loggedIn: true, authMethod: "claude.ai", email: "octo@example.com", orgId: "org-1", orgName: "Renamed" }), "subscription", null);
  assert.equal(renamed.identityKey, ok.identityKey, "an organization's display name never tells two identities apart");
  assert.notEqual(readClaudeStatus(cli({ loggedIn: true, authMethod: "claude.ai", email: "octo@example.com", orgId: "org-2" }), "subscription", null).identityKey, ok.identityKey, "another organization is another identity");
  assert.equal(readClaudeStatus(cli({}), "subscription", null).auth, "disconnected");
  assert.equal(readClaudeStatus(cli({ loggedIn: true, authMethod: "claude.ai" }), "subscription", null).auth, "error", "no email: nothing can be held to one account");
  for (const method of ["api_key", "oauth_token", "console", null]) assert.equal(readClaudeStatus(cli({ loggedIn: true, authMethod: method, email: "octo@example.com" }), "subscription", null).auth, "auth_required", String(method));
});

test("an API key is named by its fingerprint, never by itself; a key the CLI did not take asks for it again", () => {
  const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
  const read = readClaudeStatus(cli({ loggedIn: true, authMethod: "api_key" }), "api_key", key);
  assert.equal(read.auth, "connected");
  assert.match(read.identity ?? "", /^Anthropic API key \(sha256:[0-9a-f]{12}\)$/);
  assert.equal(JSON.stringify(read).includes(key), false);
  assert.equal(read.identityKey, keyIdentity(key).key, "one key, one identity");
  assert.notEqual(keyIdentity(`${key}x`).key, read.identityKey);
  assert.equal(readClaudeStatus(cli({ loggedIn: false }), "api_key", key).auth, "auth_required");
  assert.equal(readClaudeStatus(cli({ loggedIn: true, authMethod: "api_key" }), "api_key", null).auth, "auth_required", "a key forgotten (disconnected) is not a login");
});

test("codex login status: a masked API key, a ChatGPT sign-in only when it names the account, or nobody", () => {
  const key = "sk-proj-abcdefghijklmnopqrstuvwxyz";
  assert.deepEqual(readCodexStatus(ran({ stderr: "Logged in using an API key - sk-proj-***vwxyz\n" }), "api_key", key).auth, "connected");
  assert.equal(readCodexStatus(ran({ stderr: "Logged in using an API key - sk-proj-***vwxyz\n" }), "subscription", null).auth, "auth_required");
  const chatgpt = readCodexStatus(ran({ stderr: "Logged in using ChatGPT\n" }), "subscription", null);
  assert.equal(chatgpt.auth, "error", "a sign-in that names no account cannot be held to one Orbit account");
  assert.match(chatgpt.reason ?? "", /names no account/);
  assert.deepEqual(readCodexStatus(ran({ stdout: "Logged in using ChatGPT (dev@example.com)\n" }), "subscription", null), { auth: "connected", reason: null, identity: "dev@example.com", identityKey: "chatgpt:dev@example.com" });
  assert.equal(readCodexStatus(ran({ code: 1, stderr: "Not logged in\n" }), "subscription", null).auth, "disconnected");
  assert.equal(readCodexStatus(ran({ code: 1, stderr: "boom\n" }), "subscription", null).auth, "error");
});

test("installed is what --version says: a version, nothing installed, or an error with the CLI's words", () => {
  assert.deepEqual(readVersion("Claude Code", ran({ stdout: "2.1.330 (Claude Code)\n" })), { state: "installed", version: "2.1.330", detail: null });
  assert.deepEqual(readVersion("OpenAI Codex", ran({ stdout: "codex-cli 0.46.0\n" })), { state: "installed", version: "0.46.0", detail: null });
  assert.equal(readVersion("Google Antigravity", ran({ code: null, spawnError: "ENOENT" })).state, "not_installed");
  assert.equal(readVersion("Claude Code", ran({ code: 2, stderr: "broken" })).state, "error");
  assert.equal(readVersion("Claude Code", ran({ stdout: "who knows" })).state, "error");
});

test("capabilities are what the binary's own --help lists: the tool plane splits only with --tools, --restricted and --strict-mcp-config", () => {
  const all = "  -p, --print\n  --output-format <f>\n  -r, --resume [v]\n  --allowedTools <t...>\n  --tools <t...>\n  --restricted\n  --strict-mcp-config\n  --plugin-dir <p...>\n";
  assert.deepEqual(claudeCapabilities(all), { start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit: "yes", pluginObservation: "yes" });
  assert.equal(claudeCapabilities(all.replace("  --restricted\n", "")).toolPlaneSplit, "no");
  assert.equal(claudeCapabilities(all.replace("  --tools <t...>\n", "")).toolPlaneSplit, "no", "--tools is not --toolsy, nor a substring of another flag");
  assert.deepEqual(claudeCapabilities(null), UNKNOWN_CAPABILITIES);
});

test("which methods are offered, and on what evidence: Antigravity's Google sign-in is not permitted, unverified ones are not offered", () => {
  assert.equal(METHOD_SUPPORT.length, 9, "every runtime, every method");
  assert.equal(supportOf("agy", "subscription").state, "not_permitted");
  assert.match(supportOf("agy", "subscription").note, /breach of this Agreement/);
  assert.equal(supportOf("agy", "api_key").state, "not_verified");
  assert.equal(supportOf("codex", "subscription").state, "supported");
  assert.match(supportOf("codex", "subscription").note, /interest form/);
  assert.equal(supportOf("claude", "cloud").state, "blocked");
  for (const m of METHOD_SUPPORT) assert.equal(mayCreate(m.runtime, m.method), m.state === "supported" || (m.runtime === "claude" && m.method === "cloud"), `${m.runtime}/${m.method}`);
});

test("a ChatGPT sign-in Codex's status names nobody in is named by its own app server (account/read), email and workspace", () => {
  assert.equal(chatgptUnnamed(ran({ stdout: "Logged in using ChatGPT\n" })), true, "codex-cli 0.169.0 names no account");
  assert.equal(chatgptUnnamed(ran({ stdout: "Logged in using ChatGPT (octo@example.com)\n" })), false);
  assert.equal(chatgptUnnamed(ran({ stderr: "Not logged in\n", code: 1 })), false);
  const asked = CODEX_ACCOUNT_REQUEST.trim().split("\n").map((l) => JSON.parse(l) as { method: string; params?: { refreshToken?: boolean } });
  assert.deepEqual(asked.map((m) => m.method), ["initialize", "initialized", "account/read"]);
  assert.equal(asked[2]?.params?.refreshToken, false, "no token is refreshed to answer");
  // What codex-cli 0.169.0's app server answered (the email and ids replaced).
  const answer = '{"id":1,"result":{"account":{"type":"chatgpt","email":"Octo@Example.com","planType":"team","workspaceName":"Octo Org"},"userId":"user-1","requiresOpenaiAuth":true,"workspaceRouting":{"chatgptAccountId":"ws-1","backendOrigin":"https://chatgpt.com","accountRoutingOverride":"NO_CONSTRAINT"}}}';
  const account = codexAccountOf(answer);
  assert.deepEqual(account, { email: "octo@example.com", workspace: "Octo Org", workspaceId: "ws-1" });
  assert.deepEqual(codexAccountReading(account as NonNullable<typeof account>), { auth: "connected", reason: null, identity: "octo@example.com (Octo Org)", identityKey: "chatgpt:octo@example.com|ws-1" });
  assert.equal(codexAccountOf('{"method":"account/updated","params":{"authMode":"chatgpt"}}'), undefined, "not the answer");
  assert.equal(codexAccountOf('{"id":0,"result":{"userAgent":"x"}}'), undefined);
  assert.equal(codexAccountOf("not json"), undefined);
  assert.equal(codexAccountOf('{"id":1,"result":{"account":null,"requiresOpenaiAuth":true}}'), null, "signed out: nobody");
  assert.equal(codexAccountOf('{"id":1,"result":{"account":{"type":"apiKey"}}}'), null, "an API key is no ChatGPT account");
});

// What codex-cli 0.169.0 prints (the lines read, as printed): its commands, its exec's, and its config's answer to a
// web_search mode it does not know -- asked in a scratch home: nothing signs in, nothing reaches a model.
const CODEX_TOP = ["Commands:", "  exec              Run Codex non-interactively [aliases: e]", "  review            Run a code review non-interactively", "  login             Manage login"].join("\n");
const CODEX_EXEC = ["Commands:", "  resume  Resume a previous session by id or pick the most recent with --last", "  review  Run a code review against the current repository", "Options:", "  -m, --model <MODEL>", "      --json", "          Print events to stdout as JSONL"].join("\n");
const CODEX_WEB_SEARCH = "Error loading config.toml: unknown variant `?`, expected one of `disabled`, `cached`, `indexed`, `live`\nin `web_search`\n";

test("Codex's capabilities are read off the installed binary: its exec, its JSON stream, resume, and the web search its config takes", () => {
  assert.deepEqual(codexCapabilities({ top: CODEX_TOP, exec: CODEX_EXEC, webSearch: CODEX_WEB_SEARCH }), { start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit: "unknown", pluginObservation: "no" });
  const noJson = codexCapabilities({ top: CODEX_TOP, exec: CODEX_EXEC.replace("      --json\n", ""), webSearch: CODEX_WEB_SEARCH });
  assert.deepEqual([noJson.stream, noJson.usage], ["no", "no"], "without --json nothing streams and nothing is counted");
  assert.equal(codexCapabilities({ top: CODEX_TOP, exec: CODEX_EXEC, webSearch: "Error loading config.toml: unknown field `web_search`" }).webSearch, "no");
  assert.equal(codexCapabilities({ top: CODEX_TOP, exec: CODEX_EXEC, webSearch: null }).webSearch, "unknown", "not asked: not known");
  assert.equal(codexCapabilities({ top: "Commands:\n  login  Manage login", exec: "", webSearch: null }).start, "no");
  assert.deepEqual(codexCapabilities(null), UNKNOWN_CAPABILITIES, "nothing read: nothing claimed");
});
