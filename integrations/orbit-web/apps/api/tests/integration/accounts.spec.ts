// EACH CLAUDE ACCOUNT HAS AN ORBIT WEB OF ITS OWN. Orbit Web is signed in to one Claude account at a time; that
// account sees its own chats and the ones shared with it -- never another account's, through any route -- and its
// runs use the models its own Claude CLI says it may (a program's model appears only for the accounts that have it),
// read again at every sign-in.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import type { AccessList, ModelCatalog, SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { EventBus } from "../../src/core/events/event-bus.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { ClaudeAuthService } from "../../src/modules/claude-auth/claude-auth.service.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { CLAUDE_SIGNED_IN, claudeModelsProbe, claudeRun, eventually, MODEL_ENTRIES, modelsAnswer, signedIn, startHarness, type Harness, type Reply } from "../../src/testing/harness.js";
import { filled, routesOf } from "../../src/testing/routes.js";

const ALICE = { ...CLAUDE_SIGNED_IN, email: "alice@example.com", orgId: "org-a", orgName: "Alice Org" };
const BOB = { ...CLAUDE_SIGNED_IN, email: "bob@example.com", orgId: "org-b", orgName: "Bob Org", subscriptionType: "team" };
// A model one program gives some accounts: Bob's account has it, Alice's does not.
const PREVIEW = { value: "claude-mythos-5", resolvedModel: "claude-mythos-5", displayName: "Mythos 5", description: "A research preview", supportsEffort: true, supportedEffortLevels: ["high", "max"], supportsAutoMode: false };

const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function quickRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", session_id: after1(call.args, "--session-id") ?? after1(call.args, "--resume"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0, num_turns: 1, duration_ms: 1 });
    c.exit(0);
  });
}

// One Orbit Web whose Claude CLI is signed in to whichever account `who` names.
function twoAccounts() {
  const state = { who: ALICE as Record<string, unknown> };
  const fake = signedIn(new FakeProcessPort(new NodeProcessPort()))
    .on(program("claude", "auth", "status"), { run: () => ({ stdout: JSON.stringify(state.who) }) })
    .on(claudeModelsProbe, { run: () => ({ stdout: modelsAnswer(state.who === BOB ? [...MODEL_ENTRIES, PREVIEW] : MODEL_ENTRIES) }) })
    .on(claudeRun, { spawn: quickRun });
  const as = async (h: Harness, account: Record<string, unknown>) => {
    state.who = account;
    await h.app.get(ClaudeAuthService).account(true);
  };
  return { fake, state, as };
}

const newChat = async (h: Harness, body: Record<string, unknown> = {}): Promise<SessionSummary> => {
  const r = await h.send("POST", "/api/sessions", { model: "sonnet", mode: "plan", ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as SessionSummary;
};

const settled = (h: Harness, id: string) => eventually(async () => ((await h.get(`/api/sessions/${id}`)).body as SessionDetail).status, (s) => s === "ready" || s === "completed");

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
    const dated = catalog.models.find((m) => m.id === "claude-haiku-4-5-20251001");
    assert.deepEqual([dated?.label, dated?.efforts, dated?.autoMode], ["Haiku 4.5", [], false]);
    const probe = accounts.fake.callsOf(claudeModelsProbe)[0] as Call;
    for (const flag of ["--restricted", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(probe.args.includes(flag), flag);
    assert.equal(after1(probe.args, "--tools"), "", "no tool");
    assert.match(probe.input ?? "", /"subtype":"initialize"/);
    assert.deepEqual(Object.keys(probe.env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_OAUTH)/.test(k)), []);
  });

  test("an account a program gives a model to sees it, and the catalog is read again at each sign-in", async () => {
    let child: FakeChild | null = null;
    accounts.fake.on(program("claude", "auth", "login"), {
      spawn: (c) => {
        child = c;
        c.stdout("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s1\nPaste code here if prompted > ");
        c.onInput(() => {
          accounts.state.who = BOB;
          c.exit(0);
        });
      },
    });
    const probes = accounts.fake.callsOf(claudeModelsProbe).length;
    assert.equal((await h.send("POST", "/api/claude/login")).status, 202);
    await eventually(async () => ((await h.get("/api/claude/status")).body as { flow: { state: string } }).flow.state, (s) => s === "awaiting_user");
    assert.equal((await h.send("POST", "/api/claude/login/code", { code: "abc#s1" })).status, 202);
    await eventually(() => accounts.fake.callsOf(claudeModelsProbe).length, (n) => n > probes);
    assert.ok(child);
    const catalog = (await h.get("/api/claude/models")).body as ModelCatalog;
    assert.deepEqual(catalog.models.find((m) => m.id === "claude-mythos-5"), { id: "claude-mythos-5", label: "Mythos 5", description: "A research preview", efforts: ["high", "max"], autoMode: false });
    await accounts.as(h, ALICE);
    assert.equal(((await h.get("/api/claude/models")).body as ModelCatalog).models.some((m) => m.id === "claude-mythos-5"), false, "an account without it does not see it");
  });

  test("a chat's model, effort and mode are held to the account's catalog", async () => {
    await accounts.as(h, ALICE);
    const refused = await h.send("POST", "/api/sessions", { model: "claude-mythos-5", mode: "plan" });
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(refused.body), /not a model this Claude account can use/);
    assert.match(JSON.stringify((await h.send("POST", "/api/sessions", { model: "claude-haiku-4-5-20251001", mode: "autonomous" })).body), /Autonomous .* is not available with Haiku 4\.5/);
    const dated = await newChat(h, { model: "claude-haiku-4-5-20251001", prompt: "hi" });
    await settled(h, dated.id);
    const run = accounts.fake.children.find((c) => claudeRun(c.call.file, c.call.args) && after1(c.call.args, "--model") === "claude-haiku-4-5-20251001")?.call as Call;
    assert.equal(run.args.includes("--effort"), false, "a model that takes no effort level is given none");
    assert.equal((await h.send("PATCH", "/api/settings", { defaultModel: "claude-mythos-5" })).status, 400);

    await accounts.as(h, BOB);
    assert.equal((await h.send("POST", "/api/sessions", { model: "claude-mythos-5", effort: "low", mode: "plan" })).status, 400, "an effort the model does not take");
    const chat = await newChat(h, { model: "opus", effort: "medium" });
    const moved = (await h.send("PATCH", `/api/sessions/${chat.id}`, { model: "claude-mythos-5" })).body as SessionSummary;
    assert.deepEqual([moved.model, moved.effort], ["claude-mythos-5", "high"], "an effort the new model does not take moves to one it does");
    assert.equal((await h.send("PATCH", `/api/sessions/${chat.id}`, { mode: "autonomous" })).status, 400, "auto mode is not available with it");
  });
});

describe("when the CLI cannot be asked, the default list is shown and the CLI decides", () => {
  test("a fallback catalog, said as such, holds a model to its shape alone", async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeModelsProbe, { run: { code: 1, stderr: "unknown option" } }).on(claudeRun, { spawn: quickRun });
    const h = await startHarness({ fake });
    try {
      const catalog = (await h.get("/api/claude/models")).body as ModelCatalog;
      assert.equal(catalog.source, "fallback");
      assert.deepEqual(catalog.models.map((m) => m.id), ["opus", "fable", "sonnet", "haiku"]);
      assert.match(catalog.detail ?? "", /did not list this account's models/);
      await newChat(h, { model: "claude-sonnet-4-6" });
      assert.equal((await h.send("POST", "/api/sessions", { model: "--dangerously-skip-permissions" })).status, 400, "never an option");
    } finally {
      await h.close();
    }
  });
});

describe("each Claude account sees its own chats, and those shared with it", () => {
  let h: Harness;
  let accounts: ReturnType<typeof twoAccounts>;
  let alices: SessionSummary;
  before(async () => {
    accounts = twoAccounts();
    h = await startHarness({ fake: accounts.fake });
    alices = await newChat(h, { title: "Alice's private plan", prompt: "Plan the release." });
    await settled(h, alices.id);
  });
  after(() => h.close());

  test("its owner sees it as its own", async () => {
    const list = (await h.get("/api/sessions")).body as SessionSummary[];
    assert.deepEqual(list.map((s) => [s.id, s.access, s.owner]), [[alices.id, "owner", "alice@example.com"]]);
  });

  test("another account sees nothing of it, through any route under it", async () => {
    await accounts.as(h, BOB);
    assert.deepEqual((await h.get("/api/sessions")).body, []);
    const routes = routesOf(h).filter((r) => r.path.startsWith("/api/sessions/:id"));
    assert.ok(routes.length >= 15, `every route under a chat was read (${routes.length})`);
    for (const r of routes) {
      const path = filled(r.path, { id: alices.id });
      const reply = r.method === "GET" ? await h.get(path) : await h.send(r.method, path, {});
      assert.equal(reply.status, 404, `${r.method} ${r.path}`);
      assert.equal(JSON.stringify(reply.body).includes("Alice's private plan"), false, `${r.method} ${r.path}`);
    }
    const bobs = await newChat(h);
    await accounts.as(h, ALICE);
    assert.deepEqual(((await h.get("/api/sessions")).body as SessionSummary[]).map((s) => s.id), [alices.id], "and Alice does not see Bob's");
    await accounts.as(h, BOB);
    await settled(h, bobs.id);
    assert.equal((await h.send("DELETE", `/api/sessions/${bobs.id}`)).status, 204);
  });

  test("its owner shares it by email; that account opens it and carries on -- but only the owner deletes it, shares it on or publishes it", async () => {
    await accounts.as(h, ALICE);
    const shared = await h.send("PUT", `/api/sessions/${alices.id}/access`, { people: [" BOB@example.com ", "alice@example.com"] });
    assert.equal(shared.status, 200);
    assert.deepEqual((shared.body as AccessList).people.map((p) => [p.email, p.grantedBy]), [["bob@example.com", "alice@example.com"]], "lower case, and never its own owner");
    assert.equal((await h.send("PUT", `/api/sessions/${alices.id}/access`, { people: ["not an email"] })).status, 400);

    await accounts.as(h, BOB);
    const list = (await h.get("/api/sessions")).body as SessionSummary[];
    assert.deepEqual(list.map((s) => [s.id, s.access, s.owner]), [[alices.id, "shared", "alice@example.com"]]);
    assert.equal((await h.send("POST", `/api/sessions/${alices.id}/messages`, { text: "Carry on." })).status, 202);
    await settled(h, alices.id);
    assert.equal((await h.get(`/api/sessions/${alices.id}/access`)).status, 200, "it sees who owns it and who else may open it");
    for (const [method, rest] of [["DELETE", ""], ["PUT", "/access"], ["POST", "/share"], ["DELETE", "/share"]] as const) {
      const r = await h.send(method, `/api/sessions/${alices.id}${rest}`, method === "PUT" ? { people: [] } : undefined);
      assert.equal(r.status, 403, `${method} ${rest}`);
      assert.equal(errorCode(r), "owner_only");
    }

    await accounts.as(h, ALICE);
    assert.equal((await h.send("PUT", `/api/sessions/${alices.id}/access`, { people: [] })).status, 200);
    await accounts.as(h, BOB);
    assert.equal((await h.get(`/api/sessions/${alices.id}`)).status, 404, "unshared: closed again at once");
  });

  test("a notification about another account's chat never reaches this account's pages", async () => {
    await accounts.as(h, BOB);
    const stream = await h.stream("/api/events");
    try {
      h.app.get(EventBus).publishApp("session.summary", { session: { ...alices, title: "leaked?" } });
      const own = await newChat(h, { title: "Bob's own" });
      await stream.until((es) => es.some((e) => e.type === "session.summary" && (e.data as { session: SessionSummary }).session.id === own.id));
      assert.equal(stream.events.some((e) => e.type === "session.summary" && (e.data as { session: SessionSummary }).session.id === alices.id), false);
    } finally {
      stream.close();
    }
  });
});

describe("a chat from before owners is claimed, once, by the first account that signs in", () => {
  test("it becomes that account's, and stays out of every other's", async () => {
    const first = twoAccounts();
    const h1 = await startHarness({ fake: first.fake });
    const chat = await newChat(h1, { title: "From before" });
    await h1.close(true);
    const db = new DatabaseSync(join(h1.dataDir, "app", "orbit-web.db"));
    db.prepare("UPDATE sessions SET owner_email = NULL, owner_org = NULL").run();
    db.close();

    const again = twoAccounts();
    again.state.who = BOB;
    const h2 = await startHarness({ fake: again.fake, dataDir: h1.dataDir });
    try {
      assert.deepEqual(((await h2.get("/api/sessions")).body as SessionSummary[]).map((s) => [s.id, s.access, s.owner]), [[chat.id, "owner", "bob@example.com"]]);
      await again.as(h2, ALICE);
      assert.deepEqual((await h2.get("/api/sessions")).body, [], "claimed once: Alice signing in later claims nothing");
    } finally {
      await h2.close(true);
    }
    const kept = new DatabaseSync(join(h1.dataDir, "app", "orbit-web.db"));
    const claim = kept.prepare("SELECT value FROM settings WHERE key = 'ownership.claimed'").get() as { value: string } | undefined;
    kept.close();
    rmSync(h1.dataDir, { recursive: true, force: true });
    assert.deepEqual(JSON.parse(claim?.value ?? "{}").by, "bob@example.com", "who claimed them is recorded");
  });
});
