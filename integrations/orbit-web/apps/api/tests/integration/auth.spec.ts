// Mocked-process integration: the real Nest app, real HTTP and SSE, with the claude and gh programs scripted.
// These prove Orbit Web's handling of GitHub CLI's sign-in flow -- not that a real sign-in works (README: blocked here).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { ORBIT_WEB_VERSION, type GitHubStatus, type LoginSnapshot, type SetupStatus } from "@orbit-web/contracts";
import { FakeProcessPort, program, type FakeChild } from "../../src/testing/fake-process.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { eventually, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

// GitHub's sign-in is asked for only once Orbit Web is signed in to a Claude account (sign-in.spec.ts holds that gate).
const githubSignedOut = (fake: FakeProcessPort) =>
  fake.on(program("gh", "auth", "status"), { run: { stdout: '{"hosts":{}}', stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login" } });

describe("signed in to Claude, GitHub not connected yet", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ fake: githubSignedOut(signedIn(new FakeProcessPort(new NodeProcessPort()))), env: { GH_TOKEN: "gho_shouldneverreachgh000000000000000000000", GITHUB_TOKEN: "x" } })));
  after(() => h.close());

  test("health answers and the setup page says who is signed in to Claude, and that GitHub is not connected", async () => {
    const health = await h.get("/api/health");
    assert.equal(health.status, 200);
    const setup = (await h.get("/api/setup/status")).body as SetupStatus;
    assert.equal(setup.claude.state, "connected");
    assert.deepEqual(setup.claude.account, { email: "octo@example.com", organization: "Octo Org", plan: "max" });
    assert.equal(setup.github.state, "not_connected");
    assert.equal(setup.versions.web, ORBIT_WEB_VERSION);
    assert.equal(setup.health.orbitPlugin.ok, true);
  });

  test("repositories and new chats wait for GitHub", async () => {
    assert.equal((await h.get("/api/repositories?source=github")).status, 409);
    const created = await h.send("POST", "/api/sessions", { repository: { source: "github", id: "octo/sum-fixture" }, branch: "main", model: "sonnet" });
    assert.equal(created.status, 409);
    assert.equal((created.body as { error: { code: string } }).error.code, "github_not_connected");
  });

  test("gh never sees GH_TOKEN or GITHUB_TOKEN, and nothing asks gh for its token", () => {
    const ghCalls = h.fake.callsOf(program("gh"));
    assert.ok(ghCalls.some((c) => c.args[0] === "auth"), "gh auth status was asked");
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
    fake = githubSignedOut(signedIn(new FakeProcessPort(new NodeProcessPort())));
    fake.on(program("gh", "auth", "status"), { run: () => ({ stdout: loggedIn ? JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, login: "octo" }] } }) : '{"hosts":{}}' }) });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("the code and URL gh prints reach every page on the app stream; connected is decided by gh auth status and gh api user", async () => {
    const app = await h.stream("/api/events");
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
    const flowOf = (e: Record<string, unknown>) => (e.type === "connector.flow" ? (e.data as { connector: string; flow: LoginSnapshot }) : null);
    const events = await app.until((es) => es.some((e) => flowOf(e)?.flow.state === "awaiting_user"));
    const waiting = events.map(flowOf).find((f) => f?.flow.state === "awaiting_user") as { connector: string; flow: LoginSnapshot };
    assert.equal(waiting.connector, "github");
    const flow = waiting.flow;
    assert.equal(flow.code, "WXYZ-1234");
    assert.equal(flow.url, "https://github.com/login/device");
    const login = fake.callsOf(program("gh", "auth", "login"))[0];
    assert.deepEqual(login?.args, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--skip-ssh-key", "--insecure-storage"]);
    loggedIn = true;
    (child as unknown as FakeChild).stderr("✓ Authentication complete.\n✓ Logged in as octo\n");
    (child as unknown as FakeChild).exit(0);
    const status = await eventually(async () => (await h.get("/api/github/status")).body as GitHubStatus, (s) => s.flow.state === "connected");
    assert.equal(status.state, "connected");
    assert.deepEqual(status.account, { login: "octo", name: "Octo Cat" });
    const announced = await app.until((es) => es.some((e) => e.type === "connector.status"));
    assert.deepEqual(announced.find((e) => e.type === "connector.status")?.data, { connector: "github", state: "connected", account: "octo" });
    app.close();
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
