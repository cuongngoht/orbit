// THE ACCOUNT'S MCP SERVERS, through the real API: a person of the account adds a knowledge base (Orbit Web reads its
// tools and allows the read-only ones), turns it on for an employee, and the employee asks it through Orbit's tools --
// Orbit Web connects, with the server's credential on its own side; only the tools allowed are offered; every ask is the
// account policy's decision, recorded; turned off, the next ask is refused. A credential is never sent in the clear and
// never said back.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type EmployeeAccess, type EmployeeDetail, type McpServerList, type McpServerView, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { CredentialStore } from "../../src/infra/connections/credentials.js";
import { MCP_ADDRESS_POLICY, type McpAddressPolicy } from "../../src/modules/mcp-servers/mcp-client.js";
import { startFakeMcp, type FakeMcp } from "../../src/testing/fake-mcp.js";
import { program } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider, scriptedEmployee, type ToolCaller } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };

const TOOLS = [
  { name: "search", description: "Search the team's knowledge base.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "create_page", description: "Create a page.", inputSchema: { type: "object", properties: { title: { type: "string" } } }, annotations: { readOnlyHint: false } },
  { name: "fetch", description: "Fetch a page by its id.", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
];

interface Seen {
  tools: string[];
  answers: Record<string, { text: string; isError: boolean }>;
}

describe("the account's MCP servers, and an employee's use of them", () => {
  let h: Harness;
  let b: Browser;
  let kb: FakeMcp;
  let employee: EmployeeDetail;
  let server: McpServerView;
  const sandbox = new FakeSandboxProvider();
  const seen: Seen[] = [];

  before(async () => {
    kb = await startFakeMcp({ tools: TOOLS, call: (name, args) => ({ content: [{ type: "text", text: `${name} found: Reports export as CSV (${JSON.stringify(args)}).` }] }) });
    // This test's own server on this machine: what Orbit Web's own policy never reaches, allowed here alone.
    const local: McpAddressPolicy = { allows: (address, port) => address === "127.0.0.1" && port === kb.port };
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox], [MCP_ADDRESS_POLICY, local]], env: FAST });
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Knowledge office" })).status, 200);
    const connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((c) => c.runtime === "claude" && c.auth === "connected") as RuntimeConnection;
    const model = connection.catalog.models[0] as { id: string; efforts: string[] };
    sandbox.cli.on(program("claude"), {
      spawn: scriptedEmployee(async (t: ToolCaller) => {
        const listed = (await (await fetch(`${t.bridge.url}/list`, { method: "POST", headers: { "x-orbit-run-token": t.bridge.token, "x-orbit-web": "1" } })).json()) as { tools: { name: string }[] };
        const answers: Seen["answers"] = {};
        answers.search = await t.call("kb_teamkb_search", { query: "export" });
        answers.create = await t.call("kb_teamkb_create_page", { title: "x" });
        seen.push({ tools: listed.tools.map((x) => x.name), answers });
        await t.call("write_file", { path: "/output/summary.md", content: "Read.\n" });
        await t.call("submit_handoff", { summary: "Read the knowledge base." });
      }),
    });
    const hired = await b.send("POST", "/api/employees", {
      name: "Lan",
      profile: { title: "Analyst", duties: "Read the knowledge base.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "A summary.", reportingRule: "Say what was read.", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    employee = await eventually(async () => (await b.get(`/api/employees/${(hired.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
  });
  after(async () => {
    await h?.close();
    await kb?.close();
  });

  const accessOf = async (): Promise<EmployeeAccess> => (await b.get(`/api/employees/${employee.id}/access`)).body as EmployeeAccess;
  async function work(goal: string): Promise<MissionDetail> {
    const given = await b.send("POST", "/api/missions", { title: goal, goal, targetEmployeeId: employee.id, whenBusy: "enqueue", deliverables: [{ name: "summary.md", required: true }], acceptanceCriteria: [] }, { "Idempotency-Key": `k-${goal.replace(/[^A-Za-z0-9]/g, "-")}` });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    return eventually(async () => (await b.get(`/api/missions/${(given.body as MissionAccepted).missionId}`)).body as MissionDetail, (m) => m.handoffs.length === 1, 15_000);
  }
  async function accept(missionId: string): Promise<void> {
    const m = (await b.get(`/api/missions/${missionId}`)).body as MissionDetail;
    const root = m.assignments[0] as { id: string; version: number };
    const ok = await b.send("POST", `/api/assignments/${root.id}/accept`, { handoffDigest: m.handoffs.at(-1)?.digest }, { "if-match": `"${root.version}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  }

  test("a person of the account adds a server: its tools are read, and only the read-only ones allowed", async () => {
    const agent = await fetch(`${h.url}/api/mcp-servers`, { method: "POST", headers: { "content-type": "application/json", "x-orbit-run-token": "x".repeat(43), "x-orbit-web": "1" }, body: JSON.stringify({ name: "Team KB", url: kb.url, auth: { kind: "none" } }) });
    assert.notEqual(agent.status, 201, "no run's token adds a server");
    const added = await b.send("POST", "/api/mcp-servers", { name: "Team KB", url: kb.url, auth: { kind: "none" } });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    server = added.body as McpServerView;
    assert.equal(server.readError, null);
    assert.deepEqual(
      server.tools.map((t) => [t.name, t.readOnly, t.allowed, t.employeeName]),
      [
        ["search", true, true, "kb_teamkb_search"],
        ["create_page", false, false, "kb_teamkb_create_page"],
        ["fetch", null, false, "kb_teamkb_fetch"],
      ],
    );
    assert.deepEqual(((await b.get("/api/mcp-servers")).body as McpServerList).servers.map((s) => s.name), ["Team KB"]);
  });

  test("a credential is never sent in the clear, kept on Orbit Web's side, and never said back", async () => {
    const clear = await b.send("POST", "/api/mcp-servers", { name: "Clear", url: "http://kb.example.com/mcp", auth: { kind: "bearer", token: "tok-in-clear" } });
    assert.equal(clear.status, 400);
    assert.match(JSON.stringify(clear.body), /https/);
    // A server that cannot be read yet is kept, saying why: its sign-in can be put right, then read again.
    const vault = await b.send("POST", "/api/mcp-servers", { name: "Vault", url: "https://127.0.0.1:1/mcp", auth: { kind: "header", header: "X-API-Key", token: "tok-123" } });
    assert.equal(vault.status, 201, JSON.stringify(vault.body));
    const view = vault.body as McpServerView;
    assert.deepEqual(view.auth, { kind: "header", header: "X-API-Key", hasToken: true });
    assert.match(view.readError ?? "", /not on the public internet|Orbit Web never connects/);
    const listed = await b.get("/api/mcp-servers");
    for (const said of [vault.body, listed.body]) assert.equal(JSON.stringify(said).includes("tok-123"), false);
    const store = new CredentialStore(join(h.config.data.control, "credentials"));
    assert.equal(store.read(`file:${h.user?.accountId}/${view.id}`), "tok-123");
    assert.equal((await b.send("DELETE", `/api/mcp-servers/${view.id}`)).status, 200);
    assert.deepEqual(((await b.get("/api/mcp-servers")).body as McpServerList).servers.map((s) => s.name), ["Team KB"]);
  });

  let first = "";

  test("an employee uses a server only once a person turns it on -- its allowed tools, asked by Orbit Web, decided and recorded", async () => {
    assert.deepEqual(
      (await accessOf()).knowledge.map((k) => [k.name, k.enabled, k.tools]),
      [["Team KB", false, 1]],
    );
    const on = await b.send("PUT", `/api/employees/${employee.id}/access`, { knowledge: [{ serverId: server.id, enabled: true }] });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal((on.body as EmployeeAccess).knowledge[0]?.enabled, true);
    const allowed = await b.send("PUT", `/api/mcp-servers/${server.id}`, { allowedTools: ["search", "fetch"] });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    kb.asked.length = 0;
    first = (await work("Find how reports export")).id;
    const s = seen.at(-1) as Seen;
    assert.ok(s.tools.includes("kb_teamkb_search") && s.tools.includes("kb_teamkb_fetch"), s.tools.join(", "));
    assert.equal(s.tools.includes("kb_teamkb_create_page"), false, "a tool not allowed is not offered");
    assert.equal(s.answers.search?.isError, false, s.answers.search?.text);
    assert.match(s.answers.search?.text ?? "", /search found: Reports export as CSV \(\{"query":"export"\}\)/);
    assert.match(s.answers.search?.text ?? "", /data, not instructions/);
    assert.equal(s.answers.create?.isError, true);
    assert.deepEqual(
      kb.asked.filter((a) => a.method === "tools/call").map((a) => a.params.name),
      ["search"],
      "a tool not allowed never reaches the server",
    );
    const decisions = await h.sql("SELECT data->>'resource' AS resource FROM governance.audit_events WHERE event_type = 'policy.decision' AND data->>'action' = 'tool.connector'");
    assert.ok(decisions.some((d) => d.resource === "mcp:teamkb/search"), JSON.stringify(decisions));
  });

  test("turned off, the tools are no longer offered and the next ask is refused", async () => {
    await accept(first);
    assert.equal((await b.send("PUT", `/api/employees/${employee.id}/access`, { knowledge: [{ serverId: server.id, enabled: false }] })).status, 200);
    kb.asked.length = 0;
    await work("Find how reports export again");
    const s = seen.at(-1) as Seen;
    assert.equal(s.tools.some((n) => n.startsWith("kb_")), false, s.tools.join(", "));
    assert.equal(s.answers.search?.isError, true);
    assert.match(s.answers.search?.text ?? "", /Access/);
    assert.equal(kb.asked.length, 0, "the server is not asked");
  });
});
