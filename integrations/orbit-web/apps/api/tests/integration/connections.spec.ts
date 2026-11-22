// AN ACCOUNT'S AI CONNECTIONS, through the real API, with the CLIs scripted per connection home. A connection is the
// account's alone, with a config home of its own; "connected" is only what its CLI's own status says (naming the
// identity); one provider identity is connected to one account at a time; a subscription is signed in by its CLI's own
// sign-in -- in a terminal, or from its card (connection-sign-in.spec.ts), the one route that relays one, per connection;
// an API key is kept by the credential store and never shown;
// the Orbit plugin is loaded into a chat only once its owner approved it for that digest; disconnect and delete use the
// CLI's own logout and remove the home's login.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { CONNECTION_ERRORS, type AiConnectionsView, type RuntimeConnection, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { ConnectionHooks, type ConnectionEvent } from "../../src/modules/connections/connection-hooks.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeIdentities, claudeIdentityOf, claudeModelsProbe, claudeRun, CLAUDE_SIGNED_OUT, eventually, homeOf, signedIn, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { routesOf } from "../../src/testing/routes.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const API_KEY = "sk-ant-api03-test-key-0123456789abcdefghij";

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

function quickRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0, num_turns: 1, duration_ms: 1 });
    c.exit(0);
  });
}

const view = async (b: Browser): Promise<AiConnectionsView> => ok<AiConnectionsView>(await b.get("/api/connections"));

describe("settings → AI connections", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  const heard: ConnectionEvent[] = [];
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: quickRun });
    h = await startHarness({ fake, account: { connect: false } });
    h.app.get(ConnectionHooks).onChanged((e) => void heard.push(e));
  });
  after(() => h.close());

  test("with no connection: what is installed (as each CLI says), the methods and why, and no hiring -- and no chat", async () => {
    const v = await view(h);
    assert.deepEqual(v.installations.map((i) => [i.runtime, i.state, i.version]), [["claude", "installed", "2.1.328"], ["codex", "not_installed", null], ["agy", "not_installed", null]]);
    assert.deepEqual(v.connections, []);
    assert.equal(v.canHire, false);
    assert.deepEqual(v.methods.map((m) => `${m.runtime}/${m.method}:${m.state}`), ["claude/subscription:supported", "claude/api_key:supported", "claude/cloud:blocked", "codex/subscription:supported", "codex/api_key:supported", "codex/cloud:not_verified", "agy/subscription:not_permitted", "agy/api_key:not_verified", "agy/cloud:not_verified"]);
    const chat = await h.send("POST", "/api/sessions", { model: "sonnet", mode: "plan" });
    assert.deepEqual([chat.status, code(chat)], [409, CONNECTION_ERRORS.connectionRequired]);
    assert.match(JSON.stringify(chat.body), /Settings → AI Connections/);
    assert.equal((await h.get("/api/sessions")).status, 200, "the rest of the app works without one");
  });

  test("a provider's sign-in is relayed only for one connection, from its card -- no account-wide relay of Orbit's own sign-in", () => {
    const paths = routesOf(h).map((r) => `${r.method} ${r.path}`);
    for (const relay of ["/api/claude/login", "/api/claude/session", "/api/claude/status", "/api/claude/logout"]) assert.equal(paths.some((p) => p.endsWith(relay) || p.includes(`${relay}/`)), false, relay);
    assert.ok(paths.includes("POST /api/connections") && paths.includes("PUT /api/connections/:id/plugins/orbit"));
    for (const route of ["GET /api/connections/:id/sign-in", "POST /api/connections/:id/sign-in", "POST /api/connections/:id/sign-in/code", "POST /api/connections/:id/sign-in/cancel"]) assert.ok(paths.includes(route), route);
    assert.deepEqual(paths.filter((p) => /sign-in/.test(p) && p.includes("/api/connections")).length, 4, "nothing else");
  });

  test("a method its provider does not permit, or nobody verified, is refused; a CLI not installed is said so", async () => {
    const agy = await h.send("POST", "/api/connections", { runtime: "agy", method: "subscription" });
    assert.deepEqual([agy.status, code(agy)], [400, CONNECTION_ERRORS.methodNotSupported]);
    assert.match(JSON.stringify(agy.body), /breach of this Agreement/);
    assert.equal(code(await h.send("POST", "/api/connections", { runtime: "agy", method: "api_key", apiKey: API_KEY })), CONNECTION_ERRORS.methodNotSupported);
    const codex = await h.send("POST", "/api/connections", { runtime: "codex", method: "subscription" });
    assert.deepEqual([codex.status, code(codex)], [409, CONNECTION_ERRORS.notInstalled]);
    assert.equal((await h.send("POST", "/api/connections", { runtime: "claude", method: "subscription", apiKey: API_KEY })).status, 400, "a subscription takes no key");
    assert.deepEqual((await view(h)).connections, [], "nothing was made");
  });

  test("a subscription: signed in in a terminal of the server, connected only once its CLI names the identity in ITS home", async () => {
    const identities = claudeIdentities(fake);
    identities.byAccount.set(h.accountId as string, CLAUDE_SIGNED_OUT);
    const made = await h.send("POST", "/api/connections", { runtime: "claude", method: "subscription", label: "My Claude" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const c = made.body as RuntimeConnection;
    assert.deepEqual([c.auth, c.identity, c.isDefault, c.label, c.catalog.source], ["disconnected", null, true, "My Claude", "none"]);
    assert.equal(c.terminalCommand, `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js ${c.id}`);
    assert.equal(c.capabilities.toolPlaneSplit, "yes", "read from this binary's own --help");
    const home = join(h.config.data.connections, h.accountId as string, c.id, "claude");
    assert.ok(existsSync(home), "a config home of its own");
    assert.equal(statSync(join(h.config.data.connections, h.accountId as string, c.id)).mode & 0o777, 0o700);
    const status = fake.callsOf(program("claude", "auth", "status")).at(-1) as Call;
    assert.equal(status.env.CLAUDE_CONFIG_DIR, home);
    assert.deepEqual(Object.keys(status.env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_OAUTH)/.test(k)), []);
    // The person ran the command in the terminal: the CLI says who it is signed in as now.
    identities.byAccount.set(h.accountId as string, claudeIdentityOf("octo"));
    const checked = ok<RuntimeConnection>(await h.send("POST", `/api/connections/${c.id}/check`));
    assert.deepEqual([checked.auth, checked.identity, checked.catalog.source], ["connected", "octo@example.com (Octo Org)", "account"]);
    assert.deepEqual(checked.employeeReady, { ready: true, reason: null }, "its binary splits the tool plane: an employee can run on it");
    assert.equal((await view(h)).canHire, true);
    assert.ok(heard.some((e) => e.connectionId === c.id && e.change === "checked" && e.auth === "connected"), "other contexts hear it");
    const recorded = await h.sql("SELECT data->>'setting' AS setting FROM audit_events WHERE account_id = $1 AND event_type = 'settings.privileged.changed' AND data->>'setting' LIKE 'ai_connection.%' ORDER BY seq", [h.accountId]);
    assert.deepEqual(recorded.map((r) => r.setting), ["ai_connection.claude.subscription.created", "ai_connection.claude.subscription.checked"]);
  });

  test("the Orbit plugin is off for chats until its owner approves it, for exactly the digest the page showed", async () => {
    const c = (await view(h)).connections[0] as RuntimeConnection;
    assert.deepEqual([c.plugins?.installed, c.plugins?.useCases.chat.approved, c.plugins?.useCases.employee.approved], [true, false, false]);
    assert.match(c.plugins?.digest ?? "", /^[0-9a-f]{64}$/);
    const chat = ok<SessionSummary>(await h.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", prompt: "Hello." }));
    await eventually(async () => ok<SessionDetail>(await h.get(`/api/sessions/${chat.id}`)).status, (s) => s === "completed");
    const first = fake.callsOf(claudeRun).at(-1) as Call;
    assert.equal(first.args.includes(h.config.pluginDir), false, "not approved: not loaded");
    assert.equal(homeOf(first.env.CLAUDE_CONFIG_DIR)?.connectionId, c.id, "the run is the connection's");
    const stale = await h.send("PUT", `/api/connections/${c.id}/plugins/orbit`, { useCase: "chat", approved: true, digest: "0".repeat(64) });
    assert.deepEqual([stale.status, code(stale)], [409, CONNECTION_ERRORS.pluginChanged]);
    const approved = ok<RuntimeConnection>(await h.send("PUT", `/api/connections/${c.id}/plugins/orbit`, { useCase: "chat", approved: true, digest: c.plugins?.digest }));
    assert.deepEqual([approved.plugins?.useCases.chat.approved, approved.plugins?.useCases.employee.approved, approved.plugins?.revision], [true, false, 1]);
    assert.equal((await h.send("POST", `/api/sessions/${chat.id}/messages`, { text: "Again." })).status, 202);
    await eventually(() => fake.callsOf(claudeRun).length, (n) => n >= 2);
    await eventually(async () => ok<SessionDetail>(await h.get(`/api/sessions/${chat.id}`)).status, (s) => s === "completed");
    assert.equal(after1((fake.callsOf(claudeRun).at(-1) as Call).args, "--plugin-dir"), h.config.pluginDir, "approved: loaded");
    // An upgraded plugin is another digest: the grant stands for the old one, and asks to be confirmed.
    await h.sql("UPDATE plugin_grants SET digest = $1 WHERE connection_id = $2", ["f".repeat(64), c.id]);
    const upgraded = ((await view(h)).connections[0] as RuntimeConnection).plugins;
    assert.deepEqual([upgraded?.useCases.chat.approved, upgraded?.useCases.chat.needsConfirmation], [false, true]);
    const third = await h.send("POST", `/api/sessions/${chat.id}/messages`, { text: "Once more." });
    assert.equal(third.status, 202);
    await eventually(() => fake.callsOf(claudeRun).length, (n) => n >= 3);
    assert.equal((fake.callsOf(claudeRun).at(-1) as Call).args.includes(h.config.pluginDir), false, "a grant of another digest loads nothing");
    await eventually(async () => ok<SessionDetail>(await h.get(`/api/sessions/${chat.id}`)).status, (s) => s === "completed");
  });

  test("an API key: kept by the credential store (0600, outside the home), never returned, logged or recorded; the CLI is handed it", async () => {
    const made = await h.send("POST", "/api/connections", { runtime: "claude", method: "api_key", apiKey: API_KEY });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const c = made.body as RuntimeConnection;
    assert.equal(JSON.stringify(made.body).includes(API_KEY), false);
    assert.deepEqual([c.auth, c.isDefault], ["connected", false]);
    assert.match(c.identity ?? "", /^Anthropic API key \(sha256:[0-9a-f]{12}\)$/);
    assert.equal(c.terminalCommand, null);
    const file = join(h.config.data.control, "credentials", h.accountId as string, c.id);
    assert.equal(readFileSync(file, "utf8"), API_KEY);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const [row] = await h.sql("SELECT credential_ref, row_to_json(c)::text AS whole FROM ai_connections c WHERE id = $1", [c.id]);
    assert.equal(row?.credential_ref, `file:${h.accountId}/${c.id}`);
    assert.equal(String(row?.whole).includes(API_KEY), false, "the database keeps the reference alone");
    assert.equal(JSON.stringify(await h.sql("SELECT data FROM audit_events")).includes(API_KEY), false);
    assert.equal(JSON.stringify(await view(h)).includes(API_KEY), false);
    const status = fake.callsOf(program("claude", "auth", "status")).at(-1) as Call;
    assert.equal(status.env.ANTHROPIC_API_KEY, API_KEY, "the connection's own CLI is handed its own key");
    assert.equal(readdirSync(join(h.config.data.connections, h.accountId as string, c.id, "claude")).length, 0, "nothing of the key is in its home");
  });

  test("PATCH holds a change to the version read; the default moves to the one chosen", async () => {
    const [sub, key] = (await view(h)).connections as [RuntimeConnection, RuntimeConnection];
    const none = await h.send("PATCH", `/api/connections/${key.id}`, { label: "Console key" });
    assert.equal(none.status, 428);
    const stale = await h.send("PATCH", `/api/connections/${key.id}`, { label: "Console key" }, { "if-match": `"${key.version - 1}"` });
    assert.equal(stale.status, 412);
    const relabelled = ok<RuntimeConnection>(await h.send("PATCH", `/api/connections/${key.id}`, { label: "Console key", isDefault: true }, { "if-match": `"${key.version}"` }));
    assert.deepEqual([relabelled.label, relabelled.isDefault], ["Console key", true]);
    assert.equal(((await view(h)).connections.find((c) => c.id === sub.id) as RuntimeConnection).isDefault, false, "one default per runtime");
    ok(await h.send("PATCH", `/api/connections/${sub.id}`, { isDefault: true }, { "if-match": `"${((await view(h)).connections.find((c) => c.id === sub.id) as RuntimeConnection).version}"` }));
  });

  test("disconnect: the CLI's own logout in that home, the home's login removed, the key forgotten -- and everybody told", async () => {
    const key = (await view(h)).connections.find((c) => c.method === "api_key") as RuntimeConnection;
    const app = await h.stream("/api/events");
    try {
      const out = ok<RuntimeConnection>(await h.send("POST", `/api/connections/${key.id}/disconnect`));
      assert.deepEqual([out.auth, out.identity], ["disconnected", null]);
      const logout = fake.callsOf(program("claude", "auth", "logout")).at(-1) as Call;
      assert.equal(logout.env.CLAUDE_CONFIG_DIR, join(h.config.data.connections, h.accountId as string, key.id, "claude"));
      assert.equal(existsSync(join(h.config.data.control, "credentials", h.accountId as string, key.id)), false, "the key is gone");
      await app.until((es) => es.some((e) => e.type === "connections.changed" && (e.data as { change: string }).change === "disconnected"));
      assert.ok(heard.some((e) => e.connectionId === key.id && e.change === "disconnected"));
      const again = ok<RuntimeConnection>(await h.send("POST", `/api/connections/${key.id}/check`));
      assert.equal(again.auth, "auth_required", "an API-key connection without its key asks for it");
    } finally {
      app.close();
    }
  });

  test("delete: the home and the key go, and the row stays, removed (holding no identity)", async () => {
    const [first] = (await view(h)).connections as [RuntimeConnection];
    const key = (await view(h)).connections.find((c) => c.method === "api_key") as RuntimeConnection;
    assert.equal((await h.send("DELETE", `/api/connections/${key.id}`)).status, 204);
    assert.equal((await h.get(`/api/connections/${key.id}`)).status, 404);
    assert.equal(existsSync(join(h.config.data.connections, h.accountId as string, key.id)), false);
    assert.deepEqual((await view(h)).connections.map((c) => c.id), [first.id]);
    const [row] = await h.sql("SELECT removed_at IS NOT NULL AS removed, identity_key FROM ai_connections WHERE id = $1", [key.id]);
    assert.deepEqual(row, { removed: true, identity_key: null });
  });

  test("a Claude Code cloud connection is saved and shown blocked: not verified here, never used", async () => {
    const cloud = await h.send("POST", "/api/connections", { runtime: "claude", method: "cloud", cloud: { provider: "bedrock", region: "eu-west-1" } });
    assert.equal(cloud.status, 201, JSON.stringify(cloud.body));
    const c = cloud.body as RuntimeConnection;
    assert.deepEqual([c.auth, c.reasonCode, c.terminalCommand], ["disconnected", "not_verified", null]);
    assert.equal((await h.send("DELETE", `/api/connections/${c.id}`)).status, 204);
  });
});

describe("one provider identity, one Orbit account -- and each account's connections its own", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let bob: Browser;
  let alices: RuntimeConnection;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: quickRun });
    h = await startHarness({ fake, user: "alice" });
    bob = await h.as("bob", { connect: false });
    alices = (await view(h)).connections[0] as RuntimeConnection;
  });
  after(() => h.close());

  test("an identity connected to one account is refused to another: auth_required, identity_already_connected -- never used", async () => {
    // Bob signs his new connection's home in as Alice's Claude account.
    claudeIdentities(fake).byAccount.set(bob.accountId as string, claudeIdentityOf("alice"));
    const made = ok<RuntimeConnection>(await bob.send("POST", "/api/connections", { runtime: "claude", method: "subscription" }));
    assert.deepEqual([made.auth, made.reasonCode], ["auth_required", CONNECTION_ERRORS.identityAlreadyConnected]);
    assert.match(made.reason ?? "", /connected to another Orbit account/);
    assert.equal((await view(bob)).canHire, false);
    const chat = await bob.send("POST", "/api/sessions", { model: "sonnet", mode: "plan" });
    assert.deepEqual([chat.status, code(chat)], [409, CONNECTION_ERRORS.connectionUnavailable], "a connection that is not connected runs nothing");
    // Alice disconnects hers: the identity is free, and Bob's next check connects him.
    ok(await h.send("POST", `/api/connections/${alices.id}/disconnect`));
    const now = ok<RuntimeConnection>(await bob.send("POST", `/api/connections/${made.id}/check`));
    assert.deepEqual([now.auth, now.identity], ["connected", "alice@example.com (Alice Org)"]);
    const back = ok<RuntimeConnection>(await h.send("POST", `/api/connections/${alices.id}/check`));
    assert.deepEqual([back.auth, back.reasonCode], ["auth_required", CONNECTION_ERRORS.identityAlreadyConnected], "and now it is Alice's that is refused");
    claudeIdentities(fake).byAccount.set(h.accountId as string, claudeIdentityOf("alice-2"));
    assert.equal(ok<RuntimeConnection>(await h.send("POST", `/api/connections/${alices.id}/check`)).auth, "connected", "signed in again as an identity of her own");
  });

  test("a connection linked to an identity that its CLI no longer names is not used: identity_changed, login_ended", async () => {
    const [mine] = (await view(h)).connections as [RuntimeConnection];
    claudeIdentities(fake).byAccount.set(h.accountId as string, claudeIdentityOf("mallory"));
    const changed = ok<RuntimeConnection>(await h.send("POST", `/api/connections/${mine.id}/check`));
    assert.deepEqual([changed.auth, changed.reasonCode, changed.identity], ["auth_required", "identity_changed", "alice-2@example.com (Alice-2 Org)"]);
    claudeIdentities(fake).byAccount.set(h.accountId as string, CLAUDE_SIGNED_OUT);
    const gone = ok<RuntimeConnection>(await h.send("POST", `/api/connections/${mine.id}/check`));
    assert.deepEqual([gone.auth, gone.reasonCode], ["auth_required", "login_ended"]);
    claudeIdentities(fake).byAccount.set(h.accountId as string, claudeIdentityOf("alice-2"));
    assert.equal(ok<RuntimeConnection>(await h.send("POST", `/api/connections/${mine.id}/check`)).auth, "connected");
  });

  test("another account's connection is not found, by any route -- and nothing of it is listed", async () => {
    const bobs = (await view(bob)).connections[0] as RuntimeConnection;
    assert.equal((await view(h)).connections.some((c) => c.id === bobs.id), false);
    for (const [method, path, body] of [
      ["GET", `/api/connections/${bobs.id}`, undefined],
      ["PATCH", `/api/connections/${bobs.id}`, { label: "mine now" }],
      ["POST", `/api/connections/${bobs.id}/check`, undefined],
      ["POST", `/api/connections/${bobs.id}/disconnect`, undefined],
      ["DELETE", `/api/connections/${bobs.id}`, undefined],
      ["PUT", `/api/connections/${bobs.id}/plugins/orbit`, { useCase: "chat", approved: true, digest: "a".repeat(64) }],
    ] as const) {
      const r = method === "GET" ? await h.get(path) : await h.send(method, path, body, { "if-match": `"${bobs.version}"` });
      assert.equal(r.status, 404, `${method} ${path}`);
    }
    assert.equal(((await view(bob)).connections[0] as RuntimeConnection).auth, "connected", "nothing of Alice's moved Bob's");
  });

  test("each account's chats run on its own connection, and never see another account's home", async () => {
    const run = async (b: Browser): Promise<Call> => {
      const before = fake.callsOf(claudeRun).length;
      const chat = ok<SessionSummary>(await b.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", prompt: "Hi." }));
      await eventually(() => fake.callsOf(claudeRun).length, (n) => n > before);
      await eventually(async () => ok<SessionDetail>(await b.get(`/api/sessions/${chat.id}`)).status, (s) => s === "completed");
      return fake.callsOf(claudeRun).filter((c) => c.cwd.includes(chat.id)).at(-1) as Call;
    };
    const a = await run(h);
    const b = await run(bob);
    assert.equal(homeOf(a.env.CLAUDE_CONFIG_DIR)?.accountId, h.accountId);
    assert.equal(homeOf(b.env.CLAUDE_CONFIG_DIR)?.accountId, bob.accountId);
    assert.equal(JSON.stringify(a).includes(bob.accountId as string), false, "Alice's run names nothing of Bob's");
    assert.equal(JSON.stringify(b).includes(h.accountId as string), false, "nor Bob's of Alice's");
    for (const c of [a, b]) assert.ok(c.args.includes(`Read(/${h.config.data.connections}/**)`), "a run's tools are refused every connection home, its own included");
  });

  test("the models probe of each account is asked in that account's own home", () => {
    const homes = new Set(fake.callsOf(claudeModelsProbe).map((c) => homeOf(c.env.CLAUDE_CONFIG_DIR)?.accountId));
    assert.ok(homes.has(h.accountId as string) && homes.has(bob.accountId as string));
    assert.equal(homes.has(undefined), false, "never outside a connection's home");
  });
});
