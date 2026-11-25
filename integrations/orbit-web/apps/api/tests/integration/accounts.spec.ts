// THE ACCOUNT IS THE BOUNDARY. An account (its OrbitId) is made by a one-time setup code (or the trial's seed) with its
// first user; a browser of that user sees that account's records and the ones shared with the user, never another
// account's, through any route. Several accounts are signed in at once -- each with its own browser sessions and its own
// AI connections -- and nothing one does ends another's sessions. A chat runs on its account's own Claude Code
// connection, and the models it may use are what that connection's CLI said.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { RUN_TOKEN_HEADER, SHARE_RECIPIENT_UNKNOWN, SIGN_IN_REQUIRED, type AccessList, type ModelCatalog, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { accountAudience, EventBus } from "../../src/core/events/event-bus.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeIdentities, claudeModelsProbe, claudeRun, eventually, homeOf, MODEL_ENTRIES, modelsAnswer, signedIn, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { filled, routesOf } from "../../src/testing/routes.js";

// A model one program gives some accounts: Bob's account has it, Alice's does not.
const PREVIEW = { value: "claude-mythos-5", resolvedModel: "claude-mythos-5", displayName: "Mythos 5", description: "A research preview", supportsEffort: true, supportedEffortLevels: ["high", "max"], supportsAutoMode: false };

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function quickRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0, num_turns: 1, duration_ms: 1 });
    c.exit(0);
  });
}

const newChat = async (b: Browser, body: Record<string, unknown> = {}): Promise<SessionSummary> => {
  const r = await b.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as SessionSummary;
};

const settled = (b: Browser, id: string) => eventually(async () => ((await b.get(`/api/sessions/${id}`)).body as SessionDetail).status, (s) => s === "ready" || s === "completed");

describe("an account is made with its first user, and is never anybody's but its own", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ user: "alice" })));
  after(() => h.close());

  test("the harness's account was made as a setup code makes one: its user, its audit chain and its policy in effect", async () => {
    assert.match(h.accountId ?? "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(await h.sql("SELECT a.kind, u.username, u.role, u.email FROM accounts a JOIN users u ON u.account_id = a.id WHERE a.id = $1", [h.accountId]), [{ kind: "customer", username: "alice", role: "owner", email: "alice@example.com" }]);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM audit_chains WHERE account_id = $1", [h.accountId]))[0]?.n, 1, "its own audit chain");
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [h.accountId]))[0]?.n, 1, "and a policy in effect from the start");
    assert.deepEqual(await h.sql("SELECT data->>'provider' AS how FROM audit_events WHERE account_id = $1 AND event_type = 'account.created'", [h.accountId]), [{ how: "setup_code" }]);
  });

  test("two accounts are signed in at once: neither ends the other's sessions or streams", async () => {
    const stream = await h.stream("/api/events");
    try {
      const bob = await h.as("bob");
      assert.notEqual(bob.accountId, h.accountId);
      assert.equal((await h.get("/api/sessions")).status, 200, "Alice is still signed in");
      assert.equal((await bob.get("/api/sessions")).status, 200);
      const bobs = await newChat(bob, { title: "Bob's own" });
      assert.equal(stream.events.some((e) => JSON.stringify(e).includes(bobs.id)), false, "Alice's page hears nothing of Bob's chat");
      let ended = false;
      void stream.ended.then(() => (ended = true));
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(ended, false, "and her stream stays open");
    } finally {
      stream.close();
    }
  });
});

describe("the models a run may use are its account's own Claude Code connection's", () => {
  let h: Harness;
  before(async () => {
    // Bob's connection's CLI lists a preview model; Alice's does not. Each is asked in its own connection home.
    const fake: FakeProcessPort = signedIn(new FakeProcessPort(new NodeProcessPort()));
    // Whose connection home a call is made in: the identity the harness gives that account's CLI.
    const emailOf = async (dir: string | undefined): Promise<unknown> => {
      const home = homeOf(dir);
      return home === null ? null : (await claudeIdentities(fake).fallback?.(home.accountId))?.email;
    };
    fake.on(claudeModelsProbe, { run: async (call) => ({ stdout: modelsAnswer((await emailOf(call.env.CLAUDE_CONFIG_DIR)) === "bob@example.com" ? [...MODEL_ENTRIES, PREVIEW] : MODEL_ENTRIES) }) }).on(claudeRun, { spawn: quickRun });
    h = await startHarness({ fake, user: "alice" });
  });
  after(() => h.close());

  test("the catalog is the connection's, read through its CLI's control protocol -- restricted, calling no model, in its own home", async () => {
    const catalog = (await h.get("/api/claude/models")).body as ModelCatalog;
    assert.equal(catalog.source, "account");
    assert.deepEqual(catalog.models.map((m) => m.id), ["opus", "fable", "sonnet", "haiku", "claude-haiku-4-5-20251001"], "the CLI's own `default` is not a model of its own");
    assert.equal(catalog.recommended, "sonnet", "what the CLI's default resolves to");
    const probe = h.fake.callsOf(claudeModelsProbe)[0] as Call;
    for (const flag of ["--restricted", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(probe.args.includes(flag), flag);
    assert.equal(after1(probe.args, "--tools"), "", "no tool");
    assert.equal(homeOf(probe.env.CLAUDE_CONFIG_DIR)?.accountId, h.accountId, "asked in Alice's connection's own home");
    assert.deepEqual(Object.keys(probe.env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_OAUTH|ORBIT_WEB_DATABASE|PG)/.test(k)), []);
  });

  test("an account a program gives a model to sees it; another does not, and cannot run on it", async () => {
    const bob = await h.as("bob");
    const catalog = (await bob.get("/api/claude/models")).body as ModelCatalog;
    assert.deepEqual(catalog.models.find((m) => m.id === "claude-mythos-5"), { id: "claude-mythos-5", label: "Mythos 5", description: "A research preview", efforts: ["high", "max"], autoMode: false });
    assert.equal(((await h.get("/api/claude/models")).body as ModelCatalog).models.some((m) => m.id === "claude-mythos-5"), false, "Alice's account does not see it");
    const refused = await h.send("POST", "/api/sessions", { model: "claude-mythos-5", mode: "plan" });
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(refused.body), /not a model this Claude account can use/);
  });

  test("each account's chat runs on its own connection's home: Alice's run never sees Bob's, nor Bob's Alice's", async () => {
    const bob = await h.as("bob");
    const a = await newChat(h, { prompt: "Alice's question" });
    const b = await newChat(bob, { prompt: "Bob's question" });
    await settled(h, a.id);
    await settled(bob, b.id);
    await eventually(() => h.fake.callsOf(claudeRun).length, (n) => n >= 2);
    const runs = h.fake.callsOf(claudeRun);
    const homeOfRun = (sessionId: string) => homeOf(runs.find((c) => c.cwd.includes(sessionId))?.env.CLAUDE_CONFIG_DIR)?.accountId;
    assert.equal(homeOfRun(a.id), h.accountId);
    assert.equal(homeOfRun(b.id), bob.accountId);
    for (const run of runs) assert.equal(JSON.stringify(run.env).includes(run.cwd.includes(a.id) ? (bob.accountId as string) : (h.accountId as string)), false, "no variable of a run names the other account's home");
  });
});

describe("each account sees its own records, and those shared with its user", () => {
  let h: Harness;
  let bob: Browser;
  let alices: SessionSummary;
  before(async () => {
    h = await startHarness({ user: "alice", fake: signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: quickRun }) });
    bob = await h.as("bob");
    alices = await newChat(h, { title: "Alice's private plan", prompt: "Plan the release." });
    await settled(h, alices.id);
  });
  after(() => h.close());

  test("its owner sees it as its own, by its share address", async () => {
    const list = (await h.get("/api/sessions")).body as SessionSummary[];
    assert.deepEqual(list.map((s) => [s.id, s.access, s.owner]), [[alices.id, "owner", "alice@example.com"]]);
  });

  test("another account sees nothing of it, through any route under it", async () => {
    const routes = routesOf(h).filter((r) => r.path.startsWith("/api/sessions/:id"));
    assert.ok(routes.length >= 15, `every route under a chat was read (${routes.length})`);
    for (const r of routes) {
      const path = filled(r.path, { id: alices.id });
      const reply = r.method === "GET" ? await bob.get(path) : await bob.send(r.method, path, {});
      assert.equal(reply.status, 404, `${r.method} ${r.path}`);
      assert.equal(JSON.stringify(reply.body).includes("Alice's private plan"), false, `${r.method} ${r.path}`);
    }
    const bobs = await newChat(bob);
    await settled(bob, bobs.id);
    assert.deepEqual(((await h.get("/api/sessions")).body as SessionSummary[]).map((s) => s.id), [alices.id], "and Alice does not see Bob's");
  });

  test("an account id a request names is never what decides: it is the session's", async () => {
    const forged = { "x-orbit-account": h.accountId ?? "", "x-account-id": h.accountId ?? "" };
    const listed = (await bob.get(`/api/sessions?accountId=${h.accountId ?? ""}`, forged)).body as SessionSummary[];
    assert.ok(listed.every((s) => s.owner === "bob@example.com"), "a query or a header naming another account changes nothing");
    assert.equal(JSON.stringify(listed).includes(alices.id), false);
    assert.equal((await bob.get(`/api/sessions/${alices.id}?accountId=${h.accountId ?? ""}`, forged)).status, 404);
    const created = await bob.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", accountId: h.accountId });
    assert.equal(created.status, 400, "a body naming an account is refused: no request chooses its account");
  });

  test("its owner shares it by username or by a verified email; an unverified email, or nobody's, is refused whole", async () => {
    await h.account("carol", { email: null });
    const dave = await h.account("dave", { email: "dave@example.com" });
    await h.sql("UPDATE users SET email_verified_at = NULL WHERE id = $1", [dave.userId]);
    for (const people of [["dave@example.com"], ["bob", "nobody-here"], ["eve@example.com"]]) {
      const r = await h.send("PUT", `/api/sessions/${alices.id}/access`, { people });
      assert.equal(r.status, 400, JSON.stringify(people));
      assert.equal(errorCode(r), SHARE_RECIPIENT_UNKNOWN);
    }
    assert.deepEqual(((await h.get(`/api/sessions/${alices.id}/access`)).body as AccessList).people, [], "nothing was half-shared");
    const shared = await h.send("PUT", `/api/sessions/${alices.id}/access`, { people: [" BOB@example.com ", "carol", "alice"] });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.deepEqual((shared.body as AccessList).people.map((p) => [p.email, p.grantedBy]), [["bob@example.com", "alice@example.com"], ["carol@users.orbit.local", "alice@example.com"]], "by share address: a verified email, or the username's own; never its own owner");
    const again = await h.send("PUT", `/api/sessions/${alices.id}/access`, { people: (shared.body as AccessList).people.map((p) => p.email) });
    assert.equal(again.status, 200, "the addresses a page shows are taken back as the same people");
  });

  test("the account it is shared with opens it and carries on -- but only the owner deletes it, shares it on or publishes it", async () => {
    const list = (await bob.get("/api/sessions")).body as SessionSummary[];
    assert.deepEqual(list.filter((s) => s.id === alices.id).map((s) => [s.id, s.access, s.owner]), [[alices.id, "shared", "alice@example.com"]]);
    assert.equal((await bob.send("POST", `/api/sessions/${alices.id}/messages`, { text: "Carry on." })).status, 202);
    await settled(bob, alices.id);
    for (const [method, rest] of [["DELETE", ""], ["PUT", "/access"], ["POST", "/share"], ["DELETE", "/share"]] as const) {
      const r = await bob.send(method, `/api/sessions/${alices.id}${rest}`, method === "PUT" ? { people: [] } : undefined);
      assert.equal(r.status, 403, `${method} ${rest}`);
      assert.equal(errorCode(r), "owner_only");
    }
    assert.equal(JSON.stringify((await bob.get("/api/governance/workspaces")).body).includes(alices.id), false, "a chat shared with it is not its to govern");
    const carol = await h.as("carol");
    assert.equal((await carol.get(`/api/sessions/${alices.id}`)).status, 200, "a user with no verified email is shared with by username");
    assert.equal((await h.send("PUT", `/api/sessions/${alices.id}/access`, { people: [] })).status, 200);
    assert.equal((await bob.get(`/api/sessions/${alices.id}`)).status, 404, "unshared: closed again at once");
  });

  test("a notification about another account's record never reaches this account's pages", async () => {
    const stream = await bob.stream("/api/events");
    try {
      h.app.get(EventBus).publishApp("session.summary", { session: { ...alices, title: "leaked?" } }, accountAudience(h.accountId as string));
      const own = await newChat(bob, { title: "Bob's own" });
      await stream.until((es) => es.some((e) => e.type === "session.summary" && (e.data as { session: SessionSummary }).session.id === own.id));
      assert.equal(stream.events.some((e) => e.type === "session.summary" && (e.data as { session: SessionSummary }).session.id === alices.id), false);
    } finally {
      stream.close();
    }
  });
});

describe("a run's token is never a person", () => {
  test("presented anywhere but the agent gateway it is refused and recorded, whatever cookie comes with it; a research run's opens nothing", async () => {
    const h = await startHarness();
    try {
      const chat = await newChat(h, { title: "with a run" });
      const token = `tok-${randomUUID()}`;
      const research = `tok-${randomUUID()}`;
      const revision = (await h.sql("SELECT id FROM policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [h.accountId]))[0]?.id as string;
      const insert = "INSERT INTO run_bindings (run_id, token_hash, account_id, kind, resource_kind, resource_id, research_session_id, agent_id, policy_revision, started_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'test', now(), now() + interval '1 hour')";
      await h.sql(insert, [randomUUID(), sha256(token), h.accountId, "chat", "workspace", chat.id, null, "claude-code", revision]);
      await h.sql("INSERT INTO account_resources (account_id, kind, id, title, created_at) VALUES ($1, 'research_workspace', 'rw-1', 'r', now()) ON CONFLICT DO NOTHING", [h.accountId]);
      await h.sql(insert, [randomUUID(), sha256(research), h.accountId, "research", "research_workspace", "rw-1", "rs-1", "claude-research", revision]);
      for (const path of ["/api/sessions", "/api/governance/overview", "/api/account", "/api/settings", "/api/connections", "/api/auth/sessions"]) {
        const r = await h.get(path, { [RUN_TOKEN_HEADER]: token });
        assert.equal(r.status, 403, path);
        assert.equal(errorCode(r), "agent_outside_gateway", path);
      }
      const policy = await h.send("POST", "/api/governance/revisions", {}, { [RUN_TOKEN_HEADER]: token });
      assert.equal(policy.status, 403, "an agent never writes the policy that governs it");
      assert.equal((await h.get("/api/agent/whoami", { [RUN_TOKEN_HEADER]: research })).status, 401, "a research run's token opens no gateway");
      assert.equal(errorCode(await h.anonymous.get("/api/sessions")), SIGN_IN_REQUIRED, "and without a session nothing opens at all");
      const recorded = await h.sql("SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'boundary.violation' AND account_id = $1", [h.accountId]);
      assert.ok(Number(recorded[0]?.n) >= 6, "each attempt is in the account's audit record");
    } finally {
      await h.close();
    }
  });
});

