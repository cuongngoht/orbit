// A SUBSCRIPTION SIGNED IN FROM ITS CARD (ADR 0068), through the real API, with each CLI's own sign-in scripted as it
// prints it: the CLI runs with that connection's home and nothing else; only the browser that started it sees the link
// and the codes and may send Claude Code's code; that code reaches the CLI's stdin and nowhere else (not the database,
// not the audit record); it ends connected only once the CLI's own status names the identity; Codex's device flow needs
// nothing sent back; Reconnect may sign a connected one in again; the operator can switch it off.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { CONNECTION_ERRORS, type ConnectionSignIn, type RuntimeConnection } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeIdentities, claudeIdentityOf, CLAUDE_SIGNED_OUT, eventually, homeOf, signedIn, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

const CLAUDE_URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=test&response_type=code&state=s1";
const GOOD = "good-code-0123456789abcdef#s1";
const CODEX_DEVICE = [
  "Welcome to Codex [v0.169.0]",
  "",
  "1. Open this link in your browser and sign in to your account",
  "   https://auth.openai.com/codex/device",
  "",
  "2. Enter this one-time code (expires in 15 minutes)",
  "   VQZB-WOWS4",
  "",
].join("\n");

// `claude auth login --claudeai` as Claude Code prints it: the URL, the prompt -- and, for the right code, a login in the
// home it was given; a wrong code is asked for again.
function claudeLogin(fake: FakeProcessPort): void {
  fake.on(program("claude", "auth", "login"), {
    spawn: (child: FakeChild, call: Call) => {
      // A signal ends it, as it ends the real CLI.
      child.onSignal((signal) => child.exit(null, signal));
      child.stdout(`Opening browser to sign in…\nIf the browser didn't open, visit: ${CLAUDE_URL}\n`);
      child.stdout("Paste code here if prompted > ");
      // A process answers what it read on a later turn of the event loop, never inside the write itself.
      child.onInput((text) =>
        setImmediate(() => {
          if (text.trim() !== GOOD) {
            child.stdout("\nOAuth error: invalid code\nPaste code here if prompted > ");
            return;
          }
          const home = homeOf(call.env.CLAUDE_CONFIG_DIR);
          if (home !== null) claudeIdentities(fake).byConnection.set(home.connectionId, claudeIdentityOf("octo"));
          child.stdout("\nLogin successful.\n");
          child.exit(0);
        }),
      );
    },
  });
}

const signInOf = async (b: Browser, id: string): Promise<ConnectionSignIn> => ok<ConnectionSignIn>(await b.get(`/api/connections/${id}/sign-in`));

describe("a subscription signed in from its card (ADR 0068)", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    claudeLogin(fake);
    h = await startHarness({ fake, account: { connect: false } });
    claudeIdentities(fake).byAccount.set(h.accountId as string, CLAUDE_SIGNED_OUT);
  });
  after(() => h.close());

  test("Claude Code: the CLI's own sign-in in the connection's home; the link shown to this browser; the code reaches the CLI's stdin alone", async () => {
    const c = ok<RuntimeConnection>(await h.send("POST", "/api/connections", { runtime: "claude", method: "subscription" }));
    assert.deepEqual([c.auth, c.signInHere], ["disconnected", true]);
    const started = ok<ConnectionSignIn>(await h.send("POST", `/api/connections/${c.id}/sign-in`));
    assert.equal(started.mine, true);
    const waiting = await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "awaiting_user");
    assert.deepEqual([waiting.flow.url, waiting.flow.needsCode, waiting.flow.code], [CLAUDE_URL, true, null]);
    const login = fake.callsOf(program("claude", "auth", "login")).at(-1) as Call;
    assert.deepEqual(login.args, ["auth", "login", "--claudeai"]);
    assert.equal(login.env.CLAUDE_CONFIG_DIR, join(h.config.data.connections, h.accountId as string, c.id, "claude"), "that connection's home, nothing else");
    assert.deepEqual(Object.keys(login.env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_OAUTH)/.test(k)), []);
    assert.equal(ok<ConnectionSignIn>(await h.send("POST", `/api/connections/${c.id}/sign-in`)).flow.url, CLAUDE_URL, "starting again returns the one under way");
    assert.equal(fake.callsOf(program("claude", "auth", "login")).length, 1);

    // Another browser of the account: one is under way, and by whom -- nothing it could act on.
    const other = await h.browser();
    const seen = await signInOf(other, c.id);
    assert.deepEqual([seen.mine, seen.flow.state, seen.flow.url, seen.flow.code, seen.flow.needsCode, seen.startedBy], [false, "awaiting_user", null, null, false, "Octo Cat"]);
    assert.equal(code(await other.send("POST", `/api/connections/${c.id}/sign-in/code`, { code: GOOD })), CONNECTION_ERRORS.noSignIn);
    assert.equal(code(await other.send("POST", `/api/connections/${c.id}/sign-in`)), CONNECTION_ERRORS.signInBusy);
    assert.equal((await h.send("POST", `/api/connections/${c.id}/sign-in/code`, { code: "has spaces in it" })).status, 400);

    // A wrong code: the CLI asks for it again, and the page says so.
    ok(await h.send("POST", `/api/connections/${c.id}/sign-in/code`, { code: "wrong-code-000#s1" }));
    const again = await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "awaiting_user" && /again/.test(v.flow.message ?? ""));
    assert.equal(again.flow.needsCode, true);
    // The right one: connected once the CLI's own status names who it is.
    ok(await h.send("POST", `/api/connections/${c.id}/sign-in/code`, { code: GOOD }));
    const done = await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "connected");
    assert.match(done.flow.message ?? "", /octo@example\.com/);
    assert.deepEqual([done.flow.url, done.flow.code, done.flow.needsCode], [null, null, false], "an ended sign-in keeps only its outcome");
    const after = ok<RuntimeConnection>(await h.get(`/api/connections/${c.id}`));
    assert.deepEqual([after.auth, after.identity, after.catalog.source], ["connected", "octo@example.com (Octo Org)", "account"]);

    const child = fake.children.find((x) => x.call === login)?.child as FakeChild;
    assert.deepEqual(child.written.map((t) => t.trim()), ["wrong-code-000#s1", GOOD], "the codes went to the CLI's stdin");
    const kept = await h.sql("SELECT count(*)::int AS n FROM audit_events WHERE data::text LIKE $1 OR data::text LIKE $2 OR data::text LIKE $3", [`%${GOOD}%`, "%wrong-code%", "%oauth/authorize%"]);
    assert.equal(kept[0]?.n, 0, "neither a code nor the link is in the audit record");
    const settings = await h.sql("SELECT data->>'setting' AS setting FROM audit_events WHERE account_id = $1 AND data->>'setting' LIKE 'ai_connection.%' ORDER BY seq", [h.accountId]);
    assert.deepEqual(
      settings.map((r) => r.setting),
      ["ai_connection.claude.subscription.created", "ai_connection.claude.subscription.sign_in_started", "ai_connection.claude.subscription.signed_in_from_page"],
    );

    // Reconnect: a connected connection may be signed in again from its card (with the same identity it stays connected).
    ok(await h.send("POST", `/api/connections/${c.id}/sign-in`));
    await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "awaiting_user");
    const cancelled = ok<ConnectionSignIn>(await h.send("POST", `/api/connections/${c.id}/sign-in/cancel`));
    assert.ok(["cancelled", "awaiting_user"].includes(cancelled.flow.state));
    await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "cancelled");
    const last = fake.children.filter((x) => x.call.args[0] === "auth" && x.call.args[1] === "login").at(-1)?.child as FakeChild;
    assert.deepEqual(last.signals.slice(0, 1), ["SIGTERM"], "a cancelled sign-in stops the CLI");
    assert.equal(ok<RuntimeConnection>(await h.get(`/api/connections/${c.id}`)).auth, "connected", "a cancelled reconnect changes nothing");
  });

  test("OpenAI Codex: the device sign-in's link and one-time code are shown; nothing is sent back, and it ends connected by itself", async () => {
    let finish: (() => void) | null = null;
    let codexSignedIn = false;
    fake
      .on(program("codex", "--version"), { run: { stdout: "codex-cli 0.169.0\n" } })
      // codex-cli 0.169.0: its status names no account -- its app server does (account/read).
      .on(program("codex", "login", "status"), { run: () => (codexSignedIn ? { stdout: "Logged in using ChatGPT\n" } : { code: 1, stderr: "Not logged in\n" }) })
      .on(program("codex", "app-server"), {
        spawn: (child) => {
          child.onSignal((signal) => child.exit(null, signal));
          child.onInput((text) => {
            if (!text.includes('"account/read"')) return;
            setImmediate(() => child.stdout(`${JSON.stringify({ id: 1, result: { account: { type: "chatgpt", email: "octo@example.com", planType: "team", workspaceName: "Octo Org" }, workspaceRouting: { chatgptAccountId: "ws-1" } } })}\n`));
          });
        },
      })
      .on(program("codex", "login", "--device-auth"), {
        spawn: (child) => {
          child.stdout(CODEX_DEVICE);
          finish = () => {
            codexSignedIn = true;
            child.stdout("Successfully logged in\n");
            child.exit(0);
          };
        },
      });
    const c = ok<RuntimeConnection>(await h.send("POST", "/api/connections", { runtime: "codex", method: "subscription" }));
    assert.deepEqual([c.auth, c.signInHere], ["disconnected", true]);
    ok(await h.send("POST", `/api/connections/${c.id}/sign-in`));
    const waiting = await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "awaiting_user");
    assert.deepEqual([waiting.flow.url, waiting.flow.code, waiting.flow.needsCode], ["https://auth.openai.com/codex/device", "VQZB-WOWS4", false]);
    const login = fake.callsOf(program("codex", "login", "--device-auth")).at(-1) as Call;
    assert.equal(login.env.CODEX_HOME, join(h.config.data.connections, h.accountId as string, c.id, "codex"));
    assert.equal(code(await h.send("POST", `/api/connections/${c.id}/sign-in/code`, { code: "VQZB-WOWS4" })), undefined, "a code sent to a flow that asks for none is not written");
    assert.deepEqual(fake.children.find((x) => x.call === login)?.child.written, [], "nothing reached the CLI");
    (finish as unknown as () => void)();
    await eventually(() => signInOf(h, c.id), (v) => v.flow.state === "connected");
    const after = ok<RuntimeConnection>(await h.get(`/api/connections/${c.id}`));
    assert.deepEqual([after.auth, after.identity], ["connected", "octo@example.com (Octo Org)"]);
    const server = fake.callsOf(program("codex", "app-server")).at(-1) as Call;
    assert.equal(server.env.CODEX_HOME, join(h.config.data.connections, h.accountId as string, c.id, "codex"), "asked in that connection's home");
  });

  test("an API-key connection, Antigravity and another account's connection are not signed in from a card", async () => {
    const key = ok<RuntimeConnection>(await h.send("POST", "/api/connections", { runtime: "claude", method: "api_key", apiKey: "sk-ant-api03-test-key-0123456789abcdefghij" }));
    assert.equal(key.signInHere, false);
    assert.equal(code(await h.send("POST", `/api/connections/${key.id}/sign-in`)), CONNECTION_ERRORS.signInNotOffered);
    const bob = await h.as("bob");
    const mine = ok<RuntimeConnection[]>(await h.get("/api/connections").then((r) => ({ ...r, body: (r.body as { connections: RuntimeConnection[] }).connections })));
    const target = mine.find((x) => x.method === "subscription") as RuntimeConnection;
    assert.equal((await bob.send("POST", `/api/connections/${target.id}/sign-in`)).status, 404, "another account's connection is not found");
    assert.equal((await bob.get(`/api/connections/${target.id}/sign-in`)).status, 404);
  });
});

describe("the operator switched signing in from a card off (ORBIT_WEB_SIGN_IN_ON_PAGE=0)", () => {
  let h: Harness;
  before(async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    claudeLogin(fake);
    h = await startHarness({ fake, account: { connect: false }, env: { ORBIT_WEB_SIGN_IN_ON_PAGE: "0" } });
    claudeIdentities(fake).byAccount.set(h.accountId as string, CLAUDE_SIGNED_OUT);
  });
  after(() => h.close());

  test("the card offers the terminal command alone, and the route refuses", async () => {
    const c = ok<RuntimeConnection>(await h.send("POST", "/api/connections", { runtime: "claude", method: "subscription" }));
    assert.equal(c.signInHere, false);
    assert.ok(c.terminalCommand?.includes(c.id));
    const r = await h.send("POST", `/api/connections/${c.id}/sign-in`);
    assert.deepEqual([r.status, code(r)], [409, CONNECTION_ERRORS.signInNotOffered]);
    assert.match(JSON.stringify(r.body), /ORBIT_WEB_SIGN_IN_ON_PAGE=0/);
  });
});
