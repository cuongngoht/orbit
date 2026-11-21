// THE CLAUDE SIGN-IN IS ORBIT WEB'S SIGN-IN, AND IT IS A BROWSER'S. Until THIS browser finished a sign-in with a Claude
// account, every route but the health check, the access token, the Claude sign-in itself and a shared chat's link is
// refused with claude_sign_in_required -- even when the runtime's Claude CLI is signed in already. A sign-in belongs to
// the browser that started it: another browser sees nothing of it, cannot send its code and cannot take the session it
// ends with. A session is a cookie the server keeps only the hash of, rotated at every sign-in, checked for its CSRF
// token on every change, and ended by signing out -- this browser, or the whole account.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { CLAUDE_SIGN_IN_REQUIRED, CSRF_HEADER, SIGN_IN_BUSY, type ClaudeStatus, type LoginSnapshot, type SetupStatus } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type FakeChild } from "../../src/testing/fake-process.js";
import { ClaudeCli } from "../../src/modules/auth/claude-cli.service.js";
import { browserAt, CLAUDE_SIGNED_IN, CLAUDE_SIGNED_OUT, eventually, signedIn, signInBrowser, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { routesOf } from "../../src/testing/routes.js";

const claudeStatus = program("claude", "auth", "status");
const answering = (status: object) => (fake: FakeProcessPort) => fake.on(claudeStatus, { run: { stdout: JSON.stringify(status) } });
const claudeSignedOut = answering(CLAUDE_SIGNED_OUT);
const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

// The routes a person may reach before signing in, and nothing else.
const OPEN = [
  "GET /api/health",
  "POST /api/access",
  "GET /api/claude/status",
  "POST /api/claude/login",
  "POST /api/claude/login/code",
  "POST /api/claude/login/cancel",
  "GET /api/claude/login/events",
  "POST /api/claude/session",
  // A shared chat's link: one read-only snapshot, which needs no Claude account to read (modules/share).
  "GET /api/shared/:token",
];

const concrete = (path: string): string => path.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");

const statusOf = async (b: Browser): Promise<ClaudeStatus> => (await b.get("/api/claude/status")).body as ClaudeStatus;

// Every route but the open ones and the agent gateway's, asked by `b`: each is refused with claude_sign_in_required.
async function everyRouteRefused(h: Harness, b: Browser): Promise<void> {
  for (const r of routesOf(h).filter((x) => !x.open && !x.agent)) {
    const reply = r.method === "GET" ? await b.get(concrete(r.path)) : await b.send(r.method, concrete(r.path), {});
    assert.equal(reply.status, 401, `${r.method} ${r.path}`);
    assert.equal(errorCode(reply), CLAUDE_SIGN_IN_REQUIRED, `${r.method} ${r.path}`);
  }
}

describe("before the Claude sign-in, Orbit Web answers nothing but the way to it", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ fake: claudeSignedOut(signedIn(new FakeProcessPort(new NodeProcessPort()))) })));
  after(() => h.close());

  test("the routes reachable before the sign-in are exactly the health check, the access token, the Claude sign-in and reading a shared chat", () => {
    const routes = routesOf(h);
    assert.ok(routes.length >= 30, `the application's routes were read (${routes.length})`);
    assert.deepEqual(routes.filter((r) => r.open).map((r) => `${r.method} ${r.path}`).sort(), [...OPEN].sort());
  });

  test("every other route is refused with claude_sign_in_required, and nothing is run on the way", async () => {
    const before = h.fake.calls.length;
    await everyRouteRefused(h, h.anonymous);
    const ran = h.fake.calls.slice(before).filter((c) => !claudeStatus(c.file, c.args));
    assert.deepEqual(ran.map((c) => `${c.file} ${c.args.join(" ")}`), [], "only the Claude CLI's own status was asked");
  });

  test("the sign-in page reads the sign-in: not connected, no account, no session", async () => {
    const status = await statusOf(h.anonymous);
    assert.deepEqual([status.state, status.runtime, status.account, status.session, status.flow.state], ["not_connected", "not_connected", null, null, "idle"]);
    assert.equal((await h.get("/api/health")).status, 200);
  });
});

describe("the runtime's CLI being signed in does not sign a browser in", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ signIn: false })));
  after(() => h.close());

  test("a browser with no session is refused everywhere, and is told nothing about who the CLI holds", async () => {
    const status = await statusOf(h.anonymous);
    assert.equal(status.runtime, "connected", "the CLI is signed in");
    assert.deepEqual([status.state, status.account, status.session], ["not_connected", null, null], "and this browser is not");
    assert.equal(JSON.stringify(status).includes("octo@example.com"), false, "no account is named to a browser without a session");
    await everyRouteRefused(h, h.anonymous);
  });

  test("it signs in by running the Claude flow itself, and only then is it the account's owner", async () => {
    const owner = await h.browser();
    assert.equal(owner.status?.state, "connected");
    assert.equal(owner.status?.session?.email, "octo@example.com");
    assert.equal((await owner.get("/api/setup/status")).status, 200);
    assert.equal(h.fake.callsOf(program("claude", "auth", "login")).length, 1, "the official flow ran: `claude auth login --claudeai`");
    assert.deepEqual(h.fake.callsOf(program("claude", "auth", "login"))[0]?.args, ["auth", "login", "--claudeai"]);
  });
});

describe("a sign-in belongs to the browser that started it", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let child: FakeChild | null = null;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(program("claude", "auth", "login"), {
      spawn: (c) => {
        child = c;
        c.stdout("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s1\nPaste code here if prompted > ");
        c.onInput(() => c.exit(0));
        c.onSignal(() => c.exit(null, "SIGTERM"));
      },
    });
    h = await startHarness({ fake, signIn: false });
  });
  after(() => h.close());

  test("another browser sees no URL, cannot send the code, cannot cancel it, cannot start a second one, and cannot take the session", async () => {
    const mine = browserAt(h.url);
    const theirs = browserAt(h.url);
    assert.equal((await mine.send("POST", "/api/claude/login")).status, 202);
    const waiting = await eventually(async () => (await statusOf(mine)).flow, (f) => f.state === "awaiting_user" && f.needsCode);
    assert.equal(waiting.url, "https://claude.com/cai/oauth/authorize?code=true&state=s1");
    assert.match(mine.cookie, /orbit_web_login=/, "the flow is bound to this browser by a cookie");

    const seen = await statusOf(theirs);
    assert.deepEqual([seen.flow.state, seen.flow.url], ["idle", null], "another browser polling sees nothing of it");
    const { events } = await theirs.events("/api/claude/login/events", { until: (es) => es.length > 0, timeoutMs: 1_000 });
    assert.deepEqual(events.map((e) => (e as unknown as LoginSnapshot).state), ["idle"], "nor on the flow's stream");
    assert.equal(((await theirs.send("POST", "/api/claude/login/code", { code: "stolen#s1" })).body as LoginSnapshot).state, "idle");
    assert.deepEqual((child as unknown as FakeChild).written, [], "its code never reached the CLI");
    assert.equal(((await theirs.send("POST", "/api/claude/login/cancel")).body as LoginSnapshot).state, "idle");
    const second = await theirs.send("POST", "/api/claude/login");
    assert.equal(second.status, 409);
    assert.equal(errorCode(second), SIGN_IN_BUSY, "the CLI signs in one at a time");

    assert.equal((await mine.send("POST", "/api/claude/login/code", { code: "abc123#s1" })).status, 202);
    assert.deepEqual((child as unknown as FakeChild).written, ["abc123#s1\n"]);
    await eventually(async () => (await statusOf(mine)).flow.state, (s) => s === "connected");
    const taken = await theirs.send("POST", "/api/claude/session");
    assert.equal(taken.status, 409, "the verified sign-in is exchanged only by the browser that holds it");
    assert.equal((await theirs.get("/api/sessions")).status, 401);

    const claimed = await mine.send("POST", "/api/claude/session");
    assert.equal(claimed.status, 200);
    const status = claimed.body as ClaudeStatus;
    assert.equal(status.state, "connected");
    assert.match(status.session?.csrfToken ?? "", /^[0-9a-f]{64}$/);
    assert.match(mine.cookie, /orbit_web_session=/);
    assert.equal(/orbit_web_login=[^;]/.test(mine.cookie), false, "the flow's cookie is spent");
    const session = (await h.sql("SELECT token_hash FROM account_sessions"))[0]?.token_hash as string;
    assert.equal(mine.cookie.includes(session), false, "the database keeps the token's hash, never the token");
    assert.equal((await mine.send("POST", "/api/claude/session")).status, 409, "a sign-in is exchanged once");
  });
});

describe("a session is rotated at every sign-in, holds its CSRF token, and ends when it is signed out", () => {
  let h: Harness;
  before(async () => (h = await startHarness()));
  after(() => h.close());

  test("a change without this session's CSRF token is refused; a read is not", async () => {
    assert.equal((await h.get("/api/sessions")).status, 200);
    const bare = await h.send("PATCH", "/api/settings", { theme: "dark" }, { [CSRF_HEADER]: "" });
    assert.equal(bare.status, 403);
    assert.equal(errorCode(bare), "csrf_invalid");
    const wrong = await h.send("PATCH", "/api/settings", { theme: "dark" }, { [CSRF_HEADER]: "0".repeat(64) });
    assert.equal(wrong.status, 403);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" })).status, 200);
    const refused = await h.sql("SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'authz.denied'");
    assert.ok(Number(refused[0]?.n) >= 2, "each refused change is recorded");
  });

  test("signing in again from the same browser ends the session it held before", async () => {
    const jar: Record<string, string> = {};
    await signInBrowser(h.url, jar);
    const before = { ...jar };
    const rotated = await signInBrowser(h.url, jar);
    assert.notEqual(jar.orbit_web_session, before.orbit_web_session, "a new token");
    assert.equal((await rotated.get("/api/sessions")).status, 200);
    assert.equal((await browserAt(h.url, before).get("/api/sessions")).status, 401, "the token it held before is no longer a session");
    assert.equal((await h.sql("SELECT revoked_reason FROM account_sessions WHERE revoked_reason = 'rotated'")).length, 1);
  });

  test("signing this browser out ends its session only; signing the account out ends every one, and signs the CLI out", async () => {
    const one = await h.browser();
    const two = await h.browser();
    assert.equal((await one.send("DELETE", "/api/claude/session")).status, 200);
    assert.equal((await one.get("/api/sessions")).status, 401);
    assert.equal((await two.get("/api/sessions")).status, 200, "the account's other browsers stay signed in");
    let loggedIn = true;
    h.fake.on(claudeStatus, { run: () => ({ stdout: JSON.stringify(loggedIn ? CLAUDE_SIGNED_IN : CLAUDE_SIGNED_OUT) }) });
    h.fake.on(program("claude", "auth", "logout"), { run: () => ((loggedIn = false), { code: 0 }) });
    const out = await two.send("POST", "/api/claude/logout");
    assert.equal(out.status, 200);
    assert.deepEqual([(out.body as ClaudeStatus).state, (out.body as ClaudeStatus).session], ["not_connected", null]);
    assert.equal((await two.get("/api/sessions")).status, 401);
    assert.equal((await h.get("/api/sessions")).status, 401, "every browser of the account");
    const open = await h.sql("SELECT count(*)::int AS n FROM account_sessions WHERE revoked_at IS NULL");
    assert.equal(open[0]?.n, 0);
  });
});

describe("when the CLI's identity changes outside Orbit Web, the sessions of the account before end", () => {
  test("a terminal signing the CLI in as somebody else closes this browser's session at its next request", async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    let who: object = CLAUDE_SIGNED_IN;
    fake.on(claudeStatus, { run: () => ({ stdout: JSON.stringify(who) }) });
    const h = await startHarness({ fake });
    try {
      const stream = await h.stream("/api/events");
      assert.equal((await h.get("/api/sessions")).status, 200);
      who = { ...CLAUDE_SIGNED_IN, email: "mallory@example.com", orgId: "org-m" };
      // What the CLI said is kept a few seconds; the next look reads it again.
      h.app.get(ClaudeCli).forget();
      const refused = await h.get("/api/sessions");
      assert.equal(refused.status, 401);
      assert.equal(errorCode(refused), CLAUDE_SIGN_IN_REQUIRED);
      await stream.ended;
      assert.equal((await h.sql("SELECT revoked_reason FROM account_sessions"))[0]?.revoked_reason, "identity_changed");
    } finally {
      await h.close();
    }
  });
});

describe("only a Claude account signs Orbit Web in", () => {
  for (const authMethod of ["api_key", "oauth_token"]) {
    test(`a CLI signed in with ${authMethod} is not signed in to a Claude account`, async () => {
      const h = await startHarness({ fake: answering({ loggedIn: true, authMethod, apiProvider: "firstParty" })(signedIn(new FakeProcessPort(new NodeProcessPort()))) });
      try {
        const status = await statusOf(h.anonymous);
        assert.equal(status.state, "not_connected");
        assert.equal(status.method, authMethod);
        assert.match(status.detail ?? "", /not a Claude account/);
        const setup = await h.get("/api/setup/status");
        assert.equal(setup.status, 401);
      } finally {
        await h.close();
      }
    });
  }
});

describe("signing in shows the account, and the app opens", () => {
  test("the claimed status names the account, and the setup is readable", async () => {
    const h = await startHarness();
    try {
      const status = h.status as ClaudeStatus;
      assert.deepEqual(status.account, { email: "octo@example.com", organization: "Octo Org", plan: "max" });
      const setup = await h.get("/api/setup/status");
      assert.equal(setup.status, 200, "open as soon as the sign-in is verified and exchanged");
      assert.equal((setup.body as SetupStatus).claude.account?.email, "octo@example.com");
    } finally {
      await h.close();
    }
  });
});

describe("the container's own Claude credential variables sign nothing in", () => {
  const values = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-container-variable-000000000000", ANTHROPIC_API_KEY: "sk-ant-api03-container-variable-000000000000", ANTHROPIC_AUTH_TOKEN: "container-auth-token-000000000000" };
  let h: Harness;
  before(async () => (h = await startHarness({ fake: claudeSignedOut(signedIn(new FakeProcessPort(new NodeProcessPort()))), env: values })));
  after(() => h.close());

  test("no child process is given one, and the page names them as ignored -- by name, never by value", async () => {
    const status = await statusOf(h.anonymous);
    assert.equal(status.state, "not_connected");
    assert.match(status.detail ?? "", /CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN; Orbit Web ignores them/);
    for (const value of Object.values(values)) assert.equal(JSON.stringify(status).includes(value), false);
    await h.get("/api/health");
    assert.ok(h.fake.calls.length > 0);
    for (const c of h.fake.calls) assert.deepEqual(Object.keys(c.env).filter((k) => k in values || k.startsWith("ORBIT_WEB_DATABASE") || k.startsWith("PG")), [], `${c.file} ${c.args.join(" ")}`);
  });
});

describe("token mode asks for the access token first, then for the Claude sign-in", () => {
  const token = "a-long-and-random-access-token";
  let h: Harness;
  before(async () => (h = await startHarness({ signIn: false, env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: token } })));
  after(() => h.close());

  test("without the token even the sign-in is refused; with it -- and the CLI signed in -- everything else still waits for this browser's own sign-in", async () => {
    const bearer = { authorization: `Bearer ${token}` };
    assert.equal(errorCode(await h.anonymous.get("/api/claude/status")), "access_token_required");
    assert.equal(((await h.anonymous.get("/api/claude/status", bearer)).body as ClaudeStatus).state, "not_connected");
    assert.equal(errorCode(await h.anonymous.get("/api/setup/status", bearer)), CLAUDE_SIGN_IN_REQUIRED, "the access token is a perimeter, never an identity");
    assert.equal(errorCode(await h.anonymous.get("/api/settings", bearer)), CLAUDE_SIGN_IN_REQUIRED);
  });
});
