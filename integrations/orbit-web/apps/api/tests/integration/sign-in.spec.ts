// THE CLAUDE SIGN-IN IS ORBIT WEB'S SIGN-IN. Until `claude auth status` reports a Claude account, every route but the
// health check, the access token and the Claude sign-in itself is refused with claude_sign_in_required, and nothing is
// run on the way; only a Claude account signs in (never an API key or a token, and never the container's own
// credential variables, which no child process is given); signing out closes Orbit Web again at once.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { ModulesContainer } from "@nestjs/core";
import { CLAUDE_SIGN_IN_REQUIRED, type ClaudeStatus, type LoginSnapshot, type SetupStatus } from "@orbit-web/contracts";
import { BEFORE_CLAUDE_SIGN_IN } from "../../src/common/before-claude-sign-in.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type FakeChild } from "../../src/testing/fake-process.js";
import { CLAUDE_SIGNED_IN, CLAUDE_SIGNED_OUT, eventually, signedIn, startHarness, type Harness, type Reply } from "../../src/testing/harness.js";

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
  // A shared chat's link: one read-only snapshot, which needs no Claude account to read (modules/share).
  "GET /api/shared/:token",
];

interface Route {
  method: string;
  path: string;
  open: boolean;
}

const pathsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [String(v ?? "")]);
const joined = (...parts: string[]): string => `/api/${parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;

// Every route the running application declares, read from Nest's own metadata, with whether it is marked open.
function routesOf(h: Harness): Route[] {
  const routes: Route[] = [];
  for (const module of h.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as { prototype: Record<string, unknown> } | null;
      if (!controller) continue;
      const classOpen = Reflect.getMetadata(BEFORE_CLAUDE_SIGN_IN, controller) === true;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (name === "constructor" || typeof handler !== "function" || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const open = classOpen || Reflect.getMetadata(BEFORE_CLAUDE_SIGN_IN, handler) === true;
        for (const base of pathsOf(Reflect.getMetadata(PATH_METADATA, controller))) for (const own of pathsOf(Reflect.getMetadata(PATH_METADATA, handler))) routes.push({ method, path: joined(base, own), open });
      }
    }
  }
  return routes;
}

const concrete = (path: string): string => path.replace(":id", "00000000-0000-4000-8000-000000000000").replace(":owner", "octo").replace(":repo", "sum-fixture");

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
    for (const r of routesOf(h).filter((x) => !x.open)) {
      const reply = r.method === "GET" ? await h.get(concrete(r.path)) : await h.send(r.method, concrete(r.path), {});
      assert.equal(reply.status, 401, `${r.method} ${r.path}`);
      assert.equal(errorCode(reply), CLAUDE_SIGN_IN_REQUIRED, `${r.method} ${r.path}`);
    }
    const ran = h.fake.calls.slice(before).filter((c) => !claudeStatus(c.file, c.args));
    assert.deepEqual(ran.map((c) => `${c.file} ${c.args.join(" ")}`), [], "only the Claude CLI's own status was asked");
  });

  test("the sign-in page reads the sign-in: not connected, and no account", async () => {
    const status = (await h.get("/api/claude/status")).body as ClaudeStatus;
    assert.equal(status.state, "not_connected");
    assert.equal(status.account, null);
    assert.equal(status.flow.state, "idle");
    assert.equal((await h.get("/api/health")).status, 200);
  });
});

describe("only a Claude account signs Orbit Web in", () => {
  for (const authMethod of ["api_key", "oauth_token"]) {
    test(`a CLI signed in with ${authMethod} is not signed in to a Claude account`, async () => {
      const h = await startHarness({ fake: answering({ loggedIn: true, authMethod, apiProvider: "firstParty" })(signedIn(new FakeProcessPort(new NodeProcessPort()))) });
      try {
        const status = (await h.get("/api/claude/status")).body as ClaudeStatus;
        assert.equal(status.state, "not_connected");
        assert.equal(status.method, authMethod);
        assert.equal(status.account, null);
        assert.match(status.detail ?? "", /not a Claude account/);
        const setup = await h.get("/api/setup/status");
        assert.equal(setup.status, 401);
        assert.match((setup.body as { error: { message: string } }).error.message, /not a Claude account/);
      } finally {
        await h.close();
      }
    });
  }
});

describe("signing in opens Orbit Web; signing out closes it at once", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let loggedIn = false;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(claudeStatus, { run: () => ({ stdout: JSON.stringify(loggedIn ? CLAUDE_SIGNED_IN : CLAUDE_SIGNED_OUT) }) });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("there is no mode to choose: an Anthropic Console sign-in is not offered", async () => {
    const refused = await h.send("POST", "/api/claude/login", { mode: "console" });
    assert.equal(refused.status, 400);
    assert.deepEqual(fake.callsOf(program("claude", "auth", "login")), [], "nothing was started");
  });

  test("the URL is shown, the pasted code goes to that process's stdin only, and claude auth status decides", async () => {
    assert.equal((await h.get("/api/setup/status")).status, 401);
    let child: FakeChild | null = null;
    fake.on(program("claude", "auth", "login"), {
      spawn: (c) => {
        child = c;
        c.stdout("Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s1\nPaste code here if prompted > ");
        c.onInput(() => {
          loggedIn = true;
          c.stdout("\nLogin successful.\n");
          c.exit(0);
        });
      },
    });
    const started = await h.send("POST", "/api/claude/login");
    assert.equal(started.status, 202);
    const waiting = await eventually(async () => ((await h.get("/api/claude/status")).body as ClaudeStatus).flow, (f) => f.state === "awaiting_user" && f.needsCode);
    assert.equal(waiting.url, "https://claude.com/cai/oauth/authorize?code=true&state=s1");
    assert.deepEqual(fake.callsOf(program("claude", "auth", "login"))[0]?.args, ["auth", "login", "--claudeai"]);
    assert.equal((await h.send("POST", "/api/claude/login/code", { code: "a b" })).status, 400);
    assert.equal((await h.send("POST", "/api/claude/login/code", { code: "abc123#state-s1" })).status, 202);
    assert.deepEqual((child as unknown as FakeChild).written, ["abc123#state-s1\n"]);
    const { events } = await h.events("/api/claude/login/events", { until: (es) => es.some((e) => e.state === "connected") });
    const connected = events.find((e) => e.state === "connected") as unknown as LoginSnapshot;
    assert.equal(connected.message, "Signed in to Claude as octo@example.com.");
    const status = (await h.get("/api/claude/status")).body as ClaudeStatus;
    assert.equal(status.state, "connected");
    assert.deepEqual(status.account, { email: "octo@example.com", organization: "Octo Org", plan: "max" });
    const setup = await h.get("/api/setup/status");
    assert.equal(setup.status, 200, "open as soon as the sign-in is verified");
    assert.equal((setup.body as SetupStatus).claude.account?.email, "octo@example.com");
  });

  test("sign out runs claude auth logout, and every route is refused again at once", async () => {
    fake.on(program("claude", "auth", "logout"), { run: () => ((loggedIn = false), { code: 0 }) });
    const out = await h.send("POST", "/api/claude/logout");
    assert.equal(out.status, 200);
    assert.equal((out.body as ClaudeStatus).state, "not_connected");
    assert.equal((out.body as ClaudeStatus).account, null);
    const setup = await h.get("/api/setup/status");
    assert.equal(setup.status, 401);
    assert.equal(errorCode(setup), CLAUDE_SIGN_IN_REQUIRED);
    assert.equal(errorCode(await h.send("POST", "/api/claude/logout")), CLAUDE_SIGN_IN_REQUIRED, "nothing is left to sign out of");
  });
});

describe("the container's own Claude credential variables sign nothing in", () => {
  const values = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-container-variable-000000000000", ANTHROPIC_API_KEY: "sk-ant-api03-container-variable-000000000000", ANTHROPIC_AUTH_TOKEN: "container-auth-token-000000000000" };
  let h: Harness;
  before(async () => (h = await startHarness({ fake: claudeSignedOut(signedIn(new FakeProcessPort(new NodeProcessPort()))), env: values })));
  after(() => h.close());

  test("no child process is given one, and the page names them as ignored -- by name, never by value", async () => {
    const status = (await h.get("/api/claude/status")).body as ClaudeStatus;
    assert.equal(status.state, "not_connected");
    assert.match(status.detail ?? "", /CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN; Orbit Web ignores them/);
    for (const value of Object.values(values)) assert.equal(JSON.stringify(status).includes(value), false);
    assert.equal((await h.get("/api/setup/status")).status, 401);
    await h.get("/api/health");
    assert.ok(h.fake.calls.length > 0);
    for (const c of h.fake.calls) assert.deepEqual(Object.keys(c.env).filter((k) => k in values), [], `${c.file} ${c.args.join(" ")}`);
  });
});

describe("token mode asks for the access token first, then for the Claude sign-in", () => {
  const token = "a-long-and-random-access-token";
  let h: Harness;
  before(async () => (h = await startHarness({ fake: claudeSignedOut(signedIn(new FakeProcessPort(new NodeProcessPort()))), env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: token } })));
  after(() => h.close());

  test("without the token even the sign-in is refused; with it, the sign-in answers and everything else waits for it", async () => {
    const bearer = { authorization: `Bearer ${token}` };
    assert.equal(errorCode(await h.get("/api/claude/status")), "access_token_required");
    assert.equal(((await h.get("/api/claude/status", bearer)).body as ClaudeStatus).state, "not_connected");
    assert.equal(errorCode(await h.get("/api/setup/status", bearer)), CLAUDE_SIGN_IN_REQUIRED);
    assert.equal(errorCode(await h.get("/api/settings", bearer)), CLAUDE_SIGN_IN_REQUIRED);
  });
});
