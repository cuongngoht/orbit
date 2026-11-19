// Mocked-process integration: the real Nest app, real HTTP and SSE, with the claude and gh programs scripted.
// These prove Orbit Web's handling of the CLIs' sign-in flows -- not that a real sign-in works (README: blocked here).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { GitHubStatus, LoginSnapshot, SetupStatus } from "@orbit-web/contracts";
import { FakeProcessPort, program, type FakeChild } from "../../src/testing/fake-process.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { eventually, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

const signedOut = (fake: FakeProcessPort) =>
  fake
    .on(program("claude", "auth", "status"), { run: { stdout: '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}', code: 1 } })
    .on(program("gh", "auth", "status"), { run: { stdout: '{"hosts":{}}', stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" } });

describe("first run: nothing signed in", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ fake: signedOut(signedIn(new FakeProcessPort(new NodeProcessPort()))), env: { GH_TOKEN: "gho_shouldneverreachgh000000000000000000000", GITHUB_TOKEN: "x" } })));
  after(() => h.close());

  test("health answers and the setup page says neither account is connected", async () => {
    const health = await h.get("/api/health");
    assert.equal(health.status, 200);
    const setup = (await h.get("/api/setup/status")).body as SetupStatus;
    assert.equal(setup.ready, false);
    assert.equal(setup.claude.state, "not_connected");
    assert.equal(setup.github.state, "not_connected");
    assert.equal(setup.versions.web, "0.7.0");
    assert.equal(setup.health.orbitPlugin.ok, true);
  });

  test("repositories and new chats wait for the accounts", async () => {
    assert.equal((await h.get("/api/repositories")).status, 409);
    const created = await h.send("POST", "/api/sessions", { repository: "octo/sum-fixture", branch: "main", model: "sonnet" });
    assert.equal(created.status, 409);
    assert.equal((created.body as { error: { code: string } }).error.code, "claude_not_connected");
  });

  test("gh never sees GH_TOKEN or GITHUB_TOKEN, and nothing asks gh for its token", () => {
    const ghCalls = h.fake.callsOf(program("gh"));
    assert.ok(ghCalls.length > 0);
    for (const c of ghCalls) {
      assert.equal(c.env.GH_TOKEN, undefined);
      assert.equal(c.env.GITHUB_TOKEN, undefined);
      if (c.args[0] !== "--version") assert.equal(c.env.GH_CONFIG_DIR, h.config.data.github);
      assert.equal(c.args.includes("token") || c.args.includes("--show-token"), false);
    }
  });
});

describe("Connect GitHub: gh's device flow driven from the page", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let loggedIn = false;
  before(async () => {
    fake = signedOut(signedIn(new FakeProcessPort(new NodeProcessPort())));
    fake.on(program("gh", "auth", "status"), { run: () => ({ stdout: loggedIn ? JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, login: "octo" }] } }) : '{"hosts":{}}' }) });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("the code and URL gh prints reach the page; connected is decided by gh auth status and gh api user", async () => {
    let child: FakeChild | null = null;
    fake.on(program("gh", "auth", "login"), {
      spawn: (c) => {
        child = c;
        c.stderr("! First copy your one-time code: WXYZ-1234\n");
        c.stderr("Open this URL to continue in your web browser: https://github.com/login/device\n");
      },
    });
    const started = await h.send("POST", "/api/github/login");
    assert.equal(started.status, 202);
    const { events } = await h.events("/api/github/login/events", { until: (es) => es.some((e) => e.state === "awaiting_user") });
    const waiting = events.find((e) => e.state === "awaiting_user") as unknown as LoginSnapshot;
    assert.equal(waiting.code, "WXYZ-1234");
    assert.equal(waiting.url, "https://github.com/login/device");
    const login = fake.callsOf(program("gh", "auth", "login"))[0];
    assert.deepEqual(login?.args, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--skip-ssh-key", "--insecure-storage"]);
    loggedIn = true;
    (child as unknown as FakeChild).stderr("✓ Authentication complete.\n✓ Logged in as octo\n");
    (child as unknown as FakeChild).exit(0);
    const status = await eventually(async () => (await h.get("/api/github/status")).body as GitHubStatus, (s) => s.flow.state === "connected");
    assert.equal(status.state, "connected");
    assert.deepEqual(status.account, { login: "octo", name: "Octo Cat" });
  });

  test("a refused sign-in is failed with gh's own words", async () => {
    loggedIn = false;
    fake.on(program("gh", "auth", "login"), {
      spawn: (c) => {
        c.stderr("failed to authenticate via web browser: HTTP 415\n");
        c.exit(1);
      },
    });
    await h.send("POST", "/api/github/login");
    const status = await eventually(async () => (await h.get("/api/github/status")).body as GitHubStatus, (s) => s.flow.state === "failed");
    assert.match(status.flow.message ?? "", /HTTP 415/);
    assert.equal(status.state, "not_connected");
  });

  test("cancel stops the CLI", async () => {
    let child: FakeChild | null = null;
    fake.on(program("gh", "auth", "login"), {
      spawn: (c) => {
        child = c;
        c.onSignal(() => c.exit(null, "SIGTERM"));
        c.stderr("! First copy your one-time code: AAAA-BBBB\nOpen this URL to continue in your web browser: https://github.com/login/device\n");
      },
    });
    await h.send("POST", "/api/github/login");
    await eventually(async () => ((await h.get("/api/github/status")).body as GitHubStatus).flow.state, (s) => s === "awaiting_user");
    await h.send("POST", "/api/github/login/cancel");
    const status = await eventually(async () => (await h.get("/api/github/status")).body as GitHubStatus, (s) => s.flow.state === "cancelled");
    assert.equal(status.flow.code, null);
    assert.ok((child as unknown as FakeChild).signals.includes("SIGTERM"));
  });

  test("disconnect logs the account out with gh and keeps nothing of it", async () => {
    loggedIn = true;
    await eventually(async () => ((await h.get("/api/github/status")).body as GitHubStatus).state, () => true);
    fake.on(program("gh", "auth", "logout"), { run: () => ((loggedIn = false), { code: 0 }) });
    const out = await h.send("POST", "/api/github/logout");
    assert.equal(out.status, 200);
    assert.deepEqual(fake.callsOf(program("gh", "auth", "logout")).at(-1)?.args, ["auth", "logout", "--hostname", "github.com", "--user", "octo"]);
    assert.equal((out.body as GitHubStatus).state, "not_connected");
    assert.equal((out.body as GitHubStatus).account, null);
  });
});

describe("Connect Claude: the official CLI's sign-in", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let loggedIn = false;
  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(program("claude", "auth", "status"), { run: () => ({ stdout: JSON.stringify({ loggedIn, authMethod: loggedIn ? "claude.ai" : "none", apiProvider: "firstParty" }) }) });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("the URL is shown, the pasted code goes to that process's stdin only, and claude auth status decides", async () => {
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
    const started = await h.send("POST", "/api/claude/login", { mode: "claudeai" });
    assert.equal(started.status, 202);
    const waiting = await eventually(async () => ((await h.get("/api/claude/status")).body as { flow: LoginSnapshot }).flow, (f) => f.state === "awaiting_user" && f.needsCode);
    assert.equal(waiting.url, "https://claude.com/cai/oauth/authorize?code=true&state=s1");
    assert.deepEqual(fake.callsOf(program("claude", "auth", "login"))[0]?.args, ["auth", "login", "--claudeai"]);
    assert.equal((await h.send("POST", "/api/claude/login/code", { code: "a b" })).status, 400);
    assert.equal((await h.send("POST", "/api/claude/login/code", { code: "abc123#state-s1" })).status, 202);
    assert.deepEqual((child as unknown as FakeChild).written, ["abc123#state-s1\n"]);
    const done = await eventually(async () => (await h.get("/api/claude/status")).body as { state: string; flow: LoginSnapshot }, (s) => s.flow.state === "connected");
    assert.equal(done.state, "connected");
  });

  test("sign out runs claude auth logout", async () => {
    fake.on(program("claude", "auth", "logout"), { run: () => ((loggedIn = false), { code: 0 }) });
    const out = await h.send("POST", "/api/claude/logout");
    assert.equal((out.body as { state: string }).state, "not_connected");
  });
});
