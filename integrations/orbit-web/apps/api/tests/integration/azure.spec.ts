// Mocked-process integration of the Azure CLI sign-in: the real API over HTTP and SSE with `az` scripted. It proves
// Orbit Web's handling of the CLI's device flow, status and sign-out, and that Claude Code gets the sign-in only when a
// person allowed it -- not that a real Microsoft sign-in works (that needs a person).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AzureStatus, HealthReport, LoginSnapshot, SessionDetail, SessionSummary, SetupStatus } from "@orbit-web/contracts";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { claudeRun, eventually, REPOSITORY, signedIn, startHarness, type Harness } from "../../src/testing/harness.js";

const ACCOUNT = { environmentName: "AzureCloud", id: "sub-1", isDefault: true, name: "Contoso Dev", state: "Enabled", tenantId: "tenant-1", user: { name: "dev@contoso.com", type: "user" } };

function quickRun(c: FakeChild, call: Call): void {
  c.onInputClosed(() => {
    c.line({ type: "system", subtype: "init", session_id: call.args[call.args.indexOf(call.args.includes("--resume") ? "--resume" : "--session-id") + 1], claude_code_version: "2.1.328", plugins: [{ name: "orbit" }] });
    c.line({ type: "result", subtype: "success", is_error: false, result: "ok", num_turns: 1 });
    c.exit(0);
  });
}

describe("Connect Azure: the Azure CLI's device flow", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let signedInToAzure = false;

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(program("az", "account", "show"), { run: () => (signedInToAzure ? { stdout: JSON.stringify(ACCOUNT) } : { code: 1, stderr: "Please run 'az login' to setup account.\n" }) });
    fake.on(claudeRun, { spawn: quickRun });
    h = await startHarness({ fake, env: { GH_TOKEN: "gho_000000000000000000000000000000000000" } });
  });
  after(() => h.close());

  test("nobody signed in: not connected, optional, and the workspace does not wait for it", async () => {
    const setup = (await h.get("/api/setup/status")).body as SetupStatus;
    assert.equal(setup.azure.state, "not_connected");
    assert.equal(setup.azure.availableToClaude, false);
    assert.equal(setup.ready, true, "Claude and GitHub are what the workspace needs");
    assert.equal(setup.health.az.ok, true);
    assert.equal(setup.versions.az, "2.91.0");
  });

  test("the URL and one-time code az printed reach the page; az account show decides connected", async () => {
    assert.equal((await h.send("POST", "/api/azure/login", { tenant: "--allow-no-subscriptions" })).status, 400, "a tenant that reads like an option is refused");
    let child: FakeChild | null = null;
    fake.on(program("az", "login"), {
      spawn: (c) => {
        child = c;
        c.stderr("WARNING: To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code DXT2KQ9LM to authenticate.\n");
      },
    });
    assert.equal((await h.send("POST", "/api/azure/login", { tenant: "contoso.onmicrosoft.com" })).status, 202);
    const { events } = await h.events("/api/azure/login/events", { until: (es) => es.some((e) => e.state === "awaiting_user") });
    const waiting = events.find((e) => e.state === "awaiting_user") as unknown as LoginSnapshot;
    assert.equal(waiting.url, "https://microsoft.com/devicelogin");
    assert.equal(waiting.code, "DXT2KQ9LM");
    const login = fake.callsOf(program("az", "login"))[0] as Call;
    assert.deepEqual(login.args, ["login", "--use-device-code", "--allow-no-subscriptions", "--output", "none", "--tenant", "contoso.onmicrosoft.com"]);
    assert.equal(login.env.AZURE_CONFIG_DIR, h.config.data.azure);
    assert.equal(login.env.AZURE_CORE_LOGIN_EXPERIENCE_V2, "off");
    assert.equal(login.env.GH_TOKEN, undefined);
    signedInToAzure = true;
    (child as unknown as FakeChild).exit(0);
    const status = await eventually(async () => (await h.get("/api/azure/status")).body as AzureStatus, (s) => s.flow.state === "connected");
    assert.deepEqual(status.account, { user: "dev@contoso.com", userType: "user", tenantId: "tenant-1", subscription: "Contoso Dev", subscriptionId: "sub-1" });
    assert.equal(fake.calls.some((c) => c.file.endsWith("az") && c.args.some((a) => /token/i.test(a))), false, "the CLI is never asked for a token");
  });

  test("Claude Code gets the Azure sign-in only when a person allows it", async () => {
    const created = (await h.send("POST", "/api/sessions", { repository: REPOSITORY, branch: "main", model: "sonnet", prompt: "List my Azure resource groups." })).body as SessionSummary;
    await eventually(async () => ((await h.get(`/api/sessions/${created.id}`)).body as SessionDetail).status, (s) => s === "completed");
    const off = fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).at(-1)?.call as Call;
    assert.equal(off.env.AZURE_CONFIG_DIR, undefined);
    assert.ok(off.args.includes("Bash(az:*)"));
    assert.ok(off.args.includes(`Read(/${h.config.data.azure}/**)`));

    const on = await h.send("PATCH", "/api/settings", { azureForClaude: true });
    assert.equal((on.body as { azureForClaude: boolean }).azureForClaude, true);
    assert.equal(((await h.get("/api/azure/status")).body as AzureStatus).availableToClaude, true);
    await h.send("POST", `/api/sessions/${created.id}/messages`, { text: "Now list them." });
    await eventually(async () => ((await h.get(`/api/sessions/${created.id}`)).body as SessionDetail).turns, (t) => t === 2);
    const allowed = fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).at(-1)?.call as Call;
    assert.equal(allowed.env.AZURE_CONFIG_DIR, h.config.data.azure);
    assert.equal(allowed.args.includes("Bash(az:*)"), false);
    assert.equal(allowed.args.includes(`Read(/${h.config.data.azure}/**)`), false);
    assert.equal(allowed.env.GH_CONFIG_DIR, undefined, "GitHub's sign-in stays out of reach either way");
  });

  test("sign out runs az logout", async () => {
    fake.on(program("az", "logout"), { run: () => ((signedInToAzure = false), { code: 0 }) });
    const out = (await h.send("POST", "/api/azure/logout")).body as AzureStatus;
    assert.deepEqual(fake.callsOf(program("az", "logout")).at(-1)?.args, ["logout"]);
    assert.equal(out.state, "not_connected");
  });
});

describe("an image built without the Azure CLI", () => {
  let h: Harness;
  before(async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort()));
    fake.on(program("az"), { run: { code: null, spawnError: "ENOENT" } });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("says the CLI is not installed, and stays healthy", async () => {
    const azure = (await h.get("/api/azure/status")).body as AzureStatus;
    assert.equal(azure.state, "unavailable");
    assert.match(azure.detail ?? "", /not installed/);
    const health = await h.get("/api/health");
    assert.equal(health.status, 200);
    assert.equal((health.body as HealthReport).status, "ok");
    assert.equal((health.body as HealthReport).az.ok, false);
  });
});
