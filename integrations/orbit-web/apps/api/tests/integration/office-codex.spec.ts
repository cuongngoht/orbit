// AN EMPLOYEE ON OPENAI CODEX, end to end through the real API: a Codex connection (an API key) whose installed binary
// is OBSERVED to hold an employee's model plane to Orbit's tools -- its own catalog entry made Orbit's, every local
// executor off -- is offered for employees; an employee is hired on it, given work, and its codex (a stand-in speaking
// `exec --json`) works and hands in through Orbit's own tools. The model plane is given Orbit's entry for the model as a
// file beside the CLI, and the run is held to it. A binary seen offering tools of its own runs no employee.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type EmployeeDetail, type MissionAccepted, type MissionDetail, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { fakeCodexControl, scriptedCodexEmployee } from "../../src/testing/fake-codex.js";
import { program, type Call } from "../../src/testing/fake-process.js";
import { FakeSandboxProvider } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const FAST = { ORBIT_WEB_SANDBOX_HOST: "127.0.0.1", ORBIT_WEB_WORKER_TICK_MS: "100", ORBIT_WEB_RUN_HEARTBEAT_MS: "300", ORBIT_WEB_RECOVERY_SWEEP_MS: "500", ORBIT_WEB_RUN_LEASE_MS: "2000", ORBIT_WEB_STOP_GRACE_MS: "300" };
const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

describe("an employee on OpenAI Codex", () => {
  let h: Harness;
  let b: Browser;
  let codex: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();
  const written: Call[] = [];

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]], env: FAST });
    fakeCodexControl(h.fake);
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Codex office" })).status, 200);
    // The model plane: its node writes Orbit's model entry; its codex works through Orbit's tools.
    sandbox.cli.on(program("node", "-e"), {
      spawn: (child, call) => {
        written.push(call);
        child.exit(0);
      },
    });
    sandbox.cli.on(program("codex", "exec"), {
      spawn: scriptedCodexEmployee(async (t) => {
        await t.call("write_file", { path: "/output/report.md", content: "Done on Codex.\n" });
        await t.call("submit_handoff", { summary: "Done on Codex." });
      }),
    });
    const made = await b.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    codex = made.body as RuntimeConnection;
  });

  after(async () => {
    await h?.close();
  });

  test("its binary observed holding the model plane to Orbit's tools, the connection is offered for employees", async () => {
    assert.deepEqual([codex.auth, codex.catalog.source, codex.catalog.recommended], ["connected", "account", "gpt-6.1-sol"]);
    assert.equal(codex.capabilities.toolPlaneSplit, "yes");
    assert.deepEqual(codex.employeeReady, { ready: true, reason: null });
    const observed = h.fake.callsOf(program("codex", "exec", "--json")).at(-1) as Call;
    assert.ok(observed.args.includes("--disable") && observed.args.includes("shell_tool"), "observed as an employee's model plane runs");
    assert.ok(observed.args.some((a) => a.startsWith("model_providers.orbit_observation=") && a.includes("127.0.0.1")), "its provider a stand-in on the loopback");
  });

  test("hired on Codex, given work, it works and hands in through Orbit's tools -- on Orbit's entry for its model", async () => {
    const hired = await b.send("POST", "/api/employees", {
      name: "Quang",
      profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "codex", connectionId: codex.id, model: "gpt-6.1-sol", effort: "medium", webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const e = await eventually(async () => (await b.get(`/api/employees/${(hired.body as EmployeeDetail).id}`)).body as EmployeeDetail, (d) => d.sandbox.state === "READY");
    const given = await b.send("POST", "/api/missions", { title: "A report", goal: "Write the report.", targetEmployeeId: e.id, whenBusy: "reject", deliverables: [{ name: "report.md", required: true }], acceptanceCriteria: [] }, { "idempotency-key": "codex-mission-1" });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    const id = (given.body as MissionAccepted).missionId;
    const m = await eventually(async () => (await b.get(`/api/missions/${id}`)).body as MissionDetail, (x) => x.handoffs.length === 1, 15_000);
    assert.equal(m.handoffs[0]?.summary, "Done on Codex.");
    // The model plane was given Orbit's entry for the model, beside the CLI, and the CLI was pointed at it.
    const file = written.at(-1) as Call;
    const entry = (JSON.parse(file.env.ORBIT_CONTENT ?? "{}") as { models: Record<string, unknown>[] }).models[0] as Record<string, unknown>;
    assert.equal(entry.slug, "gpt-6.1-sol");
    assert.deepEqual([entry.tool_mode, entry.apply_patch_tool_type, entry.multi_agent_version, entry.supports_search_tool, JSON.stringify(entry.input_modalities)], [undefined, undefined, undefined, false, '["text"]']);
    const run = sandbox.cli.callsOf(program("codex", "exec")).at(-1) as Call;
    assert.ok(run.args.includes(`model_catalog_json=${JSON.stringify(file.env.ORBIT_FILE)}`), "the CLI reads the entry the plane was given");
    assert.ok(run.args.includes("--ignore-user-config") && run.args.includes("read-only"));
    assert.ok(run.args.some((a) => a.startsWith("mcp_servers={orbit_tools=") && a.includes("required=true")));
    // The hand-in is recorded while the CLI still runs; the run settles once it has exited.
    const [r] = await eventually(() => h.sql("SELECT state, observed FROM workforce.runs WHERE account_id = $1 AND employee_id = $2", [h.accountId as string, e.id]), (rows) => rows[0]?.state !== "running");
    assert.equal(r?.state, "succeeded");
    assert.equal((r?.observed as { toolCalls: number }).toolCalls, 2);
  });
});

describe("a Codex binary seen offering tools of its own", () => {
  let h: Harness;
  let b: Browser;

  before(async () => {
    h = await startHarness({ env: FAST });
    fakeCodexControl(h.fake);
    // This binary offers a model its code mode and sub-agents whatever entry it is given.
    h.fake.on(program("codex", "debug", "models"), { run: { stdout: JSON.stringify({ models: [{ slug: "gpt-6.1-sol", visibility: "list", priority: 1, tool_mode: "code_mode_only", input_modalities: ["text", "image"] }] }) } });
    h.fake.on(program("codex", "exec", "--json"), {
      run: async (call) => {
        const base = /base_url="([^"]+)"/.exec(call.args.find((a) => a.startsWith("model_providers.orbit_observation=")) ?? "")?.[1] ?? "";
        const offered = [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec", description: "### `exec_command`" }] }, { type: "namespace", name: "mcp__orbit_tools", tools: [{ type: "function", name: "submit_handoff" }] }];
        await (await fetch(`${base}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: [{ type: "additional_tools", tools: offered }] }) })).text();
        return { code: 0 };
      },
    });
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Codex office" })).status, 200);
  });

  after(async () => {
    await h?.close();
  });

  test("its connection is not offered for employees, and a hire on it is refused with what was seen", async () => {
    const made = await b.send("POST", "/api/connections", { runtime: "codex", method: "api_key", apiKey: "sk-proj-test-key-0123456789abcdefghijABCDE" });
    const c = made.body as RuntimeConnection;
    assert.equal(c.capabilities.toolPlaneSplit, "no");
    assert.equal(c.employeeReady.ready, false);
    const hired = await b.send("POST", "/api/employees", {
      name: "Quang",
      profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "codex", connectionId: c.id, model: "gpt-6.1-sol", effort: "medium", webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false },
      resources: DEFAULT_PRESETS[0]?.profile,
      skipProbation: true,
      skipReason: "a test employee",
    });
    assert.equal(hired.status, 422, JSON.stringify(hired.body));
    assert.equal(code(hired), "runtime_cannot_run_employees");
  });
});
