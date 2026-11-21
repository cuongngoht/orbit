// EACH CLAUDE IDENTITY IS AN ACCOUNT, AND THE ACCOUNT IS THE BOUNDARY. A browser that finishes the Claude sign-in gets a
// session for the internal account of that identity -- found, or made the first time, with nothing to register -- and
// sees that account's records and the ones shared with its email, never another account's, through any route. The
// runtime's CLI holds one identity at a time: when another account signs in, every session of the account before ends,
// and its open streams with them. Its runs use the models its own Claude CLI says it may, read again at every sign-in.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { CLAUDE_SIGN_IN_REQUIRED, RUN_TOKEN_HEADER, type AccessList, type ClaudeStatus, type ModelCatalog, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { accountAudience, EventBus } from "../../src/core/events/event-bus.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { AccountsService } from "../../src/modules/auth/accounts.service.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { CLAUDE_SIGNED_IN, claudeModelsProbe, claudeRun, eventually, MODEL_ENTRIES, modelsAnswer, signedIn, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { filled, routesOf } from "../../src/testing/routes.js";

const ALICE = { ...CLAUDE_SIGNED_IN, email: "alice@example.com", orgId: "org-a", orgName: "Alice Org" };
const BOB = { ...CLAUDE_SIGNED_IN, email: "bob@example.com", orgId: "org-b", orgName: "Bob Org", subscriptionType: "team" };
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

// One Orbit Web whose Claude CLI is signed in to whichever account `who` names. `as` signs a NEW browser in as that
// account, through the Claude sign-in (and so ends the sessions of the account before it).
function twoAccounts() {
  const state = { who: ALICE as Record<string, unknown> };
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort()))
    .on(program("claude", "auth", "status"), { run: () => ({ stdout: JSON.stringify(state.who) }) })
    .on(claudeModelsProbe, { run: () => ({ stdout: modelsAnswer(state.who === BOB ? [...MODEL_ENTRIES, PREVIEW] : MODEL_ENTRIES) }) })
    .on(claudeRun, { spawn: quickRun });
  const as = async (h: Harness, account: Record<string, unknown>): Promise<Browser> => {
    state.who = account;
    return h.browser();
  };
  return { fake, state, as };
}

const newChat = async (b: Browser, body: Record<string, unknown> = {}): Promise<SessionSummary> => {
  const r = await b.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as SessionSummary;
};

const settled = (b: Browser, id: string) => eventually(async () => ((await b.get(`/api/sessions/${id}`)).body as SessionDetail).status, (s) => s === "ready" || s === "completed");

describe("a verified Claude identity is an account, found or made at its first sign-in, and never merged with another", () => {
  let h: Harness;
  let accounts: ReturnType<typeof twoAccounts>;
  before(async () => {
    accounts = twoAccounts();
    h = await startHarness({ fake: accounts.fake });
  });
  after(() => h.close());

  test("the first sign-in made the account: an immutable id, the identity it maps to, and no name until somebody gives one", async () => {
    const status = h.status as ClaudeStatus;
    assert.equal(status.state, "connected");
    assert.match(status.session?.accountId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(status.session?.displayName, "");
    const rows = await h.sql("SELECT a.id, i.email_norm, i.org_key, i.org_name FROM accounts a JOIN account_identities i ON i.account_id = a.id");
    assert.deepEqual(rows, [{ id: status.session?.accountId, email_norm: "alice@example.com", org_key: "org-a", org_name: "Alice Org" }]);
    const renamed = await h.send("PUT", "/api/account", { displayName: "Alice & Co" });
    assert.equal(renamed.status, 200);
    assert.equal((renamed.body as { displayName: string }).displayName, "Alice & Co", "the business name is a display field, set later");
  });

  test("signing in again as the same identity finds the same account; the same email in another organization is another account", async () => {
    const again = await accounts.as(h, ALICE);
    assert.equal(again.accountId, h.accountId);
    const otherOrg = await accounts.as(h, { ...ALICE, orgId: "org-a2", orgName: "Alice Org" });
    assert.notEqual(otherOrg.accountId, h.accountId, "an email in two organizations is two identities, even under one organization name");
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM accounts"))[0]?.n, 2);
  });

  test("an account is made once however many sign-ins race for it, with its audit chain and its policy", async () => {
    const service = h.app.get(AccountsService);
    const carol = { email: "carol@example.com", orgKey: "org-c", orgName: "Carol Org", plan: null, key: "carol@example.com|org-c" };
    const made = await Promise.all(Array.from({ length: 12 }, () => service.ensure(carol)));
    assert.equal(new Set(made.map((m) => m.account.id)).size, 1);
    assert.equal(made.filter((m) => m.created).length, 1);
    const id = made[0]?.account.id as string;
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM account_identities WHERE email_norm = 'carol@example.com'"))[0]?.n, 1);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM audit_chains WHERE account_id = $1", [id]))[0]?.n, 1, "its own audit chain");
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [id]))[0]?.n, 1, "and a policy in effect from the start");
  });
});

describe("the models a run may use are the signed-in account's own", () => {
  let h: Harness;
  let accounts: ReturnType<typeof twoAccounts>;
  before(async () => {
    accounts = twoAccounts();
    h = await startHarness({ fake: accounts.fake });
  });
  after(() => h.close());

  test("the catalog is the account's, read through the CLI's control protocol -- restricted, and calling no model", async () => {
    const catalog = (await h.get("/api/claude/models")).body as ModelCatalog;
    assert.equal(catalog.source, "account");
    assert.deepEqual(catalog.models.map((m) => m.id), ["opus", "fable", "sonnet", "haiku", "claude-haiku-4-5-20251001"], "the CLI's own `default` is not a model of its own");
    assert.equal(catalog.recommended, "sonnet", "what the CLI's default resolves to");
    const probe = accounts.fake.callsOf(claudeModelsProbe)[0] as Call;
    for (const flag of ["--restricted", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(probe.args.includes(flag), flag);
    assert.equal(after1(probe.args, "--tools"), "", "no tool");
    assert.deepEqual(Object.keys(probe.env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_OAUTH|ORBIT_WEB_DATABASE|PG)/.test(k)), []);
  });

  test("an account a program gives a model to sees it, and the catalog is read again at each sign-in", async () => {
    const bob = await accounts.as(h, BOB);
    const catalog = (await bob.get("/api/claude/models")).body as ModelCatalog;
    assert.deepEqual(catalog.models.find((m) => m.id === "claude-mythos-5"), { id: "claude-mythos-5", label: "Mythos 5", description: "A research preview", efforts: ["high", "max"], autoMode: false });
    const alice = await accounts.as(h, ALICE);
    assert.equal(((await alice.get("/api/claude/models")).body as ModelCatalog).models.some((m) => m.id === "claude-mythos-5"), false, "an account without it does not see it");
    const refused = await alice.send("POST", "/api/sessions", { model: "claude-mythos-5", mode: "plan" });
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(refused.body), /not a model this Claude account can use/);
  });
});

describe("each account sees its own records, and those shared with its email -- and a switch of account ends the other's sessions", () => {
  let h: Harness;
  let accounts: ReturnType<typeof twoAccounts>;
  let alice: Browser;
  let alices: SessionSummary;
  before(async () => {
    accounts = twoAccounts();
    h = await startHarness({ fake: accounts.fake });
    alice = h;
    alices = await newChat(alice, { title: "Alice's private plan", prompt: "Plan the release." });
    await settled(alice, alices.id);
  });
  after(() => h.close());

  test("its owner sees it as its own", async () => {
    const list = (await alice.get("/api/sessions")).body as SessionSummary[];
    assert.deepEqual(list.map((s) => [s.id, s.access, s.owner]), [[alices.id, "owner", "alice@example.com"]]);
  });

  test("when another account signs in, the account before is signed out of every browser, and its open streams close", async () => {
    const stream = await alice.stream("/api/events");
    const bob = await accounts.as(h, BOB);
    await stream.ended;
    const refused = await alice.get("/api/sessions");
    assert.equal(refused.status, 401);
    assert.equal(errorCode(refused), CLAUDE_SIGN_IN_REQUIRED);
    assert.deepEqual((await bob.get("/api/sessions")).body, []);
    alice = await accounts.as(h, ALICE);
    assert.equal((await bob.get("/api/sessions")).status, 401, "and the other way round");
  });

  test("another account sees nothing of it, through any route under it", async () => {
    const bob = await accounts.as(h, BOB);
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
    alice = await accounts.as(h, ALICE);
    assert.deepEqual(((await alice.get("/api/sessions")).body as SessionSummary[]).map((s) => s.id), [alices.id], "and Alice does not see Bob's");
  });

  test("an account id a request names is never what decides: it is the session's", async () => {
    const bob = await accounts.as(h, BOB);
    const forged = { "x-orbit-account": alice.accountId ?? "", "x-account-id": alice.accountId ?? "" };
    const listed = (await bob.get(`/api/sessions?accountId=${alice.accountId ?? ""}`, forged)).body as SessionSummary[];
    assert.ok(listed.length > 0 && listed.every((s) => s.owner === "bob@example.com"), "a query or a header naming another account changes nothing: Bob sees his own chats and only those");
    assert.equal(JSON.stringify(listed).includes(alices.id), false);
    assert.equal((await bob.get(`/api/sessions/${alices.id}?accountId=${alice.accountId ?? ""}`, forged)).status, 404);
    const created = await bob.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", accountId: alice.accountId });
    assert.equal(created.status, 400, "a body naming an account is refused: no request chooses its account");
    alice = await accounts.as(h, ALICE);
  });

  test("its owner shares it by email; that account opens it and carries on -- but only the owner deletes it, shares it on or publishes it", async () => {
    alice = await accounts.as(h, ALICE);
    const shared = await alice.send("PUT", `/api/sessions/${alices.id}/access`, { people: [" BOB@example.com ", "alice@example.com"] });
    assert.equal(shared.status, 200);
    assert.deepEqual((shared.body as AccessList).people.map((p) => [p.email, p.grantedBy]), [["bob@example.com", "alice@example.com"]], "lower case, and never its own owner");

    const bob = await accounts.as(h, BOB);
    const list = (await bob.get("/api/sessions")).body as SessionSummary[];
    assert.deepEqual(list.filter((s) => s.id === alices.id).map((s) => [s.id, s.access, s.owner]), [[alices.id, "shared", "alice@example.com"]]);
    assert.ok(list.every((s) => s.id === alices.id || (s.access === "owner" && s.owner === "bob@example.com")), "and besides it, only Bob's own chats");
    assert.equal((await bob.send("POST", `/api/sessions/${alices.id}/messages`, { text: "Carry on." })).status, 202);
    await settled(bob, alices.id);
    for (const [method, rest] of [["DELETE", ""], ["PUT", "/access"], ["POST", "/share"], ["DELETE", "/share"]] as const) {
      const r = await bob.send(method, `/api/sessions/${alices.id}${rest}`, method === "PUT" ? { people: [] } : undefined);
      assert.equal(r.status, 403, `${method} ${rest}`);
      assert.equal(errorCode(r), "owner_only");
    }
    assert.equal((await bob.get("/api/governance/workspaces")).status, 200);
    assert.equal(JSON.stringify((await bob.get("/api/governance/workspaces")).body).includes(alices.id), false, "a chat shared with it is not its to govern");

    alice = await accounts.as(h, ALICE);
    assert.equal((await alice.send("PUT", `/api/sessions/${alices.id}/access`, { people: [] })).status, 200);
    const again = await accounts.as(h, BOB);
    assert.equal((await again.get(`/api/sessions/${alices.id}`)).status, 404, "unshared: closed again at once");
  });

  test("a notification about another account's record never reaches this account's pages", async () => {
    const bob = await accounts.as(h, BOB);
    const stream = await bob.stream("/api/events");
    try {
      h.app.get(EventBus).publishApp("session.summary", { session: { ...alices, title: "leaked?" } }, accountAudience(alice.accountId as string));
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
      for (const path of ["/api/sessions", "/api/governance/overview", "/api/account", "/api/settings"]) {
        const r = await h.get(path, { [RUN_TOKEN_HEADER]: token });
        assert.equal(r.status, 403, path);
        assert.equal(errorCode(r), "agent_outside_gateway", path);
      }
      const policy = await h.send("POST", "/api/governance/revisions", {}, { [RUN_TOKEN_HEADER]: token });
      assert.equal(policy.status, 403, "an agent never writes the policy that governs it");
      assert.equal((await h.get("/api/agent/whoami", { [RUN_TOKEN_HEADER]: research })).status, 401, "a research run's token opens no gateway");
      const recorded = await h.sql("SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'boundary.violation' AND account_id = $1", [h.accountId]);
      assert.ok(Number(recorded[0]?.n) >= 4, "each attempt is in the account's audit record");
    } finally {
      await h.close();
    }
  });
});
