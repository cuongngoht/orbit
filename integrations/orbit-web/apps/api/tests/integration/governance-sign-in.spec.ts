// THE CLAUDE SIGN-IN IN THE GOVERNED DEPLOYMENT. `claude auth login` runs in the agent's container, whose only way out
// is the control plane's egress proxy -- and it is not a run, so it has no run's token. Without a way of its own it
// could reach nothing, and the sign-in that opens Orbit Web (before any Constitution can exist) could never finish.
// While one sign-in runs it holds its own channel: a token handed to that process alone, which the proxy grants the
// Claude account's hosts and nothing else, each connection recorded -- and which ends with the sign-in.
//
// Claude Code is stood in for by a script, started for real through a real runner (the agent's side).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { LOGIN_ACTIVE, type AuditPage, type ClaudeStatus } from "@orbit-web/contracts";
import { CLAUDE_ACCOUNT_HOSTS } from "@orbit-web/governance-core";
import { EgressService } from "../../src/modules/governance/egress.service.js";
import { startRunner } from "../../src/runner/server.js";
import { eventually, startHarness, type Harness } from "../../src/testing/harness.js";

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

// What the sign-in's process was given, written where the test reads it.
const standIn = (out: string): string => `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const say = (s) => process.stdout.write(s);
if (args[0] === "--version") say("2.1.328 (Claude Code)\\n");
else if (args[0] === "auth" && args[1] === "status") say(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "octo@example.com", orgName: "Octo Org", subscriptionType: "max" }));
else if (args[0] === "auth" && args[1] === "login") {
  const names = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "NO_PROXY", "no_proxy", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"];
  writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.fromEntries(names.map((n) => [n, process.env[n] ?? null]))));
  say("Opening browser to sign in...\\nhttps://claude.ai/oauth/authorize?code=true&client_id=stand-in\\nPaste code here if prompted > ");
  process.stdin.on("data", () => { say("\\nLogin successful.\\n"); process.exit(0); });
} else if (args[0] === "auto-mode") say(JSON.stringify({ environment: [] }));
`;

describe("the Claude sign-in in the governed deployment", () => {
  let h: Harness;
  let runner: Server;
  let dir: string;
  let proxyPort: number;
  const envFile = () => join(dir, "login-env.json");

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "orbit-web-sign-in-"));
    const claude = join(dir, "claude.mjs");
    writeFileSync(claude, standIn(envFile()), { mode: 0o755 });
    const runnerPort = await freePort();
    runner = await startRunner(runnerPort, "127.0.0.1");
    proxyPort = await freePort();
    h = await startHarness({
      env: {
        ORBIT_WEB_DEPLOYMENT: "governed",
        ORBIT_WEB_RUNNER: `127.0.0.1:${runnerPort}`,
        ORBIT_WEB_AGENT_NETWORKS: "172.31.249.0/24",
        ORBIT_WEB_AGENT_CONTROL_HOST: "orbit-web",
        ORBIT_WEB_EGRESS_PROXY_PORT: String(proxyPort),
        ORBIT_WEB_CLAUDE_BIN: claude,
      },
    });
  });
  after(async () => {
    await h.close();
    await new Promise<void>((r) => runner.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  test("the sign-in's own process goes out through the proxy, to the Claude account's hosts only, and only while it runs", async () => {
    assert.equal((await h.send("POST", "/api/claude/login", {})).status, 202);
    await eventually(() => existsSync(envFile()), (ok) => ok);
    const env = JSON.parse(readFileSync(envFile(), "utf8")) as Record<string, string | null>;
    const proxy = new URL(env.HTTPS_PROXY ?? "http://nothing-given");
    assert.deepEqual([proxy.protocol, proxy.username, proxy.hostname, proxy.port], ["http:", "signin", "orbit-web", String(proxyPort)]);
    for (const name of ["HTTP_PROXY", "https_proxy", "http_proxy"]) assert.equal(env[name], env.HTTPS_PROXY, name);
    assert.deepEqual([env.NO_PROXY, env.no_proxy, env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC], ["orbit-web", "orbit-web", "1"]);
    const token = decodeURIComponent(proxy.password);
    assert.ok(token.length >= 32);

    const egress = h.app.get(EgressService);
    const reaches = async (host: string, port: number, given: string | null = token) => (await egress.decide({ host, port, token: given, from: "172.31.249.10" })).allow;
    for (const claude of CLAUDE_ACCOUNT_HOSTS) assert.equal(await reaches(claude.host, claude.port), true, claude.host);
    assert.equal(await reaches("example.com", 443), false, "nothing else");
    assert.equal(await reaches("platform.claude.com", 80), false, "not another port");
    assert.equal(await reaches("platform.claude.com", 443, "not-its-token"), false, "not without its token");

    // The channel ends with the sign-in, however it ended.
    assert.equal((await h.send("POST", "/api/claude/login/cancel")).status, 200);
    await eventually(async () => ((await h.get("/api/claude/status")).body as ClaudeStatus).flow.state, (s) => !LOGIN_ACTIVE.includes(s));
    assert.equal(await reaches("platform.claude.com", 443), false, "a sign-in that ended has no way out");

    // Recorded as Orbit Web's own sign-in -- never as an agent, never as the Constitution's decision.
    const owner = await h.owner();
    const events = ((await owner.get("/api/governance/audit?type=egress.sign_in&limit=50")).body as AuditPage).events;
    const seen = events.map((e) => `${e.outcome} ${String(e.data.resource)} ${e.principalType}:${e.principalId}`).sort();
    assert.deepEqual(seen, [
      "allow api.anthropic.com:443 system:claude-sign-in",
      "allow claude.ai:443 system:claude-sign-in",
      "allow platform.claude.com:443 system:claude-sign-in",
      "deny example.com:443 system:claude-sign-in",
      "deny platform.claude.com:80 system:claude-sign-in",
    ]);
    assert.equal(JSON.stringify(events).includes(token), false, "the channel's token is never recorded");
  });
});
